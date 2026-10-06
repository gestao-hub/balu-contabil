'use server';
// Envio dos documentos do KYC da subconta direto para o Asaas.
//
// O ARQUIVO NÃO É GUARDADO. Documento de identidade e selfie são dado pessoal
// sensível do responsável pelo escritório; a Balu só o repassa ao Asaas, que é
// quem precisa dele. Nada vai para Storage, banco ou log — a auditoria guarda
// tipo, tamanho e formato, nunca o conteúdo nem o nome do arquivo.
//
// O CLIENTE NÃO ESCOLHE O TIPO NEM PROVA O GRUPO. Ele manda só o `grupoId`; a
// action relista os grupos COM A CHAVE DESTE ESCRITÓRIO e confere que o grupo é
// dele, que ainda aceita envio e que não tem `onboardingUrl` (com link, a doc do
// Asaas proíbe o envio pela API). O `type` sai do próprio grupo.
//
// SÓ O DONO DA SUBCONTA envia — mesma regra do saque (`saque-actions.ts`): são
// os documentos de quem a abriu.
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireEscritorioAprovado } from '@/lib/contador/guards';
import { registrarAuditoria } from '@/lib/security/audit';
import { asaasSub } from '@/lib/clients/asaas';
import { traduzirErroAsaas, descricaoDoErroAsaas, statusDoErroAsaas } from '@/lib/billing/subconta-erros';
import { chaveDaSubconta } from '@/lib/billing/documentos-subconta-asaas';
import { documentosParaVm, validarArquivoDocumento } from '@/lib/billing/documentos-subconta';

type ActionResult = { ok: true } | { ok: false; error: string };

export async function enviarDocumentoSubcontaAction(formData: FormData): Promise<ActionResult> {
  const ctx = await requireEscritorioAprovado();
  if (!ctx.ok) return ctx;

  const grupoId = String(formData.get('grupoId') ?? '').trim();
  const arquivo = formData.get('arquivo');
  if (!grupoId) return { ok: false, error: 'Documento inválido.' };
  if (!(arquivo instanceof File)) return { ok: false, error: 'Escolha o arquivo.' };
  const invalido = validarArquivoDocumento(arquivo);
  if (invalido) return { ok: false, error: invalido };

  const sb = createAdminClient();
  const { data: cont } = await sb.from('contabilidades')
    .select('asaas_subconta_id, asaas_subconta_criada_por')
    .eq('id', ctx.id).maybeSingle();
  if (!cont?.asaas_subconta_id) return { ok: false, error: 'Este escritório ainda não tem conta de recebimento.' };
  if (!cont.asaas_subconta_criada_por || cont.asaas_subconta_criada_por !== ctx.userId) {
    return { ok: false, error: 'Só quem abriu a conta de recebimento pode enviar os documentos dela.' };
  }

  const chave = await chaveDaSubconta(ctx.id);
  if (!chave) return { ok: false, error: 'A credencial da conta de recebimento não está disponível. Fale com o suporte da Balu.' };
  const sub = asaasSub(chave);

  // O grupo tem de ser DESTA conta e ainda aceitar envio pela API.
  let grupo;
  try {
    grupo = documentosParaVm(await sub.listarDocumentosConta()).grupos.find((g) => g.grupoId === grupoId);
  } catch (e) {
    return { ok: false, error: traduzirErroAsaas(e) };
  }
  if (!grupo) return { ok: false, error: 'Este documento não é mais pedido pelo Asaas. Recarregue a página.' };
  if (grupo.linkEnvio) return { ok: false, error: 'Este documento é enviado pelo link do Asaas, não por aqui.' };
  if (!grupo.podeEnviar) return { ok: false, error: 'Este documento já foi enviado e está em análise.' };

  try {
    await sub.enviarDocumentoConta(grupo.grupoId, grupo.tipo, arquivo, nomeNeutro(grupo.tipo, arquivo.type));
  } catch (e) {
    console.error('[4b] envio de documento da subconta falhou:', e instanceof Error ? e.message.slice(0, 200) : 'erro');
    return { ok: false, error: erroDoEnvio(e) };
  }

  await registrarAuditoria({
    actorUserId: ctx.userId, acao: 'subconta.documento_enviado',
    alvoTipo: 'contabilidade', alvoId: ctx.id, contabilidadeId: ctx.id,
    meta: { grupo_id: grupo.grupoId, tipo: grupo.tipo, bytes: arquivo.size, formato: arquivo.type },
  });

  revalidatePath('/contador/configuracoes/subconta');
  return { ok: true };
}

/** Nome sem nada do usuário: o nome original do arquivo pode carregar o nome
 *  da pessoa ou o número do documento, e não há por que mandá-lo adiante. */
function nomeNeutro(tipo: string, mime: string): string {
  const ext = mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : 'jpg';
  return `${tipo.toLowerCase()}.${ext}`;
}

/** 4xx no envio é o ARQUIVO recusado — a frase genérica de `traduzirErroAsaas`
 *  falaria de CEP e endereço. Usa a descrição do Asaas quando ela é útil. */
function erroDoEnvio(e: unknown): string {
  const status = statusDoErroAsaas(e);
  if (status !== null && status >= 400 && status < 500 && status !== 401 && status !== 403) {
    return descricaoDoErroAsaas(e)
      ?? 'O Asaas recusou o arquivo. Confira se a foto está nítida e completa e tente de novo.';
  }
  return traduzirErroAsaas(e);
}
