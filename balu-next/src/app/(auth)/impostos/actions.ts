'use server';
// @custom — PR 3.1 — Dashboard de Impostos
// Server actions ligadas ao histórico de guias.
import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/supabase/server';
import type { AnexoSimples } from '@/lib/fiscal/regime';
import type { ResultadoApuracao } from '@/lib/fiscal/apuracao-types';
import { calcularApuracao, RegimeNaoSuportadoError } from '@/lib/fiscal/apuracao';
import { lerReceitasParaApuracao } from '@/lib/fiscal/receitas-source';

export type GuiaActionResult = { ok: true } | { ok: false; error: string };

/**
 * Marca uma guia como paga (PATCH status='paga' + data_pagamento=hoje).
 * Idempotente: clicar de novo não desfaz; pra "desmarcar" um dia exporemos
 * uma action separada (não pedida no PR 3.1).
 *
 * Valida ownership por `company_id == profile.current_company`.
 */
export async function marcarGuiaPagaAction(id: string): Promise<GuiaActionResult> {
  if (!id) return { ok: false, error: 'ID da guia ausente.' };

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  const { data: profile } = await supabase
    .from('profiles')
    .select('current_company')
    .eq('user_id', user.id)
    .single();
  const companyId = (profile?.current_company ?? null) as string | null;
  if (!companyId) return { ok: false, error: 'Nenhuma empresa selecionada.' };

  // YYYY-MM-DD no fuso de Brasília.
  const today = new Date();
  const brt = new Date(today.getTime() - 3 * 60 * 60 * 1000);
  const dataPagamento = brt.toISOString().slice(0, 10);

  const { error } = await supabase
    .from('guias_fiscais')
    .update({
      status: 'paga',
      data_pagamento: dataPagamento,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('company_id', companyId)
    .is('deleted_at', null);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/impostos');
  return { ok: true };
}

export type ApuracaoResult =
  | { ok: true; resultado: ResultadoApuracao }
  | { ok: false; error: string };

/**
 * Calcula a apuração de uma competência. modo='preview' só calcula; modo='commit' persiste.
 * competencia em YYYYMM.
 */
export async function iniciarApuracaoAction(
  competencia: string,
  modo: 'preview' | 'commit' = 'preview',
): Promise<ApuracaoResult> {
  if (!/^\d{6}$/.test(competencia)) {
    return { ok: false, error: 'Competência inválida (esperado YYYYMM).' };
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado.' };

  const { data: profile } = await supabase
    .from('profiles')
    .select('current_company')
    .eq('user_id', user.id)
    .single();
  const companyId = (profile?.current_company ?? null) as string | null;
  if (!companyId) return { ok: false, error: 'Nenhuma empresa ativa selecionada.' };

  const { data: fiscal } = await supabase
    .from('empresas_fiscais')
    .select('Code_regime_tributario, anexo_simples')
    .eq('empresa_id', companyId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!fiscal) return { ok: false, error: 'Empresa fiscal não configurada.' };

  const regimeCode = (fiscal.Code_regime_tributario ?? '') as string;
  const anexo = (fiscal.anexo_simples ?? null) as AnexoSimples | null;

  let resultado: ResultadoApuracao;
  try {
    const receitas = await lerReceitasParaApuracao(supabase, companyId, competencia);
    resultado = calcularApuracao({
      regimeCode,
      anexo,
      receitas,
      competencia,
      atividadeMei: fiscal.anexo_simples, // null p/ MEI → núcleo usa default serviços
      // dataInicioAtividade: não temos o campo no schema → sem anualização por ora
    });
  } catch (e) {
    if (e instanceof RegimeNaoSuportadoError) return { ok: false, error: e.message };
    return { ok: false, error: e instanceof Error ? e.message : 'Falha ao calcular apuração.' };
  }

  if (modo === 'preview') return { ok: true, resultado };

  const { error: upErr } = await supabase.from('apuracoes_fiscais').upsert(
    {
      company_id: companyId,
      owner_user_id: user.id,
      competencia_referencia: resultado.competencia,
      tipo_apuracao: resultado.tipoApuracao,
      anexo_simples: anexo,
      receita_mes: resultado.receitaMes,
      rbt12: resultado.rbt12,
      aliquota_efetiva: resultado.aliquotaEfetiva,
      valor_imposto: resultado.valorImposto,
      status: 'calculada',
      payload_calculo: resultado.breakdown,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'company_id,competencia_referencia' },
  );
  if (upErr) return { ok: false, error: `Falha ao salvar apuração: ${upErr.message}` };

  revalidatePath('/impostos');
  return { ok: true, resultado };
}
