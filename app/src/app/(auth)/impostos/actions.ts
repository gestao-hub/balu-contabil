'use server';
// @custom — PR 3.1 — Dashboard de Impostos
// Server actions ligadas ao histórico de guias.
import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/supabase/server';
import { type AnexoSimples, tipoFromCode } from '@/lib/fiscal/regime';
import type { ResultadoApuracao } from '@/lib/fiscal/apuracao-types';
import { competenciaReferenciaBrt } from '@/lib/fiscal/guia';
import { consultarDeclaracoesSimples } from '@/lib/fiscal/serpro-consulta';
import { calcularApuracao, RegimeNaoSuportadoError } from '@/lib/fiscal/apuracao';
import { lerReceitasParaApuracao } from '@/lib/fiscal/receitas-source';
import { serpro, buildEnvelope, PGMEI_SERVICES, type ProdAuth } from '@/lib/clients/serpro';
import { parseDasMei } from '@/lib/fiscal/das-mei-parse';
import { resolveSerproEnv, demoInputs } from '@/lib/fiscal/serpro-env';

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
      atividadeMei: null, // TODO: adicionar empresas_fiscais.atividade_mei (MEI: 'Comercio ou Industria'|'Prestacao de Servicos'|'Comercio e Servicos'); sem o campo sempre cai em "Prestacao de Servicos" (R$80,90)
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
      deleted_at: null,
      payload_calculo: resultado.breakdown,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'company_id,competencia_referencia' },
  );
  if (upErr) return { ok: false, error: `Falha ao salvar apuração: ${upErr.message}` };

  revalidatePath('/impostos');
  return { ok: true, resultado };
}

export type GerarDasResult = { ok: true } | { ok: false; error: string };

export async function gerarDasMeiAction(competencia: string): Promise<GerarDasResult> {
  if (!/^\d{6}$/.test(competencia)) return { ok: false, error: 'Competência inválida (YYYYMM).' };

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado.' };

  const { data: profile } = await supabase
    .from('profiles').select('current_company').eq('user_id', user.id).single();
  const companyId = (profile?.current_company ?? null) as string | null;
  if (!companyId) return { ok: false, error: 'Nenhuma empresa ativa selecionada.' };

  const { data: company } = await supabase
    .from('companies').select('cnpj').eq('id', companyId).single();
  const { data: fiscal } = await supabase
    .from('empresas_fiscais')
    .select('Code_regime_tributario, certificado_access_token, certificado_jwt, certificado_token_expiration')
    .eq('empresa_id', companyId).is('deleted_at', null).maybeSingle();
  if (!fiscal) return { ok: false, error: 'Empresa fiscal não configurada.' };
  if (fiscal.Code_regime_tributario !== '4') {
    return { ok: false, error: 'Geração de DAS via Serpro na v1 cobre só MEI; Simples virá depois.' };
  }

  const env = resolveSerproEnv();

  // Trial: usa CNPJ/período de demonstração. Prod: CNPJ real + competência pedida.
  const cnpjReal = String(company?.cnpj ?? '').replace(/\D+/g, '');
  const cnpj = env === 'trial' ? demoInputs().cnpj : cnpjReal;
  const periodo = env === 'trial' ? demoInputs().periodo : competencia;

  let prodAuth: ProdAuth | undefined;
  if (env === 'prod') {
    const at = fiscal.certificado_access_token as string | null;
    const jwt = fiscal.certificado_jwt as string | null;
    const exp = fiscal.certificado_token_expiration as string | null;
    const expMs = exp ? new Date(exp).getTime() : NaN;
    if (!at || !jwt || Number.isNaN(expMs) || expMs <= Date.now()) {
      return { ok: false, error: 'Produção exige certificado autenticado + procuração (token Serpro ausente/expirado).' };
    }
    prodAuth = { accessToken: at, jwt };
  }

  let parsed;
  try {
    const envelope = buildEnvelope({
      cnpjContratante: cnpj,
      cnpjContribuinte: cnpj,
      idSistema: 'PGMEI',
      idServico: PGMEI_SERVICES.GERAR_DAS_PDF,
      versaoSistema: '1.0',
      dados: { periodoApuracao: periodo },
    });
    const resp = await serpro.emitirDasMei(env, envelope, prodAuth);
    parsed = parseDasMei(resp);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Falha ao gerar DAS no Serpro.' };
  }

  const mes = Number(competencia.slice(4, 6));
  const ano = Number(competencia.slice(0, 4));
  const { data: guia, error: upErr } = await supabase
    .from('guias_fiscais')
    .upsert(
      {
        company_id: companyId,
        owner_user_id: user.id,
        competencia_referencia: competencia,
        competencia_mes: mes,
        competencia_ano: ano,
        numero_das: parsed.numeroDocumento,
        valor_principal: parsed.valores.principal,
        valor_multa: parsed.valores.multa,
        valor_juros: parsed.valores.juros,
        valor_total: parsed.valores.total,
        data_vencimento: parsed.dataVencimento,
        linha_digitavel: parsed.codigoDeBarras.join(' '),
        codigo_barras: parsed.codigoDeBarras.join(''),
        url_pdf: parsed.pdfBase64 ? `data:application/pdf;base64,${parsed.pdfBase64}` : null,
        status: 'gerada',
        origem: 'serpro',
        updated_at: new Date().toISOString(),
        deleted_at: null,
      },
      { onConflict: 'company_id,competencia_referencia' },
    )
    .select('id')
    .single();
  if (upErr || !guia) return { ok: false, error: `Falha ao salvar guia: ${upErr?.message ?? 'desconhecido'}` };

  // Liga a apuração da mesma competência à guia (se existir).
  await supabase
    .from('apuracoes_fiscais')
    .update({ guia_fiscal_id: guia.id, updated_at: new Date().toISOString() })
    .eq('company_id', companyId).eq('competencia_referencia', competencia).is('deleted_at', null);

  revalidatePath('/impostos');
  return { ok: true };
}

