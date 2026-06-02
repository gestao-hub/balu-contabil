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

// 1. Dados fiscais
const { data: fiscal } = await admin
  .from('empresas_fiscais')
  .select('Code_regime_tributario, anexo_simples, empresa_fiscal_ativada')
  .eq('empresa_id', COMPANY_ID).is('deleted_at', null).maybeSingle();

console.log('=== DADOS FISCAIS ===');
console.log('regime code    :', fiscal?.Code_regime_tributario ?? 'NULL');
console.log('anexo_simples  :', fiscal?.anexo_simples ?? 'NULL');
console.log('fiscal ativada :', fiscal?.empresa_fiscal_ativada);

// 2. Notas fiscais (janela 13 meses)
const inicio = new Date();
inicio.setMonth(inicio.getMonth() - 12);
const inicioIso = inicio.toISOString().slice(0, 10) + 'T00:00:00-03:00';

const { data: notas, error: notasErr } = await admin
  .from('notas_fiscais')
  .select('data_emissao, valor_total, status, tipo_documento')
  .eq('company_id', COMPANY_ID)
  .eq('status', 'ativa')
  .gte('data_emissao', inicioIso)
  .order('data_emissao', { ascending: false });

console.log('\n=== NOTAS FISCAIS (últimos 13 meses, status=ativa) ===');
if (notasErr) { console.log('Erro:', notasErr.message); }
else if (!notas?.length) { console.log('Nenhuma nota encontrada.'); }
else {
  console.log(`Total: ${notas.length} notas`);
  const porTipo = {};
  for (const n of notas) {
    porTipo[n.tipo_documento] = (porTipo[n.tipo_documento] || 0) + 1;
  }
  console.log('Por tipo:', JSON.stringify(porTipo));

  // Agrupar por competência
  const porComp = {};
  for (const n of notas) {
    const d = new Date(n.data_emissao);
    const brt = new Date(d.getTime() - 3 * 60 * 60 * 1000);
    const comp = `${brt.getFullYear()}${String(brt.getMonth() + 1).padStart(2, '0')}`;
    porComp[comp] = (porComp[comp] || 0) + Number(n.valor_total);
  }
  console.log('\nReceita por competência:');
  for (const [comp, val] of Object.entries(porComp).sort()) {
    console.log(`  ${comp}: R$ ${val.toFixed(2)}`);
  }
}

// 3. Apurações existentes
const { data: apuracoes } = await admin
  .from('apuracoes_fiscais')
  .select('competencia_referencia, tipo_apuracao, receita_mes, valor_imposto, status')
  .eq('company_id', COMPANY_ID).is('deleted_at', null)
  .order('competencia_referencia', { ascending: false }).limit(6);

console.log('\n=== APURAÇÕES EXISTENTES ===');
if (!apuracoes?.length) console.log('Nenhuma apuração salva.');
else for (const a of apuracoes) {
  console.log(`  ${a.competencia_referencia} | ${a.tipo_apuracao} | receita R$ ${a.receita_mes} | imposto R$ ${a.valor_imposto} | ${a.status}`);
}

// 4. Competência atual
const now = new Date();
const brtNow = new Date(now.getTime() - 3 * 60 * 60 * 1000);
const competenciaAtual = `${brtNow.getFullYear()}${String(brtNow.getMonth() + 1).padStart(2, '0')}`;
console.log('\n=== COMPETÊNCIA ATUAL ===', competenciaAtual);
