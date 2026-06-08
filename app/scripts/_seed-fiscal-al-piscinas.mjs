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
const EMAIL = 'allanvalle@outlook.com';

// owner_user_id (RLS) — pega do dono do email.
const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
const user = users.users.find((u) => u.email?.toLowerCase() === EMAIL.toLowerCase());
if (!user) { console.error('usuário não encontrado'); process.exit(1); }
const owner = user.id;
const now = new Date().toISOString();

// Dados reais capturados (PAGAMENTOS71 p/ jan-mar pagos; GERARDAS12 p/ abril em aberto).
const guias = [
  { c: '202601', das: '07202605487268942', total: 12666.19, principal: 12624.53, multa: 41.66, juros: 0,     venc: '2026-02-20', pag: '2026-02-23', status: 'paga' },
  { c: '202602', das: '07202607966743256', total: 34564.56, principal: 34564.56, multa: 0,     juros: 0,     venc: '2026-03-20', pag: '2026-03-20', status: 'paga' },
  { c: '202603', das: '07202610733758790', total: 12911.50, principal: 12911.50, multa: 0,     juros: 0,     venc: '2026-04-20', pag: '2026-04-20', status: 'paga' },
  { c: '202604', das: '07202615946601503', total: 11079.48, principal: 10328.59, multa: 647.6, juros: 103.29, venc: '2026-05-20', pag: null,         status: 'gerada' },
];
const declas = [
  { c: '202601', nd: '10358425202601001', tx: '2026-02-23T13:00:00Z' },
  { c: '202602', nd: '10358425202602001', tx: '2026-03-20T13:00:00Z' },
  { c: '202603', nd: '10358425202603001', tx: '2026-04-17T13:00:00Z' },
  { c: '202604', nd: '10358425202604001', tx: '2026-05-18T13:00:00Z' },
];

const guiaRows = guias.map((g) => ({
  company_id: COMPANY_ID, owner_user_id: owner,
  competencia_referencia: g.c, competencia_mes: Number(g.c.slice(4, 6)), competencia_ano: Number(g.c.slice(0, 4)),
  numero_das: g.das, valor_total: g.total, valor_principal: g.principal, valor_multa: g.multa, valor_juros: g.juros,
  data_vencimento: g.venc, data_pagamento: g.pag, status: g.status, origem: 'serpro', updated_at: now, deleted_at: null,
}));
const declaRows = declas.map((d) => ({
  company_id: COMPANY_ID, owner_user_id: owner,
  competencia_referencia: d.c, tipo: 'PGDAS-D', numero_declaracao: d.nd, data_transmissao: d.tx, status: 'transmitida', updated_at: now,
}));

const g = await admin.from('guias_fiscais').upsert(guiaRows, { onConflict: 'company_id,competencia_referencia' }).select('id');
if (g.error) { console.error('guias:', g.error.message); process.exit(1); }
console.log('guias upsertadas      :', g.data?.length);

const d = await admin.from('declaracoes_fiscais').upsert(declaRows, { onConflict: 'company_id,competencia_referencia,tipo' }).select('id');
if (d.error) { console.error('declaracoes:', d.error.message); process.exit(1); }
console.log('declaracoes upsertadas:', d.data?.length);

const u = await admin.from('empresas_fiscais').update({ sincronizacao_inicial_serpro_at: now }).eq('empresa_id', COMPANY_ID).is('deleted_at', null).select('sincronizacao_inicial_serpro_at');
if (u.error) { console.error('flag:', u.error.message); process.exit(1); }
console.log('flag (gate dispensado):', u.data?.[0]?.sincronizacao_inicial_serpro_at);
