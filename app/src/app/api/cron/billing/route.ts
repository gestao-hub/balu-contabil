// Bloco 4A — endpoint do cron diario de billing.
//
// A rotina em si mora em `lib/billing/cron.ts`: um `route.ts` do App Router
// so pode exportar os handlers HTTP, e exportar a funcao daqui quebra o
// `next build`.
import { NextResponse } from 'next/server';
import { rodarBilling } from '@/lib/billing/cron';

// TEMPO DE EXECUCAO — 60s, o teto do plano Hobby da Vercel.
//
// Sem esta linha vale o default (10-15s), e a rotina JA nao cabia: sao chamadas
// HTTP ao Asaas COM RETRY E BACKOFF, uma por assinatura, mais a varredura das
// subcontas do 4B (ate 50 paginas por escritorio). Timeout de wall-clock NAO e
// capturavel por try/catch: o processo morre antes do `NextResponse.json`, o
// resumo nunca chega e NADA retenta. A varredura do 4B roda por ULTIMO de
// proposito (ver `rodarBilling`), o que a torna a primeira coisa a ser
// sacrificada — ou seja, a rede de seguranca do escritorio cujo webhook nunca
// chega seria justamente o que deixaria de existir, em silencio.
export const maxDuration = 60;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET não configurado' }, { status: 500 });
  if ((req.headers.get('authorization') ?? '') !== `Bearer ${secret}`)
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  try {
    return NextResponse.json({ ok: true, ...(await rodarBilling()) });
  } catch (err) {
    console.error('[cron billing] falhou', err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
