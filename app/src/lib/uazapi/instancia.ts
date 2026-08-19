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
  config: ConfigUazapi | null;
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
  const token = linha.uazapi_status === 'conectado'
    ? decifrarCampo(linha.uazapi_token_cifrado)
    : null;
  const baseUrl = process.env.UAZAPI_BASE_URL ?? '';

  return {
    id: linha.id,
    nome: linha.nome ?? 'seu escritório de contabilidade',
    slaHoras: linha.sla_resposta_horas,
    whatsappSuporte: linha.whatsapp_suporte,
    numero: linha.uazapi_numero,
    config: token && baseUrl ? { baseUrl, token } : null,
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
 * A instância da PLATAFORMA (variáveis de ambiente).
 *
 * Decisão D8 (19/08/2026): ela permanece, com o número oficial do Balu, e
 * atende as empresas **sem escritório**. Não é código legado a remover.
 */
export function configDaPlataforma(): ConfigUazapi | null {
  const baseUrl = process.env.UAZAPI_BASE_URL;
  const token = process.env.UAZAPI_TOKEN;
  if (!baseUrl || !token) return null;
  return { baseUrl, token };
}
