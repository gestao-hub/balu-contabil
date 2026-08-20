// 0094 — credenciais do SERPRO Integra Contador, cifradas em repouso.
//
// Mesmo molde de `lib/fiscal/config-focus.ts` e `lib/ai/config-ia.ts`.
// Deliberadamente NÃO compartilha código com o da Focus: são contratos
// diferentes, com ciclos de renovação diferentes, e uma regra nova de um não
// pode alcançar o outro sem alguém decidir isso.
//
// O CERTIFICADO DO CONTRATANTE NÃO MORA AQUI. Ele já tem casa própria em
// `serpro_contratante` (cert_pfx_enc / cert_password_enc) desde antes desta
// migration; o que faltava era tela, não tabela.
import 'server-only';
import { cifrarCampo, decifrarCampo, PREFIXO } from '@/lib/crypto/envelope';
import { createAdminClient } from '@/lib/supabase/admin';

// SEM ambiente aqui, de propósito: o caminho real de produção
// (`requestComProcurador`) usa `/integra-contador/v1/...` fixo, e nenhum código
// de produto chama o caminho `call()` que aceita 'trial'. Ver o comentário da
// 0094 — controle que não controla nada é pior que controle ausente.
export type CredenciaisSerpro = {
  consumerKey: string;
  consumerSecret: string;
};

export function guardarSegredoSerpro(valor: string): string {
  if (!valor) throw new Error('guardarSegredoSerpro: valor vazio');
  const cifrado = cifrarCampo(valor);
  if (cifrado === valor) throw new Error('guardarSegredoSerpro: cifra nao aplicada');
  return cifrado;
}

export function lerSegredoSerpro(cifrado: string | null): string | null {
  if (!cifrado) return null;
  if (!cifrado.startsWith(PREFIXO)) {
    throw new Error('lerSegredoSerpro: credencial SERPRO sem cifra — gravacao corrompida');
  }
  return decifrarCampo(cifrado);
}

/** Única forma permitida de mencionar a credencial fora deste módulo. */
export function mascararSegredoSerpro(valor: string | null): string {
  if (!valor || valor.length < 12) return '…';
  return `${valor.slice(0, 4)}…${valor.slice(-4)}`;
}

// ---------------------------------------------------------------- leitura
const TTL_MS = 60_000;
let cache: { cred: CredenciaisSerpro | null; expiraEm: number } | null = null;

export function invalidarCacheSerpro(): void {
  cache = null;
}

/**
 * Credenciais do SERPRO. Banco primeiro, ambiente como fallback.
 *
 * Devolve `null` quando não há par completo. Meia credencial é pior que
 * nenhuma: a chamada sairia e voltaria 401, e o erro apontaria para a Receita
 * em vez de apontar para a tela que ficou pela metade.
 */
export async function obterCredenciaisSerpro(): Promise<CredenciaisSerpro | null> {
  const agora = Date.now();
  if (!cache || agora >= cache.expiraEm) {
    let cred: CredenciaisSerpro | null = null;
    // Mesma guarda de `config-focus.ts`: sem Supabase configurado não há banco
    // a consultar, e criar o cliente só para vê-lo lançar polui os testes.
    if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      try {
        const sb = createAdminClient();
        const { data } = await sb
          .from('config_serpro')
          .select('consumer_key_cifrado, consumer_secret_cifrado')
          .eq('id', 1)
          .maybeSingle();
        if (data) {
          const ck = lerSegredoSerpro((data.consumer_key_cifrado ?? null) as string | null);
          const cs = lerSegredoSerpro((data.consumer_secret_cifrado ?? null) as string | null);
          if (ck && cs) cred = { consumerKey: ck, consumerSecret: cs };
        }
      } catch (e) {
        console.error('[0094] leitura de config_serpro falhou:', e instanceof Error ? e.message : e);
      }
    }
    cache = { cred, expiraEm: agora + TTL_MS };
  }

  if (cache.cred) return cache.cred;

  const ck = process.env.SERPRO_CONSUMER_KEY;
  const cs = process.env.SERPRO_CONSUMER_SECRET;
  if (!ck || !cs) return null;
  return { consumerKey: ck, consumerSecret: cs };
}
