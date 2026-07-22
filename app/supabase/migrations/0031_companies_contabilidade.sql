-- 0031: vínculo empresa ↔ escritório. NULL = empresa "solta" (experiência atual).
-- companies.user_id já é nullable no banco real (empresa criada pelo contador nasce sem dono).
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS contabilidade_id uuid REFERENCES public.contabilidades(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS companies_contabilidade_idx ON public.companies(contabilidade_id);
