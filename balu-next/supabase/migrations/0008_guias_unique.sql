-- Idempotência: 1 guia por empresa+competência. Habilita upsert idempotente em gerarDasMeiAction.
-- Índice NÃO-parcial: o onConflict do PostgREST não resolve índice parcial (WHERE ...).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_guias_company_competencia
  ON public.guias_fiscais (company_id, competencia_referencia);
