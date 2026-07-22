-- 0030: tenant do escritório de contabilidade (Bloco A).
-- Spec: docs/product/2026-07-22-bloco-a-multitenant-contador-design.md

-- Papel de admin do Balu (enum user_types existe fora do repo; trigger 0002 faz cast)
ALTER TYPE public.user_types ADD VALUE IF NOT EXISTS 'AdminBalu';

CREATE TABLE IF NOT EXISTS public.contabilidades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  cnpj text UNIQUE,
  crc text NOT NULL,
  crc_uf char(2) NOT NULL,
  logo_url text,                          -- path no bucket privado 'branding'
  whatsapp_suporte text,                  -- E.164
  email_remetente_nome text,
  status text NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente','aprovada','suspensa')),
  aprovada_em timestamptz,
  aprovada_por uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.contabilidade_membros (
  contabilidade_id uuid NOT NULL REFERENCES public.contabilidades(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contabilidade_id, user_id)
);
-- Lançamento: 1 usuário em no máx. 1 contabilidade (dropar este índice na V2/papéis)
CREATE UNIQUE INDEX IF NOT EXISTS contabilidade_membros_user_unique
  ON public.contabilidade_membros(user_id);

CREATE TABLE IF NOT EXISTS public.convites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contabilidade_id uuid NOT NULL REFERENCES public.contabilidades(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('cliente','membro')),
  email text,                             -- null = link reutilizável do escritório
  token text NOT NULL UNIQUE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  expira_em timestamptz,                  -- null = sem expiração (link)
  revogado_em timestamptz,
  usado_em timestamptz,
  usado_por uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS convites_contabilidade_idx ON public.convites(contabilidade_id);

-- updated_at (função tg_set_updated_at existe desde a 0025)
DO $$ BEGIN
  CREATE TRIGGER tg_contabilidades_updated_at BEFORE UPDATE ON public.contabilidades
    FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- RLS ligada já no nascimento
ALTER TABLE public.contabilidades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contabilidade_membros ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.convites ENABLE ROW LEVEL SECURITY;

-- membro lê a própria contabilidade
CREATE POLICY contabilidades_select_membro ON public.contabilidades FOR SELECT
  USING (id IN (SELECT contabilidade_id FROM public.contabilidade_membros
                WHERE user_id = auth.uid()));
-- membro edita branding (colunas restritas por GRANT abaixo; status NUNCA via client)
CREATE POLICY contabilidades_update_membro ON public.contabilidades FOR UPDATE
  USING (id IN (SELECT contabilidade_id FROM public.contabilidade_membros
                WHERE user_id = auth.uid()))
  WITH CHECK (id IN (SELECT contabilidade_id FROM public.contabilidade_membros
                     WHERE user_id = auth.uid()));

-- membro lê os colegas; INSERT/DELETE só via service role (server actions)
CREATE POLICY membros_select ON public.contabilidade_membros FOR SELECT
  USING (contabilidade_id IN (SELECT contabilidade_id FROM public.contabilidade_membros
                              WHERE user_id = auth.uid()));

-- membro lê/gerencia convites do escritório; aceite roda por RPC (security definer)
CREATE POLICY convites_all_membro ON public.convites FOR ALL
  USING (contabilidade_id IN (SELECT contabilidade_id FROM public.contabilidade_membros
                              WHERE user_id = auth.uid()))
  WITH CHECK (contabilidade_id IN (SELECT contabilidade_id FROM public.contabilidade_membros
                                   WHERE user_id = auth.uid()));

GRANT SELECT ON public.contabilidades, public.contabilidade_membros, public.convites TO authenticated;
GRANT UPDATE (nome, logo_url, whatsapp_suporte, email_remetente_nome)
  ON public.contabilidades TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.convites TO authenticated;
GRANT ALL ON public.contabilidades, public.contabilidade_membros, public.convites TO service_role;
