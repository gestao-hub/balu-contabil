-- 0039: versionamento de Termos/Política + aceites do titular (Bloco E, item 6.1).
CREATE TABLE IF NOT EXISTS public.documento_versoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL CHECK (tipo IN ('termos','privacidade')),
  versao text NOT NULL,
  conteudo_md text NOT NULL,
  publicado_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tipo, versao)
);
CREATE TABLE IF NOT EXISTS public.aceites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('termos','privacidade')),
  versao text NOT NULL,
  aceito_em timestamptz NOT NULL DEFAULT now(),
  ip inet
);
CREATE INDEX IF NOT EXISTS aceites_user_idx ON public.aceites(user_id, tipo);

ALTER TABLE public.documento_versoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aceites ENABLE ROW LEVEL SECURITY;

CREATE POLICY doc_select_publicado ON public.documento_versoes FOR SELECT
  USING (publicado_em IS NOT NULL);
GRANT SELECT ON public.documento_versoes TO anon, authenticated;
GRANT ALL ON public.documento_versoes TO service_role;

CREATE POLICY aceites_select_own ON public.aceites FOR SELECT USING (user_id = auth.uid());
CREATE POLICY aceites_insert_own ON public.aceites FOR INSERT WITH CHECK (user_id = auth.uid());
GRANT SELECT, INSERT ON public.aceites TO authenticated;
GRANT ALL ON public.aceites TO service_role;
