// Qual instância de WhatsApp atende quem — a camada de TENANT do canal.
//
// `cliente.ts` continua sendo transporte puro ("um texto entra, uma mensagem
// sai"). Quem sabe de escritório é este módulo. A separação importa: com a
// resolução de tenant dentro do cliente, todo teste de envio precisaria de
// banco, e a decisão de "por qual número isto sai" ficaria escondida dentro de
// uma função de rede.
//
// Migration 0091. Spec:
// docs/superpowers/specs/2026-08-20-canal-whatsapp-por-escritorio-design.md
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { decifrarCampo } from '@/lib/crypto/envelope';
import type { ConfigUazapi } from './cliente';
import { tokenDaPlataforma } from './config-plataforma';

/** Dados do escritório que o atendimento pode usar — e SÓ eles.
 *
 *  Decisão D5 (19/08/2026): nome, prazo de resposta e WhatsApp de suporte.
 *  CNPJ, CRC, e-mail e o nome do contador responsável ficam de fora — a
 *  garantia é a AUSÊNCIA do dado nesta struct, não a boa vontade do modelo. */
export type EscritorioDoCanal = {
  id: string;
  nome: string;
  slaHoras: number | null;
  whatsappSuporte: string | null;
  /** Número conectado à instância, só dígitos. Para conferência opcional
   *  contra o `owner` do payload — nunca como fonte de verdade. */
  numero: string | null;
  /** Config para ENVIO ATIVO (cron). Só existe quando a instância está
   *  `conectado`: mandar por uma que está `conectando` é falar com o vazio e
   *  receber `ok` de volta. */
  config: ConfigUazapi | null;
  /** Config para RESPONDER a quem escreveu NESTE canal — vale mesmo com o
   *  status defasado no banco.
   *
   *  Achado no code-review de 19/08/2026: usar só `config` fazia a resposta
   *  cair no `?? configDaPlataforma()` e sair pelo NÚMERO DO BALU, com o prompt
   *  assinando como o escritório. Se a mensagem chegou por este canal, a
   *  instância está viva — quem está errado é o status gravado. Responder pelo
   *  número que recebeu é sempre o certo; o que nunca pode acontecer é
   *  responder por outro. */
  configDeResposta: ConfigUazapi | null;
};

const COLUNAS =
  'id, nome, sla_resposta_horas, whatsapp_suporte, uazapi_numero, uazapi_status, uazapi_token_cifrado';

type LinhaContabilidade = {
  id: string;
  nome: string | null;
  sla_resposta_horas: number | null;
  whatsapp_suporte: string | null;
  uazapi_numero: string | null;
  uazapi_status: string | null;
  uazapi_token_cifrado: string | null;
};

function montar(linha: LinhaContabilidade): EscritorioDoCanal {
  // Token só vale quando a instância está CONECTADA. Uma instância em
  // 'conectando' tem token válido na uazapi e nenhum número atrás dele: enviar
  // por ela seria mandar mensagem para o vazio, com `ok:true` de volta.
  const token = decifrarCampo(linha.uazapi_token_cifrado);
  const baseUrl = process.env.UAZAPI_BASE_URL ?? '';
  const cfg = token && baseUrl ? { baseUrl, token } : null;

  return {
    id: linha.id,
    nome: linha.nome ?? 'seu escritório de contabilidade',
    slaHoras: linha.sla_resposta_horas,
    whatsappSuporte: linha.whatsapp_suporte,
    numero: linha.uazapi_numero,
    config: linha.uazapi_status === 'conectado' ? cfg : null,
    configDeResposta: cfg,
  };
}

/**
 * O escritório dono do canal em que a mensagem caiu.
 *
 * O token vem da QUERY STRING da URL do webhook (`?t=`), montada por nós no
 * provisionamento. Não vem do corpo: o envelope da uazapi não tem contrato
 * conhecido (ver `payload.ts`), e o projeto já perdeu uma rodada apostando
 * nisso em 12/08/2026.
 *
 * Devolve `null` para token vazio, desconhecido ou malformado — quem chama
 * responde "canal desconhecido" sem revelar qual das três coisas aconteceu.
 */
export async function escritorioPorWebhookToken(
  admin: SupabaseClient, token: string | null | undefined,
): Promise<EscritorioDoCanal | null> {
  const t = String(token ?? '').trim();
  // Formato conferido antes de ir ao banco: 64 hex. Barra varredura de token
  // aleatório sem custo de I/O.
  if (!/^[0-9a-f]{64}$/.test(t)) return null;

  const { data } = await admin
    .from('contabilidades').select(COLUNAS).eq('uazapi_webhook_token', t).maybeSingle();

  return data ? montar(data as LinhaContabilidade) : null;
}

/** O escritório de uma empresa — usado na SAÍDA (cron), para o aviso do
 *  cliente sair pelo número do escritório dele. */
export async function escritorioPorId(
  admin: SupabaseClient, contabilidadeId: string | null | undefined,
): Promise<EscritorioDoCanal | null> {
  if (!contabilidadeId) return null;
  const { data } = await admin
    .from('contabilidades').select(COLUNAS).eq('id', contabilidadeId).maybeSingle();
  return data ? montar(data as LinhaContabilidade) : null;
}

/**
 * A instância da PLATAFORMA — o número oficial do Balu.
 *
 * Decisão D8 (19/08/2026): ela permanece e atende as empresas **sem
 * escritório**. Não é código legado a remover.
 *
 * PASSOU A LER DO BANCO em 24/08/2026 (0101), com `UAZAPI_TOKEN` de retaguarda.
 * Antes o token só existia no ambiente, e por isso **não havia tela para
 * conectar este canal**: era criar a instância na mão no painel da uazapi,
 * copiar o token e colar numa variável. A tela nova
 * (`/admin/configuracoes/whatsapp`) grava em `config_whatsapp`, e é esta função
 * que faz a tela valer alguma coisa — card que não alimenta o cliente é card
 * decorativo (lição da sessão 30, com a Focus).
 *
 * A retaguarda no ambiente fica de pé de propósito: é ela que está no ar hoje,
 * e derrubá-la no mesmo deploy que estreia a tela deixaria o canal mudo até
 * alguém conectar.
 *
 * VIROU ASSÍNCRONA. Quem chama tem de esperar — um `configDaPlataforma()` sem
 * `await` devolve uma Promise, que é *truthy*, e o canal passaria adiante um
 * objeto sem `token`: mensagem nenhuma sai e nada acusa.
 */
export async function configDaPlataforma(): Promise<ConfigUazapi | null> {
  const baseUrl = process.env.UAZAPI_BASE_URL;
  if (!baseUrl) return null;

  const doBanco = await tokenDaPlataforma();
  const token = doBanco ?? process.env.UAZAPI_TOKEN;
  if (!token) return null;
  return { baseUrl, token };
}
