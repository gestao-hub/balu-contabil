-- 0032: honorários v2 (cli_2_11). Colunas reais mantidas (mes_referencia date, valor numeric,
-- data_vencimento, data_pagamento, status). Linhas legadas (contabilidade_id null) ficam fora da UI v2.
ALTER TABLE public.honorarios
  ADD COLUMN IF NOT EXISTS contabilidade_id uuid REFERENCES public.contabilidades(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS empresa_cliente_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS forma_pagamento text,
  ADD COLUMN IF NOT EXISTS recorrente boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recorrencia_dia int CHECK (recorrencia_dia BETWEEN 1 AND 28),
  ADD COLUMN IF NOT EXISTS asaas_charge_id text,    -- gancho Bloco B
  ADD COLUMN IF NOT EXISTS asaas_customer_id text;  -- gancho Bloco B

-- cliente_id (legado) passa a ser opcional: o v2 vincula pela empresa cliente
ALTER TABLE public.honorarios ALTER COLUMN cliente_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS honorarios_contabilidade_idx ON public.honorarios(contabilidade_id);
-- idempotência do cron: 1 honorário recorrente por escritório+cliente+competência
CREATE UNIQUE INDEX IF NOT EXISTS honorarios_recorrencia_unique
  ON public.honorarios(contabilidade_id, empresa_cliente_id, mes_referencia)
  WHERE recorrente = true;
