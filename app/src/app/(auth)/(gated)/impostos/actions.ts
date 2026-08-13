'use server';
// @custom — PR 3.1 — Dashboard de Impostos
// Server actions ligadas ao histórico de guias.
import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/supabase/server';
import { type AnexoSimples, tipoFromCode } from '@/lib/fiscal/regime';
import type { ResultadoApuracao } from '@/lib/fiscal/apuracao-types';
import { competenciaReferenciaBrt } from '@/lib/fiscal/guia';
import { consultarDeclaracoesSimples } from '@/lib/fiscal/serpro-consulta';
import { consultarPagamentosDas } from '@/lib/fiscal/serpro-pagamentos';
import type { PagamentoDas } from '@/lib/fiscal/serpro-pagamentos-parse';
import { consultarDasnSimei } from '@/lib/fiscal/serpro-dasn-simei';
import { gerarDasSimples } from '@/lib/fiscal/serpro-das-simples';
import { calcularApuracao, RegimeNaoSuportadoError } from '@/lib/fiscal/apuracao';
import { getParametrosDaCompetencia } from '@/lib/fiscal/parametros';
import { lerReceitasParaApuracao, lerNotasAnoCalendario } from '@/lib/fiscal/receitas-source';
import { gerarDasMei } from '@/lib/fiscal/serpro-das-mei';
import { resolverAnexoEmpresa } from '@/lib/fiscal/cnae-sync';
import { anexarAnexosDasReceitas } from '@/lib/fiscal/segregacao';
import { transmitirPgdasd } from '@/lib/fiscal/serpro-pgdasd';
import type { DeclaracaoPgdasdResult } from '@/lib/fiscal/serpro-pgdasd-parse';
import { registrarDeclaracaoAnual } from '@/lib/fiscal/declaracoes-anuais/registrar';
import { calcularDivergencia } from '@/lib/fiscal/declaracoes-anuais/divergencia';
import { resumirReceitasAno } from '@/lib/fiscal/dasn/resumo';
import { DasnCamposSchema, DasnRascunhoSchema, rotuloCampoDasn } from '@/lib/fiscal/dasn/campos';
import { DefisCamposSchema, DefisRascunhoSchema, rotuloCampoDefis } from '@/lib/fiscal/defis/campos';
import { mensagemDeIssues } from '@/lib/fiscal/declaracoes-anuais/erros';
import {
  BUCKET_COMPROVANTES_GUIA, caminhoComprovanteGuia, nomeExibivel, validarComprovanteGuia,
} from '@/lib/fiscal/comprovante-guia';
import { uploadToBucket, removeFromBucket, signedUrlDownload } from '@/lib/clients/supabase-storage';
import { registrarAuditoria } from '@/lib/security/audit';
import type { DeclaracaoAnualTipo } from '@/lib/fiscal/declaracoes-anuais/tipos';

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

  // PONTO DE ESCRITA ÚNICO (migration 0072). A action não escreve mais em
  // `guias_fiscais` direto: a RPC marca a guia, resolve as notificações dela e
  // grava a auditoria com a origem, numa transação só. A conciliação bancária
  // (Bloco 7, Frente 3) chama exatamente a mesma função com `origem` diferente.
  //
  // O motivo de existir é histórico e concreto: enquanto "guia paga" teve dois
  // donos, o filtro foi esquecido em três consumidores seguidos (0065, 0066,
  // 0067), um de cada vez. Com um ponto só, o consumidor novo não tem como
  // esquecer — não há nada para lembrar.
  //
  // `companyId` continua sendo lido acima para o guard de sessão/empresa
  // ativa; a autorização de verdade é a da RPC (`user_owns_company`).
  const { data: res, error } = await supabase.rpc('registrar_pagamento_guia', {
    p_guia_id: id,
    p_data_pagamento: dataPagamento,
    p_origem: 'manual',
    p_transacao_id: null,
  });

  if (error) return { ok: false, error: error.message };

  const r = res as { ok: boolean; motivo?: string } | null;
  if (!r?.ok) {
    return {
      ok: false,
      error: r?.motivo === 'nao_autorizado'
        ? 'Esta guia não é da sua empresa.'
        : 'Guia não encontrada.',
    };
  }

  revalidatePath('/impostos');
  revalidatePath('/notificacoes');
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
    .select('Code_regime_tributario, anexo_simples, atividade_mei, data_inicio_atividade')
    .eq('empresa_id', companyId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!fiscal) return { ok: false, error: 'Empresa fiscal não configurada.' };

  const regimeCode = (fiscal.Code_regime_tributario ?? '') as string;
  const resolvido = await resolverAnexoEmpresa(supabase, companyId, (fiscal.anexo_simples ?? null) as AnexoSimples | null, competencia);
  const anexo = resolvido.anexo;

  let resultado: ResultadoApuracao;
  try {
    const receitas = await lerReceitasParaApuracao(supabase, companyId, competencia);
    const receitasAnexadas = await anexarAnexosDasReceitas(supabase, companyId, competencia, receitas, anexo);
    // Tabela do Simples e salário mínimo VIGENTES NA COMPETÊNCIA (migration
    // 0079), não os que estavam no código no dia do deploy. Reapurar uma
    // competência antiga passa a usar os parâmetros daquela época.
    const parametros = await getParametrosDaCompetencia(supabase, competencia);
    resultado = calcularApuracao({
      regimeCode,
      anexo,
      receitas: receitasAnexadas,
      competencia,
      atividadeMei: (fiscal.atividade_mei ?? null) as string | null,
      tabelaSimples: parametros.tabelaSimples,
      salarioMinimo: parametros.salarioMinimo,
      // Anualização do RBT12 (0082). Empresa com menos de 12 meses tem a
      // receita projetada para 12 meses em vez de somar meses que não
      // existiram — sem isso o RBT12 fica baixo demais, cai numa faixa
      // inferior e produz alíquota menor que a devida. `undefined` quando o
      // dado não veio da Receita: aí o cálculo segue como sempre foi.
      dataInicioAtividade: (fiscal.data_inicio_atividade ?? undefined) as string | undefined,
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
      fator_r: resolvido.fatorR ?? null,
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

export type GerarDasResult = { ok: true; semValor: boolean } | { ok: false; error: string };

export async function gerarDasMeiAction(competencia: string): Promise<GerarDasResult> {
  if (!/^\d{6}$/.test(competencia)) return { ok: false, error: 'Competência inválida (YYYYMM).' };

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
  if (fiscal.Code_regime_tributario !== '4') {
    return { ok: false, error: 'Geração de DAS-MEI cobre só MEI; Simples usa o fluxo próprio.' };
  }

  const r = await gerarDasMei(supabase, companyId, competencia);
  if (!r.ok) return r;
  if (r.result.semValor) return { ok: true, semValor: true };

  const d = r.result.das;
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
        numero_das: d.numeroDocumento,
        valor_principal: d.valores.principal,
        valor_multa: d.valores.multa,
        valor_juros: d.valores.juros,
        valor_total: d.valores.total,
        data_vencimento: d.dataVencimento,
        linha_digitavel: d.codigoDeBarras.join(' '),
        codigo_barras: d.codigoDeBarras.join(''),
        url_pdf: d.pdfBase64 ? `data:application/pdf;base64,${d.pdfBase64}` : null,
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

  await supabase
    .from('apuracoes_fiscais')
    .update({ guia_fiscal_id: guia.id, updated_at: new Date().toISOString() })
    .eq('company_id', companyId).eq('competencia_referencia', competencia).is('deleted_at', null);

  revalidatePath('/impostos');
  return { ok: true, semValor: false };
}

export type ConsultaDasResult = { ok: true; count: number } | { ok: false; error: string };

/**
 * Normaliza um número de DAS para casamento: só dígitos, sem zeros à esquerda.
 * O CONSDECLARACAO13 traz "07202610733758790" e o PAGAMENTOS71 "7202610733758790" —
 * mesmo documento, só diferindo no zero inicial.
 */
function normalizarNumeroDas(v: string | null | undefined): string {
  return String(v ?? '').replace(/\D+/g, '').replace(/^0+/, '');
}

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
  // PGDAS-D só Simples (codes 1/2). tipoFromCode mapeia code 3 (Lucro Real/Presumido) como 'simples'
  // → checar os códigos explicitamente para não consultar SERPRO p/ Regime Normal.
  const regimeCode = (fiscal.Code_regime_tributario ?? '') as string;
  if (regimeCode !== '1' && regimeCode !== '2') {
    return { ok: false, error: 'A consulta de listagem cobre Simples (PGDAS-D); MEI virá depois.' };
  }

  const year = ano ?? Number(competenciaReferenciaBrt(new Date()).slice(0, 4));

  const r = await consultarDeclaracoesSimples(supabase, companyId, year);
  if (!r.ok) return r;

  // Busca os DAS pagos (PAGTOWEB / PAGAMENTOS71) e indexa por número de documento.
  // FATAL: se falhar, não salvamos nem marcamos nada. Senão o sync fecharia com os meses
  // pagos em branco e — sem botão de re-consulta — o usuário ficaria preso com dados furados.
  // Melhor falhar aqui (gate permanece) e deixar o usuário/cron tentar de novo.
  const pagtos = await consultarPagamentosDas(supabase, companyId, year);
  if (!pagtos.ok) {
    return { ok: false, error: 'A SERPRO está instável agora (consulta de pagamentos falhou). Tente atualizar de novo em instantes.' };
  }
  const pagPorDocumento = new Map<string, PagamentoDas>();
  for (const p of pagtos.pagamentos) {
    const chave = normalizarNumeroDas(p.numeroDocumento);
    if (chave) pagPorDocumento.set(chave, p);
  }

  // Uma linha por competência (situação do CONSDECLARACAO13), enriquecida em 2 fontes:
  //  - PAGA: casa o DAS pago do PAGAMENTOS71 pelo NÚMERO DO DOCUMENTO (não por competência —
  //    senão 2 DAS/mês, ex. parcelamento, colidem no upsert; e parcelamento, ausente no
  //    CONSDECLARACAO13, é ignorado de graça).
  //  - EM ABERTO (declarada e não paga): GERARDAS12 traz valor + vencimento + linha digitável + PDF.
  //    É 1 chamada SERPRO por competência em aberto → só roda nas declaradas não pagas.
  const rows: Record<string, unknown>[] = [];
  for (const s of r.situacoes) {
    const base = {
      company_id: companyId,
      owner_user_id: user.id,
      competencia_referencia: s.competencia,
      competencia_mes: Number(s.competencia.slice(4, 6)),
      competencia_ano: Number(s.competencia.slice(0, 4)),
      numero_das: s.numeroDas,
      origem: 'serpro',
      updated_at: new Date().toISOString(),
      deleted_at: null,
    };

    const pag = s.numeroDas ? pagPorDocumento.get(normalizarNumeroDas(s.numeroDas)) : undefined;
    if (pag) {
      rows.push({
        ...base,
        status: 'paga',
        valor_total: pag.valorTotal,
        valor_principal: pag.valorPrincipal,
        valor_multa: pag.valorMulta,
        valor_juros: pag.valorJuros,
        data_vencimento: pag.dataVencimento,
        data_pagamento: pag.dataPagamento,
      });
      continue;
    }

    // DAS em aberto: competência declarada e não paga → GERARDAS12 (não-fatal por competência).
    if (s.numeroDeclaracao && s.status !== 'paga') {
      const das = await gerarDasSimples(supabase, companyId, s.competencia);
      if (das.ok && !das.result.semValor) {
        const d = das.result;
        rows.push({
          ...base,
          numero_das: d.numeroDas ?? s.numeroDas,
          status: 'gerada',
          valor_total: d.valores.total,
          valor_principal: d.valores.principal,
          valor_multa: d.valores.multa,
          valor_juros: d.valores.juros,
          data_vencimento: d.dataVencimento,
          linha_digitavel: d.codigoDeBarras.join(' '),
          codigo_barras: d.codigoDeBarras.join(''),
          url_pdf: d.pdfBase64 ? `data:application/pdf;base64,${d.pdfBase64}` : null,
        });
        continue;
      }
      // semValor (nada devido) ou erro → cai pro base (preserva o que já está na guia).
    }

    // Só situação: sem valores no payload → o upsert preserva o que já estava gravado.
    rows.push({ ...base, status: s.status });
  }

  if (rows.length > 0) {
    const { error } = await supabase
      .from('guias_fiscais')
      .upsert(rows, { onConflict: 'company_id,competencia_referencia' });
    if (error) return { ok: false, error: `Falha ao salvar a listagem: ${error.message}` };
  }

  // Declarações (numeroDeclaracao/dataTransmissao) vão p/ a tabela própria — separadas do DAS.
  const decls = r.situacoes.map((s) => ({
    company_id: companyId,
    owner_user_id: user.id,
    competencia_referencia: s.competencia,
    tipo: 'PGDAS-D',
    numero_declaracao: s.numeroDeclaracao,
    data_transmissao: s.dataTransmissao,
    status: s.numeroDeclaracao ? 'transmitida' : 'pendente',
    updated_at: new Date().toISOString(),
  }));
  if (decls.length > 0) {
    const { error: decErr } = await supabase
      .from('declaracoes_fiscais')
      .upsert(decls, { onConflict: 'company_id,competencia_referencia,tipo' });
    if (decErr) return { ok: false, error: `Falha ao salvar as declarações: ${decErr.message}` };
  }

  revalidatePath('/impostos');
  return { ok: true, count: r.situacoes.length };
}

/**
 * Consulta na SERPRO (DASN-SIMEI / CONSULTIMADECREC152) as declarações anuais já transmitidas do MEI
 * e faz upsert em declaracoes_fiscais (tipo 'DASN-SIMEI', competência = ano). Só MEI. Read-only na SERPRO.
 * Obs.: a transmissão da DASN-SIMEI ainda não está disponível na API SERPRO; aqui é só histórico/consulta.
 */
export async function consultarDasnSimeiAction(ano?: number): Promise<ConsultaDasResult> {
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
  if ((fiscal.Code_regime_tributario ?? '') !== '4') {
    return { ok: false, error: 'A consulta da DASN-SIMEI cobre só MEI.' };
  }

  // Ano-calendário declarado: por padrão o ano anterior (a DASN-SIMEI é do exercício passado).
  const year = ano ?? Number(competenciaReferenciaBrt(new Date()).slice(0, 4)) - 1;

  const r = await consultarDasnSimei(supabase, companyId, year);
  if (!r.ok) return r;

  const decls = r.declaracoes
    .filter((d) => d.numeroDeclaracao)
    .map((d) => ({
      company_id: companyId,
      owner_user_id: user.id,
      competencia_referencia: String(year),
      tipo: 'DASN-SIMEI',
      numero_declaracao: d.numeroDeclaracao,
      data_transmissao: d.dataTransmissao,
      status: 'transmitida',
      updated_at: new Date().toISOString(),
    }));
  if (decls.length > 0) {
    const { error } = await supabase
      .from('declaracoes_fiscais')
      .upsert(decls, { onConflict: 'company_id,competencia_referencia,tipo' });
    if (error) return { ok: false, error: `Falha ao salvar as declarações: ${error.message}` };
  }

  revalidatePath('/impostos');
  return { ok: true, count: r.declaracoes.length };
}

export type GerarDasSimplesResult =
  | { ok: true; semValor: boolean }
  | { ok: false; error: string };

/**
 * Gera o DAS (PGDAS-D / GERARDAS12) de uma competência via o token do procurador e persiste
 * em guias_fiscais. Só Simples. Período pago → { ok:true, semValor:true } (não persiste valor).
 */
export async function gerarDasSimplesAction(competencia: string): Promise<GerarDasSimplesResult> {
  if (!/^\d{6}$/.test(competencia)) return { ok: false, error: 'Competência inválida (YYYYMM).' };

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
    return { ok: false, error: 'Geração de DAS por aqui cobre Simples (PGDAS-D); MEI usa o fluxo próprio.' };
  }

  // P0.1 (paliativo) — não gerar DAS sem a PGDAS-D transmitida no período.
  // No Simples a guia (DAS) nasce da declaração: emitir o boleto sem declaração
  // transmitida pode gerar guia inválida e deixa a obrigação principal (PGDAS-D)
  // em falta. Reusa o mesmo procurador (CONSDECLARACAO13, read-only) p/ checar.
  const ano = Number(competencia.slice(0, 4));
  const situacao = await consultarDeclaracoesSimples(supabase, companyId, ano);
  if (!situacao.ok) return { ok: false, error: situacao.error };
  const declarada = situacao.situacoes.find((s) => s.competencia === competencia)?.numeroDeclaracao;
  if (!declarada) {
    return {
      ok: false,
      error: 'A PGDAS-D desta competência ainda não foi transmitida na Receita Federal. Transmita a declaração (PGDAS-D) antes de gerar o DAS.',
    };
  }

  const r = await gerarDasSimples(supabase, companyId, competencia);
  if (!r.ok) return r;
  if (r.result.semValor) return { ok: true, semValor: true };

  const d = r.result;
  const mes = Number(competencia.slice(4, 6));
  const { error } = await supabase
    .from('guias_fiscais')
    .upsert(
      {
        company_id: companyId,
        owner_user_id: user.id,
        competencia_referencia: competencia,
        competencia_mes: mes,
        competencia_ano: ano,
        numero_das: d.numeroDas,
        valor_principal: d.valores.principal,
        valor_multa: d.valores.multa,
        valor_juros: d.valores.juros,
        valor_total: d.valores.total,
        data_vencimento: d.dataVencimento,
        linha_digitavel: d.codigoDeBarras.join(' '),
        codigo_barras: d.codigoDeBarras.join(''),
        url_pdf: d.pdfBase64 ? `data:application/pdf;base64,${d.pdfBase64}` : null,
        status: 'gerada',
        origem: 'serpro',
        updated_at: new Date().toISOString(),
        deleted_at: null,
      },
      { onConflict: 'company_id,competencia_referencia' },
    );
  if (error) return { ok: false, error: `Falha ao salvar a guia: ${error.message}` };

  revalidatePath('/impostos');
  return { ok: true, semValor: false };
}

export type SalvarFolhaResult = { ok: true } | { ok: false; error: string };

export type FolhaInput = {
  competencia: string; // YYYYMM
  proLabore: number;
  salarios: number;
  encargos: number;
};

/**
 * Upsert da folha mensal (lote) da empresa ativa. Usado pela tela /impostos/folha.
 * UNIQUE(company_id, competencia) → onConflict direto (sem soft-delete).
 */
export async function salvarFolhaAction(rows: FolhaInput[]): Promise<SalvarFolhaResult> {
  if (!Array.isArray(rows) || rows.length === 0) return { ok: true };
  for (const r of rows) {
    if (!/^\d{6}$/.test(r.competencia)) return { ok: false, error: `Competência inválida: ${r.competencia}.` };
    if (r.proLabore < 0 || r.salarios < 0 || r.encargos < 0) {
      return { ok: false, error: 'Valores da folha não podem ser negativos.' };
    }
  }

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado.' };

  const { data: profile } = await supabase
    .from('profiles').select('current_company').eq('user_id', user.id).single();
  const companyId = (profile?.current_company ?? null) as string | null;
  if (!companyId) return { ok: false, error: 'Nenhuma empresa ativa selecionada.' };

  const now = new Date().toISOString();
  const payload = rows.map((r) => ({
    company_id: companyId,
    owner_user_id: user.id,
    competencia: r.competencia,
    pro_labore: Number.isFinite(r.proLabore) ? r.proLabore : 0,
    salarios: Number.isFinite(r.salarios) ? r.salarios : 0,
    encargos: Number.isFinite(r.encargos) ? r.encargos : 0,
    updated_at: now,
  }));

  const { error } = await supabase
    .from('folha_mensal')
    .upsert(payload, { onConflict: 'company_id,competencia' });
  if (error) return { ok: false, error: `Falha ao salvar a folha: ${error.message}` };

  revalidatePath('/impostos/folha');
  revalidatePath('/impostos');
  return { ok: true };
}

export type PreviewDeclaracaoResult =
  | { ok: true; result: DeclaracaoPgdasdResult }
  | { ok: false; error: string };

/** Dry-run da PGDAS-D (indicadorTransmissao=false): a SERPRO calcula SEM transmitir. */
export async function previewDeclaracaoAction(competencia: string): Promise<PreviewDeclaracaoResult> {
  if (!/^\d{6}$/.test(competencia)) return { ok: false, error: 'Competência inválida (YYYYMM).' };
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado.' };
  const { data: profile } = await supabase
    .from('profiles').select('current_company').eq('user_id', user.id).single();
  const companyId = (profile?.current_company ?? null) as string | null;
  if (!companyId) return { ok: false, error: 'Nenhuma empresa ativa selecionada.' };
  const { data: fiscal } = await supabase
    .from('empresas_fiscais').select('Code_regime_tributario')
    .eq('empresa_id', companyId).is('deleted_at', null).maybeSingle();
  if (!fiscal) return { ok: false, error: 'Empresa fiscal não configurada.' };
  // PGDAS-D só Simples (codes 1/2). tipoFromCode mapeia code 3 (Lucro Real/Presumido) como 'simples'
  // → checar os códigos explicitamente para não deixar LP/LR cair na declaração.
  const regimeCode = (fiscal.Code_regime_tributario ?? '') as string;
  if (regimeCode !== '1' && regimeCode !== '2') {
    return { ok: false, error: 'A declaração PGDAS-D cobre Simples (anexos I–V); MEI usa a DASN-SIMEI e Regime Normal não declara aqui.' };
  }
  return transmitirPgdasd(supabase, companyId, competencia, { indicadorTransmissao: false });
}

export type MarcarSincronizacaoResult = { ok: true } | { ok: false; error: string };

/**
 * Marca a primeira sincronização com a SERPRO.
 * Separada da consultarDeclaracoesAction para não acoplar o conceito
 * "primeira vez" ao fluxo de consulta recorrente.
 * Idempotente: uma segunda chamada apenas atualiza o timestamp.
 */
export async function marcarSincronizacaoInicialAction(): Promise<MarcarSincronizacaoResult> {
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

  const { error } = await supabase
    .from('empresas_fiscais')
    .update({ sincronizacao_inicial_serpro_at: new Date().toISOString() })
    .eq('empresa_id', companyId)
    .is('deleted_at', null);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/impostos');
  return { ok: true };
}

export type RegistrarDeclaracaoResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * Registra (ou retifica) a declaração anual de uma empresa do usuário.
 * `dataTransmissao` ausente = rascunho: grava, mas NÃO cala o aviso do sino.
 * Roda com a sessão do usuário — a policy declaracoes_fiscais_owner cobre a escrita.
 *
 * `companyId` vem de QUEM RENDERIZOU o formulário e é conferido contra a RLS de
 * `companies`. Antes esta action relia em `profiles.current_company` no momento do
 * envio: quem tem mais de uma empresa via a tela de uma e gravava na outra, porque
 * a empresa ativa pode mudar entre o render e o submit — outra aba, o cache de
 * rota do Next, ou o próprio link de notificação, que hoje troca a empresa ativa.
 */
export async function registrarDeclaracaoAnualAction(input: {
  companyId: string;
  tipo: DeclaracaoAnualTipo;
  ano: number;
  dados: Record<string, unknown>;
  numeroDeclaracao?: string | null;
  dataTransmissao?: string | null;
  comprovante?: { nome: string; mime: string; base64: string } | null;
}): Promise<RegistrarDeclaracaoResult> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão inválida.' };

  const companyId = input.companyId;
  if (!companyId) return { ok: false, error: 'Nenhuma empresa selecionada.' };

  // A RLS `companies_select` (user_id = auth.uid()) é quem prova a posse: empresa
  // de outro dono volta vazia e a action para aqui.
  const { data: empresa } = await supabase
    .from('companies').select('id').eq('id', companyId).is('deleted_at', null).maybeSingle();
  if (!empresa) return { ok: false, error: 'Empresa não encontrada.' };

  // Rascunho aceita formulário pela metade; a entrega exige o schema inteiro.
  const rascunho = !input.dataTransmissao;
  const ehDasn = input.tipo === 'DASN-SIMEI';
  const schema = ehDasn
    ? (rascunho ? DasnRascunhoSchema : DasnCamposSchema)
    : (rascunho ? DefisRascunhoSchema : DefisCamposSchema);
  const parsed = schema.safeParse(input.dados);
  if (!parsed.success) {
    return { ok: false, error: mensagemDeIssues(parsed.error.issues, ehDasn ? rotuloCampoDasn : rotuloCampoDefis) };
  }

  // Divergência: compara o total declarado com o apurado pelas notas do ano.
  const notas = await lerNotasAnoCalendario(supabase, companyId, input.ano);
  const resumo = resumirReceitasAno(notas, input.ano);
  const d = parsed.data as { receitaComercio?: number; receitaServico?: number; receitaBrutaTotal?: number };
  const declarado = input.tipo === 'DASN-SIMEI'
    ? (d.receitaComercio ?? 0) + (d.receitaServico ?? 0)
    : (d.receitaBrutaTotal ?? 0);
  const divergencia = calcularDivergencia(declarado, resumo.total);

  return registrarDeclaracaoAnual(supabase, {
    companyId,
    ownerUserId: user.id,
    tipo: input.tipo,
    ano: input.ano,
    dados: parsed.data as Record<string, unknown>,
    numeroDeclaracao: input.numeroDeclaracao ?? null,
    dataTransmissao: input.dataTransmissao ?? null,
    divergenciaReceita: divergencia.diferenca,
    origem: 'manual',
    registradoPor: user.id,
    comprovante: input.comprovante
      ? { nome: input.comprovante.nome, mime: input.comprovante.mime, bytes: Buffer.from(input.comprovante.base64, 'base64') }
      : null,
  }).then((r) => {
    if (r.ok) revalidatePath('/impostos');
    return r;
  });
}

