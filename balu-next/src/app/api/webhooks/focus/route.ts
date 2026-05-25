// @custom — Onda 4 hardening — Webhook handler de callbacks do Focus NFe.
// Focus chama este endpoint quando o status de uma nota muda (autorizada, rejeitada, cancelada...).
import 'server-only';
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

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

// Mapeia status textual do Focus → status canônico interno.
function mapStatus(focusStatus: string | undefined | null): string {
  const s = (focusStatus ?? '').toLowerCase();
  if (s.includes('autorizado'))                                return 'autorizada';
  if (s.includes('cancelado'))                                 return 'cancelada';
  if (s.includes('denegado'))                                  return 'denegada';
  if (s.includes('erro') || s.includes('rejeitado'))           return 'rejeitada';
  if (s.includes('processando') || s.includes('em_processamento')) return 'processando';
  if (s.includes('inutilizado'))                               return 'inutilizada';
  return s || 'desconhecido';
}

type FocusCallback = {
  ref?: string;
  status?: string;
  mensagem?: string;
  chave_nfe?: string;
  caminho_xml_nota_fiscal?: string;
  caminho_danfe?: string;
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
    const update = {
      status: mapStatus(body.status),
      chave_acesso: body.chave_nfe ?? null,
      pdf_url: body.pdf_url ?? body.caminho_danfe ?? null,
      xml_url: body.xml_url ?? body.caminho_xml_nota_fiscal ?? null,
      focus_response: body as unknown as Record<string, unknown>,
      updated_at: new Date().toISOString(),
    };

    const { error } = await sb.from('notas_fiscais').update(update).eq('ref', ref);
    if (error) {
      console.error('[webhook focus] erro update notas_fiscais', { ref, error });
    }
  } catch (err) {
    console.error('[webhook focus] erro inesperado', err);
  }

  // SEMPRE 200 — Focus retenta em 4xx/5xx.
  return NextResponse.json({ ok: true }, { status: 200 });
}
