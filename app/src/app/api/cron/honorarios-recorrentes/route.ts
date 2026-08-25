// src/app/api/cron/honorarios-recorrentes/route.ts
// Cron mensal (dia 1): materializa a competência corrente dos honorários
// recorrentes via RPC gerar_honorarios_recorrentes (idempotente pelo índice
// honorarios_recorrencia_unique). Mesmo padrão de auth do cron/sync-municipios.
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checarCron } from '@/lib/security/segredo';

export async function GET(req: Request) {
  const recusa = checarCron(req);
  if (recusa) return NextResponse.json(recusa.body, { status: recusa.status });
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('gerar_honorarios_recorrentes');
  if (error) {
    console.error('[cron honorarios]', error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, gerados: data ?? 0 });
}
