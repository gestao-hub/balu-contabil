// Bloco 7, Task 6 — fila de escaladas de atendimento do escritório.
'use server';
import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/supabase/server';
import { getContabilidadeCtx } from '@/lib/contador/guards';
import { registrarAuditoria } from '@/lib/security/audit';
import { createAdminClient } from '@/lib/supabase/admin';
import { escritorioPorId } from '@/lib/uazapi/instancia';
import { enviarMensagem } from '@/lib/uazapi/cliente';

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Teto da resposta: mensagem de WhatsApp, não e-mail. */
const MAX_RESPOSTA = 2000;

/**
 * Responde o cliente PELO WHATSAPP DO ESCRITÓRIO conectado à plataforma, e
 * fecha o atendimento (para o relógio do SLA).
 *
 * POR QUE PELA BALU, e não por um link wa.me (decisão do usuário, 06/10/2026):
 * o link abre o WhatsApp logado no aparelho de quem clicou — que pode ser o
 * número pessoal do contador. Aqui a mensagem sai, com garantia, pela instância
 * do escritório (`escritorioPorId(...).config`, só quando CONECTADA).
 *
 * A linha é lida pela SESSÃO (RLS da 0070 recorta pelo escritório) — o
 * telefone de destino nunca vem do navegador, só o id do atendimento.
 */
export async function responderAtendimentoAction(id: string, texto: string): Promise<ActionResult> {
  if (!id) return { ok: false, error: 'Atendimento não informado.' };
  const mensagem = String(texto ?? '').trim();
  if (!mensagem) return { ok: false, error: 'Escreva a resposta.' };
  if (mensagem.length > MAX_RESPOSTA) return { ok: false, error: `A resposta passa de ${MAX_RESPOSTA} caracteres.` };

  const g = await getContabilidadeCtx();
  if ('error' in g) return { ok: false, error: g.error };
  if (!g.contabilidade) return { ok: false, error: 'Você não faz parte de um escritório.' };

  const supabase = await createServerClient();
  const { data: linha, error: eLer } = await supabase
    .from('whatsapp_atendimentos')
    .select('id, telefone, resposta_enviada, atendido_em')
    .eq('id', id)
    .eq('contabilidade_id', g.contabilidade.id)
    .maybeSingle();
  if (eLer) return { ok: false, error: 'Não foi possível ler o atendimento. Tente de novo.' };
  if (!linha) return { ok: false, error: 'Atendimento não encontrado.' };
  if (linha.atendido_em) return { ok: false, error: 'Este atendimento já foi respondido por alguém da equipe.' };

  // `config` só existe com a instância CONECTADA — mandar por uma instância em
  // 'conectando' devolveria ok sem nada sair.
  const canal = await escritorioPorId(createAdminClient(), g.contabilidade.id);
  if (!canal?.config) {
    return {
      ok: false,
      error: 'O WhatsApp do escritório não está conectado. Conecte em Config. > WhatsApp para responder por aqui.',
    };
  }

  const envio = await enviarMensagem(canal.config, { telefone: linha.telefone as string, texto: mensagem });
  if (!envio.ok) {
    console.error('[atendimentos] resposta da equipe nao enviada:', envio.erro ?? 'sem detalhe');
    return { ok: false, error: 'O WhatsApp não aceitou o envio agora. Confira a conexão e tente de novo.' };
  }

  // A resposta da equipe entra no histórico da conversa (a IA a lê na próxima
  // mensagem do cliente) sem apagar o que o assistente já tinha dito.
  const anterior = (linha.resposta_enviada as string | null)?.trim();
  const { error: eGravar } = await supabase
    .from('whatsapp_atendimentos')
    .update({
      resposta_enviada: `${anterior ? `${anterior}\n\n` : ''}Resposta da equipe: ${mensagem}`,
      atendido_em: new Date().toISOString(),
      atendido_por: g.userId,
    })
    .eq('id', id)
    .eq('contabilidade_id', g.contabilidade.id)
    .is('atendido_em', null);
  // A mensagem JÁ SAIU: falhar aqui não pode virar "tente de novo", senão o
  // cliente recebe duas vezes.
  if (eGravar) console.error('[atendimentos] resposta enviada mas nao gravada:', eGravar.message);

  await registrarAuditoria({
    actorUserId: g.userId, acao: 'atendimento.responder',
    contabilidadeId: g.contabilidade.id, alvoTipo: 'whatsapp_atendimento', alvoId: id,
    // Sem o texto e sem o telefone: o conteúdo é conversa do cliente.
    meta: { caracteres: mensagem.length },
  });

  revalidatePath('/contador/atendimentos');
  return { ok: true };
}

/**
 * Marca uma escalada como atendida — é isto que para o relógio do SLA.
 *
 * O escopo por `contabilidade_id` está no `.eq()` E na RLS (policy
 * `whatsapp_atendimentos_update_escritorio`, migration 0070). O `.eq()` sozinho
 * seria anti-IDOR de fachada; a RLS é a fronteira de verdade, e o `.eq()`
 * existe para o erro ser "não encontrado" em vez de um update silencioso de
 * zero linhas.
 */
export async function marcarAtendidoAction(id: string): Promise<ActionResult> {
  if (!id) return { ok: false, error: 'Atendimento não informado.' };

  const g = await getContabilidadeCtx();
  if ('error' in g) return { ok: false, error: g.error };
  if (!g.contabilidade) return { ok: false, error: 'Você não faz parte de um escritório.' };

  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('whatsapp_atendimentos')
    .update({ atendido_em: new Date().toISOString(), atendido_por: g.userId })
    .eq('id', id)
    .eq('contabilidade_id', g.contabilidade.id)
    .is('atendido_em', null)   // idempotente: quem já foi atendido não muda de dono
    .select('id');

  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    // Duas causas possíveis, e nenhuma é erro do usuário: outra pessoa do
    // escritório atendeu primeiro, ou a linha não é desta contabilidade.
    return { ok: false, error: 'Este atendimento já foi marcado por alguém da equipe.' };
  }

  await registrarAuditoria({
    actorUserId: g.userId, acao: 'atendimento.marcar_atendido',
    contabilidadeId: g.contabilidade.id, alvoTipo: 'whatsapp_atendimento', alvoId: id,
  });

  revalidatePath('/contador/atendimentos');
  return { ok: true };
}
