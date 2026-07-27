// Bloco 4A — endpoint do cron diario de billing.
//
// A rotina em si mora em `lib/billing/cron.ts`: um `route.ts` do App Router
// so pode exportar os handlers HTTP, e exportar a funcao daqui quebra o
// `next build`.
import { NextResponse } from 'next/server';
import { rodarBilling } from '@/lib/billing/cron';

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
