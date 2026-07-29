'use server';
// Bloco 6A — o catálogo de explicações (AdminBalu).
//
// Este arquivo é o único lugar do sistema que fala com a IA para PRODUZIR
// conteúdo. E o que ele produz é RASCUNHO: nenhum texto daqui chega a um cliente
// sem alguém ter lido e aprovado (§5.6 da spec, e DL 9.295/46 — quem explica
// tributo assina embaixo).
//
// A IA ESTÁ FORA DO CAMINHO DA REQUISIÇÃO DO CLIENTE. Ela é chamada aqui, por um
// admin, uma vez por SITUAÇÃO fiscal — não por cliente, não por competência.
// Provedor fora do ar não tira explicação nenhuma do ar.
//
// Nada de puro mora aqui: `'use server'` só pode exportar função async. O prompt
// está em `@/lib/explicacoes/prompt`, a regra de marcadores em
// `@/lib/explicacoes/marcadores` e o schema da fronteira em `@/types/zod`.
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdminBaluAction } from '@/lib/admin/guard';
import { registrarAuditoria } from '@/lib/security/audit';
import { lerChaveIa } from '@/lib/ai/config-ia';
import { gerarTexto } from '@/lib/ai/cliente';
import type { Provedor } from '@/lib/ai/provedores';
import { situacaoDaChave } from '@/lib/fiscal/situacao-fiscal';
import { montarPrompt } from '@/lib/explicacoes/prompt';
import { marcadoresDaChave } from '@/lib/explicacoes/marcadores';
import { marcadoresDe } from '@/lib/explicacoes/renderizar';
import { ChaveExplicacaoSchema } from '@/types/zod';

type ResultadoGeracao =
  | { ok: true; marcadoresIntrusos: string[] }
  | { ok: false; error: string };

const ROTA = '/admin/explicacoes';

