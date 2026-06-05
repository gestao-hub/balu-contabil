import type { SupabaseClient } from '@supabase/supabase-js';
import type { FolhaMensal } from './folha';
import { competenciaAddMonths } from './guia';

/**
 * Lê a folha necessária para apurar `ateCompetencia` (a própria + 12 meses anteriores).
 * Espelha receitas-source.ts: janela de 13 meses por competência. RLS garante o tenant.
 */
export async function lerFolhaParaApuracao(
  supabase: SupabaseClient,
  companyId: string,
  ateCompetencia: string, // YYYYMM
): Promise<FolhaMensal[]> {
  const inicio = competenciaAddMonths(ateCompetencia, -12); // janela de 13 meses (incl. a atual)

  const { data, error } = await supabase
    .from('folha_mensal')
    .select('competencia, pro_labore, salarios, encargos')
    .eq('company_id', companyId)
    .gte('competencia', inicio)
    .lte('competencia', ateCompetencia);

  if (error) throw new Error(`Falha ao ler folha para apuração: ${error.message}`);

  return (data ?? []).map((r) => ({
    competencia: r.competencia as string,
    proLabore: Number(r.pro_labore ?? 0),
    salarios: Number(r.salarios ?? 0),
    encargos: Number(r.encargos ?? 0),
  }));
}
