-- Base juridica/contabil — grounding interno para o rascunho de IA do
-- catalogo de explicacoes (Bloco 6A). NAO e lida pelo caminho do cliente
-- (tela de impostos, webhook do 6B) — so por gerarRascunhoAction, via admin
-- client. Busca textual nativa do Postgres nesta rodada (sem pgvector/
-- embeddings — ver spec 2026-07-30-base-juridica-rag-design.md, secao 2.1).

CREATE TABLE IF NOT EXISTS public.documentos_juridicos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fonte          text NOT NULL CHECK (fonte IN ('dou','receita_federal','simples_nacional')),
  -- Chave natural do documento (uma publicacao do DOU ou uma pagina do
  -- portal tem URL estavel) — e o que identifica "e o mesmo documento" ao
  -- longo do tempo. NAO usar hash_conteudo como chave: um documento que
  -- mudou de conteudo geraria hash novo, o upsert inseriria uma segunda
  -- linha em vez de atualizar a existente, acumulando versoes obsoletas.
  url_origem     text NOT NULL,
  titulo         text NOT NULL,
  texto          text NOT NULL,
  publicado_em   date,
  -- Hash do texto — usado so para a Edge Function PULAR reprocessamento
  -- (comparar hash antes de gravar), nunca e a chave do upsert.
  hash_conteudo  text NOT NULL,
  busca          tsvector GENERATED ALWAYS AS (to_tsvector('portuguese', titulo || ' ' || texto)) STORED,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS documentos_juridicos_fonte_url_uidx
  ON public.documentos_juridicos (fonte, url_origem);

CREATE INDEX IF NOT EXISTS documentos_juridicos_busca_gin
  ON public.documentos_juridicos USING GIN (busca);

-- Mesmo trigger reusado por toda tabela nova desde a 0001_init.sql — nao
-- inventar um updated_at manual.
CREATE TRIGGER documentos_juridicos_set_updated_at
  BEFORE UPDATE ON public.documentos_juridicos
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.documentos_juridicos ENABLE ROW LEVEL SECURITY;
-- Sem policy nenhuma + REVOKE explicito: mesma licao da 0053/0055/0058/0061 —
-- o ALTER DEFAULT PRIVILEGES do Supabase concede tudo em `public` para
-- anon/authenticated, calado, em TODA tabela nova.
REVOKE ALL ON public.documentos_juridicos FROM anon, authenticated;

COMMENT ON TABLE public.documentos_juridicos IS
  'Base juridica/contabil para grounding do rascunho de IA (catalogo do 6A). Leitura interna via service_role apenas — nunca lida pelo caminho do cliente.';

-- Tabela nova: rodar node app/scratchpad/_reload-postgrest.mjs
