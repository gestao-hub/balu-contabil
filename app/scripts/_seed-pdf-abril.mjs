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
const COMP = '202604';

const { gerarDasSimples } = await import('../src/lib/fiscal/serpro-das-simples.ts');
console.log('GERARDAS12', COMP, '...');
const r = await gerarDasSimples(admin, COMPANY_ID, COMP);
if (!r.ok) { console.error('FALHOU:', r.error); process.exit(1); }
if (r.result.semValor) { console.log('semValor (nada devido)'); process.exit(0); }
const d = r.result;
const upd = await admin.from('guias_fiscais').update({
  numero_das: d.numeroDas,
  valor_total: d.valores.total,
  valor_principal: d.valores.principal,
  valor_multa: d.valores.multa,
  valor_juros: d.valores.juros,
  data_vencimento: d.dataVencimento,
  linha_digitavel: d.codigoDeBarras.join(' '),
  url_pdf: d.pdfBase64 ? `data:application/pdf;base64,${d.pdfBase64}` : null,
  updated_at: new Date().toISOString(),
}).eq('company_id', COMPANY_ID).eq('competencia_referencia', COMP).select('numero_das, valor_total, url_pdf');
if (upd.error) { console.error('update:', upd.error.message); process.exit(1); }
const row = upd.data?.[0];
console.log('Abril atualizado → das', row?.numero_das, '| total', row?.valor_total, '| pdf', (row?.url_pdf || '').slice(0, 40) + '…');
