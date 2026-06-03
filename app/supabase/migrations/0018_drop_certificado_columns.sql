-- 0018: remove colunas órfãs do modelo de auth antigo do SERPRO.
-- Substituídas pelo token_procurador (serpro_contratante + serpro_token_procurador*).
-- Nenhum código lê estas colunas após a migração do MEI pro fluxo procurador.

ALTER TABLE public.empresas_fiscais
  DROP COLUMN IF EXISTS certificado_jwt,
  DROP COLUMN IF EXISTS certificado_access_token,
  DROP COLUMN IF EXISTS certificado_token_expiration;
