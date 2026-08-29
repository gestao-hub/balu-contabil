// src/lib/contador/guards.ts
import 'server-only';
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { getGateContext } from '@/lib/auth/gate-context';

/**
 * QUEM É CONTADOR — a checagem de PAPEL, que faltava neste arquivo.
 *
 * POR QUE EXISTE (auditoria 29/08/2026). Todo o resto daqui responde "de qual
 * escritório esta pessoa é membro?", lendo `contabilidade_membros`. Isso
 * responde por VÍNCULO, nunca por papel — e quem não tem vínculo nenhum não é
 * recusado, é mandado para `/contador/cadastro` (ver `contador/page.tsx`) para
 * criar um. Ou seja: o caminho de "não é contador" e o de "é contador e ainda
 * não tem escritório" eram o MESMO caminho, e Admin e Empresa desciam por ele.
 *
 * O papel mora em `role_types.type`, que é fonte única e confiável: a 0104
 * fechou as policies de escrita da tabela e tirou o fallback para
 * `user_metadata` (que o próprio dono da sessão grava pelo GoTrue), e a 0077
 * impõe `UNIQUE(user_id)` — uma pessoa, um papel. Não há acúmulo de papéis a
 * considerar aqui; se um dia houver, é ESTE ponto que muda, não as telas.
 *
 * Par página/action pelo mesmo motivo de `lib/admin/guard.ts`: Server Action
 * que redireciona de dentro perde a mensagem para o usuário.
 */
export async function requireContadorPage() {
  // `getGateContext` e NÃO uma consulta própria: ele é memoizado por request
  // (React `cache()`) e os dois layouts pais já o chamaram neste mesmo render.
  // Consultar de novo aqui custaria um round-trip ao Auth server MAIS um SELECT
  // em `role_types` por página de /contador — que é exatamente o desperdício
  // que o comentário no topo de `gate-context.ts` registra ter sido eliminado.
  const ctx = await getGateContext();
  if (!ctx) redirect('/login');
  if (ctx.normalizedRole === 'contador') return ctx.user;

  // MEMBRO CONVIDADO — o caminho que a primeira versão deste guard trancava.
  //
  // `aceitar_convite` (0043, ramo `tipo = 'membro'`) insere SÓ em
  // `contabilidade_membros`; nunca escreve `role_types`. E o papel nasce
  // `'Empresa'` por DEFAULT (0083, linha 27) quando a pessoa não escolhe nada
  // no cadastro — que é o caso normal de quem chega por convite de equipe.
  // Exigir `role = 'Contador'` aqui trancava o funcionário convidado fora do
  // escritório ao qual ele pertence, e teria tirado o acesso de todos os
  // membros já existentes no momento do deploy.
  //
  // A regra correta: **pertencer a um escritório é a credencial desta área**;
  // o papel é a credencial de CRIAR um escritório, e essa segue exigida em
  // `criarContabilidadeAction`. São perguntas diferentes, e confundi-las foi o
  // erro — na direção oposta à do BUG-003, que continua fechado: quem não é
  // Contador nem membro não passa daqui.
  //
  // A consulta só acontece quando o papel NÃO é Contador, então o caminho
  // comum continua sem ida extra ao banco. A policy `membros_select` (0035)
  // usa `minha_contabilidade_membro()`, SECURITY DEFINER, então a sessão lê a
  // própria linha sem precisar de service role.
  const supabase = await createServerClient();
  const { data: membro } = await supabase
    .from('contabilidade_membros')
    .select('contabilidade_id')
    .eq('user_id', ctx.user.id)
    .maybeSingle();
  // Para a raiz, e não para /login: quem chegou aqui TEM sessão válida — só está
  // no lugar errado. Mandar para o login faria parecer que a sessão caiu.
  if (!membro) redirect('/');
  return ctx.user;
}

/** Guard de AÇÃO do Contador. Devolve erro em vez de redirecionar.
 *
 *  Consulta própria, ao contrário da versão de página: Server Action é um
 *  request separado, então não há `getGateContext` memoizado para reaproveitar
 *  — e aquele helper leria `profiles.current_company` de graça, que a ação não
 *  usa. Aqui a consulta direta é a mais barata das duas. */
export async function requireContadorAction(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Sessão inválida.' };
  const { data: role } = await supabase
    .from('role_types').select('type').eq('user_id', user.id).maybeSingle();
  if (role?.type !== 'Contador') return { error: 'Esta área é do escritório contábil.' };
  return { userId: user.id };
}

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
