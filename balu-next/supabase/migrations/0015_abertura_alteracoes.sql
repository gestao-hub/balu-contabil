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
