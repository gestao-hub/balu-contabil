// src/lib/contador/guards.ts
import 'server-only';
import { createServerClient } from '@/lib/supabase/server';

export type ContabilidadeCtx = {
  userId: string;
  contabilidade: { id: string; nome: string; status: 'pendente' | 'aprovada' | 'suspensa';
    logo_url: string | null; whatsapp_suporte: string | null; email_remetente_nome: string | null } | null;
};

/** Contexto do usuário logado + sua contabilidade (null se não é membro de nenhuma). */
export async function getContabilidadeCtx(): Promise<ContabilidadeCtx | { error: string }> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Sessão inválida.' };
  const { data } = await supabase
    .from('contabilidade_membros')
    .select('contabilidade_id, contabilidades ( id, nome, status, logo_url, whatsapp_suporte, email_remetente_nome )')
    .eq('user_id', user.id)
    .maybeSingle();
  const c = (data?.contabilidades ?? null) as ContabilidadeCtx['contabilidade'];
  return { userId: user.id, contabilidade: c };
}

export type Contabilidade = NonNullable<ContabilidadeCtx['contabilidade']>;

/** Sessão válida + escritório aprovado, ou o erro pronto pra devolver da action. */
export type EscritorioAprovado = {
  ok: true;
  userId: string;
  /** Atalho de `contabilidade.id` — o escopo de toda mutação do escritório. */
  id: string;
  contabilidade: Contabilidade;
};

/**
 * A CHECAGEM DE AUTORIZAÇÃO DE TUDO QUE ENVOLVE DINHEIRO DO ESCRITÓRIO.
 *
 * Existia em três cópias com três assinaturas diferentes (subconta, honorários
 * e convites), o que significa que endurecer uma não alcançava as outras — e a
 * que ficasse para trás continuaria decidindo quem pode emitir cobrança. É uma
 * função só, aqui, para que "aprovado" queira dizer a mesma coisa nos três.
 *
 * Retorno ANOTADO de propósito: sem a anotação o TS infere cada ramo com as
 * chaves do outro como `?: undefined`, e o discriminante `ok` deixa de eliminar
 * o ramo de erro no call site (quirk que já mordeu convites-actions.ts).
 *
 * Mora em `@/lib/contador/` e não numa das rotas: arquivo `'use server'` só
 * pode exportar função async, então nem o tipo do retorno poderia sair de lá.
 */
export async function requireEscritorioAprovado(): Promise<
  EscritorioAprovado | { ok: false; error: string }
> {
  const g = await getContabilidadeCtx();
  if ('error' in g) return { ok: false, error: g.error };
  if (!g.contabilidade) return { ok: false, error: 'Você não faz parte de um escritório.' };
  if (g.contabilidade.status !== 'aprovada') return { ok: false, error: 'Escritório não aprovado.' };
  return { ok: true, userId: g.userId, id: g.contabilidade.id, contabilidade: g.contabilidade };
}
