import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReceitaApuracao } from './apuracao-types';
import { competenciaAddMonths, competenciaReferenciaBrt } from './guia';

/**
 * Lê as receitas necessárias para apurar `ateCompetencia` (a própria + 12 meses anteriores).
 *
 * DECISÃO FINAL (2026-05-31): OPÇÃO (b) — fonte canônica de receita é `notas_fiscais`.
 * A tabela `receitas_fiscais` é órfã (ninguém a popula, esvaziada sem backup) e está
 * descontinuada. Toda leitura de receita para apuração passa por esta função.
 */
export async function lerReceitasParaApuracao(
  supabase: SupabaseClient,
  companyId: string,
  ateCompetencia: string, // YYYYMM
): Promise<ReceitaApuracao[]> {
  const inicio = competenciaAddMonths(ateCompetencia, -12); // janela de 13 meses (incl. a atual)
  const inicioIso = `${inicio.slice(0, 4)}-${inicio.slice(4, 6)}-01T00:00:00-03:00`;

  const { data, error } = await supabase
    .from('notas_fiscais')
    .select('data_emissao, valor_total, status, tipo_documento, cnae')
    .eq('company_id', companyId)
    // 'ativa' = emissão real autorizada; 'lancada' = lançamento manual (NF emitida fora).
    // Ambas são receita válida → entram na base de imposto.
    .in('status', ['ativa', 'lancada'])
    .in('tipo_documento', ['NFSe', 'NFe', 'NFCe'])
    .gte('data_emissao', inicioIso);

  if (error) throw new Error(`Falha ao ler notas para apuração: ${error.message}`);

  return (data ?? [])
    .filter((n) => n.data_emissao != null && n.valor_total != null)
    .map((n) => {
      const competencia = competenciaReferenciaBrt(new Date(n.data_emissao as string));
      return { competencia, valor: Number(n.valor_total), cnae: (n.cnae as string | null) ?? null };
    });
}
