import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.resolve(__dirname, '../.env.local'), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#')) continue;
  const eq = t.indexOf('='); if (eq < 0) continue;
  const k = t.slice(0, eq).trim(), v = t.slice(eq + 1).trim();
  if (!process.env[k]) process.env[k] = v;
}

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const COMPANY_ID = '41a9c2a4-241f-40b0-a1c5-da3fced49359';

const before = await admin
  .from('empresas_fiscais')
  .select('empresa_id, sincronizacao_inicial_serpro_at')
  .eq('empresa_id', COMPANY_ID)
  .is('deleted_at', null)
  .maybeSingle();

if (before.error) { console.error('Erro select:', before.error.message); process.exit(1); }
console.log('ANTES  sincronizacao_inicial_serpro_at:', before.data?.sincronizacao_inicial_serpro_at ?? 'NULL');

const upd = await admin
  .from('empresas_fiscais')
  .update({ sincronizacao_inicial_serpro_at: null })
  .eq('empresa_id', COMPANY_ID)
  .is('deleted_at', null)
  .select('empresa_id, sincronizacao_inicial_serpro_at');

if (upd.error) { console.error('Erro update:', upd.error.message); process.exit(1); }
console.log('DEPOIS sincronizacao_inicial_serpro_at:', upd.data?.[0]?.sincronizacao_inicial_serpro_at ?? 'NULL');
console.log('linhas afetadas:', upd.data?.length ?? 0);
