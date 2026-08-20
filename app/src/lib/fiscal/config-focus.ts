// 0094/0095 — o token de REVENDA da Focus, cifrado em repouso e lido do banco.
//
// Mesmo molde de `lib/ai/config-ia.ts`, que a 0056 provou em produção. Não é
// abstração compartilhada de propósito: são segredos de domínios diferentes, e
// juntá-los faria uma mudança de regra de um alcançar o outro.
//
// UM TOKEN, SEM AMBIENTE. A 0094 supôs um par hom/prod e estava errada: sondando
// a Focus em 20/08/2026, os dois tokens do `.env.local` levaram 401 em
// `/v2/empresas/:id` — inclusive para um id qualquer —, ou seja, não têm acesso
// à API de revenda. O par hom/prod pertence ao token DA EMPRESA
// (`companies.focus_token`), que é quem emite; o de revenda é um só, e a
// revenda só existe em `api.focusnfe.com.br`. Detalhes na 0095.
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
let cache: { token: string | null; expiraEm: number } | null = null;

export function invalidarCacheFocus(): void {
  cache = null;
}

/**
 * Token de revenda da Focus — o único aceito em `/v2/empresas*`.
 *
 * Ordem: banco primeiro, `FOCUS_NFE_TOKEN` depois. O fallback existe para não
 * derrubar a produção no deploy desta mudança: lá a variável está preenchida e
 * o banco pode estar vazio. Some quando a tela estiver preenchida.
 *
 * NÃO há fallback para `FOCUS_NFE_TOKEN_PRODUÇÃO` / `FOCUS_NFE_HOMOLOGAÇÃO` do
 * `.env.local`: eles foram testados contra a revenda e devolvem 401. Aceitá-los
 * aqui trocaria um erro claro ("não configurado") por um 401 no meio do
 * cadastro de empresa — o tipo de falha que este módulo existe para acabar.
 *
 * Devolve `null` em vez de lançar: quem chama decide a mensagem.
 */
export async function obterTokenRevendaFocus(): Promise<string | null> {
  const agora = Date.now();
  if (!cache || agora >= cache.expiraEm) {
    let token: string | null = null;
    // Sem as variáveis do Supabase não há banco para consultar — é o caso do
    // vitest. Sem esta guarda, `createAdminClient()` lançaria "supabaseUrl is
    // required" a cada chamada e encheria a saída dos testes de erro que não é
    // erro.
    if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      try {
        const sb = createAdminClient();
        const { data } = await sb
          .from('config_focus')
          .select('token_revenda_cifrado')
          .eq('id', 1)
          .maybeSingle();
        if (data) token = lerTokenFocus((data.token_revenda_cifrado ?? null) as string | null);
      } catch (e) {
        // Banco fora do ar ou cifra corrompida não podem apagar o fallback de
        // ambiente: o pior desfecho aqui é ficar sem emissão por um motivo que
        // não tem nada a ver com a credencial.
        console.error('[0095] leitura de config_focus falhou:', e instanceof Error ? e.message : e);
      }
    }
    cache = { token, expiraEm: agora + TTL_MS };
  }

  return cache.token || process.env.FOCUS_NFE_TOKEN || null;
}
