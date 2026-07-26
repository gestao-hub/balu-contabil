-- 0048_declaracoes_anuais.sql — Bloco 3: DASN-SIMEI assistida + DEFIS.
-- Aditiva e idempotente, no espírito da 0025. Nenhuma tabela nova: as duas
-- declarações anuais moram em declaracoes_fiscais com competencia_referencia =
-- '<ano>' e tipo em ('DASN-SIMEI','DEFIS'). A UNIQUE (company_id,
-- competencia_referencia, tipo) da 0025 já dá idempotência: reenviar o
-- comprovante é upsert, não duplica.
--
-- RLS: NADA muda aqui. declaracoes_fiscais_owner (0025) já deixa o empresário
-- escrever o que é dele; declaracoes_select_contador (0033) é SELECT-only e
-- continua assim — o contador escreve pela Server Action com service role.

ALTER TABLE public.declaracoes_fiscais
  ADD COLUMN IF NOT EXISTS dados               jsonb,
  ADD COLUMN IF NOT EXISTS comprovante_path    text,
  ADD COLUMN IF NOT EXISTS origem              text,
  ADD COLUMN IF NOT EXISTS registrado_por      uuid,
  ADD COLUMN IF NOT EXISTS divergencia_receita numeric;

DO $$ BEGIN
  ALTER TABLE public.declaracoes_fiscais
    ADD CONSTRAINT declaracoes_fiscais_origem_chk
    CHECK (origem IS NULL OR origem IN ('serpro','manual'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.declaracoes_fiscais.dados IS
  'Payload declarado. DASN: {receitaComercio, receitaServico, possuiEmpregado}. DEFIS: campos do art. 72 (camelCase).';
COMMENT ON COLUMN public.declaracoes_fiscais.divergencia_receita IS
  'declarado - apurado pelas notas. NULL = nao aplicavel; 0 = confere.';

-- Bucket privado dos comprovantes. Acesso SO pela service role (upload na action,
-- leitura por signed URL), como abertura-documentos: nenhum cliente toca direto,
-- entao nao ha policy em storage.objects.
INSERT INTO storage.buckets (id, name, public)
VALUES ('declaracoes-comprovantes', 'declaracoes-comprovantes', false)
ON CONFLICT (id) DO NOTHING;