export type ConsultaDasResult = { ok: true; count: number } | { ok: false; error: string };

/**
 * Consulta na SERPRO (PGDAS-D / CONSDECLARACAO13) as declarações/DAS do ano-calendário atual
 * e faz upsert da SITUAÇÃO em guias_fiscais. Só Simples. Read-only na SERPRO (não emite/declara).
 */
export async function consultarDeclaracoesAction(ano?: number): Promise<ConsultaDasResult> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado.' };

  const { data: profile } = await supabase
    .from('profiles').select('current_company').eq('user_id', user.id).single();
  const companyId = (profile?.current_company ?? null) as string | null;
  if (!companyId) return { ok: false, error: 'Nenhuma empresa ativa selecionada.' };

  const { data: fiscal } = await supabase
    .from('empresas_fiscais')
    .select('Code_regime_tributario')
    .eq('empresa_id', companyId).is('deleted_at', null).maybeSingle();
  if (!fiscal) return { ok: false, error: 'Empresa fiscal não configurada.' };
  if (tipoFromCode((fiscal.Code_regime_tributario ?? '') as string) !== 'simples') {
    return { ok: false, error: 'A consulta de listagem cobre Simples (PGDAS-D); MEI virá depois.' };
  }

  const year = ano ?? Number(competenciaReferenciaBrt(new Date()).slice(0, 4));

  const r = await consultarDeclaracoesSimples(supabase, companyId, year);
  if (!r.ok) return r;

  const rows = r.situacoes.map((s) => ({
    company_id: companyId,
    owner_user_id: user.id,
    competencia_referencia: s.competencia,
    competencia_mes: Number(s.competencia.slice(4, 6)),
    competencia_ano: Number(s.competencia.slice(0, 4)),
    numero_das: s.numeroDas,
    status: s.status,
    origem: 'serpro',
    updated_at: new Date().toISOString(),
    deleted_at: null,
  }));

  if (rows.length > 0) {
    const { error } = await supabase
      .from('guias_fiscais')
      .upsert(rows, { onConflict: 'company_id,competencia_referencia' });
    if (error) return { ok: false, error: `Falha ao salvar a listagem: ${error.message}` };
  }

  revalidatePath('/impostos');
  return { ok: true, count: rows.length };
}
