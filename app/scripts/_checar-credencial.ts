#!/usr/bin/env tsx
// READ-ONLY: pergunta ao produto se cada empresa consegue emitir, usando a
// MESMA guarda que a emissão real usa (`resolverCredencialEmissao`).
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
const env: Record<string, string> = {};
for (const l of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = l.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
for (const k of Object.keys(env)) process.env[k] = env[k];

async function main() {
  const { resolverCredencialEmissao, MENSAGEM_RECUSA } = await import('../src/lib/fiscal/resolver-credencial');
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: empresas } = await sb.from('companies').select('id, nome, cnpj').is('deleted_at', null);
  for (const e of empresas ?? []) {
    const r = await resolverCredencialEmissao(e.id);
    console.log(r.ok
      ? `  EMITE   ${e.nome.padEnd(22)} ambiente=${r.ambiente} token=${r.token.slice(0, 6)}...`
      : `  recusa  ${e.nome.padEnd(22)} ${r.motivo}: ${MENSAGEM_RECUSA[r.motivo].slice(0, 70)}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
