import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AnexoSimples } from './regime';
import type { ReceitaApuracao, PreviewImposto } from './apuracao-types';
import { calcularApuracao } from './apuracao';
import type { TabelaSimples } from './simples';
import { getParametrosDaCompetencia } from './parametros';
import { lerReceitasParaApuracao } from './receitas-source';
import { anexarAnexosDasReceitas } from './segregacao';
import { resolverAnexoEmpresa } from './cnae-sync';
import { competenciaReferenciaBrt } from './guia';

// Mapeia o resultado da apuração para a prévia. Puro (sem Supabase) → testável.
// Regime Normal lança RegimeNaoSuportadoError; Simples sem anexo lança Error —
// ambos viram 'indisponivel' (sem prévia, sem quebrar a emissão).
export function montarPreview(input: {
  regimeCode: string;
  anexo: AnexoSimples | null;
  receitas: ReceitaApuracao[];
  competencia: string;
  atividadeMei?: string | null;
  tabelaSimples?: TabelaSimples | null;
  salarioMinimo?: number | null;
}): PreviewImposto {
  try {
    const r = calcularApuracao({
      regimeCode: input.regimeCode,
      anexo: input.anexo,
      receitas: input.receitas,
      competencia: input.competencia,
      atividadeMei: input.atividadeMei ?? null,
      tabelaSimples: input.tabelaSimples,
      salarioMinimo: input.salarioMinimo,
    });
    if (r.tipoApuracao === 'DAS-MEI') return { tipo: 'mei', valorFixo: r.valorImposto };
    // Simples sempre traz aliquotaEfetiva numérica; se vier null (caminho futuro),
    // não mostra estimativa zerada enganosa → indisponivel.
    if (r.aliquotaEfetiva == null) return { tipo: 'indisponivel' };
    return { tipo: 'simples', aliquota: r.aliquotaEfetiva };
  } catch {
    return { tipo: 'indisponivel' };
  }
}

// Busca regime/anexo + receitas e monta a prévia da competência atual.
export async function obterPreviewImposto(
  supabase: SupabaseClient,
  companyId: string,
): Promise<PreviewImposto> {
  const { data: fiscal } = await supabase
    .from('empresas_fiscais')
    .select('Code_regime_tributario, anexo_simples, atividade_mei')
    .eq('empresa_id', companyId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!fiscal?.Code_regime_tributario) return { tipo: 'indisponivel' };

  const competencia = competenciaReferenciaBrt();
  const receitas = await lerReceitasParaApuracao(supabase, companyId, competencia);
  // Mesmo fallback da apuração: resolve o anexo via CNAE/Fator R (não o anexo_simples cru).
  const resolvido = await resolverAnexoEmpresa(
    supabase, companyId, (fiscal.anexo_simples as AnexoSimples | null) ?? null, competencia,
  );
  const fallbackAnexo = resolvido.anexo;
  const receitasAnexadas = await anexarAnexosDasReceitas(supabase, companyId, competencia, receitas, fallbackAnexo);
  // Mesmos parâmetros datados da apuração de verdade (0079). Se a prévia usasse
  // uma tabela e a apuração outra, o cliente veria um número na tela e outro na
  // guia — e a divergência apareceria só depois de emitir.
  const parametros = await getParametrosDaCompetencia(supabase, competencia);
  return montarPreview({
    regimeCode: fiscal.Code_regime_tributario as string,
    anexo: fallbackAnexo,
    receitas: receitasAnexadas,
    competencia,
    atividadeMei: (fiscal.atividade_mei as string | null) ?? null,
    tabelaSimples: parametros.tabelaSimples,
    salarioMinimo: parametros.salarioMinimo,
  });
}
