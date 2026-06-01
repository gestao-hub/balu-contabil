-- 0015_abertura_alteracoes.sql
-- Hash canônico dos dados da abertura (detecção de alteração real) +
-- tabela de solicitações de alteração (payload em jsonb, sem duplicar colunas).

ALTER TABLE public.abertura_empresas ADD COLUMN IF NOT EXISTS dados_hash text;

CREATE TABLE IF NOT EXISTS public.abertura_alteracoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  abertura_id uuid NOT NULL REFERENCES public.abertura_empresas(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dados jsonb NOT NULL,
  dados_hash text NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente','aprovada','rejeitada')),
  observacoes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TRIGGER abertura_alteracoes_set_updated_at BEFORE UPDATE
  ON public.abertura_alteracoes FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.abertura_alteracoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY abertura_alteracoes_owner ON public.abertura_alteracoes FOR ALL
  TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Stub de empresa em abertura não tem CNPJ ainda
ALTER TABLE public.companies ALTER COLUMN cnpj DROP NOT NULL;

-- status para controlar o ciclo de vida da empresa
-- (coluna pode não existir no banco real — migrations 0001/0002 estão defasadas)
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS status text DEFAULT 'active'
  CHECK (status IN ('active', 'inactive', 'em_abertura'));

-- se a coluna já existia sem o CHECK, garante que o constraint está presente
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'companies' AND column_name = 'status'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'companies_status_check' AND conrelid = 'public.companies'::regclass
  ) THEN
    ALTER TABLE public.companies ADD CONSTRAINT companies_status_check
      CHECK (status IN ('active', 'inactive', 'em_abertura'));
  END IF;
END$$;

-- índice no FK (Postgres não cria automaticamente)
CREATE INDEX IF NOT EXISTS abertura_alteracoes_abertura_id_idx
  ON public.abertura_alteracoes (abertura_id);
