'use server';
// Canal de WhatsApp do escritório — conectar, acompanhar e desconectar.
// Migration 0091. Spec:
// docs/superpowers/specs/2026-08-20-canal-whatsapp-por-escritorio-design.md
//
// TUDO PASSA PELO ADMIN CLIENT, e não é preguiça: a 0091 concedeu a
// `authenticated` apenas SELECT de `uazapi_numero`, `uazapi_status` e
// `uazapi_conectado_em`. O token da instância e o token do webhook não são
// legíveis nem escrevíveis pela sessão do usuário — `permission denied` aqui
// seria a migration funcionando, não bug.
//
// NENHUMA action deste arquivo devolve token: nem o da instância (envia
// mensagem em nome do escritório), nem o do webhook (identifica o tenant na
// entrada). O que volta para a tela é status, número e código de pareamento.
import { revalidatePath } from 'next/cache';
import { randomBytes } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireEscritorioAprovado } from '@/lib/contador/guards';
import { registrarAuditoria } from '@/lib/security/audit';
import { cifrarCampo, decifrarCampo } from '@/lib/crypto/envelope';
import { getSiteUrl } from '@/lib/site-url';
import { soDigitosWhatsapp } from '@/lib/whatsapp/numero';
import {
  criarInstancia, configurarWebhook, pedirPareamento, statusInstancia, desconectarInstancia,
} from '@/lib/uazapi/provisionamento';

type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { dados: T }))
  | { ok: false; error: string };

type LinhaCanal = {
  id: string;
  nome: string | null;
  uazapi_instancia_id: string | null;
  uazapi_token_cifrado: string | null;
  uazapi_webhook_token: string | null;
  uazapi_status: string | null;
};

const COLUNAS = 'id, nome, uazapi_instancia_id, uazapi_token_cifrado, uazapi_webhook_token, uazapi_status';

/**
 * A instância do escritório, criando-a na primeira vez.
 *
 * Idempotente de propósito: um duplo clique em "Conectar" não pode gerar duas
 * instâncias no servidor — a segunda ficaria órfã, cobrando recurso e sem
 * ninguém sabendo que existe.
 */
async function garantirInstancia(contabilidadeId: string): Promise<
  { ok: true; token: string; linha: LinhaCanal } | { ok: false; error: string }
> {
  const admin = createAdminClient();
  const { data } = await admin.from('contabilidades').select(COLUNAS).eq('id', contabilidadeId).maybeSingle();
  const linha = data as LinhaCanal | null;
  if (!linha) return { ok: false, error: 'Escritório não encontrado.' };

  const jaTem = decifrarCampo(linha.uazapi_token_cifrado);
  if (linha.uazapi_instancia_id && jaTem) return { ok: true, token: jaTem, linha };

  const criada = await criarInstancia(linha.nome ?? contabilidadeId.slice(0, 8));
  if (!criada.ok) return { ok: false, error: criada.erro };

  // GRAVAR É A PRIMEIRA COISA depois da criação — mesma disciplina da subconta
  // Asaas: o token só aparece na resposta da criação. Perdido, a instância fica
  // inoperável pela Balu e vira lixo no servidor de outra pessoa.
  const tokenWebhook = randomBytes(32).toString('hex');
  const { error } = await admin.from('contabilidades').update({
    uazapi_instancia_id: criada.dados.id,
    uazapi_token_cifrado: cifrarCampo(criada.dados.token),
    uazapi_webhook_token: tokenWebhook,
    uazapi_status: 'desconectado',
  }).eq('id', contabilidadeId);

  if (error) {
    console.error('[whatsapp escritorio] instancia criada e NAO gravada:', criada.dados.id, error.message);
    return { ok: false, error: 'Instância criada mas não salva. Chame o suporte com este código: ' + criada.dados.id };
  }

  const cfg = await configurarWebhook(criada.dados.token, getSiteUrl(), tokenWebhook);
  if (!cfg.ok) {
    // Não é fatal: sem webhook o escritório ENVIA e não RECEBE. Melhor deixar
    // conectar e registrar o defeito do que abortar tudo.
    console.error('[whatsapp escritorio] webhook nao configurado:', cfg.erro);
  }

  return {
    ok: true,
    token: criada.dados.token,
    linha: { ...linha, uazapi_instancia_id: criada.dados.id, uazapi_webhook_token: tokenWebhook },
  };
}

