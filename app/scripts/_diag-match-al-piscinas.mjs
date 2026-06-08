import fs from 'node:fs';
import path from 'node:path';
import Module from 'node:module';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.resolve(__dirname, '../.env.local'), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#')) continue;
  const eq = t.indexOf('='); if (eq < 0) continue;
  const k = t.slice(0, eq).trim(), v = t.slice(eq + 1).trim();
  if (!process.env[k]) process.env[k] = v;
}
const mod = Module; const orig = mod._load;
mod._load = function (req, p, m) { if (req === 'server-only') return {}; return orig.call(this, req, p, m); };

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const COMPANY_ID = '41a9c2a4-241f-40b0-a1c5-da3fced49359';
const YEAR = Number(process.env.YEAR ?? 2026);
const norm = (v) => String(v ?? '').replace(/\D+/g, '').replace(/^0+/, '');

const { consultarDeclaracoesSimples } = await import('../src/lib/fiscal/serpro-consulta.ts');
const { consultarPagamentosDas } = await import('../src/lib/fiscal/serpro-pagamentos.ts');

console.log('=== guias_fiscais atuais ===');
const { data: guias } = await admin.from('guias_fiscais')
  .select('competencia_referencia, numero_das, valor_total, status')
  .eq('company_id', COMPANY_ID).is('deleted_at', null)
  .order('competencia_referencia', { ascending: false });
for (const g of guias ?? []) console.log(g.competencia_referencia, '| das', String(g.numero_das ?? '—').padEnd(20), '| total', g.valor_total, '| status', g.status);

console.log('\n=== CONSDECLARACAO13 (situações) ===');
const sit = await consultarDeclaracoesSimples(admin, COMPANY_ID, YEAR);
if (!sit.ok) { console.error('FALHOU:', sit.error); process.exit(1); }
for (const s of sit.situacoes) console.log(s.competencia, '| numeroDas', String(s.numeroDas ?? '—').padEnd(20), '| norm', norm(s.numeroDas).padEnd(18), '| status', s.status, '| decl?', s.numeroDeclaracao ? 'sim' : 'não');

console.log('\n=== PAGAMENTOS71 ===');
const pag = await consultarPagamentosDas(admin, COMPANY_ID, YEAR);
if (!pag.ok) { console.error('FALHOU:', pag.error); process.exit(1); }
const mapa = new Map();
for (const p of pag.pagamentos) { const k = norm(p.numeroDocumento); if (k) mapa.set(k, p); console.log(p.competencia, '| doc', String(p.numeroDocumento).padEnd(18), '| norm', k.padEnd(18), '| total', p.valorTotal); }

console.log('\n=== MATCH situação.numeroDas ↔ pagamento.numeroDocumento ===');
for (const s of sit.situacoes) {
  const hit = s.numeroDas ? mapa.get(norm(s.numeroDas)) : undefined;
  console.log(s.competencia, hit ? `✅ casa → R$ ${hit.valorTotal}` : `❌ sem match (status ${s.status})`);
}
