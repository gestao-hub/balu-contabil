-- @custom — CNAE/atividade por nota (segregação de receita por anexo no Simples).
-- Ver docs/superpowers/specs/2026-06-05-cnae-na-nota-segregacao-design.md.
-- Aditiva e idempotente. Aplicada manualmente. NULL = sem tag → apuração usa o anexo do principal.
ALTER TABLE public.notas_fiscais ADD COLUMN IF NOT EXISTS cnae TEXT;
COMMENT ON COLUMN public.notas_fiscais.cnae IS 'CNAE (7 dígitos) da atividade da nota; resolve o anexo na apuração. NULL → fallback no principal.';
