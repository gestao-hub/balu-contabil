'use server';
// Documentos legais (Termos de Uso / Política de Privacidade) — AdminBalu.
//
// ⚠️ PRÉ-LANÇAMENTO (decisão do dono do produto, 20/08/2026): os 5 aceites hoje
// gravados em `aceites` são todos de contas de teste, e por isso reescrever o
// texto de uma versão JÁ PUBLICADA é permitido. `salvarDocumentoAction` faz
// UPDATE na própria linha `(tipo, versao)` — publicada ou rascunho —, SEM criar
// versão nova e SEM tocar `publicado_em`.
//
// DEPOIS DO LANÇAMENTO essa permissão vira o problema que a migration 0090 já
// registra no comentário dela: reescrever o corpo de uma versão que usuário de
// verdade aceitou corrompe a prova de consentimento da LGPD (`aceites`
// referencia `(tipo, versao)`, não o conteúdo — o texto pode mudar debaixo do
// aceite já registrado). Por isso esta action MEDE e devolve, a cada chamada,
// quantos aceites a versão já tem, e grava esse número na auditoria — é o
// freio (a tela avisa antes de gravar), não o bloqueio. Quando o app for ao ar,
// trocar o freio por recusa é a mudança de poucas linhas neste arquivo.
//
// `salvarNovaVersaoDocumentoAction` (cria rascunho novo) já é, hoje, o caminho
// que sobra sozinho depois do lançamento — mantido pronto de propósito.
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdminBaluAction } from '@/lib/admin/guard';
import { registrarAuditoria } from '@/lib/security/audit';
import { DocumentoVersaoSchema, PublicarDocumentoSchema } from '@/types/zod';

type Admin = ReturnType<typeof createAdminClient>;

type ActionResult = { ok: true; aceitesNaVersao: number } | { ok: false; error: string };
type ActionResultSimples = { ok: true } | { ok: false; error: string };

const ROTA_INDICE = '/admin/configuracoes/documentos';
const rotaDoc = (tipo: string) => `/admin/configuracoes/documentos/${tipo}`;

async function contarAceites(sb: Admin, tipo: string, versao: string): Promise<number> {
  const { count } = await sb
    .from('aceites')
    .select('id', { count: 'exact', head: true })
    .eq('tipo', tipo)
    .eq('versao', versao);
  return count ?? 0;
}

/**
 * Reescreve o markdown da própria linha `(tipo, versao)` — publicada ou
 * rascunho, tanto faz. Não cria versão nova, não mexe em `publicado_em`.
 *
 * A contagem de aceites é medida de novo aqui (não confia no que a tela
 * mostrou antes do clique) porque é o valor que vai para a auditoria: o rastro
 * de "quantos aceites existiam no momento da reescrita" precisa ser o de
 * verdade, não um número que pode ter ficado velho na tela aberta.
 */
export async function salvarDocumentoAction(entrada: unknown): Promise<ActionResult> {
  const ctx = await requireAdminBaluAction();
  if ('error' in ctx) return { ok: false, error: ctx.error };

  const parsed = DocumentoVersaoSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos.' };
  }
  const { tipo, versao, conteudo_md } = parsed.data;

  const sb = createAdminClient();
  const { data: atual, error: eLer } = await sb
    .from('documento_versoes')
    .select('id, publicado_em')
    .eq('tipo', tipo)
    .eq('versao', versao)
    .maybeSingle();
  if (eLer) {
    console.error('[documentos] leitura falhou:', eLer.message);
    return { ok: false, error: 'Não foi possível ler o documento. Tente de novo.' };
  }
  if (!atual) {
    return { ok: false, error: 'Essa versão não existe. Recarregue a página.' };
  }

  const aceitesNaVersao = await contarAceites(sb, tipo, versao);

  // `.select('id')` para distinguir "gravou" de "não pegou linha nenhuma" —
  // mesmo cuidado de `admin/configuracoes/ia/actions.ts`.
  const { data, error } = await sb
    .from('documento_versoes')
    .update({ conteudo_md })
    .eq('id', atual.id)
    .select('id');
  if (error) {
    console.error('[documentos] update falhou:', error.message);
    return { ok: false, error: 'Não foi possível salvar. Tente de novo.' };
  }
  if ((data?.length ?? 0) === 0) {
    return { ok: false, error: 'O documento não foi encontrado. Recarregue a página.' };
  }

  // `alvo_id` é uuid — vai o `id` da linha de `documento_versoes`, não uma
  // string tipo/versão. Tipo, versão, se já estava publicada e quantos
  // aceites existiam ficam no `meta` (defeito já corrigido em outras actions
  // do admin: ver o comentário de `admin/configuracoes/ia/actions.ts`).
  await registrarAuditoria({
    actorUserId: ctx.userId,
    acao: 'documentos.editar',
    alvoTipo: 'documento_versoes',
    alvoId: atual.id,
    meta: {
      tipo,
      versao,
      estava_publicada: Boolean(atual.publicado_em),
      aceites_na_versao: aceitesNaVersao,
    },
  });

  revalidatePath(ROTA_INDICE);
  revalidatePath(rotaDoc(tipo));
  return { ok: true, aceitesNaVersao };
}

