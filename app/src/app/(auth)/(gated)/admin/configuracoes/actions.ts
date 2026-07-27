'use server';
// Bloco 4A — liberação manual de acesso pelo AdminBalu.
//
// PARA QUE SERVE: quem paga por boleto fica bloqueado até a compensação (1 a
// 3 dias úteis). O titular manda o comprovante, o admin libera na hora, e
// quando a compensação cair o sistema só registra o pagamento — a liberação
// deixa de importar sozinha, porque o status já libera.
//
// POR QUE NÃO "marcar como ativa": seria desfeito na madrugada. A
// reconciliação lê as cobranças no Asaas e, no vencimento, um boleto ainda
// não compensado vira OVERDUE → 'inadimplente'. O cliente que mandou o
// comprovante seria bloqueado de novo. A liberação vive em campo próprio
// (0051) que nada vindo do Asaas apaga.
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdminBaluAction } from '@/lib/admin/guard';
import { registrarAuditoria } from '@/lib/security/audit';
import { ymdBrt } from '@/lib/fiscal/tempo-brt';
import { dataLiberacao, MAX_DIAS_LIBERACAO } from './liberacao';

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function liberarAcessoAction(
  assinaturaId: string, dias: number, motivo: string,
): Promise<ActionResult> {
  const ctx = await requireAdminBaluAction();
  if ('error' in ctx) return { ok: false, error: ctx.error };

  if (!assinaturaId) return { ok: false, error: 'Assinatura não informada.' };
  if (!Number.isInteger(dias) || dias < 1 || dias > MAX_DIAS_LIBERACAO) {
    return { ok: false, error: `Informe de 1 a ${MAX_DIAS_LIBERACAO} dias.` };
  }
  // Motivo OBRIGATÓRIO. Uma liberação sem justificativa é indistinguível de
  // um erro de clique quando alguém for auditar isso daqui a seis meses.
  const texto = motivo.trim();
  if (texto.length < 5) {
    return { ok: false, error: 'Descreva o motivo (ex.: comprovante de boleto de 27/07).' };
  }

  const sb = createAdminClient();
  const { data: atual } = await sb
    .from('assinaturas').select('id, liberado_ate').eq('id', assinaturaId).maybeSingle();
  if (!atual) return { ok: false, error: 'Assinatura não encontrada.' };

  const ate = dataLiberacao(dias, ymdBrt());
  const { error } = await sb.from('assinaturas').update({
    liberado_ate: ate,
    liberacao_motivo: texto,
    liberacao_por: ctx.userId,
    liberacao_em: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', assinaturaId);
  if (error) return { ok: false, error: error.message };

  await registrarAuditoria({
    actorUserId: ctx.userId, acao: 'assinatura.liberar_manual',
    alvoTipo: 'assinatura', alvoId: assinaturaId,
    meta: { ate, dias, motivo: texto, anterior: atual.liberado_ate },
  });

  revalidatePath('/admin/configuracoes');
  return { ok: true };
}

/** Revoga a liberação antes do prazo — erro de clique, comprovante falso,
 *  pagamento que não veio. Volta a valer o status normal na hora. */
export async function revogarLiberacaoAction(assinaturaId: string): Promise<ActionResult> {
  const ctx = await requireAdminBaluAction();
  if ('error' in ctx) return { ok: false, error: ctx.error };
  if (!assinaturaId) return { ok: false, error: 'Assinatura não informada.' };

  const sb = createAdminClient();
  const { data: atual } = await sb
    .from('assinaturas').select('id, liberado_ate, liberacao_motivo')
    .eq('id', assinaturaId).maybeSingle();
  if (!atual) return { ok: false, error: 'Assinatura não encontrada.' };

  const { error } = await sb.from('assinaturas').update({
    liberado_ate: null,
    // O motivo e o autor FICAM: apagá-los junto tiraria do audit visual da
    // própria linha o registro de que houve uma liberação.
    updated_at: new Date().toISOString(),
  }).eq('id', assinaturaId);
  if (error) return { ok: false, error: error.message };

  await registrarAuditoria({
    actorUserId: ctx.userId, acao: 'assinatura.revogar_liberacao',
    alvoTipo: 'assinatura', alvoId: assinaturaId,
    meta: { era_ate: atual.liberado_ate, motivo_anterior: atual.liberacao_motivo },
  });

  revalidatePath('/admin/configuracoes');
  return { ok: true };
}
