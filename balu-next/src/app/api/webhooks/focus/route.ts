// @custom — Onda 4 hardening — Webhook handler de callbacks do Focus NFe.
// Focus chama este endpoint quando o status de uma nota muda (autorizada, rejeitada, cancelada...).
import 'server-only';
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { mapStatusFocus } from '@/lib/fiscal/focus-status';

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
  // TODO: Focus envia assinatura HMAC em algum header? Validar quando documentado.
  // Por ora confiamos em segredo na URL + IP allowlist no edge.

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
    const chave = body.chave_nfe ?? null;
    const numero = body.numero != null
      ? String(body.numero)
      : body.numero_nfse != null ? String(body.numero_nfse) : null;
    const serie = body.serie != null ? String(body.serie) : null;
    // PDF: NFSe Nacional manda `url_danfse` (S3 pré-assinada, sem auth);
    // NFe/NFCe legacy mandam `caminho_danfe` (path relativo da Focus).
    const pdf =
      body.pdf_url ?? body.url_danfse ?? body.caminho_danfe ?? body.caminho_danfse ?? null;
    // XML: NFSe Nacional manda `caminho_xml_nota_fiscal` (relativo).
    const xml = body.xml_url ?? body.caminho_xml_nota_fiscal ?? body.caminho_xml_nfse ?? null;
    const protocolo = body.protocolo ?? null;

    // Lê a nota antes pra preservar o `request` no payload_focusnfe.
    const { data: notaAtual } = await sb
      .from('notas_fiscais')
      .select('id, payload_focusnfe')
      .eq('referencia', ref)
      .maybeSingle();

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

    // Bug pré-existente fixado: a coluna é `referencia`, não `ref`.
    const { error } = await sb.from('notas_fiscais').update(update).eq('referencia', ref);
    if (error) {
      console.error('[webhook focus] erro update notas_fiscais', { ref, error: error.message });
    }
  } catch (err) {
    console.error('[webhook focus] erro inesperado', err);
  }

  // SEMPRE 200 — Focus retenta em 4xx/5xx.
  return NextResponse.json({ ok: true }, { status: 200 });
}
