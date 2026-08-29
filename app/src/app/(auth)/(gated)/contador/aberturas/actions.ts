// src/app/(auth)/(gated)/contador/aberturas/actions.ts
'use server';
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { getContabilidadeCtx } from '@/lib/contador/guards';
import { registrarAuditoria } from '@/lib/security/audit';
import { ABERTURA_TEXT_FIELDS, DOC_KEYS } from '@/types/abertura';
import { notificarEtapaAbertura } from '@/lib/abertura/notificar';
import { ETAPA_LABEL } from '@/lib/abertura/etapas';
import { tipoDocumento, minutaPronta, type MinutaInput } from '@/lib/abertura/minuta';
import { renderMinuta } from '@/lib/abertura/minuta/templates';
import { assertAssinaturaEscritorio } from '@/lib/billing/gate';
import { MENSAGEM_CNPJ_DUPLICADO_ESCRITORIO, mensagemDeErroDeEmpresa } from '@/lib/empresa/cnpj-unico';

export type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

// Etapas que o operador seta via "avançar". 'concluido' é ação própria (exige CNPJ).
const ETAPAS_OPERAVEIS = new Set([
  'recebido', 'em_analise', 'pendente_documentos',
  'enviado_receita', 'enviado_junta', 'enviado_prefeitura', 'cancelado',
]);

type Admin = ReturnType<typeof createAdminClient>;

// Guard: a company da abertura precisa pertencer à carteira do escritório (anti-IDOR).
async function aberturaDaCarteira(admin: Admin, contabilidadeId: string, aberturaId: string) {
  const { data: ab } = await admin
    .from('abertura_empresas').select('id, company_id, processo_etapa').eq('id', aberturaId).maybeSingle();
  const companyId = (ab as { company_id?: string | null } | null)?.company_id ?? null;
  if (!ab || !companyId) return null;
  const { data: comp } = await admin
    .from('companies').select('id, contabilidade_id').eq('id', companyId).maybeSingle();
  if (!comp || (comp as { contabilidade_id?: string | null }).contabilidade_id !== contabilidadeId) return null;
  return { aberturaId: (ab as { id: string }).id, companyId };
}

// Anotação explícita: sem ela o TS infere cada ramo com as chaves do outro como
// `?: undefined`, e `'error' in e` deixa de eliminar o ramo de erro (mesmo quirk
// de convites-actions requireEscritorioAprovado).
async function requireEscritorio(): Promise<{ error: string } | { userId: string; contabilidadeId: string }> {
  const g = await getContabilidadeCtx();
  if ('error' in g) return { error: g.error };
  if (!g.contabilidade || g.contabilidade.status !== 'aprovada') return { error: 'Escritório não aprovado.' };
  return { userId: g.userId, contabilidadeId: g.contabilidade.id };
}

export async function avancarProcessoAction(
  input: { aberturaId: string; etapa: string; protocolo?: string; observacoes?: string },
): Promise<ActionResult> {
  const e = await requireEscritorio();
  if ('error' in e) return { ok: false, error: e.error };
  const assinatura = await assertAssinaturaEscritorio(e.contabilidadeId);
  if (!assinatura.ok) return { ok: false, error: assinatura.error };
  if (!ETAPAS_OPERAVEIS.has(input.etapa)) return { ok: false, error: 'Etapa inválida.' };

  const admin = createAdminClient();
  const alvo = await aberturaDaCarteira(admin, e.contabilidadeId, input.aberturaId);
  if (!alvo) return { ok: false, error: 'Abertura fora da sua carteira.' };

  const patch: Record<string, unknown> = { processo_etapa: input.etapa, processo_atualizado_por: e.userId };
  if (input.protocolo !== undefined) patch.processo_protocolo = input.protocolo.trim() || null;
  if (input.observacoes !== undefined) patch.processo_observacoes = input.observacoes.trim() || null;

  const { error } = await admin.from('abertura_empresas').update(patch).eq('id', alvo.aberturaId);
  if (error) return { ok: false, error: error.message };

  await registrarAuditoria({
    actorUserId: e.userId, acao: 'abertura.avancar', alvoTipo: 'company',
    alvoId: alvo.companyId, contabilidadeId: e.contabilidadeId, meta: { etapa: input.etapa },
  });

  // Notifica o titular da nova etapa (Bloco 1). Busca user_id (o guard não o traz).
  const { data: abRow } = await admin.from('abertura_empresas').select('user_id').eq('id', alvo.aberturaId).maybeSingle();
  const label = ETAPA_LABEL[input.etapa] ?? input.etapa;
  await notificarEtapaAbertura(admin, {
    aberturaId: alvo.aberturaId, ownerUserId: (abRow as { user_id?: string | null } | null)?.user_id ?? null,
    companyId: alvo.companyId, etapa: input.etapa,
    titulo: `Abertura: ${label}`,
    corpo: `O status do seu processo de abertura foi atualizado para "${label}".`,
    severidade: input.etapa === 'pendente_documentos' ? 'warning' : (input.etapa === 'cancelado' ? 'danger' : 'info'),
  });
  revalidatePath(`/contador/aberturas/${alvo.aberturaId}`);
  revalidatePath('/contador/aberturas');
  return { ok: true };
}

