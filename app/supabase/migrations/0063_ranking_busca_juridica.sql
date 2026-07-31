-- Ranking por relevancia na busca textual de documentos_juridicos.
--
-- O /code-review achou que buscarContextoJuridico (lib/base-juridica/buscar.ts)
-- fazia textSearch + limit SEM ORDER BY — o PostgREST nao ordena por
-- relevancia sozinho, entao a medida que a tabela cresce via ingestao diaria,
-- os 5 resultados devolvidos passam a ser arbitrarios (ordem de scan do
-- indice), nao os mais relevantes. Esta RPC faz a busca E a ordenacao por
-- ts_rank_cd no lado do banco, onde da pra expressar isso de verdade.
--
-- So service_role chama (mesmo padrao de notificacoes_pendentes_whatsapp e
-- outras RPCs internas deste projeto) — documentos_juridicos ja e fechada
-- pra anon/authenticated desde a 0062, entao esta funcao nao abre nada novo.
CREATE OR REPLACE FUNCTION public.buscar_documentos_juridicos(p_consulta text, p_limite int DEFAULT 5)
RETURNS TABLE (titulo text, texto text)
LANGUAGE sql STABLE AS $$
  SELECT d.titulo, d.texto
  FROM public.documentos_juridicos d
  WHERE d.busca @@ websearch_to_tsquery('portuguese', p_consulta)
  ORDER BY ts_rank_cd(d.busca, websearch_to_tsquery('portuguese', p_consulta)) DESC
  LIMIT p_limite;
$$;

REVOKE ALL ON FUNCTION public.buscar_documentos_juridicos(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.buscar_documentos_juridicos(text, int) TO service_role;
