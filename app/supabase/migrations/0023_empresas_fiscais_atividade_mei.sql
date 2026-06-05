-- @custom — P0.4: atividade do MEI (Comércio/Indústria, Serviços, ambos) para a estimativa
-- de DAS-MEI (valorDasMei). Aditiva e idempotente. Aplicada manualmente (db_atual.sql é a verdade).
-- Valores esperados (contrato com das-mei.ts): 'Comercio ou Industria' | 'Prestacao de Servicos'
-- | 'Comercio e Servicos'. NULL = não informado → estimativa cai em Serviços (default).
ALTER TABLE public.empresas_fiscais ADD COLUMN IF NOT EXISTS atividade_mei TEXT;
COMMENT ON COLUMN public.empresas_fiscais.atividade_mei IS 'Atividade do MEI p/ estimativa de DAS-MEI. NULL → Serviços (default).';
