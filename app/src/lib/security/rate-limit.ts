import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

/** true = dentro do limite; false = estourou. Fail-open: se a RPC falhar, retorna true
 *  (não bloqueia usuário legítimo por indisponibilidade do rate-limiter). */
export async function limitar(chave: string, max: number, janelaSegs: number): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc('check_rate_limit', {
      // capa a chave: um valor gigante (ex.: e-mail forjado com KB) poderia estourar
      // o índice btree e cair no fail-open, contornando o limite.
      p_chave: chave.slice(0, 200), p_max: max, p_janela_segs: janelaSegs,
    });
    if (error) return true;
    return data !== false;
  } catch {
    return true;
  }
}

/** Normaliza um e-mail para compor a chave de rate-limit — o Supabase autentica
 *  case-insensitive, então sem isso o atacante dividiria o orçamento em variações
 *  de maiúsculas/minúsculas do mesmo e-mail. */
export function chaveEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Extrai um IP de cliente do header (best-effort) para compor a chave.
 *  Aceita tanto `Headers` (Request.headers) quanto `ReadonlyHeaders` (next/headers). */
export function ipDe(h: { get(name: string): string | null }): string {
  const xff = h.get('x-forwarded-for') ?? '';
  return xff.split(',')[0].trim() || 'sem-ip';
}
