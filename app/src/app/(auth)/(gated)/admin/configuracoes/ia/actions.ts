'use server';
// Bloco 6A — configuração do provedor de IA (AdminBalu).
//
// O QUE ESTA TELA DECIDE: qual provedor redige os RASCUNHOS do catálogo de
// explicações. Nada aqui participa de exibir a explicação ao cliente — o texto
// exibido já foi gerado, revisado e aprovado por um humano muito antes. Provedor
// fora do ar, chave vencida ou tela nunca configurada não tiram a explicação do
// ar; só impedem gerar rascunho novo.
//
// ⚠️ UPDATE, NUNCA UPSERT. O plano deste bloco pedia `upsert` na linha `id = 1`,
// e teria apagado a chave: o upsert do PostgREST manda NULL nas colunas ausentes
// do payload — armadilha já provada contra o banco neste repo (ver o comentário
// de `contador/configuracoes/avulsos/actions.ts`). Como salvar SEM chave nova é
// o caminho comum (o campo vem vazio quando o admin só troca o modelo), o upsert
// zeraria o segredo em silêncio na primeira vez que alguém mexesse no formulário.
//
// Nada de puro mora aqui: `'use server'` só pode exportar função async. O schema
// da fronteira está em `@/types/zod` e a cifra em `@/lib/ai/config-ia`.
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdminBaluAction } from '@/lib/admin/guard';
import { registrarAuditoria } from '@/lib/security/audit';
import { guardarChaveIa, lerChaveIa } from '@/lib/ai/config-ia';
import { gerarTexto } from '@/lib/ai/cliente';
import type { Provedor } from '@/lib/ai/provedores';
import { ConfigIaSchema } from '@/types/zod';

type ActionResult = { ok: true } | { ok: false; error: string };

const ROTA = '/admin/configuracoes/ia';

/** Prompt trivial de propósito: prova credencial e modelo, não qualidade. */
const PROMPT_TESTE = 'Responda apenas: ok';

export async function salvarConfigIaAction(entrada: unknown): Promise<ActionResult> {
  const ctx = await requireAdminBaluAction();
  if ('error' in ctx) return { ok: false, error: ctx.error };

  const parsed = ConfigIaSchema.safeParse(entrada);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos.' };
  }
  const dados = parsed.data;

  // `base_url` só existe no modo personalizado. Zerá-la nos demais impede que
  // uma URL sobrando de uma configuração anterior continue no banco e volte a
  // valer se alguém trocar o provedor de volta.
  const personalizado = dados.provedor === 'personalizado';
  const patch: Record<string, unknown> = {
    provedor: dados.provedor,
    modelo: dados.modelo.trim(),
    base_url: personalizado ? (dados.base_url ?? '').trim() : null,
    atualizado_por: ctx.userId,
    atualizado_em: new Date().toISOString(),
  };

  // CAMPO VAZIO = NÃO TROCAR. A coluna só entra no patch quando há chave nova;
  // é isto que faz "salvar só o modelo" preservar o segredo.
  const chaveNova = (dados.chave ?? '').trim();
  if (chaveNova) {
    try {
      patch.chave_cifrada = guardarChaveIa(chaveNova);
    } catch {
      // `guardarChaveIa` recusa devolver valor não cifrado. Gravar em claro
      // seria pior que não gravar.
      return { ok: false, error: 'Não foi possível proteger a chave. Nada foi salvo.' };
    }
  }

  const sb = createAdminClient();
  const { data: atual, error: eLer } = await sb
    .from('config_ia').select('id').eq('id', 1).maybeSingle();
  if (eLer) {
    console.error('[6a] config_ia leitura falhou:', eLer.message);
    return { ok: false, error: 'Não foi possível ler a configuração. Tente de novo.' };
  }

  if (atual) {
    // `.select('id')` para distinguir "gravou" de "não pegou linha nenhuma" —
    // sem ele o PostgREST devolve sucesso para um UPDATE que não achou nada.
    const { data, error } = await sb
      .from('config_ia').update(patch).eq('id', 1).select('id');
    if (error) {
      console.error('[6a] config_ia update falhou:', error.message);
      return { ok: false, error: 'Não foi possível salvar. Tente de novo.' };
    }
    if ((data?.length ?? 0) === 0) {
      return { ok: false, error: 'A configuração não foi encontrada. Recarregue a página.' };
    }
  } else {
    const { error } = await sb.from('config_ia').insert({ id: 1, ...patch });
    if (error) {
      console.error('[6a] config_ia insert falhou:', error.message);
      return { ok: false, error: 'Não foi possível salvar. Tente de novo.' };
    }
  }

  // A AUDITORIA NÃO MENCIONA A CHAVE — nem mascarada. Máscara em log é chave
  // pela metade, e o que interessa auditar é QUEM trocou e QUANDO, não o quê.
  await registrarAuditoria({
    actorUserId: ctx.userId, acao: 'ia.config_salvar',
    alvoTipo: 'config_ia', alvoId: '1',
    meta: {
      provedor: dados.provedor, modelo: patch.modelo,
      base_url: patch.base_url, trocou_chave: Boolean(chaveNova),
    },
  });

  revalidatePath(ROTA);
  return { ok: true };
}

/**
 * Testa a credencial contra o provedor de verdade. Nenhum dado de contribuinte
 * atravessa: o prompt é uma constante deste arquivo.
 */
export async function testarConexaoIaAction(): Promise<ActionResult> {
  const ctx = await requireAdminBaluAction();
  if ('error' in ctx) return { ok: false, error: ctx.error };

  const sb = createAdminClient();
  const { data, error } = await sb
    .from('config_ia').select('provedor, modelo, base_url, chave_cifrada')
    .eq('id', 1).maybeSingle();
  if (error) {
    console.error('[6a] config_ia leitura falhou:', error.message);
    return { ok: false, error: 'Não foi possível ler a configuração.' };
  }
  if (!data?.provedor || !data?.modelo) {
    return { ok: false, error: 'Configure o provedor e o modelo antes de testar.' };
  }

  // `lerChaveIa` LANÇA em gravação corrompida — por isso vem em `try` próprio,
  // e não junto da chamada de rede: são duas falhas diferentes e o admin
  // precisa saber qual das duas aconteceu.
  let chave: string | null;
  try {
    chave = lerChaveIa(data.chave_cifrada);
  } catch {
    return { ok: false, error: 'A chave gravada está corrompida. Salve a chave de novo.' };
  }
  if (!chave) {
    return { ok: false, error: 'Nenhuma chave gravada. Informe a chave e salve antes de testar.' };
  }

  try {
    await gerarTexto(
      {
        provedor: data.provedor as Provedor,
        modelo: data.modelo,
        base_url: data.base_url,
        chave,
      },
      PROMPT_TESTE,
    );
  } catch (e) {
    const bruto = e instanceof Error ? e.message : String(e);
    // `cliente.ts` já tira a chave da mensagem do provedor. Esta é a rede de
    // baixo, para o erro que vier de qualquer outro lugar (DNS, timeout, um
    // `fetch` que ecoa o cabeçalho).
    const limpo = bruto.split(chave).join('***').slice(0, 300);
    return { ok: false, error: limpo };
  }

  await registrarAuditoria({
    actorUserId: ctx.userId, acao: 'ia.testar_conexao',
    alvoTipo: 'config_ia', alvoId: '1',
    meta: { provedor: data.provedor, modelo: data.modelo },
  });

  return { ok: true };
}
