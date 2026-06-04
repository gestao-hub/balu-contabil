-- @custom — Drift detection por valor, não por timestamp.
-- Problema: `detectFocusDrift` comparava max(companies.updated_at,
-- empresas_fiscais.updated_at) contra focus_sync_em. Mas `updated_at` é bumpado
-- pelo trigger tg_set_updated_at em QUALQUER UPDATE da linha — inclusive a
-- renovação do token SERPRO (serpro-procurador.ts), que não tem nada a ver com
-- a Focus. Resultado: falso "Há mudanças não sincronizadas" no Diagnóstico
-- (header amarelo com os itens internos todos verdes).
--
-- Solução: coluna dedicada bumpada SÓ quando campos que vão no payload da Focus
-- mudam (forms Dados da empresa / Regime). Drift = focus_fields_dirty_at > focus_sync_em.
-- NULL = nenhuma edição relevante desde o último sync → sem drift.
--
-- Aditiva e idempotente. Sem backfill: linhas existentes ficam NULL (sem drift),
-- que é o estado correto até a próxima edição de campo Focus.

ALTER TABLE public.empresas_fiscais
  ADD COLUMN IF NOT EXISTS focus_fields_dirty_at TIMESTAMPTZ;

COMMENT ON COLUMN public.empresas_fiscais.focus_fields_dirty_at IS
  'Última edição de um campo que vai no payload da Focus (dados da empresa / regime). Comparado contra focus_sync_em para detectar drift. NULL = nada pendente.';
