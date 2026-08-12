// Bloco 7, Task 4 — marca do escritorio resolvida pelo HOST da requisicao.
//
// Serve o caso que o co-branding do Bloco A nao alcanca: o visitante que abre
// o dominio proprio do escritorio e ainda NAO tem sessao (tela de login). Sem
// sessao nao ha empresa ativa nem vinculo pra consultar — a unica pista de
// quem atende ali e o host.
//
// Cache: DE PROPOSITO nao usa `unstable_cache`. Ler `headers()` ja torna a
// rota dinamica, e uma entrada de cache sem o host na chave serviria a marca
// de um escritorio para o dominio de outro — o pior bug possivel desta
// feature (landmine 6.2 da spec). O custo evitado seria uma consulta por
// render; nao paga o risco.
import 'server-only';
import { headers } from 'next/headers';
import { createServerClient } from '@/lib/supabase/server';
import { signedUrlBranding } from '@/lib/clients/supabase-storage';
import { hostDaRequisicao } from './host';

export type BrandingHost = {
  contabilidadeId: string;
  nome: string;
  logoUrl: string | null;
  slaRespostaHoras: number | null;
};

/**
 * Devolve a marca do escritorio dono do host atual, ou null quando o host e
 * o dominio da Balu, um dominio ainda nao verificado, ou de escritorio nao
 * aprovado — todos caem na marca Balu, que e o default seguro.
 */
export async function brandingDoHost(): Promise<BrandingHost | null> {
  const host = hostDaRequisicao(await headers());
  if (!host) return null;

  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc('branding_por_host', { p_host: host });
  if (error) {
    // Marca e enfeite: um erro aqui nao pode derrubar a pagina de login.
    console.error('[branding_por_host]', error.message);
    return null;
  }

  const linha = (Array.isArray(data) ? data[0] : data) as
    | { contabilidade_id: string; nome: string; logo_url: string | null; sla_resposta_horas: number | null }
    | undefined;
  if (!linha) return null;

  return {
    contabilidadeId: linha.contabilidade_id,
    nome: linha.nome,
    logoUrl: linha.logo_url ? await signedUrlBranding(linha.logo_url) : null,
    slaRespostaHoras: linha.sla_resposta_horas ?? null,
  };
}