export async function concluirAberturaAction(input: { aberturaId: string; cnpj: string }): Promise<ActionResult> {
  const e = await requireEscritorio();
  if ('error' in e) return { ok: false, error: e.error };
  const assinatura = await assertAssinaturaEscritorio(e.contabilidadeId);
  if (!assinatura.ok) return { ok: false, error: assinatura.error };
  const cnpj = input.cnpj.replace(/\D/g, '');
  if (cnpj.length !== 14) return { ok: false, error: 'CNPJ inválido (informe os 14 dígitos).' };

  const admin = createAdminClient();
  const alvo = await aberturaDaCarteira(admin, e.contabilidadeId, input.aberturaId);
  if (!alvo) return { ok: false, error: 'Abertura fora da sua carteira.' };

  // PRÉ-CHECAGEM DE CNPJ ÚNICO — mesma razão da pré-checagem de `titular_cpf`
  // em `criarAberturaClienteAction`: dar erro claro em vez de estourar a
  // constraint. Ganhou urgência com a migration 0106 (um CNPJ, uma empresa
  // ativa), que tornou esta colisão possível pela primeira vez.
  //
  // E o motivo de ser ANTES do passo 1, e não um `catch` no passo 2: os três
  // passos abaixo não estão numa transação. Se o UPDATE do passo 2 falhasse,
  // o passo 1 JÁ TERIA gravado — a abertura ficaria "concluída, CNPJ emitido"
  // com a empresa ainda sem CNPJ, e o operador não teria como saber disso pela
  // tela. Recusar antes de escrever qualquer coisa evita o estado partido.
  // `.limit(1)` e não `maybeSingle()` puro: aquele ERRA quando vem mais de uma
  // linha, e o erro cairia num `data` nulo — ou seja, "duas duplicatas" seria
  // lido como "nenhuma", que é o pior resultado possível desta checagem.
  const { data: jaExiste } = await admin.from('companies')
    .select('id')
    .eq('cnpj', cnpj)
    .is('deleted_at', null)
    .neq('id', alvo.companyId)
    .limit(1)
    .maybeSingle();
  if (jaExiste) return { ok: false, error: MENSAGEM_CNPJ_DUPLICADO_ESCRITORIO };

  // 1) abertura concluída + CNPJ emitido
  const { error: e1 } = await admin.from('abertura_empresas').update({
    processo_etapa: 'concluido', processo_cnpj_emitido: cnpj, processo_atualizado_por: e.userId,
  }).eq('id', alvo.aberturaId);
  if (e1) return { ok: false, error: e1.message };

  // 2) ativa a company com o CNPJ (escopado — anti-IDOR)
  const { error: e2 } = await admin.from('companies')
    .update({ status: 'active', cnpj })
    .eq('id', alvo.companyId).eq('contabilidade_id', e.contabilidadeId);
  // Cinto e suspensório: a pré-checagem acima cobre o caso normal, mas entre
  // ela e este UPDATE cabe uma corrida (outro escritório concluindo o mesmo
  // CNPJ). Se acontecer, a mensagem tem de ser a de negócio, e não o nome do
  // índice — mesmo o estado ficando partido, que é a dívida registrada acima.
  if (e2) return { ok: false, error: mensagemDeErroDeEmpresa(e2, e2.message, 'escritorio') };

  // 3) semeia empresas_fiscais se ainda não existe (regime fica pra aba Regime
  //    tributário, como posProcessarNovaEmpresa já prevê). Best-effort.
  const { data: fiscalExist } = await admin.from('empresas_fiscais').select('id').eq('empresa_id', alvo.companyId).maybeSingle();
  if (!fiscalExist) {
    const { data: ab } = await admin.from('abertura_empresas').select('empresa_cnae_principal').eq('id', alvo.aberturaId).maybeSingle();
    await admin.from('empresas_fiscais').insert({
      empresa_id: alvo.companyId, owner_user_id: null, cnpj,
      cnae_principal: (ab as { empresa_cnae_principal?: string | null } | null)?.empresa_cnae_principal ?? null,
    });
  }

  await registrarAuditoria({
    actorUserId: e.userId, acao: 'abertura.concluir', alvoTipo: 'company',
    alvoId: alvo.companyId, contabilidadeId: e.contabilidadeId, meta: { cnpj },
  });

  const { data: abRowC } = await admin.from('abertura_empresas').select('user_id').eq('id', alvo.aberturaId).maybeSingle();
  await notificarEtapaAbertura(admin, {
    aberturaId: alvo.aberturaId, ownerUserId: (abRowC as { user_id?: string | null } | null)?.user_id ?? null,
    companyId: alvo.companyId, etapa: 'concluido',
    titulo: 'Sua empresa foi aberta!',
    corpo: `Parabéns! O CNPJ ${cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')} foi emitido e sua empresa está ativa.`,
    severidade: 'info',
  });
  revalidatePath(`/contador/aberturas/${alvo.aberturaId}`);
  revalidatePath('/contador/aberturas');
  revalidatePath('/contador');
  return { ok: true };
}

