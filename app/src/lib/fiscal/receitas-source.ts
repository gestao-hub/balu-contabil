import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReceitaApuracao } from './apuracao-types';
import type { NotaReceita } from './declaracoes-anuais/tipos';
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

/**
 * Lê as notas de um ano-calendário para montar a declaração anual (DASN/DEFIS).
 *
 * A janela SQL é generosa de propósito (±1 dia nas pontas, em UTC): o recorte
 * exato do ano em BRT é feito por `resumirReceitasAno` (dasn/resumo.ts), que é
 * puro e testado. Filtrar por ano direto no SQL erraria a nota de 31/12 à noite.
 */
export async function lerNotasAnoCalendario(
  supabase: SupabaseClient,
  companyId: string,
  ano: number,
): Promise<NotaReceita[]> {
  const inicio = `${ano - 1}-12-31T00:00:00Z`;
  const fim = `${ano + 1}-01-02T00:00:00Z`;

  const { data, error } = await supabase
    .from('notas_fiscais')
    .select('data_emissao, valor_total, tipo_documento')
    .eq('company_id', companyId)
    .in('status', ['ativa', 'lancada'])
    .in('tipo_documento', ['NFSe', 'NFe', 'NFCe'])
    .gte('data_emissao', inicio)
    .lt('data_emissao', fim);

  if (error) throw new Error(`Falha ao ler notas do ano ${ano}: ${error.message}`);

  return (data ?? [])
    .filter((n) => n.data_emissao != null && n.valor_total != null)
    .map((n) => ({
      dataEmissao: n.data_emissao as string,
      valor: Number(n.valor_total),
      tipoDocumento: n.tipo_documento as NotaReceita['tipoDocumento'],
    }));
}
