'use server';
// Caixa Postal do e-CAC — ações da tela (empresa e escritório).
//
// QUEM PODE: o dono da empresa (empresa atual dele) e o escritório que a
// atende (id da empresa na URL, conferido contra a carteira). A leitura das
// mensagens é pela SESSÃO (RLS da 0110); a escrita, pelo service role.
//
// ⚠️ ABRIR DÁ CIÊNCIA (Decreto 70.235/72, art. 23, § 2º, III). A action exige
// `cienteDoPrazo: true` — a tela só manda isso depois do aviso confirmado —, e
// registra quem abriu e quando.
import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getContabilidadeCtx, type ContabilidadeCtx } from '@/lib/contador/guards';
import { empresaAtivaDoDono, empresaDoDono, mensagemDeRecusaDeEmpresa } from '@/lib/auth/empresa-dono';
import { registrarAuditoria } from '@/lib/security/audit';
import { sincronizarCaixaPostalEmpresa } from '@/lib/fiscal/caixa-postal-sync';
import { detalharMensagem } from '@/lib/fiscal/serpro-caixa-postal';
import { ASSUNTO_PADRAO } from '@/lib/fiscal/serpro-caixa-postal-parse';
import { ymdBrt } from '@/lib/fiscal/tempo-brt';
import { gerarRelatorioSitfisEmpresa, BUCKET_RELATORIOS } from '@/lib/fiscal/sitfis-sync';
import { signedUrlDownload } from '@/lib/clients/supabase-storage';
import { consultarParcelamentosEmpresa, parcelasDisponiveis, gerarDasDaParcela } from '@/lib/fiscal/parcelamentos-sync';
import { consultarReciboDctfweb, gerarGuiaDctfweb } from '@/lib/fiscal/dctfweb';

type Resultado<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

type Permitida =
  | { ok: true; companyId: string; userId: string; contabilidadeId: string | null }
  | { ok: false; error: string };

/** Escritório APROVADO e empresa ativa da carteira dele. */
async function doEscritorio(g: ContabilidadeCtx, companyId: string): Promise<Permitida> {
  if (!g.contabilidade || g.contabilidade.status !== 'aprovada') return { ok: false, error: 'Empresa não encontrada.' };
  const { data } = await createAdminClient().from('companies')
    .select('id, contabilidade_id, deleted_at').eq('id', companyId).maybeSingle();
  if (!data || data.contabilidade_id !== g.contabilidade.id || data.deleted_at) {
    return { ok: false, error: 'Empresa não encontrada na sua carteira.' };
  }
  return { ok: true, companyId, userId: g.userId, contabilidadeId: g.contabilidade.id };
}

/**
 * A empresa sobre a qual a pessoa pode agir. `companyId` informado = caminho do
 * escritório; ausente = a empresa atual do dono, provada (`empresaAtivaDoDono`).
 */
async function empresaPermitida(companyId: string | null): Promise<Permitida> {
  const g = await getContabilidadeCtx();
  if ('error' in g) return { ok: false, error: 'Entre na sua conta.' };
  if (companyId) return doEscritorio(g, companyId);

  const ativa = await empresaAtivaDoDono(await createServerClient(), g.userId);
  if (!ativa.ok) return { ok: false, error: mensagemDeRecusaDeEmpresa(ativa.motivo) };
  return { ok: true, companyId: ativa.companyId, userId: g.userId, contabilidadeId: null };
}

/**
 * Ações que chegam pelo id de uma LINHA (mensagem, relatório, parcelamento): a
 * empresa vem da linha, e a mesma guarda de `empresaPermitida` vale para ela.
 * A RLS da 0110–0112 sozinha não basta: `minha_contabilidade_membro()` não
 * olha o status do escritório, e um escritório suspenso daria ciência de
 * intimação de cliente (code-review de 13/10).
 */
async function podeAgirSobre(g: ContabilidadeCtx, companyId: string): Promise<Permitida> {
  // Membro de escritório também pode ser dono da PRÓPRIA empresa: empresa fora
  // da carteira ainda passa pela prova de dono, em vez de ser recusada.
  if (g.contabilidade) {
    const doEsc = await doEscritorio(g, companyId);
    if (doEsc.ok) return doEsc;
  }
  const provado = await empresaDoDono(await createServerClient(), g.userId, companyId);
  if (!provado) return { ok: false, error: mensagemDeRecusaDeEmpresa('nao_e_dono') };
  return { ok: true, companyId: provado, userId: g.userId, contabilidadeId: null };
}

function revalidar(companyId: string) {
  revalidatePath('/receita/mensagens');
  revalidatePath(`/contador/clientes/${companyId}/receita`);
}

/** Busca na Receita agora (lista tudo; não abre nada). */
export async function atualizarCaixaPostalAction(
  companyId: string | null,
): Promise<Resultado<{ novas: number; total: number }>> {
  const e = await empresaPermitida(companyId);
  if (!e.ok) return e;
  const r = await sincronizarCaixaPostalEmpresa(createAdminClient(), e.companyId, { completa: true });
  if (!r.ok) return { ok: false, error: r.error };
  revalidar(e.companyId);
  return { ok: true, data: { novas: r.novas, total: r.total } };
}

