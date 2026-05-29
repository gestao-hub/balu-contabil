-- Impede apuração duplicada por empresa+competência (corrige Bugs 5 e 6 do fluxo n8n).
-- Habilita upsert idempotente em iniciarApuracaoAction.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_apuracoes_company_competencia
  ON public.apuracoes_fiscais (company_id, competencia_referencia)
  WHERE deleted_at IS NULL;
