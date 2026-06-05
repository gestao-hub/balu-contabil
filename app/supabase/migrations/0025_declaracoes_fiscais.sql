-- @custom — Cria declaracoes_fiscais (P1.1: seção "Declarações" no /impostos).
-- Ver docs/superpowers/specs/2026-06-05-declaracoes-impostos-design.md.
--
-- CONTEXTO: declaracoes_fiscais está na 0001_init.sql num schema idealizado NUNCA aplicado,
-- com a convenção VELHA (empresa_id + competencia char6). O banco real usa company_id +
-- competencia_referencia + owner_user_id (ver DB-DIVERGENCIA.md). Esta migration cria a tabela
-- na convenção REAL (corrige a divergência), de forma aditiva/idempotente. Mesmo espírito da 0013
-- (aux_produtos), mas corrigindo a convenção em vez de copiar a 0001.
-- Aplicada manualmente (db_atual.sql é a fonte da verdade).
-- Sem deleted_at de propósito: declaração se re-consulta/corrige, não se apaga → UNIQUE real
-- (não parcial) → upsert onConflict direto, sem o erro 42P10.

-- Função de suporte (idempotente; o banco pode não ter — ver 0013).
CREATE OR REPLACE FUNCTION public.tg_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN new.updated_at := now(); RETURN new; END; $$;

CREATE TABLE IF NOT EXISTS public.declaracoes_fiscais (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  owner_user_id          UUID NOT NULL,
  competencia_referencia TEXT NOT NULL,
  tipo                   TEXT NOT NULL DEFAULT 'PGDAS-D',
  numero_declaracao      TEXT,
  data_transmissao       TIMESTAMPTZ,
  status                 TEXT,
  guia_fiscal_id         UUID REFERENCES public.guias_fiscais(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT declaracoes_fiscais_company_comp_tipo_uniq UNIQUE (company_id, competencia_referencia, tipo)
);
COMMENT ON TABLE public.declaracoes_fiscais IS 'Declarações fiscais (PGDAS-D etc.) por competência. Convenção real (company_id/competencia_referencia); corrige a 0001.';

CREATE INDEX IF NOT EXISTS declaracoes_fiscais_company_idx ON public.declaracoes_fiscais (company_id);

ALTER TABLE public.declaracoes_fiscais ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY declaracoes_fiscais_owner ON public.declaracoes_fiscais
    FOR ALL TO authenticated
    USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER tg_declaracoes_fiscais_updated_at BEFORE UPDATE ON public.declaracoes_fiscais
    FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
EXCEPTION WHEN undefined_function THEN NULL; WHEN duplicate_object THEN NULL; END $$;
