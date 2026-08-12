// Base juridica — busca textual em documentos_juridicos (Task 1). NUNCA
// lança: quem chama (gerarRascunhoAction, Task 4) trata lista vazia como
// "sem contexto extra", o mesmo comportamento de hoje sem esta feature —
// uma falha aqui e uma peca de apoio caindo, nao motivo para bloquear o
// admin de gerar rascunho.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SituacaoFiscal } from '@/lib/fiscal/situacao-fiscal';
import { palavrasChaveDaSituacao } from './palavras-chave';
import { termosDaPergunta } from './termos';

export type TrechoJuridico = { titulo: string; texto: string };

const LIMITE = 5;

export async function buscarContextoJuridico(
  sb: SupabaseClient, s: SituacaoFiscal,
): Promise<TrechoJuridico[]> {
  try {
    // "OR" maiusculo entre frases — testado contra websearch_to_tsquery no
    // banco real (ver nota do plano): frases de duas palavras ("Simples
    // Nacional") viram AND interno, palavras hifenizadas ("DAS-MEI") viram
    // frase por proximidade, e cada termo entra no OR geral.
    const consulta = palavrasChaveDaSituacao(s).join(' OR ');
    const { data, error } = await sb.rpc('buscar_documentos_juridicos', {
      p_consulta: consulta,
      p_limite: LIMITE,
    });
    if (error || !data) return [];
    return data as TrechoJuridico[];
  } catch {
    return [];
  }
}

/**
 * Mesma busca, a partir de uma PERGUNTA escrita pelo cliente.
 *
 * O caminho do 6A parte de uma `SituacaoFiscal` tipada — o app já sabe do que
 * se trata. No atendimento por WhatsApp o que chega é frase solta, e os termos
 * saem dela por código (`termosDaPergunta`), nunca por escolha da IA: se a IA
 * escolhesse o que pesquisar, poderia "buscar" algo que ela mesma inventou e
 * depois se apoiar no resultado.
 *
 * Pergunta sem termo pesquisável ("oi", "bom dia") devolve lista vazia sem ir
 * ao banco — buscar a base inteira por saudação só traria ruído.
 */
export async function buscarContextoPorPergunta(
  sb: SupabaseClient, pergunta: string,
): Promise<TrechoJuridico[]> {
  const termos = termosDaPergunta(pergunta);
  if (termos.length === 0) return [];
  try {
    const { data, error } = await sb.rpc('buscar_documentos_juridicos', {
      p_consulta: termos.join(' OR '),
      p_limite: LIMITE,
    });
    if (error || !data) return [];
    return data as TrechoJuridico[];
  } catch {
    return [];
  }
}
