// src/lib/fiscal/parametros.ts
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SALARIO_MINIMO_FALLBACK } from './das-mei';
import { TABELA_SIMPLES_FALLBACK, type TabelaSimples } from './simples';
import { lerTabelaSimples, dataDaCompetencia } from './parametros-schema';
import { ymdBrt } from './tempo-brt';

export type LimitesFiscais = { mei: number; simples: number };
export const LIMITES_FALLBACK: LimitesFiscais = { mei: 81000, simples: 4800000 }; // LC 123/2006

/**
 * Lê os tetos vigentes de parametros_fiscais (maior vigencia_inicio <= hoje).
 *
 * "Hoje" é BRT, não UTC. Vigência fiscal é data de CALENDÁRIO brasileiro, e a
 * Vercel roda em UTC: com `toISOString()` a data já virou nas últimas 3h do dia
 * daqui, e um teto novo (o limite do MEI muda em 1º de janeiro) passava a valer
 * às 21h do dia 31 — mudando o semáforo de "irregular" antes da hora. É o
 * mesmo erro de 1 dia que `ymdBrt` existe para eliminar, e que o resto do
 * domínio fiscal já evita.
 */
export async function getLimitesFiscais(supabase: SupabaseClient): Promise<LimitesFiscais> {
  const { data } = await supabase
    .from('parametros_fiscais')
    .select('chave, valor, vigencia_inicio')
    .in('chave', ['limite_mei', 'limite_simples'])
    .lte('vigencia_inicio', ymdBrt())
    .order('vigencia_inicio', { ascending: false });
  const pick = (k: string) => Number(data?.find((r) => r.chave === k)?.valor);
  return {
    mei: pick('limite_mei') || LIMITES_FALLBACK.mei,
    simples: pick('limite_simples') || LIMITES_FALLBACK.simples,
  };
}

/** Os parâmetros datados que o cálculo precisa para uma competência. */
export type ParametrosDaCompetencia = {
  tabelaSimples: TabelaSimples;
  salarioMinimo: number;
};

/**
 * Lê a tabela do Simples e o salário mínimo vigentes NA COMPETÊNCIA (migration
 * 0079). Uma consulta só para os dois — são a mesma tabela e o mesmo critério
 * de vigência, e o cálculo precisa dos dois juntos.
 *
 * Nunca lança e nunca devolve vazio: banco fora do ar, linha ausente ou JSON
 * torto caem no fallback do módulo, com o motivo no log. Imposto que some por
 * falha de leitura seria pior do que imposto calculado com a tabela anterior —
 * e a tabela anterior é o que já estava em produção até esta migration.
 */
export async function getParametrosDaCompetencia(
  supabase: SupabaseClient,
  competencia: string,
): Promise<ParametrosDaCompetencia> {
  const ate = dataDaCompetencia(competencia);
  let linhas: Array<{ chave: string; valor: number | null; valor_json: unknown }> = [];
  try {
    const { data, error } = await supabase
      .from('parametros_fiscais')
      .select('chave, valor, valor_json, vigencia_inicio')
      .in('chave', ['tabela_simples', 'salario_minimo'])
      .lte('vigencia_inicio', ate)
      // Descendente + "primeiro que casa" = a vigência mais recente que já
      // começou. É o mesmo desenho de getLimitesFiscais, com a diferença de
      // comparar contra a competência em vez de hoje.
      .order('vigencia_inicio', { ascending: false });
    if (error) throw new Error(error.message);
    linhas = (data ?? []) as typeof linhas;
  } catch (err) {
    console.error('[parametros] leitura falhou; usando fallback do código', err);
  }

  const primeira = (chave: string) => linhas.find((l) => l.chave === chave);

  const tabelaBruta = primeira('tabela_simples')?.valor_json;
  const tabela = tabelaBruta == null ? null : lerTabelaSimples(tabelaBruta);
  if (tabelaBruta != null && tabela === null) {
    console.error('[parametros] tabela_simples inválida em parametros_fiscais; usando fallback');
  }

  const smBruto = Number(primeira('salario_minimo')?.valor);
  const salarioMinimo = Number.isFinite(smBruto) && smBruto > 0 ? smBruto : SALARIO_MINIMO_FALLBACK;

  return { tabelaSimples: tabela ?? TABELA_SIMPLES_FALLBACK, salarioMinimo };
}
