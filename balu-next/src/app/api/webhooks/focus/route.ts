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
  // NFSe Nacional / DPS
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

    const chave = body.chave_nfe ?? null;
    const numero = body.numero != null ? String(body.numero) : (body.numero_nfse != null ? String(body.numero_nfse) : null);
    const serie = body.serie != null ? String(body.serie) : null;
    const pdf = body.pdf_url ?? body.caminho_danfe ?? body.caminho_danfse ?? null;
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
      chave_acesso: chave,
      pdf_url: pdf,
      xml_url: xml,
      protocolo_autorizacao: protocolo,
      numero_nf: numero,
      serie: serie,
      payload_focusnfe: requestAnterior
        ? { request: requestAnterior, callback: body }
        : { callback: body },
      updated_at: new Date().toISOString(),
    };

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
