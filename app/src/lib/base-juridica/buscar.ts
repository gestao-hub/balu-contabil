// Base juridica — busca textual em documentos_juridicos (Task 1). NUNCA
// lança: quem chama (gerarRascunhoAction, Task 4) trata lista vazia como
// "sem contexto extra", o mesmo comportamento de hoje sem esta feature —
// uma falha aqui e uma peca de apoio caindo, nao motivo para bloquear o
// admin de gerar rascunho.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SituacaoFiscal } from '@/lib/fiscal/situacao-fiscal';
import { palavrasChaveDaSituacao } from './palavras-chave';

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
