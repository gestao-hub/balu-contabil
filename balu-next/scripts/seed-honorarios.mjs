/**
 * Gera 500 honorários de teste para Allan Valle (jan–jun 2026).
 * Statuses variados: pendente, pago, atrasado.
 * O trigger do banco seta 'atrasado' automaticamente quando
 * data_vencimento < CURRENT_DATE e data_pagamento IS NULL.
 *
 * Uso: node scripts/seed-honorarios.mjs
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

const COMPANY_ID  = 'efbf9e07-dd1b-4e46-8427-dcd15c872238';
const CLIENTE_ID  = '608d5e6c-9655-4c18-8ca8-196ed98ae8f1';
const USER_ID     = 'dd3fc6a0-b81a-4e37-8ee4-55ccf17d8f71';
const TODAY       = '2026-06-01';

// Seed simples mas determinístico
let seed = 42;
function rand() { seed = (seed * 1664525 + 1013904223) & 0x7fffffff; return seed / 0x7fffffff; }
function randInt(min, max) { return Math.floor(rand() * (max - min + 1)) + min; }
function randOf(arr) { return arr[Math.floor(rand() * arr.length)]; }

// Valor arredondado a 2 casas
function randValor() {
  const v = randInt(200, 5000) + randOf([0, 0.5, 0.9, 0.99]);
  return Math.round(v * 100) / 100;
}

// Retorna YYYY-MM-DD dado ano, mes (1-12), dia
function isoDate(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Último dia do mês
function lastDay(y, m) { return new Date(y, m, 0).getDate(); }

// Meses de jan a jun 2026
const MESES = [
  { ano: 2026, mes: 1, label: 'jan' },
  { ano: 2026, mes: 2, label: 'fev' },
  { ano: 2026, mes: 3, label: 'mar' },
  { ano: 2026, mes: 4, label: 'abr' },
  { ano: 2026, mes: 5, label: 'mai' },
  { ano: 2026, mes: 6, label: 'jun' },
];

const TOTAL = 500;
const POR_MES = Math.floor(TOTAL / MESES.length); // 83 por mês, 2 sobram nos últimos

const observacoes = [
  'Serviços de contabilidade', 'Honorários mensais', 'Consultoria fiscal',
  'Folha de pagamento', 'Declarações fiscais', 'Escrituração contábil',
  null, null, null, // maioria sem observação
];

const rows = [];

for (let mi = 0; mi < MESES.length; mi++) {
  const { ano, mes } = MESES[mi];
  const qtd = mi < TOTAL % MESES.length ? POR_MES + 1 : POR_MES;
  const mesRef = isoDate(ano, mes, 1);
  const ld = lastDay(ano, mes);
  const mesPassado = mesRef < TODAY; // meses anteriores ao atual

  for (let i = 0; i < qtd; i++) {
    const diaVenc = randInt(1, ld);
    const dataVenc = isoDate(ano, mes, diaVenc);
    const isPast = dataVenc < TODAY;

    // Define status baseado em quando vence e no índice do registro
    let status, dataPagamento;
    const r = rand();

    if (!isPast) {
      // Futuro: só pendente
      status = 'pendente';
      dataPagamento = null;
    } else if (mes <= 3 || r < 0.5) {
      // Passado: 50% pago
      status = 'pago';
      const diaPag = Math.min(diaVenc + randInt(1, 10), ld);
      dataPagamento = isoDate(ano, mes, diaPag);
    } else {
      // Passado: será marcado 'atrasado' pelo trigger
      status = 'atrasado';
      dataPagamento = null;
    }

    rows.push({
      company_id:      COMPANY_ID,
      cliente_id:      CLIENTE_ID,
      mes_referencia:  mesRef,
      valor:           randValor(),
      data_vencimento: dataVenc,
      data_pagamento:  dataPagamento,
      status,
      observacao:      randOf(observacoes),
    });
  }
}

console.log(`Gerando ${rows.length} honorários...`);

// Insere em lotes de 50
const LOTE = 50;
let criados = 0;
for (let i = 0; i < rows.length; i += LOTE) {
  const lote = rows.slice(i, i + LOTE);
  const { error } = await admin.from('honorarios').insert(lote);
  if (error) { console.error(`Erro no lote ${i}:`, error.message); process.exit(1); }
  criados += lote.length;
  process.stdout.write(`\r  ${criados}/${rows.length} inseridos...`);
}

console.log(`\n\n✅ ${criados} honorários criados.`);

// Resumo por mês e status
const { data: resumo } = await admin
  .from('honorarios')
  .select('mes_referencia, status')
  .eq('company_id', COMPANY_ID)
  .eq('cliente_id', CLIENTE_ID);

const por = {};
for (const r of resumo ?? []) {
  const k = `${r.mes_referencia?.slice(0, 7)} / ${r.status}`;
  por[k] = (por[k] || 0) + 1;
}
console.log('\nDistribuição:');
for (const [k, v] of Object.entries(por).sort()) console.log(`  ${k}: ${v}`);
