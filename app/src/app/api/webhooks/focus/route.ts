// @custom — Onda 4 hardening — Webhook handler de callbacks do Focus NFe.
// Focus chama este endpoint quando o status de uma nota muda (autorizada, rejeitada, cancelada...).
import 'server-only';
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { mapStatusFocus } from '@/lib/fiscal/focus-status';
import { extrairCamposNota } from '@/lib/fiscal/nfse-callback';
import { limitar, ipDe } from '@/lib/security/rate-limit';
import { segredoOk } from './segredo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

let _admin: SupabaseClient | null = null;
function admin(): SupabaseClient {
  if (_admin) return _admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error('Supabase admin client não configurado');
  _admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _admin;
}

type FocusCallback = {
  ref?: string;
  status?: string;
  mensagem?: string;
  // NFe/NFCe
  chave_nfe?: string;
  protocolo?: string;
  numero?: string | number;
  serie?: string | number;
  caminho_xml_nota_fiscal?: string;
  caminho_danfe?: string;
  // NFSe Nacional / DPS (callback real, validado 2026-05-28):
  //   url_danfse → S3 pré-assinada do PDF (USAR ESTE pra pdf_url)
  //   caminho_xml_nota_fiscal → path relativo do XML (prependar base Focus)
  //   url → consulta pública NFSe Nacional
  //   codigo_verificacao → SEFAZ/Receita
  url_danfse?: string;
  url?: string;
  caminho_xml_nfse?: string;
  caminho_danfse?: string;
  numero_nfse?: string | number;
  codigo_verificacao?: string;
  // genéricos
  pdf_url?: string;
  xml_url?: string;
  [k: string]: unknown;
};

export async function POST(req: Request) {
  if (!(await limitar(`focus-webhook:${ipDe(req.headers)}`, 300, 60))) {
    return NextResponse.json({ ok: false, reason: 'rate_limited' }, { status: 200 });
  }
  if (!segredoOk(req)) {
    console.warn('[webhook focus] segredo inválido/ausente');
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 200 });
  }

  let body: FocusCallback;
  try {
    body = (await req.json()) as FocusCallback;
  } catch {
    // Sempre 200 — Focus retenta em 4xx/5xx e não queremos loop.
    return NextResponse.json({ ok: false, reason: 'invalid_json' }, { status: 200 });
  }

  const ref = body.ref;
  if (!ref) {
    return NextResponse.json({ ok: false, reason: 'missing_ref' }, { status: 200 });
  }

  try {
    const sb = admin();

    // Coletando o que veio no callback. Callbacks de cancelamento normalmente só
    // trazem `status` — qualquer campo ausente NÃO deve sobrescrever o valor
    // gravado anteriormente (autorização). Por isso o `update` abaixo só inclui
    // colunas quando o callback de fato as trouxe.
    // Mapeamento de campos centralizado em `extrairCamposNota` (lida com a
    // diferença NFS-e ↔ NF-e: chave vem em `codigo_verificacao`, sem protocolo).
    const { chaveAcesso: chave, protocolo, numero, serie, pdf, xml } =
      extrairCamposNota(body);

    // ─── A NOTA É RESOLVIDA POR id, NUNCA POR `referencia` SOLTA ────────────
    //
    // `referencia` NÃO é única no banco: o índice é
    // `idx_notas_fiscais_company_id_referencia`, ou seja, único POR EMPRESA.
    // Duas empresas podem legitimamente carregar a mesma string.
    //
    // O que isso armava, com este handler rodando em service_role: um membro de
    // escritório LÊ a `referencia` de uma nota do cliente (a policy
    // `notas_fiscais_select_contador` permite), INSERE uma nota na PRÓPRIA
    // empresa com essa mesma `referencia` (a policy de insert só exige
    // `user_owns_company`, não diz nada sobre o valor), e espera. O callback
    // seguinte do cliente escrevia `status`, `chave_acesso`, `protocolo`,
    // `pdf_url`, `xml_url` e o payload inteiro nas DUAS linhas — e a segunda é
    // dele, então `/notas_fiscais/[id]/download` passa a servir o documento
    // fiscal do cliente.
    //
    // A leitura anterior usava `.maybeSingle()` no mesmo filtro, o que com duas
    // linhas devolve erro PGRST116 — e o erro era descartado, então nem sinal
    // ficava.
    //
    // QUAL LINHA É A LEGÍTIMA, quando há mais de uma: a MAIS ANTIGA. A
    // `referencia` é um UUID gerado em `generateRef` no instante da emissão; para
    // plantar uma cópia é preciso primeiro LER a original, o que só é possível
    // depois que ela existe. A ordenação por `created_at` é, portanto, a ordem
    // entre original e cópia — e não uma heurística.
    const { data: candidatas, error: leituraErr } = await sb
      .from('notas_fiscais')
      .select('id, company_id, payload_focusnfe, created_at')
      .eq('referencia', ref)
      .order('created_at', { ascending: true })
      .limit(5);

    if (leituraErr) {
      console.error('[webhook focus] erro lendo notas_fiscais', { ref, error: leituraErr.message });
      return NextResponse.json({ ok: true });
    }
    if (!candidatas || candidatas.length === 0) {
      console.warn('[webhook focus] callback sem nota correspondente', { ref });
      return NextResponse.json({ ok: true });
    }
    if (candidatas.length > 1) {
      // Não é ruído: a única forma de duas empresas terem o mesmo UUID de
      // referência é alguém ter copiado. Grita com os ids para a investigação.
      console.error('[webhook focus] REFERENCIA DUPLICADA ENTRE EMPRESAS — possível cópia deliberada', {
        ref,
        linhas: candidatas.map((c) => ({ id: c.id, company_id: c.company_id, created_at: c.created_at })),
      });
    }
    const notaAtual = candidatas[0];

    const requestAnterior = (notaAtual?.payload_focusnfe as { request?: unknown } | null)?.request ?? null;

    const update: Record<string, unknown> = {
      status: mapStatusFocus(body.status),
      payload_focusnfe: requestAnterior
        ? { request: requestAnterior, callback: body }
        : { callback: body },
      updated_at: new Date().toISOString(),
    };
    // Só inclui campos que VIERAM no callback — evita "limpar" dados gravados
    // pelo callback de autorização anterior quando chega o de cancelamento.
    if (chave) update.chave_acesso = chave;
    if (pdf) update.pdf_url = pdf;
    if (xml) update.xml_url = xml;
    if (protocolo) update.protocolo_autorizacao = protocolo;
    if (numero) update.numero_nf = numero;
    if (serie) update.serie = serie;

    // Por `id`, e não por `referencia`: ver o bloco acima.
    const { error } = await sb.from('notas_fiscais').update(update).eq('id', notaAtual.id);
    if (error) {
      console.error('[webhook focus] erro update notas_fiscais', { ref, error: error.message });
    }
  } catch (err) {
    console.error('[webhook focus] erro inesperado', err);
  }

  // SEMPRE 200 — Focus retenta em 4xx/5xx.
  return NextResponse.json({ ok: true }, { status: 200 });
}
