import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReceitaApuracao } from './apuracao-types';
import { competenciaAddMonths } from './guia';

/**
 * Lê as receitas necessárias para apurar `ateCompetencia` (a própria + 12 meses anteriores).
 *
 * PROVISÓRIO (2026-05-29): implementa a OPÇÃO (b) — lê de `notas_fiscais`.
 * A tabela `receitas_fiscais` é órfã (ninguém a popula) e foi esvaziada sem backup.
 * Decisão final pendente do outro dev. Se virar opção (a), trocar SÓ o corpo desta função.
 */
export async function lerReceitasParaApuracao(
  supabase: SupabaseClient,
  companyId: string,
  ateCompetencia: string, // YYYYMM
): Promise<ReceitaApuracao[]> {
  const inicio = competenciaAddMonths(ateCompetencia, -12); // janela de 13 meses (incl. a atual)
  const inicioIso = `${inicio.slice(0, 4)}-${inicio.slice(4, 6)}-01T00:00:00`;

  const { data, error } = await supabase
    .from('notas_fiscais')
    .select('data_emissao, valor_total, status, tipo_documento')
    .eq('company_id', companyId)
    .eq('status', 'ativa')
    .gte('data_emissao', inicioIso);

  if (error) throw new Error(`Falha ao ler notas para apuração: ${error.message}`);

  return (data ?? [])
    .filter((n) => n.data_emissao != null && n.valor_total != null)
    .map((n) => {
      const d = new Date(n.data_emissao as string);
      const competencia = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      return { competencia, valor: Number(n.valor_total) };
    });
}
