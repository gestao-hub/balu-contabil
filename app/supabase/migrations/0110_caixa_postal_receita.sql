-- 0110 — Caixa Postal do e-CAC dentro da Balu (Integra-CaixaPostal).
--
-- POR QUE EXISTE. As mensagens e intimações da Receita chegam na Caixa Postal
-- do e-CAC, e até aqui a Balu não as via: o cliente só sabia de uma intimação
-- entrando no e-CAC. Análise de 06/10/2026 (prioridade 1).
--
-- ⚠️ CIÊNCIA. Abrir o DETALHE de uma mensagem (MSGDETALHAMENTO62) conta como
-- ciência da intimação (Decreto 70.235/1972, art. 23, § 2º, III — está na doc
-- do serviço). Prazo começa a correr. Por isso:
--   * o cron só LISTA (assunto, origem, data) — nunca abre;
--   * `conteudo` só é preenchido quando uma PESSOA clica em "Abrir", depois de
--     um aviso explícito, e `aberta_em`/`aberta_por` registram quem deu ciência.

CREATE TABLE IF NOT EXISTS public.mensagens_receita (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  -- Identificador da mensagem na Caixa Postal (Number(10) na doc).
  isn             text NOT NULL,
  numero_controle text,
  assunto         text NOT NULL,
  origem          text,
  -- relevancia = 2 na doc ("com relevância").
  relevante       boolean NOT NULL DEFAULT false,
  data_envio      date,
  -- Estado NA RECEITA no momento da última listagem (indicadorLeitura).
  lida_na_receita boolean NOT NULL DEFAULT false,
  data_ciencia    date,
  -- Só depois de "Abrir" na Balu (que É ciência):
  conteudo        text,
  aberta_em       timestamptz,
  aberta_por      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mensagens_receita_unica UNIQUE (company_id, isn)
);

CREATE INDEX IF NOT EXISTS mensagens_receita_company_idx
  ON public.mensagens_receita (company_id, data_envio DESC);

ALTER TABLE public.mensagens_receita ENABLE ROW LEVEL SECURITY;

-- Leitura: o dono da empresa e o escritório que a atende. Escrita só pelo
-- service role (cron e actions) — ninguém marca ciência pelo navegador.
DROP POLICY IF EXISTS mensagens_receita_select_dono ON public.mensagens_receita;
CREATE POLICY mensagens_receita_select_dono ON public.mensagens_receita FOR SELECT
  USING (company_id IN (SELECT id FROM public.companies WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS mensagens_receita_select_contador ON public.mensagens_receita;
CREATE POLICY mensagens_receita_select_contador ON public.mensagens_receita FOR SELECT
  USING (company_id IN (SELECT id FROM public.companies
                        WHERE contabilidade_id IS NOT NULL
                          AND contabilidade_id = public.minha_contabilidade_membro()));

REVOKE ALL ON public.mensagens_receita FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.mensagens_receita FROM authenticated;
GRANT SELECT ON public.mensagens_receita TO authenticated;

-- Rotatividade da varredura diária (mesmo desenho da 0088 para pagamentos):
-- quem esperou mais vai primeiro.
ALTER TABLE public.empresas_fiscais
  ADD COLUMN IF NOT EXISTS caixa_postal_consultada_em timestamptz;

-- ------------------------------------------------ tipo de notificação novo
-- ⚠️ REMONTADA POR INTEIRO: lista da 0093 mais o tipo novo.
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
  'receita_mensagem_nova'
));

DO $$
BEGIN
  IF to_regclass('public.mensagens_receita') IS NULL THEN
    RAISE EXCEPTION '0110: tabela mensagens_receita não criada';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                  AND table_name = 'empresas_fiscais' AND column_name = 'caixa_postal_consultada_em') THEN
    RAISE EXCEPTION '0110: coluna caixa_postal_consultada_em não criada';
  END IF;
END $$;
