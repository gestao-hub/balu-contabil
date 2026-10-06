-- 0112 — Parcelamentos do Simples e do MEI na Receita (Integra-Parcelamento).
--
-- Prioridade 4 da análise de 06/10/2026. A tabela guarda os PEDIDOS de
-- parcelamento (número, situação, datas) por modalidade; as parcelas
-- disponíveis e o DAS de cada parcela são consultados ao vivo, por clique.

CREATE TABLE IF NOT EXISTS public.parcelamentos_receita (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  -- PARCSN, PARCSN-ESP, PERTSN, RELPSN, PARCMEI, PARCMEI-ESP, PERTMEI, RELPMEI
  modalidade     text NOT NULL,
  numero         text NOT NULL,
  data_pedido    date,
  situacao       text,
  data_situacao  date,
  consultado_em  timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT parcelamentos_receita_unico UNIQUE (company_id, modalidade, numero),
  CONSTRAINT parcelamentos_receita_modalidade_check CHECK (modalidade IN (
    'PARCSN','PARCSN-ESP','PERTSN','RELPSN','PARCMEI','PARCMEI-ESP','PERTMEI','RELPMEI'))
);

ALTER TABLE public.parcelamentos_receita ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS parcelamentos_receita_select_dono ON public.parcelamentos_receita;
CREATE POLICY parcelamentos_receita_select_dono ON public.parcelamentos_receita FOR SELECT
  USING (company_id IN (SELECT id FROM public.companies WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS parcelamentos_receita_select_contador ON public.parcelamentos_receita;
CREATE POLICY parcelamentos_receita_select_contador ON public.parcelamentos_receita FOR SELECT
  USING (company_id IN (SELECT id FROM public.companies
                        WHERE contabilidade_id IS NOT NULL
                          AND contabilidade_id = public.minha_contabilidade_membro()));

REVOKE ALL ON public.parcelamentos_receita FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.parcelamentos_receita FROM authenticated;
GRANT SELECT ON public.parcelamentos_receita TO authenticated;

ALTER TABLE public.empresas_fiscais
  ADD COLUMN IF NOT EXISTS parcelamentos_consultados_em timestamptz;

DO $$
BEGIN
  IF to_regclass('public.parcelamentos_receita') IS NULL THEN
    RAISE EXCEPTION '0112: tabela parcelamentos_receita não criada';
  END IF;
END $$;
