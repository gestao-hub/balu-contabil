#!/usr/bin/env tsx
// O QR do WhatsApp EXPIRA (rotaciona em segundos). A pergunta desta sonda: para
// renovar, basta consultar /instance/status — que já traz `qrcode` — ou é
// preciso chamar /instance/connect de novo? A resposta decide se o polling da
// tela é uma chamada ou duas.
import { createClient } from '@supabase/supabase-js';
import { decifrarCampo } from '../src/lib/crypto/envelope';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const BASE = process.env.UAZAPI_BASE_URL!.replace(/\/+$/, '');

async function main() {
  const { data } = await sb.from('contabilidades').select('uazapi_token_cifrado').eq('status', 'aprovada').limit(1).maybeSingle();
  const token = decifrarCampo(data!.uazapi_token_cifrado as string)!;

  const hash = (s: string) => s ? `${s.length}c/${s.slice(30, 46)}` : '(vazio)';
  for (let i = 0; i < 6; i++) {
    const res = await fetch(`${BASE}/instance/status`, { headers: { token }, signal: AbortSignal.timeout(20_000) });
    const j = await res.json() as Record<string, unknown>;
    const inst = (j.instance ?? j) as Record<string, unknown>;
    const st = j.status as Record<string, unknown> | undefined;
    console.log(`t+${i * 10}s  status=${inst.status}  connected=${st?.connected}  qrcode=${hash(String(inst.qrcode ?? ''))}`);
    if (i < 5) await new Promise((r) => setTimeout(r, 10_000));
  }
}

main().catch((e) => { console.error('ERRO:', e instanceof Error ? e.message : e); process.exit(1); });
