// src/lib/fiscal/parametros.ts
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

export type LimitesFiscais = { mei: number; simples: number };
export const LIMITES_FALLBACK: LimitesFiscais = { mei: 81000, simples: 4800000 }; // LC 123/2006

/** Lê os tetos vigentes de parametros_fiscais (maior vigencia_inicio <= hoje). */
export async function getLimitesFiscais(supabase: SupabaseClient): Promise<LimitesFiscais> {
  const { data } = await supabase
    .from('parametros_fiscais')
    .select('chave, valor, vigencia_inicio')
    .in('chave', ['limite_mei', 'limite_simples'])
    .lte('vigencia_inicio', new Date().toISOString().slice(0, 10))
    .order('vigencia_inicio', { ascending: false });
  const pick = (k: string) => Number(data?.find((r) => r.chave === k)?.valor);
  return {
    mei: pick('limite_mei') || LIMITES_FALLBACK.mei,
    simples: pick('limite_simples') || LIMITES_FALLBACK.simples,
  };
}