// ── Comprovante de pagamento da guia (P3.5, migration 0084) ──────────────────
//
// POR QUE ANEXAR NÃO MARCA A GUIA COMO PAGA. Seria cômodo e está errado: "paga"
// é estado fiscal, entra em relatório e some da fila de vencidas, e tem um
// ponto de escrita único desde a 0072 (`registrar_pagamento_guia`, que também
// resolve as notificações e grava auditoria numa transação). Um upload de
// arquivo não pode disparar isso pela porta dos fundos — anexar documenta,
// marcar paga é outro ato, com outro botão.

export type ComprovanteGuiaResult = { ok: true } | { ok: false; error: string };

/**
 * A guia é MESMO da empresa de quem está pedindo?
 *
 * Lê pelo client da SESSÃO de propósito: a RLS `guias_fiscais_select`
 * (`user_owns_company`) é quem responde. Guia de outro dono volta vazia e a
 * action para — sem que este arquivo precise reimplementar a regra de posse.
 */
async function guiaDoUsuario(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  guiaId: string,
): Promise<{ id: string; company_id: string; comprovante_path: string | null; comprovante_nome: string | null } | null> {
  const { data } = await supabase
    .from('guias_fiscais')
    .select('id, company_id, comprovante_path, comprovante_nome')
    .eq('id', guiaId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!data?.company_id) return null;
  return data as { id: string; company_id: string; comprovante_path: string | null; comprovante_nome: string | null };
}

