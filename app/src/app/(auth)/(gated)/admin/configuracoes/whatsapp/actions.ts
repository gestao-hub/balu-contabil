'use server';
// 0101 — canal de WhatsApp DA PLATAFORMA (o número oficial do Balu).
//
// É a irmã de `contador/configuracoes/whatsapp/actions.ts`, com duas
// diferenças que não são cosméticas:
//
//  1. O guard é `requireAdminBaluAction`, não o do escritório.
//  2. O webhook desta instância NÃO leva `?t=`. A rota `/api/webhooks/uazapi`
//     decide o tenant por precedência: com `t`, é canal de escritório; com
//     `?s=<UAZAPI_WEBHOOK_SECRET>`, é o canal da plataforma. Mandar `t` aqui
//     faria as mensagens do número oficial entrarem como se fossem de um
//     escritório — e a carteira inteira do assistente sairia errada.
//
// NENHUMA action daqui devolve o token da instância: com ele, qualquer um
// envia mensagem em nome da plataforma inteira. E o QR também não vai para a
// auditoria — ele é credencial de sessão do WhatsApp, e quem o ler no minuto
// seguinte conecta o próprio aparelho no lugar do Balu.
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdminBaluAction } from '@/lib/admin/guard';
import { registrarAuditoria } from '@/lib/security/audit';
import { getSiteUrl } from '@/lib/site-url';
import {
  guardarTokenPlataforma, lerTokenPlataforma, lerConfigWhatsapp, gravarAdminToken,
} from '@/lib/uazapi/config-plataforma';
import {
  criarInstancia, configurarWebhookUrl, pedirQrCode, statusInstancia, desconectarInstancia,
  sondarAdminToken,
} from '@/lib/uazapi/provisionamento';

type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { dados: T }))
  | { ok: false; error: string };

/** Aponta o webhook da instância da plataforma para a nossa entrada, com o
 *  `?s=` que a rota já valida hoje. O segredo continua no ambiente de
 *  propósito — ver o cabeçalho da 0101. */
async function apontarWebhookDaPlataforma(tokenInstancia: string): Promise<void> {
  const segredo = process.env.UAZAPI_WEBHOOK_SECRET;
  if (!segredo) {
    // Não aborta: sem webhook a plataforma ENVIA e não RECEBE, que é melhor do
    // que não conectar nada. Mas registra — este é o tipo de falha que some.
    console.error('[0101] UAZAPI_WEBHOOK_SECRET ausente: instancia conectada sem receber mensagem.');
    return;
  }
  const site = getSiteUrl().replace(/\/+$/, '');
  const r = await configurarWebhookUrl(
    tokenInstancia,
    `${site}/api/webhooks/uazapi?s=${encodeURIComponent(segredo)}`,
  );
  if (!r.ok) console.error('[0101] webhook da plataforma nao configurado:', r.erro);
}

/**
 * A instância da plataforma, criando-a na primeira vez.
 *
 * Idempotente pelo mesmo motivo da do escritório: um duplo clique não pode
 * gerar duas instâncias no servidor compartilhado — a segunda ficaria órfã,
 * consumindo recurso, sem ninguém saber que existe.
 *
 * ⚠️ O GUARD É SOBRE A INSTÂNCIA EXISTIR, não sobre conseguir decifrá-la —
 * lição do code-review de 19/08/2026, no caminho do escritório. Guardando pelos
 * dois juntos, uma falha de decifra (chave rotacionada, texto corrompido) cairia
 * no `else` e PROVISIONARIA OUTRA instância.
 */
async function garantirInstanciaPlataforma(): Promise<
  { ok: true; token: string } | { ok: false; error: string }
> {
  const r = await lerConfigWhatsapp();
  // FALHA FECHADA: erro de leitura não pode virar "ainda não existe" e
  // provisionar por cima de uma instância que está no ar.
  if (!r.ok) return { ok: false, error: 'Não foi possível ler a configuração do canal. Tente de novo.' };

  if (r.linha?.instancia_id) {
    let jaTem: string | null = null;
    try {
      jaTem = lerTokenPlataforma(r.linha.token_cifrado);
    } catch {
      jaTem = null;
    }
    if (!jaTem) {
      console.error('[0101] instancia existe e o token nao decifra:', r.linha.instancia_id);
      return {
        ok: false,
        error: 'Não conseguimos ler a credencial da instância da plataforma. Código para o suporte: '
          + r.linha.instancia_id,
      };
    }
    return { ok: true, token: jaTem };
  }

  const criada = await criarInstancia('plataforma');
  if (!criada.ok) return { ok: false, error: criada.erro };

  // GRAVAR É A PRIMEIRA COISA depois da criação: o token só aparece na resposta
  // dela. Perdido, a instância fica inoperável e vira lixo no servidor.
  const { error } = await createAdminClient().from('config_whatsapp').upsert({
    id: 1,
    instancia_id: criada.dados.id,
    token_cifrado: guardarTokenPlataforma(criada.dados.token),
    status: 'desconectado',
    atualizado_em: new Date().toISOString(),
  }, { onConflict: 'id' });

  if (error) {
    console.error('[0101] instancia criada e NAO gravada:', criada.dados.id, error.message);
    return { ok: false, error: 'Instância criada mas não salva. Código para o suporte: ' + criada.dados.id };
  }

  await apontarWebhookDaPlataforma(criada.dados.token);
  return { ok: true, token: criada.dados.token };
}

