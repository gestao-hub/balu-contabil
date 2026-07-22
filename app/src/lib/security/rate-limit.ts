import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

/** true = dentro do limite; false = estourou. Fail-open: se a RPC falhar, retorna true
 *  (não bloqueia usuário legítimo por indisponibilidade do rate-limiter). */
export async function limitar(chave: string, max: number, janelaSegs: number): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc('check_rate_limit', {
      p_chave: chave, p_max: max, p_janela_segs: janelaSegs,
    });
    if (error) return true;
    return data !== false;
  } catch {
    return true;
  }
}

/** Extrai um IP de cliente do header (best-effort) para compor a chave.
 *  Aceita tanto `Headers` (Request.headers) quanto `ReadonlyHeaders` (next/headers). */
export function ipDe(h: { get(name: string): string | null }): string {
  const xff = h.get('x-forwarded-for') ?? '';
  return xff.split(',')[0].trim() || 'sem-ip';
}