export async function gerarRascunhoAction(chaveBruta: unknown): Promise<ResultadoGeracao> {
  const ctx = await requireAdminBaluAction();
  if ('error' in ctx) return { ok: false, error: ctx.error };

  // FORMA, e depois SIGNIFICADO. As duas antes de qualquer rede: crédito de IA é
  // dinheiro, e uma chave que não descreve situação nenhuma faria o modelo
  // redigir sobre um tributo inventado — com aparência de legítimo no catálogo.
  const parsed = ChaveExplicacaoSchema.safeParse(chaveBruta);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? 'Chave inválida.' };
  }
  const chave = parsed.data;

  const situacao = situacaoDaChave(chave);
  if (!situacao) {
    return { ok: false, error: 'Situação fiscal desconhecida. Nada foi gerado.' };
  }

  const sb = createAdminClient();

  // A LINHA ATUAL VEM PRIMEIRO, e a recusa de sobrescrever aprovado é decidida
  // ANTES de chamar a IA. Gastar a chamada para depois descobrir que não pode
  // gravar seria pagar por um texto que vai para o lixo.
  const { data: atual, error: eLer } = await sb
    .from('explicacoes_fiscais')
    .select('id, status')
    .eq('chave', chave)
    .maybeSingle();
  if (eLer) {
    console.error('[6a] catalogo leitura falhou:', eLer.message);
    return { ok: false, error: 'Não foi possível ler o catálogo. Tente de novo.' };
  }

  // ═══ GERAR NUNCA SOBRESCREVE APROVADO ═══
  // Um clique acidental apagaria texto que um humano leu, revisou e carimbou.
  // Para regerar, o caminho é derrubar a aprovação de propósito (Task 9) — um
  // ato explícito, registrado, e não efeito colateral de outro botão.
  if (atual?.status === 'aprovado') {
    return {
      ok: false,
      error: 'Esta situação já tem texto aprovado. Edite-o para derrubar a aprovação antes de gerar outro.',
    };
  }

  const { data: cfg, error: eCfg } = await sb
    .from('config_ia')
    .select('provedor, modelo, base_url, chave_cifrada')
    .eq('id', 1)
    .maybeSingle();
  if (eCfg) {
    console.error('[6a] config_ia leitura falhou:', eCfg.message);
    return { ok: false, error: 'Não foi possível ler a configuração do provedor.' };
  }
  if (!cfg?.provedor || !cfg?.modelo) {
    return { ok: false, error: 'Configure o provedor de IA antes de gerar rascunho.' };
  }

  // `lerChaveIa` LANÇA em gravação corrompida — `try` próprio, um caso por vez.
  let chaveIa: string | null;
  try {
    chaveIa = lerChaveIa(cfg.chave_cifrada);
  } catch {
    return { ok: false, error: 'A chave do provedor está corrompida. Salve a chave de novo.' };
  }
  if (!chaveIa) {
    return { ok: false, error: 'Nenhuma chave de IA gravada. Configure o provedor antes de gerar.' };
  }

  const geradoPor = `${cfg.provedor}/${cfg.modelo}`;

  let texto: string;
  try {
    // O prompt é DERIVADO DA SITUAÇÃO, e `montarPrompt` só aceita
    // `SituacaoFiscal` — tipo que não tem como carregar dado de contribuinte.
    texto = await gerarTexto(
      {
        provedor: cfg.provedor as Provedor,
        modelo: cfg.modelo,
        base_url: cfg.base_url,
        chave: chaveIa,
      },
      montarPrompt(situacao),
    );
  } catch (e) {
    const bruto = e instanceof Error ? e.message : String(e);
    // Rede de baixo: `cliente.ts` já limpa a chave da mensagem do provedor, mas
    // o erro pode vir de qualquer outro lugar.
    return { ok: false, error: bruto.split(chaveIa).join('***').slice(0, 300) };
  }

  // O rascunho é gravado mesmo com marcador intruso — é rascunho, e o admin
  // corrige numa linha. Mas a action AVISA: sem isso ele só descobriria no
  // momento em que a aprovação recusa, depois de ter lido o texto inteiro.
  const permitidos = new Set(marcadoresDaChave(chave));
  const marcadoresIntrusos = marcadoresDe(texto).filter((m) => !permitidos.has(m));

  const linha = {
    texto,
    status: 'rascunho' as const,
    gerado_por: geradoPor,
    // Gerar rascunho novo apaga o carimbo antigo: um texto que ninguém aprovou
    // não pode continuar mostrando quem aprovou o anterior.
    aprovado_por: null,
    aprovado_em: null,
    updated_at: new Date().toISOString(),
  };

  if (atual) {
    // `update`, nunca `upsert`: o upsert do PostgREST manda NULL nas colunas
    // ausentes do payload — regra do repo, e o que quase apagou a chave do
    // provedor na Task 7. O `.select('id')` distingue "gravou" de "não achou".
    const { data, error } = await sb
      .from('explicacoes_fiscais').update(linha).eq('chave', chave).select('id');
    if (error) {
      console.error('[6a] catalogo update falhou:', error.message);
      return { ok: false, error: 'Não foi possível salvar o rascunho. Tente de novo.' };
    }
    if ((data?.length ?? 0) === 0) {
      return { ok: false, error: 'A explicação não foi encontrada. Recarregue a página.' };
    }
  } else {
    const { error } = await sb.from('explicacoes_fiscais').insert({ chave, ...linha });
    if (error) {
      console.error('[6a] catalogo insert falhou:', error.message);
      return { ok: false, error: 'Não foi possível salvar o rascunho. Tente de novo.' };
    }
  }

  await registrarAuditoria({
    actorUserId: ctx.userId, acao: 'ia.gerar_rascunho',
    alvoTipo: 'explicacao_fiscal', alvoId: atual?.id ?? null,
    // Nunca a chave do provedor. `gerado_por` é rastro de origem, não segredo.
    meta: {
      chave, gerado_por: geradoPor, tamanho: texto.length,
      marcadores_intrusos: marcadoresIntrusos,
      substituiu_rascunho: Boolean(atual),
    },
  });

  revalidatePath(ROTA);
  return { ok: true, marcadoresIntrusos };
}
