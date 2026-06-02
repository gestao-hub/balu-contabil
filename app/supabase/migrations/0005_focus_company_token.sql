-- @custom — Focus 1: cadastro automático da empresa na Focus NFe no momento da criação.
-- Aditivo: 4 colunas em `companies` para guardar o token retornado pela Focus + estado
-- do último cadastro/sync (consumido pelo painel "Saúde da empresa" — Focus 3).
--
-- focus_token: token específico da empresa devolvido por POST /v2/empresas (revenda).
--              É usado como Basic-auth nas chamadas por-empresa futuras (atualizar,
--              enviar cert via PUT no Focus 2, etc).
-- focus_status: 'ok' | 'erro' | NULL. NULL = nunca tentou; 'erro' = última tentativa falhou.
-- focus_last_check: quando foi a última tentativa (sucesso ou falha).
-- focus_last_error: mensagem da última falha (descartada quando focus_status volta a 'ok').
--
-- Não há backfill: empresas existentes ficam com NULL e podem ser cadastradas
-- on-demand pelo painel de Saúde.

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS focus_token       TEXT        NULL,
  ADD COLUMN IF NOT EXISTS focus_status      TEXT        NULL,
  ADD COLUMN IF NOT EXISTS focus_last_check  TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS focus_last_error  TEXT        NULL;

COMMENT ON COLUMN public.companies.focus_token      IS 'Token devolvido pelo POST /v2/empresas da Focus (auth por-empresa).';
COMMENT ON COLUMN public.companies.focus_status     IS 'Estado do último sync com Focus: ok | erro | NULL (nunca tentou).';
COMMENT ON COLUMN public.companies.focus_last_check IS 'Timestamp da última tentativa de cadastro/sync na Focus.';
COMMENT ON COLUMN public.companies.focus_last_error IS 'Mensagem da última falha (NULL quando status=ok).';
