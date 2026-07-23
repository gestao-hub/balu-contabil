// src/app/(auth)/(gated)/contador/aberturas/actions.ts
'use server';
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { getContabilidadeCtx } from '@/lib/contador/guards';
import { registrarAuditoria } from '@/lib/security/audit';
import { ABERTURA_TEXT_FIELDS, DOC_KEYS } from '@/types/abertura';

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
  revalidatePath(`/contador/aberturas/${alvo.aberturaId}`);
  revalidatePath('/contador/aberturas');
  return { ok: true };
}

export async function concluirAberturaAction(input: { aberturaId: string; cnpj: string }): Promise<ActionResult> {
  const e = await requireEscritorio();
  if ('error' in e) return { ok: false, error: e.error };
  const cnpj = input.cnpj.replace(/\D/g, '');
  if (cnpj.length !== 14) return { ok: false, error: 'CNPJ inválido (informe os 14 dígitos).' };

  const admin = createAdminClient();
  const alvo = await aberturaDaCarteira(admin, e.contabilidadeId, input.aberturaId);
  if (!alvo) return { ok: false, error: 'Abertura fora da sua carteira.' };

  // 1) abertura concluída + CNPJ emitido
  const { error: e1 } = await admin.from('abertura_empresas').update({
    processo_etapa: 'concluido', processo_cnpj_emitido: cnpj, processo_atualizado_por: e.userId,
  }).eq('id', alvo.aberturaId);
  if (e1) return { ok: false, error: e1.message };

  // 2) ativa a company com o CNPJ (escopado — anti-IDOR)
  const { error: e2 } = await admin.from('companies')
    .update({ status: 'active', cnpj })
    .eq('id', alvo.companyId).eq('contabilidade_id', e.contabilidadeId);
  if (e2) return { ok: false, error: e2.message };

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