export async function anexarComprovanteGuiaAction(input: {
  guiaId: string;
  nome: string;
  mime: string;
  base64: string;
}): Promise<ComprovanteGuiaResult> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão inválida.' };
  if (!input.guiaId) return { ok: false, error: 'Guia não informada.' };

  const guia = await guiaDoUsuario(supabase, input.guiaId);
  if (!guia) return { ok: false, error: 'Guia não encontrada.' };

  let bytes: Buffer;
  try {
    bytes = Buffer.from(input.base64, 'base64');
  } catch {
    return { ok: false, error: 'Não foi possível ler o arquivo.' };
  }

  // Valida ANTES de tocar no storage: recusar depois do upload deixaria o
  // arquivo no bucket sem nenhuma linha apontando para ele.
  const v = validarComprovanteGuia({ mime: input.mime, tamanho: bytes.byteLength });
  if (!v.ok) return { ok: false, error: v.error };

  const path = caminhoComprovanteGuia(guia.company_id, guia.id, input.mime);
  try {
    await uploadToBucket(BUCKET_COMPROVANTES_GUIA, path, bytes, input.mime);
  } catch (e) {
    return { ok: false, error: `Falha ao subir o comprovante: ${e instanceof Error ? e.message : String(e)}` };
  }

  const { error, data: gravadas } = await supabase
    .from('guias_fiscais')
    .update({
      comprovante_path: path,
      comprovante_nome: nomeExibivel(input.nome),
      comprovante_mime: input.mime,
      comprovante_tamanho: bytes.byteLength,
      comprovante_em: new Date().toISOString(),
    })
    .eq('id', guia.id)
    .select('id');

  // Upload feito e banco recusado deixaria um arquivo órfão no bucket — que
  // ninguém alcança e ninguém apaga. Desfaz o que deu para desfazer. A exceção
  // é a substituição: ali o path é o mesmo, e apagar destruiria o comprovante
  // anterior, que continua sendo o válido enquanto o novo não gravou.
  if (error || (gravadas?.length ?? 0) === 0) {
    if (!guia.comprovante_path) await removeFromBucket(BUCKET_COMPROVANTES_GUIA, path).catch(() => {});
    console.error('[guia/comprovante] update falhou', error?.message);
    return { ok: false, error: 'O arquivo subiu, mas não foi possível vinculá-lo à guia. Tente de novo.' };
  }

  await registrarAuditoria({
    actorUserId: user.id,
    acao: guia.comprovante_path ? 'guia.comprovante_substituir' : 'guia.comprovante_anexar',
    alvoTipo: 'guias_fiscais',
    alvoId: guia.id,
    meta: { nome: nomeExibivel(input.nome), mime: input.mime, bytes: bytes.byteLength },
  });

  revalidatePath('/impostos');
  return { ok: true };
}

/**
 * URL de download do comprovante, válida por poucos minutos.
 *
 * Pedida por clique, e não embutida na página: uma URL assinada renderizada no
 * HTML vale para quem tiver o HTML, e a lista de guias é justamente a tela que
 * um contador mostra com a mesa cheia de gente em volta.
 */
export async function urlComprovanteGuiaAction(
  guiaId: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão inválida.' };

  const guia = await guiaDoUsuario(supabase, guiaId);
  if (!guia?.comprovante_path) return { ok: false, error: 'Esta guia não tem comprovante anexado.' };

  // Download forçado, nunca inline: aceitar PDF e imagem sem herdar o risco do
  // formato depende disso (ver `signedUrlDownload`).
  const url = await signedUrlDownload(
    BUCKET_COMPROVANTES_GUIA, guia.comprovante_path, nomeExibivel(guia.comprovante_nome),
  );
  if (!url) return { ok: false, error: 'Não foi possível abrir o comprovante.' };
  return { ok: true, url };
}