/** ⚠️ Abre a mensagem na Receita — DÁ CIÊNCIA. */
export async function abrirMensagemReceitaAction(
  mensagemId: string, cienteDoPrazo: boolean,
): Promise<Resultado<{ conteudo: string }>> {
  if (!mensagemId) return { ok: false, error: 'Mensagem não informada.' };
  if (cienteDoPrazo !== true) return { ok: false, error: 'Confirme que está ciente de que abrir a mensagem conta como ciência.' };

  const g = await getContabilidadeCtx();
  if ('error' in g) return { ok: false, error: 'Entre na sua conta.' };

  // Pela SESSÃO: a RLS da 0110 só devolve mensagem da empresa do dono ou de
  // cliente do escritório. Id de outra empresa volta vazio.
  const sb = await createServerClient();
  const { data: m } = await sb.from('mensagens_receita')
    .select('id, company_id, isn, conteudo').eq('id', mensagemId).maybeSingle();
  if (!m) return { ok: false, error: 'Mensagem não encontrada.' };
  const e = await podeAgirSobre(g, m.company_id as string);
  if (!e.ok) return e;
  // Já aberta antes: o conteúdo guardado basta, sem nova chamada à Receita.
  if (m.conteudo) return { ok: true, data: { conteudo: m.conteudo as string } };

  const admin = createAdminClient();
  const r = await detalharMensagem(admin, m.company_id as string, m.isn as string);
  if (!r.ok) return { ok: false, error: r.error };

  const agora = new Date().toISOString();
  const { error } = await admin.from('mensagens_receita').update({
    conteudo: r.mensagem.corpo,
    // Detalhe sem assunto devolve o texto padrão: aí o da LISTA, que é o
    // real, fica (code-review de 13/10).
    ...(r.mensagem.assunto !== ASSUNTO_PADRAO ? { assunto: r.mensagem.assunto } : {}),
    lida_na_receita: true,
    // Data de HOJE EM BRASÍLIA: `agora` é UTC, e às 21h de Brasília já é o
    // dia seguinte — um dia a menos de prazo para quem conta pela tela.
    data_ciencia: r.mensagem.dataCiencia ?? ymdBrt(),
    aberta_em: agora,
    aberta_por: g.userId,
    updated_at: agora,
  }).eq('id', m.id as string);
  if (error) console.error('[caixa postal] mensagem aberta mas não gravada:', error.message);

  await registrarAuditoria({
    actorUserId: g.userId, acao: 'receita.mensagem_aberta',
    alvoTipo: 'mensagem_receita', alvoId: m.id as string,
    contabilidadeId: e.contabilidadeId ?? undefined,
    // A ciência é o fato jurídico: quem, qual mensagem, quando.
    meta: { company_id: m.company_id, isn: m.isn },
  });

  revalidar(m.company_id as string);
  return { ok: true, data: { conteudo: r.mensagem.corpo } };
}

// ─── SITUAÇÃO FISCAL (SITFIS, 0111) ──────────────────────────────────────────

/** Espera da tela pela geração do relatório na Receita (a varredura espera menos). */
const ESPERA_MAXIMA_TELA_MS = 25_000;

/** Emite agora o Relatório de Situação Fiscal e guarda o PDF. */
export async function emitirSituacaoFiscalAction(
  companyId: string | null,
): Promise<Resultado<{ resultado: string }>> {
  const e = await empresaPermitida(companyId);
  if (!e.ok) return e;
  const r = await gerarRelatorioSitfisEmpresa(createAdminClient(), e.companyId, {
    solicitadoPor: e.userId, esperaMaximaMs: ESPERA_MAXIMA_TELA_MS,
  });
  if (!r.ok) return { ok: false, error: r.error };
  await registrarAuditoria({
    actorUserId: e.userId, acao: 'receita.sitfis_emitido', alvoTipo: 'company', alvoId: e.companyId,
    contabilidadeId: e.contabilidadeId ?? undefined, meta: { relatorio_id: r.id, resultado: r.resultado },
  });
  revalidar(e.companyId);
  return { ok: true, data: { resultado: r.resultado } };
}

/**
 * Link de download (5 min) do relatório. A linha é lida pela SESSÃO — a RLS da
 * 0111 só a devolve ao dono da empresa e ao escritório dela —, e só então o
 * service role assina a URL do bucket privado.
 */
export async function baixarRelatorioSitfisAction(relatorioId: string): Promise<Resultado<{ url: string }>> {
  if (!relatorioId) return { ok: false, error: 'Relatório não informado.' };
  const g = await getContabilidadeCtx();
  if ('error' in g) return { ok: false, error: 'Entre na sua conta.' };
  const sb = await createServerClient();
  const { data } = await sb.from('relatorios_situacao_fiscal')
    .select('company_id, storage_path, emitido_em').eq('id', relatorioId).maybeSingle();
  if (!data) return { ok: false, error: 'Relatório não encontrado.' };
  const e = await podeAgirSobre(g, data.company_id as string);
  if (!e.ok) return e;
  const dia = String(data.emitido_em ?? '').slice(0, 10);
  const url = await signedUrlDownload(BUCKET_RELATORIOS, data.storage_path as string, `situacao-fiscal-${dia}.pdf`);
  if (!url) return { ok: false, error: 'Não foi possível gerar o link do relatório. Tente de novo.' };
  return { ok: true, data: { url } };
}

