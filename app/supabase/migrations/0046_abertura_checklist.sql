-- 0046_abertura_checklist.sql — Bloco 2: Abertura Digital completa
-- Parte do schema REAL de public.abertura_empresas (db_atual.sql linhas 223-286),
-- NAO do 0001 (idealizado). Idempotente: pode rodar 2x sem erro.

-- Estado de revisao por documento (Frente A). Mapeia DocKey -> objeto:
--   { status: 'aprovado'|'recusado', observacao, revisado_por, revisado_em }
-- A ausencia de chave = "enviado, aguardando analise" (estado derivado no app).
-- Merge parcial no app (nunca sobrescrever o objeto inteiro — landmine #4 da spec).
ALTER TABLE public.abertura_empresas
  ADD COLUMN IF NOT EXISTS docs_revisao jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Realtime para a visao do cliente acompanhar etapa/docs em tempo real (Frente C).
-- Respeita a RLS existente de abertura_empresas. Guarda idempotente (padrao 0045):
-- nao falha se ja for membro da publication nem se a publication nao existir.
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.abertura_empresas;
EXCEPTION
  WHEN duplicate_object THEN NULL;   -- ja e membro
  WHEN undefined_object THEN NULL;   -- publication nao existe neste ambiente
END $$;

-- Nota: o tipo 'abertura_etapa' JA esta no CHECK de notifications.tipo (migration
-- 0045 do Bloco 1) — nenhuma alteracao de constraint necessaria aqui.
