-- @custom — Fundação multi-atividade: catálogo CNAE→anexo + CNAEs por empresa.
-- Ver docs/superpowers/specs/2026-06-04-modelo-cnae-anexo-design.md.
-- Aditiva e idempotente. Aplicada manualmente (db_atual.sql é a fonte de verdade).

-- 1) Referência global CNAE → anexo (curada; não é dado de tenant).
CREATE TABLE IF NOT EXISTS public.cnae_anexo (
  codigo      TEXT PRIMARY KEY,                         -- 7 dígitos, sem máscara
  anexo_base  TEXT,                                     -- 'Anexo I'..'Anexo V'; NULL = depende de Fator R / desconhecido
  fator_r     BOOLEAN NOT NULL DEFAULT false,           -- sujeito a Fator R (III↔V)
  anexo_iv    BOOLEAN NOT NULL DEFAULT false,           -- flag Anexo IV (INSS à parte) — tratar no futuro
  descricao   TEXT,
  observacao  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.cnae_anexo IS 'Referência CNAE→anexo do Simples (curada). anexo_base NULL quando depende de Fator R.';

ALTER TABLE public.cnae_anexo ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY cnae_anexo_select ON public.cnae_anexo FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Sem policy de escrita: curada via migration (service_role).

-- 2) CNAEs por empresa.
CREATE TABLE IF NOT EXISTS public.company_cnaes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL,
  codigo        TEXT NOT NULL,                           -- 7 dígitos
  descricao     TEXT,
  tipo          TEXT NOT NULL CHECK (tipo IN ('principal','secundario')),
  fonte         TEXT,                                    -- 'brasilapi' | 'focus' | 'manual'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);
COMMENT ON TABLE public.company_cnaes IS 'CNAEs (principal + secundários) por empresa. Anexo é resolvido via cnae_anexo em leitura.';

CREATE UNIQUE INDEX IF NOT EXISTS company_cnaes_company_codigo_uniq
  ON public.company_cnaes (company_id, codigo) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS company_cnaes_company_idx ON public.company_cnaes (company_id);

ALTER TABLE public.company_cnaes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY company_cnaes_owner ON public.company_cnaes
    FOR ALL TO authenticated
    USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3) updated_at automático (mesmo padrão das demais tabelas).
DO $$ BEGIN
  CREATE TRIGGER tg_company_cnaes_updated_at BEFORE UPDATE ON public.company_cnaes
    FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
EXCEPTION WHEN undefined_function THEN NULL; WHEN duplicate_object THEN NULL; END $$;

-- 4) Seed inicial (curado à mão — LC 123/CGSN). Crescer conforme aparecem novos CNAEs.
--    Sujeitos a Fator R: fator_r=true, anexo_base=NULL (cai no manual III/V).
INSERT INTO public.cnae_anexo (codigo, anexo_base, fator_r, anexo_iv, descricao) VALUES
  ('4299501', 'Anexo IV', false, true,  'Construção de instalações esportivas e recreativas'),
  ('4120400', 'Anexo IV', false, true,  'Construção de edifícios'),
  ('4322301', 'Anexo IV', false, true,  'Instalações hidráulicas, sanitárias e de gás'),
  ('4744005', 'Anexo I',  false, false, 'Comércio varejista de materiais de construção em geral'),
  ('4744003', 'Anexo I',  false, false, 'Comércio varejista de materiais hidráulicos'),
  ('4789005', 'Anexo I',  false, false, 'Comércio varejista de produtos saneantes domissanitários'),
  ('6201501', NULL,       true,  false, 'Desenvolvimento de programas de computador sob encomenda')
ON CONFLICT (codigo) DO NOTHING;