// ─── PARCELAMENTOS (0112) ────────────────────────────────────────────────────

/** Consulta na Receita os pedidos de parcelamento de todas as modalidades do regime. */
export async function consultarParcelamentosAction(
  companyId: string | null,
): Promise<Resultado<{ encontrados: number; falhas: string[] }>> {
  const e = await empresaPermitida(companyId);
  if (!e.ok) return e;
  const r = await consultarParcelamentosEmpresa(createAdminClient(), e.companyId);
  if (!r.ok) return { ok: false, error: r.error };
  revalidar(e.companyId);
  return { ok: true, data: { encontrados: r.encontrados, falhas: r.falhas } };
}

/**
 * O parcelamento, se a pessoa pode agir sobre ele. Lido pela SESSÃO (RLS da
 * 0112: só o dono da empresa e o escritório dela recebem a linha) e conferido
 * por `podeAgirSobre` (escritório aprovado, empresa ativa).
 */
async function parcelamentoPermitido(g: ContabilidadeCtx, parcelamentoId: string): Promise<
  { ok: true; p: { id: string; company_id: string; modalidade: string }; contabilidadeId: string | null }
  | { ok: false; error: string }
> {
  const sb = await createServerClient();
  const { data } = await sb.from('parcelamentos_receita')
    .select('id, company_id, modalidade').eq('id', parcelamentoId).maybeSingle();
  const p = data as { id: string; company_id: string; modalidade: string } | null;
  if (!p) return { ok: false, error: 'Parcelamento não encontrado.' };
  const e = await podeAgirSobre(g, p.company_id);
  if (!e.ok) return e;
  return { ok: true, p, contabilidadeId: e.contabilidadeId };
}

export async function parcelasDisponiveisAction(
  parcelamentoId: string,
): Promise<Resultado<{ parcelas: { parcela: string; valor: number | null }[] }>> {
  const g = await getContabilidadeCtx();
  if ('error' in g) return { ok: false, error: 'Entre na sua conta.' };
  const perm = await parcelamentoPermitido(g, parcelamentoId);
  if (!perm.ok) return perm;
  const { p } = perm;
  const r = await parcelasDisponiveis(createAdminClient(), p.company_id, p.modalidade);
  if (!r.ok) return r;
  return { ok: true, data: { parcelas: r.parcelas } };
}

/** DAS de uma parcela, como PDF em base64 (a tela baixa como arquivo). */
export async function gerarDasParcelaAction(
  parcelamentoId: string, parcela: string,
): Promise<Resultado<{ pdfBase64: string }>> {
  const g = await getContabilidadeCtx();
  if ('error' in g) return { ok: false, error: 'Entre na sua conta.' };
  const perm = await parcelamentoPermitido(g, parcelamentoId);
  if (!perm.ok) return perm;
  const { p } = perm;
  const r = await gerarDasDaParcela(createAdminClient(), p.company_id, p.modalidade, parcela);
  if (!r.ok) return r;
  await registrarAuditoria({
    actorUserId: g.userId, acao: 'receita.das_parcela_emitido', alvoTipo: 'company', alvoId: p.company_id,
    contabilidadeId: perm.contabilidadeId ?? undefined, meta: { modalidade: p.modalidade, parcela },
  });
  return { ok: true, data: { pdfBase64: r.pdfBase64 } };
}

// ─── DCTFWeb (só leitura e guia) ─────────────────────────────────────────────

/** Recibo (CONSRECIBO32) ou DARF (GERARGUIA31) da DCTFWeb do mês, em PDF base64. */
export async function documentoDctfwebAction(
  companyId: string | null, competencia: string, tipo: 'recibo' | 'darf',
): Promise<Resultado<{ pdfBase64: string }>> {
  if (!/^\d{6}$/.test(competencia)) return { ok: false, error: 'Escolha o mês.' };
  const e = await empresaPermitida(companyId);
  if (!e.ok) return e;
  const admin = createAdminClient();
  const r = tipo === 'darf'
    ? await gerarGuiaDctfweb(admin, e.companyId, competencia)
    : await consultarReciboDctfweb(admin, e.companyId, competencia);
  if (!r.ok) return r;
  if (tipo === 'darf') {
    await registrarAuditoria({
      actorUserId: e.userId, acao: 'receita.dctfweb_darf_emitido', alvoTipo: 'company', alvoId: e.companyId,
      contabilidadeId: e.contabilidadeId ?? undefined, meta: { competencia },
    });
  }
  return { ok: true, data: { pdfBase64: r.pdfBase64 } };
}
