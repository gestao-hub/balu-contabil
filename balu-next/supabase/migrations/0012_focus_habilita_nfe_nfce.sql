-- @custom — Emissão multi-tipo: flags de habilitação de NF-e e NFC-e por empresa.
-- NFS-e já tinha flags (focus_habilita_nfse*). NF-e/NFC-e não existiam.
-- Aditiva e idempotente. Habilita os 3 tipos para a AL Piscinas (teste).

ALTER TABLE public.empresas_fiscais
  ADD COLUMN IF NOT EXISTS focus_habilita_nfe  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS focus_habilita_nfce BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.empresas_fiscais.focus_habilita_nfe  IS 'Empresa habilitada a emitir NF-e (modelo 55) no painel.';
COMMENT ON COLUMN public.empresas_fiscais.focus_habilita_nfce IS 'Empresa habilitada a emitir NFC-e (modelo 65) no painel.';

-- Habilita os 3 tipos para a AL Piscinas (match por razão social — evita hardcode de UUID/CNPJ).
UPDATE public.empresas_fiscais ef
   SET focus_habilita_nfe = true,
       focus_habilita_nfce = true
  FROM public.companies c
 WHERE ef.empresa_id = c.id
   AND (c.razao_social ILIKE '%piscina%' OR c.nome ILIKE '%piscina%')
   AND ef.deleted_at IS NULL;
