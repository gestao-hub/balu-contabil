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
import {
  uploadToBucket, removeFromBucket, signedUrlDownload,
} from '@/lib/clients/supabase-storage';
import {
  validarComprovanteLiberacao, caminhoComprovanteLiberacao, nomeSeguro, carimboDe,
  BUCKET_COMPROVANTES_LIBERACAO, type ComprovanteUpload,
} from '@/lib/billing/comprovante-liberacao';
import { dataLiberacao, MAX_DIAS_LIBERACAO } from './liberacao';

// Neste arquivo, todo export de VALOR tem de ser Server Action async:
// constante e função síncrona quebram o `next build`, e o `tsc --noEmit` não
// pega (a validação vive nos tipos gerados em .next/types). O repo já pagou
// por isso duas vezes. Tipo é apagado na compilação e passa — `ActionResult`
// abaixo é prova disso —, mas o do comprovante mora junto do validador, que é
// onde ele é usado.
export type ActionResult = { ok: true } | { ok: false; error: string };

export async function liberarAcessoAction(
  assinaturaId: string, dias: number, motivo: string,
  comprovante: ComprovanteUpload | null,
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

  // Comprovante OBRIGATÓRIO (decisão do usuário, 27/07). Esta é a única porta
  // que destrava o gate sem passar pelo Asaas; sem arquivo, o único lastro
  // seria um texto digitado por quem liberou. A checagem é aqui no servidor —
  // a do navegador é conveniência e pode ser contornada.
  if (!comprovante || !comprovante.base64) {
    return { ok: false, error: 'Anexe o comprovante. Não há liberação sem comprovante.' };
  }
  let bytes: Buffer;
  try {
    bytes = Buffer.from(comprovante.base64, 'base64');
  } catch {
    return { ok: false, error: 'Não foi possível ler o arquivo enviado.' };
  }
  // O tamanho que vale é o dos bytes decodificados, não o que o cliente disse.
  const v = validarComprovanteLiberacao({
    nome: comprovante.nome, mime: comprovante.mime, tamanho: bytes.byteLength,
  });
  if (!v.ok) return { ok: false, error: v.error };

  const sb = createAdminClient();
  const { data: atual } = await sb
    .from('assinaturas').select('id, liberado_ate').eq('id', assinaturaId).maybeSingle();
  if (!atual) return { ok: false, error: 'Assinatura não encontrada.' };

  const agora = new Date().toISOString();
  const path = caminhoComprovanteLiberacao(
    assinaturaId, comprovante.nome, comprovante.mime, carimboDe(agora),
  );
  try {
    await uploadToBucket(
      BUCKET_COMPROVANTES_LIBERACAO, path, bytes,
      comprovante.mime || 'application/octet-stream',
    );
  } catch (e) {
    return { ok: false, error: `Falha ao guardar o comprovante: ${(e as Error).message}` };
  }

  const ate = dataLiberacao(dias, ymdBrt());
  const { error } = await sb.from('assinaturas').update({
    liberado_ate: ate,
    liberacao_motivo: texto,
    liberacao_por: ctx.userId,
    liberacao_em: agora,
    liberacao_comprovante_path: path,
    liberacao_comprovante_nome: comprovante.nome.trim().slice(0, 200),
    liberacao_comprovante_mime: comprovante.mime || null,
    liberacao_comprovante_tamanho: bytes.byteLength,
    updated_at: agora,
  }).eq('id', assinaturaId);
  if (error) {
    // Sem isto sobra arquivo no bucket sem nenhuma linha apontando para ele —
    // e o próximo que for auditar não sabe se houve liberação ou não.
    await removeFromBucket(BUCKET_COMPROVANTES_LIBERACAO, path);
    return { ok: false, error: error.message };
  }

  await registrarAuditoria({
    actorUserId: ctx.userId, acao: 'assinatura.liberar_manual',
    alvoTipo: 'assinatura', alvoId: assinaturaId,
    // O path entra na meta: é assim que a liberação de SEIS MESES ATRÁS
    // continua tendo comprovante, mesmo depois de várias renovações.
    meta: {
      ate, dias, motivo: texto, anterior: atual.liberado_ate,
      comprovante_path: path, comprovante_nome: comprovante.nome, comprovante_bytes: bytes.byteLength,
    },
  });

  revalidatePath('/admin/configuracoes');
  return { ok: true };
}

/**
 * URL curta (5 min) para o AdminBalu abrir o comprovante de uma liberação.
 *
 * Gerada sob demanda, e não junto com a lista, para não despejar no HTML da
 * página uma URL assinada por titular — quem tivesse acesso ao HTML levaria
 * todos os comprovantes de uma vez. Força download: nada é renderizado.
 */
export async function urlComprovanteLiberacaoAction(
  assinaturaId: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const ctx = await requireAdminBaluAction();
  if ('error' in ctx) return { ok: false, error: ctx.error };
  if (!assinaturaId) return { ok: false, error: 'Assinatura não informada.' };

  const sb = createAdminClient();
  const { data } = await sb
    .from('assinaturas')
    .select('liberacao_comprovante_path, liberacao_comprovante_nome, liberacao_comprovante_mime')
    .eq('id', assinaturaId).maybeSingle();
  if (!data?.liberacao_comprovante_path) {
    return { ok: false, error: 'Esta liberação não tem comprovante guardado.' };
  }

  const url = await signedUrlDownload(
    BUCKET_COMPROVANTES_LIBERACAO,
    data.liberacao_comprovante_path,
    nomeSeguro(data.liberacao_comprovante_nome ?? 'comprovante', data.liberacao_comprovante_mime ?? ''),
  );
  if (!url) return { ok: false, error: 'Não foi possível gerar o link do comprovante.' };

  await registrarAuditoria({
    actorUserId: ctx.userId, acao: 'assinatura.ver_comprovante_liberacao',
    alvoTipo: 'assinatura', alvoId: assinaturaId,
    meta: { path: data.liberacao_comprovante_path },
  });

  return { ok: true, url };
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
