/**
 * Roda o motor de apuração da AL Piscinas direto, sem passar pela server action.
 * Importa os módulos compilados via tsx.
 */
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

// ─── helpers inline (sem imports @/ pra evitar path alias) ───────────────
function competenciaAddMonths(comp, n) {
  const y = Number(comp.slice(0, 4)), m = Number(comp.slice(4, 6));
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}${String((idx % 12) + 1).padStart(2, '0')}`;
}
function competenciaReferenciaBrt(date) {
  const brt = new Date(date.getTime() - 3 * 60 * 60 * 1000);
  return `${brt.getFullYear()}${String(brt.getMonth() + 1).padStart(2, '0')}`;
}
function brl(v) { return v == null ? '-' : `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`; }

// tabela Anexo III (LC 123/2006)
const ANEXO_III = [
  { faixa: 1, ate: 180000,   nominal: 0.06,  deduzir: 0 },
  { faixa: 2, ate: 360000,   nominal: 0.112, deduzir: 9360 },
  { faixa: 3, ate: 720000,   nominal: 0.135, deduzir: 17640 },
  { faixa: 4, ate: 1800000,  nominal: 0.16,  deduzir: 35640 },
  { faixa: 5, ate: 3600000,  nominal: 0.21,  deduzir: 125640 },
  { faixa: 6, ate: 4800000,  nominal: 0.33,  deduzir: 648000 },
];

function calcularSimples(receitas, competencia) {
  // Receita do mês
  const receitaMes = receitas
    .filter(r => r.competencia === competencia)
    .reduce((a, r) => a + r.valor, 0);

  // RBT12: 12 meses anteriores (exclui a competência atual)
  const inicio = competenciaAddMonths(competencia, -12);
  const fim    = competenciaAddMonths(competencia, -1);
  const rbt12  = receitas
    .filter(r => r.competencia >= inicio && r.competencia <= fim)
    .reduce((a, r) => a + r.valor, 0);

  const faixa = ANEXO_III.find(f => rbt12 <= f.ate) ?? ANEXO_III.at(-1);
  const aliquota = rbt12 <= 0 ? 0 : Math.max(0, (rbt12 * faixa.nominal - faixa.deduzir) / rbt12);
  const valorImposto = Number((receitaMes * aliquota).toFixed(2));

  return { receitaMes, rbt12, faixa: faixa.faixa, aliquotaNominal: faixa.nominal, aliquotaEfetiva: aliquota, valorImposto, inicio, fim };
}

// ─── buscar notas (janela 13 meses) ─────────────────────────────────────
const agora = new Date();
const competenciaAtual = competenciaReferenciaBrt(agora);
const janela = competenciaAddMonths(competenciaAtual, -12);
const inicioIso = `${janela.slice(0,4)}-${janela.slice(4,6)}-01T00:00:00-03:00`;

const { data: notas } = await admin
  .from('notas_fiscais')
  .select('data_emissao, valor_total, status, tipo_documento')
  .eq('company_id', COMPANY_ID)
  .eq('status', 'ativa')
  .gte('data_emissao', inicioIso);

const receitas = (notas ?? []).map(n => ({
  competencia: competenciaReferenciaBrt(new Date(n.data_emissao)),
  valor: Number(n.valor_total),
  tipo: n.tipo_documento,
}));

console.log('=== RECEITAS ENCONTRADAS ===');
console.log(`Total notas: ${receitas.length}`);
console.log('Tipos:', [...new Set(receitas.map(r => r.tipo))].join(', ') || '(nenhuma)');
const porComp = {};
for (const r of receitas) porComp[r.competencia] = (porComp[r.competencia] || 0) + r.valor;
for (const [c, v] of Object.entries(porComp).sort()) console.log(`  ${c}: ${brl(v)}`);

// ─── calcular para competência atual e anterior ──────────────────────────
for (const comp of [competenciaAddMonths(competenciaAtual, -1), competenciaAtual]) {
  const r = calcularSimples(receitas, comp);
  console.log(`\n=== APURAÇÃO ${comp} ===`);
  console.log('  Receita do mês  :', brl(r.receitaMes));
  console.log('  Janela RBT12    :', r.inicio, '→', r.fim);
  console.log('  RBT12           :', brl(r.rbt12));
  console.log('  Faixa           :', r.faixa);
  console.log('  Alíquota nominal:', (r.aliquotaNominal * 100).toFixed(1) + '%');
  console.log('  Alíquota efetiva:', (r.aliquotaEfetiva * 100).toFixed(2) + '%');
  console.log('  IMPOSTO         :', brl(r.valorImposto));

  if (r.rbt12 === 0 && r.receitaMes > 0) {
    console.log('  ⚠️  RBT12=0 → alíquota zerada. Empresa sem histórico 12 meses anteriores.');
    console.log('     Correto pela LC 123: 1ª faixa nominal seria ' + (r.aliquotaNominal * 100).toFixed(1) + '% mas sem dataInicioAtividade não há anualização.');
  }
}

// ─── diagnóstico do bug 202605 ───────────────────────────────────────────
console.log('\n=== DIAGNÓSTICO: por que 202605 zerou? ===');
const r05 = calcularSimples(receitas, '202605');
console.log('  RBT12 janela 202505→202604:', brl(r05.rbt12), '(zero = sem notas nesse período)');
console.log('  campo "dataInicioAtividade" no schema: AUSENTE → sem anualização possível');
console.log('  alíquota efetiva com RBT12=0:', (r05.aliquotaEfetiva * 100).toFixed(2) + '%  ← bug');