/**
 * Cria uma versão NOVA, sempre como rascunho (`publicado_em: null`). Recusa se
 * `(tipo, versao)` já existir — é o `UNIQUE` da tabela, checado antes para dar
 * mensagem legível em vez do erro cru do Postgres.
 */
export async function salvarNovaVersaoDocumentoAction(entrada: unknown): Promise<ActionResultSimples> {
  const ctx = await requireAdminBaluAction();
  if ('error' in ctx) return { ok: false, error: ctx.error };

  const parsed = DocumentoVersaoSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos.' };
  }
  const { tipo, versao, conteudo_md } = parsed.data;

  const sb = createAdminClient();
  const { data: existente, error: eLer } = await sb
    .from('documento_versoes')
    .select('id')
    .eq('tipo', tipo)
    .eq('versao', versao)
    .maybeSingle();
  if (eLer) {
    console.error('[documentos] leitura falhou:', eLer.message);
    return { ok: false, error: 'Não foi possível verificar a versão. Tente de novo.' };
  }
  if (existente) {
    return { ok: false, error: 'Já existe uma versão com esse número. Escolha um número novo.' };
  }

  const { data: nova, error } = await sb
    .from('documento_versoes')
    .insert({ tipo, versao, conteudo_md, publicado_em: null })
    .select('id')
    .single();
  if (error || !nova) {
    console.error('[documentos] insert falhou:', error?.message);
    return { ok: false, error: 'Não foi possível criar a versão. Tente de novo.' };
  }

  await registrarAuditoria({
    actorUserId: ctx.userId,
    acao: 'documentos.criar_versao',
    alvoTipo: 'documento_versoes',
    alvoId: nova.id,
    meta: { tipo, versao },
  });

  revalidatePath(ROTA_INDICE);
  revalidatePath(rotaDoc(tipo));
  return { ok: true };
}

/**
 * Publica um rascunho. Recusa se já publicado — publicar não é caminho para
 * "trocar a data de publicação"; quem precisar disso edita a linha por fora
 * (`salvarDocumentoAction`).
 */
export async function publicarDocumentoAction(entrada: unknown): Promise<ActionResultSimples> {
  const ctx = await requireAdminBaluAction();
  if ('error' in ctx) return { ok: false, error: ctx.error };

  const parsed = PublicarDocumentoSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos.' };
  }
  const { tipo, versao } = parsed.data;

  const sb = createAdminClient();
  const { data: atual, error: eLer } = await sb
    .from('documento_versoes')
    .select('id, publicado_em')
    .eq('tipo', tipo)
    .eq('versao', versao)
    .maybeSingle();
  if (eLer) {
    console.error('[documentos] leitura falhou:', eLer.message);
    return { ok: false, error: 'Não foi possível ler o documento. Tente de novo.' };
  }
  if (!atual) {
    return { ok: false, error: 'Essa versão não existe. Recarregue a página.' };
  }
  if (atual.publicado_em) {
    return { ok: false, error: 'Esta versão já está publicada.' };
  }

  // `.is('publicado_em', null)` fecha a corrida: se alguém publicou entre a
  // leitura acima e este UPDATE, `data` volta vazio e não é reportado como
  // sucesso (mesmo cuidado do "UPDATE que não pega linha" em `ia/actions.ts`).
  const { data, error } = await sb
    .from('documento_versoes')
    .update({ publicado_em: new Date().toISOString() })
    .eq('id', atual.id)
    .is('publicado_em', null)
    .select('id');
  if (error) {
    console.error('[documentos] publicar falhou:', error.message);
    return { ok: false, error: 'Não foi possível publicar. Tente de novo.' };
  }
  if ((data?.length ?? 0) === 0) {
    return { ok: false, error: 'Esta versão já está publicada.' };
  }

  await registrarAuditoria({
    actorUserId: ctx.userId,
    acao: 'documentos.publicar',
    alvoTipo: 'documento_versoes',
    alvoId: atual.id,
    meta: { tipo, versao },
  });

  revalidatePath(ROTA_INDICE);
  revalidatePath(rotaDoc(tipo));
  // Publicar troca a versão vigente pra TODO MUNDO: `documentosPendentes`
  // (lib/lgpd/pendencia-aceite.ts) passa a marcar pendência para quem já
  // tinha aceitado a versão anterior, e o próximo acesso de qualquer usuário
  // pode cair em `/aceite`.
  revalidatePath('/aceite');
  return { ok: true };
}