/** Conectar: cria a instância se preciso e devolve o código de pareamento. */
export async function conectarWhatsappAction(numeroBruto: string): Promise<ActionResult<{ paircode: string }>> {
  const g = await requireEscritorioAprovado();
  if (!g.ok) return { ok: false, error: g.error };

  const numero = soDigitosWhatsapp(numeroBruto);
  // 12 ou 13 dígitos com o 55 na frente. O 9º dígito varia legitimamente (ver
  // lib/whatsapp/numero), então a régua é o tamanho, não o formato exato.
  if (numero.length < 12 || numero.length > 13 || !numero.startsWith('55')) {
    return { ok: false, error: 'Informe o número com DDD, no formato 55 + DDD + número.' };
  }

  const inst = await garantirInstancia(g.id);
  if (!inst.ok) return { ok: false, error: inst.error };

  const par = await pedirPareamento(inst.token, numero);
  if (!par.ok) return { ok: false, error: par.erro };

  const admin = createAdminClient();
  await admin.from('contabilidades')
    .update({ uazapi_status: 'conectando', uazapi_numero: numero })
    .eq('id', g.id);

  await registrarAuditoria({
    actorUserId: g.userId,
    acao: 'whatsapp.pareamento_solicitado', alvoTipo: 'contabilidade', alvoId: g.id,
    contabilidadeId: g.id,
    // Número mascarado: a auditoria registra que aconteceu, não quem é.
    meta: { numero: numero.slice(0, 4) + '…' + numero.slice(-2) },
  });

  revalidatePath('/contador/configuracoes/whatsapp');
  return { ok: true, dados: { paircode: par.dados.paircode } };
}

/** Status: consulta a uazapi e sincroniza o banco. Chamado em polling pela tela
 *  enquanto o pareamento não conclui. */
export async function statusWhatsappAction(): Promise<
  ActionResult<{ status: string; numero: string | null }>
> {
  const g = await requireEscritorioAprovado();
  if (!g.ok) return { ok: false, error: g.error };

  const admin = createAdminClient();
  const { data } = await admin.from('contabilidades').select(COLUNAS).eq('id', g.id).maybeSingle();
  const linha = data as LinhaCanal | null;
  const token = decifrarCampo(linha?.uazapi_token_cifrado ?? null);
  if (!token) return { ok: true, dados: { status: 'desconectado', numero: null } };

  const st = await statusInstancia(token);
  if (!st.ok) return { ok: false, error: st.erro };

  // Vocabulário da uazapi → o nosso (o CHECK da 0091 só aceita estes três).
  const nosso = st.dados.status === 'connected' ? 'conectado'
    : st.dados.status === 'connecting' ? 'conectando' : 'desconectado';

  await admin.from('contabilidades').update({
    uazapi_status: nosso,
    ...(st.dados.numero ? { uazapi_numero: st.dados.numero } : {}),
    ...(nosso === 'conectado' ? { uazapi_conectado_em: new Date().toISOString() } : {}),
  }).eq('id', g.id);

  revalidatePath('/contador/configuracoes/whatsapp');
  return { ok: true, dados: { status: nosso, numero: st.dados.numero } };
}

/** Desconectar o número. A instância CONTINUA existindo — é assim que se troca
 *  de aparelho sem perder token nem webhook. */
export async function desconectarWhatsappAction(): Promise<ActionResult> {
  const g = await requireEscritorioAprovado();
  if (!g.ok) return { ok: false, error: g.error };

  const admin = createAdminClient();
  const { data } = await admin.from('contabilidades').select(COLUNAS).eq('id', g.id).maybeSingle();
  const token = decifrarCampo((data as LinhaCanal | null)?.uazapi_token_cifrado ?? null);
  if (!token) return { ok: false, error: 'Nenhuma instância configurada.' };

  const r = await desconectarInstancia(token);
  if (!r.ok) return { ok: false, error: r.erro };

  await admin.from('contabilidades')
    .update({ uazapi_status: 'desconectado', uazapi_numero: null, uazapi_conectado_em: null })
    .eq('id', g.id);

  await registrarAuditoria({
    actorUserId: g.userId, contabilidadeId: g.id,
    acao: 'whatsapp.desconectado', alvoTipo: 'contabilidade', alvoId: g.id, meta: {},
  });

  revalidatePath('/contador/configuracoes/whatsapp');
  return { ok: true };
}
