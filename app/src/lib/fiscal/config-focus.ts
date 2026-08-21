// 0094/0095/0099 — os tokens da Focus para a conta da PLATAFORMA, cifrados em
// repouso e lidos do banco.
//
// Mesmo molde de `lib/ai/config-ia.ts`, que a 0056 provou em produção. Não é
// abstração compartilhada de propósito: são segredos de domínios diferentes, e
// juntá-los faria uma mudança de regra de um alcançar o outro.
//
// PAR HOM/PROD, DE VOLTA. A 0095 tinha reduzido isto a um token só, com base
// numa sonda contra `GET /v2/empresas/:id` (401 nos dois tokens do
// `.env.local`) lida como "não são tokens de revenda". Era a leitura errada:
// o corpo do 401 dizia `permissao_negada` — permissão FALTANDO NA CONTA
// naquele endpoint, não tipo de token errado. Sondando o catálogo
// (`/v2/codigos_cnae/6201501`), que discrimina por token sem depender dessa
// permissão quebrada, os dois batem: homologação dá 200 em
// `homologacao.focusnfe.com.br` e 401 em `api.focusnfe.com.br`; produção, o
// contrário. Detalhes e a medição completa na 0099, que desfaz a 0095.
//
// `companies.focus_token` continua sendo outra coisa: o token DA EMPRESA, que
// a Focus devolve no POST /v2/empresas e que a emissão usa — não este par.
import 'server-only';
import { cifrarCampo, decifrarCampo, PREFIXO } from '@/lib/crypto/envelope';
import { createAdminClient } from '@/lib/supabase/admin';

export function guardarTokenFocus(token: string): string {
  if (!token) throw new Error('guardarTokenFocus: token vazio');
  const cifrado = cifrarCampo(token);
  // `cifrarCampo` devolve o próprio valor quando recebe '' — barrado acima. Se
  // um dia a cifra falhar em silêncio, gravar em claro seria pior que falhar.
  if (cifrado === token) throw new Error('guardarTokenFocus: cifra nao aplicada');
  return cifrado;
}

export function lerTokenFocus(cifrado: string | null): string | null {
  if (!cifrado) return null;
  // A coluna nasce na 0095 e `guardarTokenFocus` recusa gravar sem cifra: valor
  // sem prefixo só pode ser gravação corrompida. O fallback silencioso de
  // `decifrarCampo` (que existe para certificado legado) esconderia isso.
  if (!cifrado.startsWith(PREFIXO)) {
    throw new Error('lerTokenFocus: token da Focus sem cifra — gravacao corrompida');
  }
  return decifrarCampo(cifrado);
}

/** Única forma permitida de mencionar o token fora deste módulo. */
export function mascararTokenFocus(token: string | null): string {
  if (!token || token.length < 12) return '…';
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

// ---------------------------------------------------------------- leitura
//
// Cache em processo com TTL curto. Sem ele, cada chamada à Focus pagaria uma ida
// ao banco. 60s é curto o bastante para que trocar o token no admin valha quase
// de imediato, e a action de salvar chama `invalidarCacheFocus()` para não
// esperar nem isso.
const TTL_MS = 60_000;
let cache: { hom: string | null; prod: string | null; expiraEm: number } | null = null;

export function invalidarCacheFocus(): void {
  cache = null;
}

export type AmbienteFocus = 'hom' | 'prod';

async function carregarCache(): Promise<{ hom: string | null; prod: string | null }> {
  const agora = Date.now();
  if (cache && agora < cache.expiraEm) return cache;

  let hom: string | null = null;
  let prod: string | null = null;
  // Sem as variáveis do Supabase não há banco para consultar — é o caso do
  // vitest. Sem esta guarda, `createAdminClient()` lançaria "supabaseUrl is
  // required" a cada chamada e encheria a saída dos testes de erro que não é
  // erro.
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const sb = createAdminClient();
      const { data } = await sb
        .from('config_focus')
        .select('token_hom_cifrado, token_prod_cifrado')
        .eq('id', 1)
        .maybeSingle();
      if (data) {
        hom = lerTokenFocus((data.token_hom_cifrado ?? null) as string | null);
        prod = lerTokenFocus((data.token_prod_cifrado ?? null) as string | null);
      }
    } catch (e) {
      // Banco fora do ar ou cifra corrompida não podem apagar o fallback de
      // ambiente: o pior desfecho aqui é ficar sem emissão por um motivo que
      // não tem nada a ver com a credencial.
      console.error('[0099] leitura de config_focus falhou:', e instanceof Error ? e.message : e);
    }
  }
  cache = { hom, prod, expiraEm: agora + TTL_MS };
  return cache;
}

/**
 * Token da Focus para a conta da plataforma, no ambiente pedido.
 *
 * Ordem: banco primeiro, variável de ambiente ESPECÍFICA do ambiente depois,
 * `FOCUS_NFE_TOKEN` (genérico, o nome que existe nas variáveis da Vercel) por
 * último. O nome específico vence o genérico de propósito — um token de
 * homologação usado contra a base de produção (ou vice-versa) dá 401, então
 * misturar os dois no fallback recriaria o mesmo tipo de falha muda que esta
 * tabela existe para acabar.
 *
 * Devolve `null` em vez de lançar: quem chama decide a mensagem.
 */
export async function obterTokenFocus(ambiente: AmbienteFocus): Promise<string | null> {
  const c = await carregarCache();
  const doBanco = ambiente === 'hom' ? c.hom : c.prod;
  if (doBanco) return doBanco;

  const especifico =
    ambiente === 'hom'
      ? process.env.FOCUS_NFE_HOMOLOGACAO
      : process.env.FOCUS_NFE_TOKEN_PRODUCAO;

  return especifico || process.env.FOCUS_NFE_TOKEN || null;
}