/** Conectar por QR: cria a instância se preciso e devolve o QR. */
export async function conectarPlataformaAction(): Promise<ActionResult<{ qrcode: string }>> {
  const g = await requireAdminBaluAction();
  if ('error' in g) return { ok: false, error: g.error };

  const inst = await garantirInstanciaPlataforma();
  if (!inst.ok) return { ok: false, error: inst.error };

  // Reconfigurado a cada conexão, como no caminho do escritório: sem isto, um
  // 502 passageiro durante o provisionamento deixaria a plataforma capaz de
  // enviar e incapaz de receber PARA SEMPRE, com a tela dizendo "Conectado".
  await apontarWebhookDaPlataforma(inst.token);

  const qr = await pedirQrCode(inst.token);
  if (!qr.ok) return { ok: false, error: qr.erro };

  await createAdminClient().from('config_whatsapp')
    .update({ status: 'conectando', atualizado_por: g.userId, atualizado_em: new Date().toISOString() })
    .eq('id', 1);

  await registrarAuditoria({
    actorUserId: g.userId,
    acao: 'whatsapp_plataforma.qrcode_solicitado', alvoTipo: 'config', alvoId: null,
    meta: {},
  });

  revalidatePath('/admin/configuracoes/whatsapp');
  return { ok: true, dados: { qrcode: qr.dados.qrcode } };
}

/** Status: consulta a uazapi e sincroniza o banco. O polling da tela chama
 *  isto, e a resposta traz o QR corrente — o servidor o rotaciona sozinho. */
export async function statusPlataformaAction(): Promise<
  ActionResult<{ status: string; numero: string | null; qrcode: string | null }>
> {
  const g = await requireAdminBaluAction();
  if ('error' in g) return { ok: false, error: g.error };

  const r = await lerConfigWhatsapp();
  if (!r.ok) return { ok: false, error: 'Não foi possível ler a configuração do canal.' };

  let token: string | null = null;
  try {
    token = lerTokenPlataforma(r.linha?.token_cifrado ?? null);
  } catch {
    token = null;
  }
  if (!token) return { ok: true, dados: { status: 'desconectado', numero: null, qrcode: null } };

  const st = await statusInstancia(token);
  if (!st.ok) return { ok: false, error: st.erro };

  // Vocabulário da uazapi → o nosso (o CHECK da 0101 só aceita estes três).
  const nosso = st.dados.status === 'connected' ? 'conectado'
    : st.dados.status === 'connecting' ? 'conectando' : 'desconectado';

  await createAdminClient().from('config_whatsapp').update({
    status: nosso,
    // O número vem do `owner` da instância — ninguém o digita nesta tela.
    ...(st.dados.numero ? { numero: st.dados.numero } : {}),
    ...(nosso === 'conectado' ? { conectado_em: new Date().toISOString() } : {}),
    atualizado_em: new Date().toISOString(),
  }).eq('id', 1);

  revalidatePath('/admin/configuracoes/whatsapp');
  return { ok: true, dados: { status: nosso, numero: st.dados.numero, qrcode: st.dados.qrcode } };
}

/** Desconectar o número. A INSTÂNCIA CONTINUA EXISTINDO — é assim que se troca
 *  o aparelho sem perder token nem webhook. */
export async function desconectarPlataformaAction(): Promise<ActionResult> {
  const g = await requireAdminBaluAction();
  if ('error' in g) return { ok: false, error: g.error };

  const r = await lerConfigWhatsapp();
  if (!r.ok) return { ok: false, error: 'Não foi possível ler a configuração do canal.' };

  let token: string | null = null;
  try {
    token = lerTokenPlataforma(r.linha?.token_cifrado ?? null);
  } catch {
    token = null;
  }
  if (!token) return { ok: false, error: 'Nenhuma instância configurada.' };

  const d = await desconectarInstancia(token);
  if (!d.ok) return { ok: false, error: d.erro };

  await createAdminClient().from('config_whatsapp')
    .update({
      status: 'desconectado', numero: null, conectado_em: null,
      atualizado_por: g.userId, atualizado_em: new Date().toISOString(),
    })
    .eq('id', 1);

  await registrarAuditoria({
    actorUserId: g.userId,
    acao: 'whatsapp_plataforma.desconectado', alvoTipo: 'config', alvoId: null, meta: {},
  });

  revalidatePath('/admin/configuracoes/whatsapp');
  return { ok: true };
}

/**
 * Grava o ADMIN TOKEN da uazapi — a credencial que provisiona qualquer
 * instância do servidor compartilhado.
 *
 * TESTA CONTRA O SERVIÇO REAL ANTES DE GRAVAR, e não é zelo: um token errado
 * aqui só se manifesta na próxima tentativa de conectar um canal, com a
 * mensagem "não configurado" — que mente, porque configurado está. Mesmo
 * padrão do botão "Testar" da Focus (sessão 30).
 */
export async function salvarAdminTokenAction(tokenBruto: string): Promise<ActionResult<{ instancias: number }>> {
  const g = await requireAdminBaluAction();
  if ('error' in g) return { ok: false, error: g.error };

  const token = (tokenBruto ?? '').trim();
  if (!token) return { ok: false, error: 'Cole o admin token da uazapi.' };

  const sonda = await sondarAdminToken(token);
  if (!sonda.ok) return { ok: false, error: sonda.erro };

  const r = await gravarAdminToken(token, g.userId);
  if (!r.ok) return { ok: false, error: 'Não foi possível salvar. Tente de novo.' };

  await registrarAuditoria({
    actorUserId: g.userId,
    acao: 'whatsapp_plataforma.admin_token_salvo', alvoTipo: 'config', alvoId: null,
    // NUNCA o token, nem mascarado. A contagem é o que prova que ele funciona.
    meta: { instancias_visiveis: sonda.dados.instancias },
  });

  revalidatePath('/admin/configuracoes/whatsapp');
  return { ok: true, dados: { instancias: sonda.dados.instancias } };
}
