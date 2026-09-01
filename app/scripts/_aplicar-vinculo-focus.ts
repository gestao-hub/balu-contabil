#!/usr/bin/env tsx
/**
 * APLICA o vínculo na Focus das empresas indicadas, chamando o
 * `syncEmpresaNaFocus` do produto — não uma reimplementação.
 *
 * O que acontece por empresa (ver o cabeçalho de `focus-empresa-sync.ts`):
 *   1. procura o CNPJ na conta da Focus;
 *   2. achando, VINCULA (guarda `focus_empresa_id` + os dois tokens cifrados)
 *      em vez de criar — nenhuma empresa nova é cadastrada;
 *   3. se o município for nacional e a empresa vier sem NFS-e, envia o PUT que
 *      liga `habilita_nfsen_homologacao`.
 *
 * Autorizado pelo usuário em 01/09/2026, depois da prévia de
 * `_previa-vinculo-focus.ts` (que mostra o payload exato do PUT).
 *
 *   npx tsx --require ./scratchpad/shim-server-only.cjs scripts/_aplicar-vinculo-focus.ts
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env: Record<string, string> = {};
for (const l of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = l.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
for (const k of Object.keys(env)) process.env[k] = env[k];

async function main() {
  const { syncEmpresaNaFocus } = await import('../src/lib/fiscal/focus-empresa-sync');

  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const CNPJS = ['53015033000171', '10358425000120']; // MCB MARKETING, AL PISCINAS

  for (const cnpj of CNPJS) {
    const { data: company } = await sb
      .from('companies').select('id, nome').eq('cnpj', cnpj).is('deleted_at', null).maybeSingle();
    if (!company) { console.log(`${cnpj}: nao existe no Balu — pulado`); continue; }

    console.log(`\n>>> ${company.nome} (${cnpj})`);
    const r = await syncEmpresaNaFocus(sb, company.id);
    console.log(r.ok ? '    OK' : `    FALHOU: ${r.error}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
