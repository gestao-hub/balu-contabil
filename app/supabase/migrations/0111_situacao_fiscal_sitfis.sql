-- 0111 — Relatório de Situação Fiscal da Receita (Integra-SITFIS).
--
-- POR QUE EXISTE. Pendências na Receita/PGFN (débito, omissão de declaração)
-- travam a certidão negativa e só eram vistas no e-CAC. Prioridade 2 da
-- análise de 06/10/2026.
--
-- O relatório é um PDF oficial. Ele é GUARDADO (bucket privado
-- `relatorios-fiscais`, download só por URL assinada depois da checagem de
-- acesso) e ganha um `resultado` que é INDÍCIO lido do texto do PDF — ver
-- `lib/fiscal/sitfis-parse.ts`: 'indeterminado' quando não dá para afirmar.

CREATE TABLE IF NOT EXISTS public.relatorios_situacao_fiscal (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  emitido_em     timestamptz NOT NULL DEFAULT now(),
  storage_path   text NOT NULL,
  resultado      text NOT NULL DEFAULT 'indeterminado',
  -- NULL = varredura automática; senão, quem pediu pela tela.
  solicitado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT relatorios_sitfis_resultado_check
    CHECK (resultado IN ('sem_pendencias', 'com_pendencias', 'indeterminado'))
);

CREATE INDEX IF NOT EXISTS relatorios_sitfis_company_idx
  ON public.relatorios_situacao_fiscal (company_id, emitido_em DESC);

ALTER TABLE public.relatorios_situacao_fiscal ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS relatorios_sitfis_select_dono ON public.relatorios_situacao_fiscal;
CREATE POLICY relatorios_sitfis_select_dono ON public.relatorios_situacao_fiscal FOR SELECT
  USING (company_id IN (SELECT id FROM public.companies WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS relatorios_sitfis_select_contador ON public.relatorios_situacao_fiscal;
CREATE POLICY relatorios_sitfis_select_contador ON public.relatorios_situacao_fiscal FOR SELECT
  USING (company_id IN (SELECT id FROM public.companies
                        WHERE contabilidade_id IS NOT NULL
                          AND contabilidade_id = public.minha_contabilidade_membro()));

REVOKE ALL ON public.relatorios_situacao_fiscal FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.relatorios_situacao_fiscal FROM authenticated;
GRANT SELECT ON public.relatorios_situacao_fiscal TO authenticated;

ALTER TABLE public.empresas_fiscais
  ADD COLUMN IF NOT EXISTS sitfis_consultado_em timestamptz;

-- Bucket PRIVADO, só PDF, 10 MB. Sem policy em storage.objects para
-- anon/authenticated: tudo passa pelo service role (mesmo desenho da 0103).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('relatorios-fiscais', 'relatorios-fiscais', false, 10 * 1024 * 1024, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE
  SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ------------------------------------------------ tipo de notificação novo
-- ⚠️ REMONTADA POR INTEIRO: lista da 0110 mais o tipo novo.
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_tipo_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_tipo_check CHECK (tipo IN (
  'das_a_vencer','das_vencido','pgdas_pendente','dasn_pendente','defis_pendente',
  'cert_a_vencer','cert_vencido','limite_faturamento','honorario_a_vencer','abertura_etapa',
  'assinatura_trial_acabando','assinatura_cobranca_vencida',
  'whatsapp_escalado',
  'sla_estourado','pagamento_nao_detectado',
  'parametro_fiscal_desatualizado',
  'pagamento_confirmado',
  'whatsapp_desconectado',
  'apuracao_bloqueada',
  'receita_mensagem_nova',
  'situacao_fiscal_pendencia'
));

DO $$
BEGIN
  IF to_regclass('public.relatorios_situacao_fiscal') IS NULL THEN
    RAISE EXCEPTION '0111: tabela relatorios_situacao_fiscal não criada';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'relatorios-fiscais' AND public = false) THEN
    RAISE EXCEPTION '0111: bucket relatorios-fiscais não está privado';
  END IF;
END $$;