export async function decidirAlteracaoAction(
  input: { alteracaoId: string; aprovar: boolean; observacoes?: string },
): Promise<ActionResult> {
  const e = await requireEscritorio();
  if ('error' in e) return { ok: false, error: e.error };
  const assinatura = await assertAssinaturaEscritorio(e.contabilidadeId);
  if (!assinatura.ok) return { ok: false, error: assinatura.error };

  const admin = createAdminClient();
  const { data: alt } = await admin.from('abertura_alteracoes')
    .select('id, abertura_id, dados, dados_hash, status').eq('id', input.alteracaoId).maybeSingle();
  if (!alt) return { ok: false, error: 'Alteração não encontrada.' };
  const aberturaId = (alt as { abertura_id: string }).abertura_id;

  const alvo = await aberturaDaCarteira(admin, e.contabilidadeId, aberturaId);
  if (!alvo) return { ok: false, error: 'Alteração fora da sua carteira.' };
  if ((alt as { status: string }).status !== 'pendente') return { ok: false, error: 'Esta alteração já foi decidida.' };

  if (input.aprovar) {
    // Aplica os dados (jsonb) no abertura_empresas, reusando as chaves de
    // types/abertura (fonte única — zero drift com o wizard).
    const dados = ((alt as { dados?: Record<string, unknown> }).dados ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {
      dados_hash: (alt as { dados_hash?: string }).dados_hash ?? null,
      processo_atualizado_por: e.userId,
    };
    for (const k of ABERTURA_TEXT_FIELDS) if (k in dados) patch[k] = dados[k];
    for (const k of DOC_KEYS) if (k in dados) patch[k] = dados[k];
    const { error: eUp } = await admin.from('abertura_empresas').update(patch).eq('id', alvo.aberturaId);
    if (eUp) return { ok: false, error: eUp.message };
  }

  const { error } = await admin.from('abertura_alteracoes').update({
    status: input.aprovar ? 'aprovada' : 'rejeitada',
    observacoes: input.observacoes?.trim() || null,
  }).eq('id', input.alteracaoId);
  if (error) return { ok: false, error: error.message };

  await registrarAuditoria({
    actorUserId: e.userId, acao: input.aprovar ? 'abertura.alteracao.aprovar' : 'abertura.alteracao.rejeitar',
    alvoTipo: 'company', alvoId: alvo.companyId, contabilidadeId: e.contabilidadeId,
  });
  revalidatePath(`/contador/aberturas/${alvo.aberturaId}`);
  return { ok: true };
}

export async function gerarMinutaAction(input: { aberturaId: string }): Promise<ActionResult<{ html: string; filename: string; tipoDoc: string }>> {
  const e = await requireEscritorio();
  if ('error' in e) return { ok: false, error: e.error };
  const assinatura = await assertAssinaturaEscritorio(e.contabilidadeId);
  if (!assinatura.ok) return { ok: false, error: assinatura.error };
  const admin = createAdminClient();
  const alvo = await aberturaDaCarteira(admin, e.contabilidadeId, input.aberturaId);
  if (!alvo) return { ok: false, error: 'Abertura fora da sua carteira.' };

  const { data: ab } = await admin.from('abertura_empresas').select('*').eq('id', alvo.aberturaId).maybeSingle();
  if (!ab) return { ok: false, error: 'Abertura não encontrada.' };
  const row = ab as Record<string, any>;

  const pronta = minutaPronta(row as MinutaInput);
  if (!pronta.ok) return { ok: false, error: `Faltam dados para a minuta: ${pronta.faltando.join(', ')}.` };

  const tipoDoc = tipoDocumento(String(row.empresa_tipo ?? ''));
  const { html, filename } = renderMinuta(tipoDoc, row);

  await registrarAuditoria({
    actorUserId: e.userId, acao: 'abertura.gerar_minuta', alvoTipo: 'company',
    alvoId: alvo.companyId, contabilidadeId: e.contabilidadeId, meta: { tipoDoc },
  });
  return { ok: true, data: { html, filename, tipoDoc } };
}

export async function revisarDocumentoAction(
  input: { aberturaId: string; docKey: string; status: 'aprovado' | 'recusado'; observacao?: string },
): Promise<ActionResult> {
  const e = await requireEscritorio();
  if ('error' in e) return { ok: false, error: e.error };
  const assinatura = await assertAssinaturaEscritorio(e.contabilidadeId);
  if (!assinatura.ok) return { ok: false, error: assinatura.error };
  if (!(DOC_KEYS as readonly string[]).includes(input.docKey)) return { ok: false, error: 'Documento inválido.' };
  if (input.status !== 'aprovado' && input.status !== 'recusado') return { ok: false, error: 'Status inválido.' };

  const admin = createAdminClient();
  const alvo = await aberturaDaCarteira(admin, e.contabilidadeId, input.aberturaId);
  if (!alvo) return { ok: false, error: 'Abertura fora da sua carteira.' };

  // Busca a linha para merge do JSONB + user_id (destinatário) + etapa atual.
  const { data: ab } = await admin.from('abertura_empresas')
    .select('docs_revisao, user_id, processo_etapa').eq('id', alvo.aberturaId).maybeSingle();
  const revisaoAtual = ((ab as { docs_revisao?: Record<string, unknown> } | null)?.docs_revisao ?? {}) as Record<string, unknown>;
  const etapaAtual = (ab as { processo_etapa?: string | null } | null)?.processo_etapa ?? 'recebido';
  const ownerUserId = (ab as { user_id?: string | null } | null)?.user_id ?? null;

  // Merge PARCIAL: só a chave do doc é tocada; os demais docs permanecem.
  const patch: Record<string, unknown> = {
    docs_revisao: {
      ...revisaoAtual,
      [input.docKey]: {
        status: input.status,
        observacao: input.observacao?.trim() || null,
        revisado_por: e.userId,
        revisado_em: new Date().toISOString(),
      },
    },
  };
  // Recusa move para pendente_documentos (se não estiver em etapa terminal).
  if (input.status === 'recusado' && !['concluido', 'cancelado'].includes(etapaAtual)) {
    patch.processo_etapa = 'pendente_documentos';
    patch.processo_atualizado_por = e.userId;
  }

  const { error } = await admin.from('abertura_empresas').update(patch).eq('id', alvo.aberturaId);
  if (error) return { ok: false, error: error.message };

  await registrarAuditoria({
    actorUserId: e.userId, acao: 'abertura.revisar_doc', alvoTipo: 'company',
    alvoId: alvo.companyId, contabilidadeId: e.contabilidadeId,
    meta: { docKey: input.docKey, status: input.status },
  });

  if (input.status === 'recusado') {
    const motivo = input.observacao?.trim();
    await notificarEtapaAbertura(admin, {
      aberturaId: alvo.aberturaId, ownerUserId, companyId: alvo.companyId,
      etapa: `doc_recusado_${input.docKey}`,
      titulo: 'Um documento precisa de ajuste',
      corpo: `O documento enviado foi recusado.${motivo ? ' Motivo: ' + motivo + '.' : ''} Reenvie pelo painel de abertura.`,
      severidade: 'warning',
    });
  }
  revalidatePath(`/contador/aberturas/${alvo.aberturaId}`);
  revalidatePath('/contador/aberturas');
  return { ok: true };
}
