-- @custom — Lançamento manual de NF: distingue emissão real (Focus) de lançamento manual.
-- 'emissao' (default) = nota emitida pela plataforma; 'manual' = NF já emitida fora, só registrada.
ALTER TABLE public.notas_fiscais
  ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'emissao';

ALTER TABLE public.notas_fiscais DROP CONSTRAINT IF EXISTS notas_fiscais_origem_check;
ALTER TABLE public.notas_fiscais
  ADD CONSTRAINT notas_fiscais_origem_check CHECK (origem IN ('emissao','manual'));

-- Status 'lancada' (nota manual): db_atual.sql NÃO mostra CHECK em status → texto livre, insere ok.
-- Se a base real tiver um CHECK de status, estendê-lo aqui para incluir 'lancada'.
