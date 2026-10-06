// Varredura diária da RECEITA FEDERAL (Integra Contador): Caixa Postal do
// e-CAC (0110) e Relatório de Situação Fiscal (0111). Análise de 06/10/2026.
//
// ⚠️ POR QUE UMA ROTA PRÓPRIA, e não mais uma etapa de /api/cron/obrigacoes:
// aquele cron tem `maxDuration = 60` compartilhado entre materialização das
// obrigações, e-mails, WhatsApp, conciliação, pagamentos SERPRO, billing e
// apuração — já no limite. As consultas à Receita são as chamadas mais lentas
// (mTLS + token de procurador + a espera de geração do SITFIS), e espremê-las
// lá dentro trocaria aviso fiscal por tempo de e-mail. Aqui elas têm 60s só
// delas.
//
// ⚠️ AGENDAMENTO: o plano da Vercel já usa os 2 crons permitidos
// (`vercel.json`). Esta rota é disparada pelo pg_cron + pg_net, como
// `whatsapp-encerrar` — o job vive em `scratchpad/_agendar-cron-receita.mjs`,
// fora do git, porque carrega o CRON_SECRET de produção.
import 'server-only';
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checarCron } from '@/lib/security/segredo';
import { rodarCaixaPostal } from '@/lib/fiscal/caixa-postal-sync';
import { rodarSitfis } from '@/lib/fiscal/sitfis-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Orçamentos, em ordem. Somam 50s, deixando folga para a autenticação do
 * contratante e o corte por wall-clock (que try/catch não pega).
 * A Caixa Postal vem primeiro: intimação tem prazo; o relatório é semanal.
 */
const ORCAMENTO_CAIXA_POSTAL_MS = 22_000;
const ORCAMENTO_SITFIS_MS = 28_000;

export async function GET(req: Request) {
  const recusa = checarCron(req);
  if (recusa) return NextResponse.json(recusa.body, { status: recusa.status });

  const admin = createAdminClient();

  let caixaPostal: unknown = null;
  try {
    caixaPostal = await rodarCaixaPostal(admin, { orcamentoMs: ORCAMENTO_CAIXA_POSTAL_MS });
  } catch (err) {
    console.error('[cron receita] caixa postal falhou', err);
    caixaPostal = { erro: String(err) };
  }

  let sitfis: unknown = null;
  try {
    sitfis = await rodarSitfis(admin, { orcamentoMs: ORCAMENTO_SITFIS_MS });
  } catch (err) {
    console.error('[cron receita] sitfis falhou', err);
    sitfis = { erro: String(err) };
  }

  const resumo = { ok: true, caixa_postal: caixaPostal, sitfis };
  console.log('[cron receita]', JSON.stringify(resumo));
  return NextResponse.json(resumo);
}
