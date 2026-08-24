// 0101 — a instância uazapi do canal DA PLATAFORMA, lida do banco.
//
// Mesmo molde de `lib/fiscal/config-focus.ts` e `lib/ai/config-ia.ts`: guardar
// cifrado, ler pelo service_role, e — o ponto que a sessão 30 deixou por
// escrito — **fazer o cliente ler daqui**. Card que não alimenta o cliente é
// card decorativo, e seria a mesma classe de defeito que a tela veio corrigir.
//
// PRECEDÊNCIA: banco primeiro, `UAZAPI_TOKEN` do ambiente como retaguarda.
// Assim a tela nova não quebra nada enquanto a coluna estiver vazia — é
// exatamente a transição que a 0094 fez para a Focus.
import 'server-only';
import { cifrarCampo, decifrarCampo, PREFIXO } from '@/lib/crypto/envelope';
import { createAdminClient } from '@/lib/supabase/admin';

export function guardarTokenPlataforma(token: string): string {
  if (!token) throw new Error('guardarTokenPlataforma: token vazio');
  const cifrado = cifrarCampo(token);
  // `cifrarCampo` devolve o próprio valor quando recebe '' — barrado acima. Se
  // um dia a cifra falhar em silêncio, gravar em claro seria pior que falhar.
  if (cifrado === token) throw new Error('guardarTokenPlataforma: cifra nao aplicada');
  return cifrado;
}

export function lerTokenPlataforma(cifrado: string | null): string | null {
  if (!cifrado) return null;
  // A coluna nasce na 0101 e `guardarTokenPlataforma` recusa gravar sem cifra:
  // valor sem prefixo só pode ser gravação corrompida. O fallback silencioso de
  // `decifrarCampo` (que existe para certificado legado) esconderia isso.
  if (!cifrado.startsWith(PREFIXO)) {
    throw new Error('lerTokenPlataforma: token da uazapi sem cifra — gravacao corrompida');
  }
  return decifrarCampo(cifrado);
}

export type LinhaConfigWhatsapp = {
  instancia_id: string | null;
  token_cifrado: string | null;
  admin_token_cifrado: string | null;
  status: string | null;
  numero: string | null;
  conectado_em: string | null;
};

const COLUNAS = 'instancia_id, token_cifrado, admin_token_cifrado, status, numero, conectado_em';

/** A linha singleton, ou `null` quando ainda não existe. Erro de leitura sobe
 *  como `erro` — nunca vira "não configurado", que faria o admin colar
 *  credencial por cima de um estado que ele não está enxergando. */
export async function lerConfigWhatsapp(): Promise<
  { ok: true; linha: LinhaConfigWhatsapp | null } | { ok: false; erro: string }
> {
  const { data, error } = await createAdminClient()
    .from('config_whatsapp').select(COLUNAS).eq('id', 1).maybeSingle();
  if (error) {
    console.error('[0101] config_whatsapp leitura falhou:', error.message);
    return { ok: false, erro: error.message };
  }
  return { ok: true, linha: (data as LinhaConfigWhatsapp | null) ?? null };
}

/**
 * O token da instância da plataforma, decifrado — ou `null` se não houver.
 *
 * Usado por quem PROVISIONA (a tela do admin) e por `configDaPlataforma`
 * (`lib/uazapi/instancia.ts`), que é quem monta o objeto do cliente de envio.
 * Duas funções com aquele nome, em módulos diferentes, seria armadilha: só
 * existe uma, e ela mora lá.
 */
export async function tokenDaPlataforma(): Promise<string | null> {
  const r = await lerConfigWhatsapp();
  if (!r.ok || !r.linha) return null;
  try {
    return lerTokenPlataforma(r.linha.token_cifrado);
  } catch (e) {
    console.error('[0101] token da plataforma nao decifra:', e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * O ADMIN TOKEN da uazapi — a credencial que provisiona QUALQUER instância do
 * servidor compartilhado (37 delas em 24/08/2026, quase todas de outros
 * produtos). É a mais forte desta integração, e a única que cria recurso.
 *
 * PRECEDÊNCIA: banco (0102) primeiro, `UAZAPI_ADMIN_TOKEN` como retaguarda.
 *
 * POR QUE SAIU DO AMBIENTE: em 24/08/2026 a variável existia no `.env.local` e
 * **não existia na Vercel**. Resultado: `criarInstancia` respondia
 * "UAZAPI_ADMIN_TOKEN não configurado" em produção e só em produção —
 * provisionar canal nunca funcionou publicado, desde a 0091, e local funcionava
 * sempre. Variável de ambiente some sem avisar; campo de formulário, não.
 */
export async function adminTokenDaUazapi(): Promise<string | null> {
  const r = await lerConfigWhatsapp();
  if (r.ok && r.linha?.admin_token_cifrado) {
    try {
      return lerTokenPlataforma(r.linha.admin_token_cifrado);
    } catch (e) {
      // Gravação corrompida NÃO cai para o ambiente em silêncio: seria trocar
      // uma credencial por outra sem ninguém pedir. Erro no log, e o caminho
      // segue para a retaguarda só quando a coluna está VAZIA.
      console.error('[0102] admin token nao decifra:', e instanceof Error ? e.message : e);
      return null;
    }
  }
  return process.env.UAZAPI_ADMIN_TOKEN ?? null;
}

/** Grava o admin token cifrado. A tabela é singleton (id = 1). */
export async function gravarAdminToken(token: string, porUserId: string): Promise<{ ok: true } | { ok: false; erro: string }> {
  const { error } = await createAdminClient().from('config_whatsapp').upsert({
    id: 1,
    admin_token_cifrado: guardarTokenPlataforma(token),
    atualizado_por: porUserId,
    atualizado_em: new Date().toISOString(),
  }, { onConflict: 'id' });
  if (error) {
    console.error('[0102] admin token nao gravado:', error.message);
    return { ok: false, erro: error.message };
  }
  return { ok: true };
}
