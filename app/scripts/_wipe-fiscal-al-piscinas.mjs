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

const g = await admin.from('guias_fiscais').delete().eq('company_id', COMPANY_ID).select('id');
if (g.error) { console.error('guias_fiscais:', g.error.message); process.exit(1); }
console.log('guias_fiscais apagadas      :', g.data?.length ?? 0);

const d = await admin.from('declaracoes_fiscais').delete().eq('company_id', COMPANY_ID).select('id');
if (d.error) { console.error('declaracoes_fiscais:', d.error.message); process.exit(1); }
console.log('declaracoes_fiscais apagadas:', d.data?.length ?? 0);

const u = await admin.from('empresas_fiscais')
  .update({ sincronizacao_inicial_serpro_at: null })
  .eq('empresa_id', COMPANY_ID).is('deleted_at', null)
  .select('empresa_id, sincronizacao_inicial_serpro_at');
if (u.error) { console.error('empresas_fiscais:', u.error.message); process.exit(1); }
console.log('sincronizacao_inicial_serpro_at →', u.data?.[0]?.sincronizacao_inicial_serpro_at ?? 'NULL');
