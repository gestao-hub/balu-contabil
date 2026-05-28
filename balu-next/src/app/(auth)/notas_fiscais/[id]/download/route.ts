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

export const runtime = 'nodejs';

const ENV: FocusEnv = 'hom';
const FOCUS_BASE_HOM = 'https://homologacao.focusnfe.com.br';
const FOCUS_BASE_PROD = 'https://api.focusnfe.com.br';

function focusBase(env: FocusEnv): string {
  return env === 'prod' ? FOCUS_BASE_PROD : FOCUS_BASE_HOM;
}

function isAbsoluteUrl(s: string | null): s is string {
  return !!s && /^https?:\/\//i.test(s);
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
  const { data: profile } = await supabase
    .from('profiles').select('current_company').eq('user_id', user.id).single();
  const companyId = (profile?.current_company ?? null) as string | null;
  if (!companyId) return new Response('sem empresa', { status: 400 });

  const { data: nota } = await supabase
    .from('notas_fiscais')
    .select('tipo_documento, referencia, pdf_url, xml_url')
    .eq('id', id).eq('company_id', companyId).maybeSingle();
  if (!nota) return new Response('nota não encontrada', { status: 404 });

  const { data: company } = await supabase
    .from('companies').select('focus_token').eq('id', companyId).single();
  const focusToken = (company?.focus_token as string | null) ?? null;
  if (!focusToken) return new Response('empresa sem token Focus — sincronize antes', { status: 409 });

  const tipo = assertTipoDoc(nota.tipo_documento as string);
  const ref = nota.referencia as string;
  const savedUrl = (formato === 'pdf' ? (nota.pdf_url as string | null) : (nota.xml_url as string | null)) ?? null;

  try {
    if (formato === 'xml') {
      // 1) URL salva (NFSe Nacional vem com path relativo; legacy pode vir absoluto)
      if (savedUrl) {
        const url = isAbsoluteUrl(savedUrl) ? savedUrl : `${focusBase(ENV)}${savedUrl}`;
        const r = await fetch(url, { headers: { Authorization: basicAuth(focusToken) } });
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
      // NFSe Nacional: url_danfse é S3 pré-assinada (sem auth). Outros podem
      // exigir auth. Tentamos sem auth primeiro pra URLs absolutas; com auth
      // pra paths relativos.
      if (isAbsoluteUrl(savedUrl)) {
        const r = await fetch(savedUrl);
        if (r.ok) return pdfResponse(await r.arrayBuffer(), ref);
      } else {
        const url = `${focusBase(ENV)}${savedUrl}`;
        const r = await fetch(url, { headers: { Authorization: basicAuth(focusToken) } });
        if (r.ok) return pdfResponse(await r.arrayBuffer(), ref);
      }
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
