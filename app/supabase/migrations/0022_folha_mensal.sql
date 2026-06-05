-- @custom — Fator R: folha mensal por empresa (pró-labore + salários + encargos).
-- Ver docs/superpowers/specs/2026-06-05-fator-r-calculo-design.md.
-- Aditiva e idempotente. Aplicada manualmente (db_atual.sql é a fonte de verdade).
-- Sem deleted_at de propósito: folha de um mês é valor que se corrige, não registro que se
-- apaga. Assim o UNIQUE é real (não índice parcial) e o upsert por (company_id, competencia)
-- funciona direto, sem o erro 42P10 dos índices parciais.

CREATE TABLE IF NOT EXISTS public.folha_mensal (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL,
  competencia   TEXT NOT NULL,                 -- YYYYMM
  pro_labore    NUMERIC(14,2) NOT NULL DEFAULT 0,
  salarios      NUMERIC(14,2) NOT NULL DEFAULT 0,
  encargos      NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT folha_mensal_company_competencia_uniq UNIQUE (company_id, competencia)
);
COMMENT ON TABLE public.folha_mensal IS 'Folha mensal por empresa (pró-labore+salários+encargos). Alimenta o Fator R (Anexo III↔V).';

CREATE INDEX IF NOT EXISTS folha_mensal_company_idx ON public.folha_mensal (company_id);

ALTER TABLE public.folha_mensal ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY folha_mensal_owner ON public.folha_mensal
    FOR ALL TO authenticated
    USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER tg_folha_mensal_updated_at BEFORE UPDATE ON public.folha_mensal
    FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
EXCEPTION WHEN undefined_function THEN NULL; WHEN duplicate_object THEN NULL; END $$;
