'use server';
// Bloco 4B — catalogo de servicos avulsos do escritorio (o que ele cobra fora
// da mensalidade).
//
// ESCRITA SO PELO SERVICE ROLE, DE PROPOSITO: a 0053 deu a `servicos_avulsos`
// uma policy de SELECT para o escritorio dono e NENHUMA de INSERT/UPDATE/DELETE
// — mesma forma de `assinaturas` na 0050. O service role ignora RLS, entao a
// UNICA coisa que impede um escritorio de mexer no catalogo do outro e o
// `.eq('contabilidade_id', ctx.id)` de cada escrita daqui. Ele nao e redundante
// com o `.eq('id', ...)`: sem ele, um id de outro escritorio (que vaza de
// qualquer lugar — histórico, print, palpite) editaria ou apagaria a linha
// alheia. Por isso todo UPDATE/DELETE abaixo leva os dois, e todos pedem
// `.select('id')` para distinguir "gravou" de "nao achou nada" — sem o select o
// PostgREST devolve sucesso para um UPDATE que nao pegou linha nenhuma, e a
// tela diria "salvo" sobre coisa nenhuma.
//
// Nada de puro mora aqui: 'use server' so pode exportar funcao async, e
// exportar tipo/constante/funcao pura daqui quebra no `next build` sem o `tsc
// --noEmit` reclamar. Por isso as regras estao em `@/lib/billing/avulso` e o
// schema da fronteira em `@/types/zod`.
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireEscritorioAprovado } from '@/lib/contador/guards';
import { registrarAuditoria } from '@/lib/security/audit';
import { validarServicoAvulso, CATALOGO_SUGERIDO, type ServicoAvulso } from '@/lib/billing/avulso';
import { ServicoAvulsoSchema } from '@/types/zod';

type ActionResult = { ok: true } | { ok: false; error: string };

const ROTA = '/contador/configuracoes/avulsos';

const IdSchema = z.string().uuid('Serviço inválido.');

/** Cria (id nulo) ou edita (id preenchido) um serviço do catálogo. */
export async function salvarServicoAction(entrada: unknown): Promise<ActionResult> {
  const ctx = await requireEscritorioAprovado();
  if (!ctx.ok) return ctx;

  // FRONTEIRA: forma primeiro (o que o TypeScript nao garante em runtime)...
  const parsed = ServicoAvulsoSchema.safeParse(entrada);
  if (!parsed.success) return { ok: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos.' };
  // A anotacao e a prova de que o schema cobre `ServicoAvulso` inteiro: campo
  // que sumir do schema (ou mudar de tipo) quebra aqui, no `tsc`.
  const dados: ServicoAvulso & { id: string | null; categoria: string | null; ativo: boolean } = parsed.data;

  // ...e so depois as regras, que espelham `servicos_avulsos_valor_check` nos
  // dois sentidos. Sao as MESMAS que a tela aplica antes do round-trip: se a
  // tela aceitasse o que o CHECK recusa, o escritorio veria um erro de Postgres
  // em ingles no meio do cadastro.
  const v = validarServicoAvulso(dados);
  if (!v.ok) return { ok: false, error: v.error };

  const sb = createAdminClient();
  const linha = {
    contabilidade_id: ctx.id,
    nome: dados.nome.trim(),
    categoria: dados.categoria,
    tipo_valor: dados.tipoValor,
    // Redundante com o que a validacao ja garante, e de proposito: e a ultima
    // linha antes do banco, e o CHECK PROIBE o campo do outro tipo.
    valor_centavos: dados.tipoValor === 'fixo' ? dados.valorCentavos : null,
    percentual: dados.tipoValor === 'percentual' ? dados.percentual : null,
    ativo: dados.ativo,
    updated_at: new Date().toISOString(),
  };

  if (dados.id) {
    // `update`, nunca `upsert`: o upsert do PostgREST manda NULL nas colunas
    // ausentes do payload — armadilha ja provada contra o banco neste repo.
    const { data, error } = await sb
      .from('servicos_avulsos')
      .update(linha)
      .eq('id', dados.id)
      .eq('contabilidade_id', ctx.id)
      .select('id');
    if (error) return { ok: false, error: 'Não foi possível salvar o serviço. Tente de novo.' };
    if ((data?.length ?? 0) === 0) return { ok: false, error: 'Serviço não encontrado neste escritório.' };
  } else {
    const { error } = await sb.from('servicos_avulsos').insert(linha);
    if (error) return { ok: false, error: 'Não foi possível salvar o serviço. Tente de novo.' };
  }

  await registrarAuditoria({
    actorUserId: ctx.userId,
    acao: dados.id ? 'avulso.editado' : 'avulso.criado',
    alvoTipo: 'servico_avulso',
    alvoId: dados.id,
    contabilidadeId: ctx.id,
    meta: {
      nome: linha.nome,
      tipo: linha.tipo_valor,
      valor_centavos: linha.valor_centavos,
      percentual: linha.percentual,
    },
  });

  revalidatePath(ROTA);
  return { ok: true };
}

/**
 * Liga/desliga o serviço. É O "REMOVER" DA TELA, e não o DELETE.
 *
 * `cobrancas_escritorio.servico_avulso_id` aponta para cá com ON DELETE SET
 * NULL: apagar um serviço já cobrado não apaga a cobrança — desliga ela da sua
 * origem, e o histórico deixa de saber o que foi cobrado. A coluna `ativo`
 * existe exatamente para isso: o serviço some da lista de emissão sem levar o
 * passado junto. O DELETE de verdade fica em `apagarServicoAction`, restrito a
 * item que nunca foi cobrado.
 */
export async function definirAtivoServicoAction(id: unknown, ativo: unknown): Promise<ActionResult> {
  const ctx = await requireEscritorioAprovado();
  if (!ctx.ok) return ctx;

  const idOk = IdSchema.safeParse(id);
  if (!idOk.success) return { ok: false, error: 'Serviço inválido.' };
  const ativoOk = z.boolean().safeParse(ativo);
  if (!ativoOk.success) return { ok: false, error: 'Situação inválida.' };

  const sb = createAdminClient();
  const { data, error } = await sb
    .from('servicos_avulsos')
    .update({ ativo: ativoOk.data, updated_at: new Date().toISOString() })
    .eq('id', idOk.data)
    .eq('contabilidade_id', ctx.id)
    .select('id');
  if (error) return { ok: false, error: 'Não foi possível mudar a situação do serviço. Tente de novo.' };
  if ((data?.length ?? 0) === 0) return { ok: false, error: 'Serviço não encontrado neste escritório.' };

  await registrarAuditoria({
    actorUserId: ctx.userId,
    acao: ativoOk.data ? 'avulso.reativado' : 'avulso.desativado',
    alvoTipo: 'servico_avulso',
    alvoId: idOk.data,
    contabilidadeId: ctx.id,
  });

  revalidatePath(ROTA);
  return { ok: true };
}

/**
 * DELETE de verdade — só para serviço que NUNCA foi cobrado.
 *
 * Serve ao caso real de quem errou o cadastro e não quer o item morto na lista
 * para sempre. A checagem em `cobrancas_escritorio` é a linha que separa isso
 * de destruir histórico: havendo QUALQUER cobrança apontando para o serviço, o
 * DELETE viraria `servico_avulso_id = NULL` naquela cobrança (ON DELETE SET
 * NULL da 0053) e ninguém saberia mais de onde ela veio. A busca é pelo id sem
 * filtrar por escritório de propósito: a pergunta é "alguém já usou isto?", e
 * qualquer resposta positiva basta para recusar.
 */
export async function apagarServicoAction(id: unknown): Promise<ActionResult> {
  const ctx = await requireEscritorioAprovado();
  if (!ctx.ok) return ctx;

  const idOk = IdSchema.safeParse(id);
  if (!idOk.success) return { ok: false, error: 'Serviço inválido.' };

  const sb = createAdminClient();
  const { count, error: erroUso } = await sb
    .from('cobrancas_escritorio')
    .select('id', { count: 'exact', head: true })
    .eq('servico_avulso_id', idOk.data);
  // Erro na CHECAGEM não pode virar permissão para apagar: sem saber se houve
  // cobrança, a resposta segura é não apagar.
  if (erroUso) return { ok: false, error: 'Não foi possível conferir o histórico do serviço. Tente de novo.' };
  if ((count ?? 0) > 0) {
    return {
      ok: false,
      error: 'Este serviço já foi cobrado de algum cliente e não pode ser apagado — desative-o para tirá-lo da lista.',
    };
  }

  const { data, error } = await sb
    .from('servicos_avulsos')
    .delete()
    .eq('id', idOk.data)
    .eq('contabilidade_id', ctx.id)
    .select('id, nome');
  if (error) return { ok: false, error: 'Não foi possível apagar o serviço. Tente de novo.' };
  if ((data?.length ?? 0) === 0) return { ok: false, error: 'Serviço não encontrado neste escritório.' };

  await registrarAuditoria({
    actorUserId: ctx.userId,
    acao: 'avulso.apagado',
    alvoTipo: 'servico_avulso',
    alvoId: idOk.data,
    contabilidadeId: ctx.id,
    meta: { nome: data?.[0]?.nome ?? null },
  });

  revalidatePath(ROTA);
  return { ok: true };
}

/**
 * Popula o catálogo com o seed sugerido (spec §5) — sugestão, nunca imposição:
 * tudo o que entra aqui é editável e desativável depois.
 *
 * Só roda em catálogo vazio, senão cada clique duplicaria a lista inteira. A
 * contagem e o INSERT não são atômicos (não há índice único de nome por
 * escritório para apoiar um upsert), então dois cliques SIMULTÂNEOS ainda
 * poderiam semear duas vezes; quem fecha essa janela hoje é o botão desabilitado
 * durante o envio, na tela. Duplicata é ruído editável — não é dinheiro emitido
 * — e por isso não vale uma migration só para isso agora.
 */
export async function semearCatalogoAction(): Promise<ActionResult> {
  const ctx = await requireEscritorioAprovado();
  if (!ctx.ok) return ctx;

  const sb = createAdminClient();
  const { count, error: erroContagem } = await sb
    .from('servicos_avulsos')
    .select('id', { count: 'exact', head: true })
    .eq('contabilidade_id', ctx.id);
  if (erroContagem) return { ok: false, error: 'Não foi possível ler o catálogo. Tente de novo.' };
  if ((count ?? 0) > 0) return { ok: false, error: 'O catálogo já tem serviços.' };

  const { error } = await sb.from('servicos_avulsos').insert(
    CATALOGO_SUGERIDO.map((s) => ({
      contabilidade_id: ctx.id,
      nome: s.nome,
      categoria: s.categoria,
      tipo_valor: s.tipoValor,
      valor_centavos: s.tipoValor === 'fixo' ? s.valorCentavos ?? null : null,
      percentual: s.tipoValor === 'percentual' ? s.percentual ?? null : null,
      ativo: true,
    })),
  );
  if (error) return { ok: false, error: 'Não foi possível criar a lista sugerida. Tente de novo.' };

  await registrarAuditoria({
    actorUserId: ctx.userId,
    acao: 'avulso.semeado',
    alvoTipo: 'contabilidade',
    alvoId: ctx.id,
    contabilidadeId: ctx.id,
    meta: { quantidade: CATALOGO_SUGERIDO.length },
  });

  revalidatePath(ROTA);
  return { ok: true };
}
