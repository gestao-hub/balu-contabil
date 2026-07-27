-- 0050_billing.sql — Bloco 4A: assinatura da Balu.
-- Aditiva e idempotente: pode rodar 2x sem erro.

-- ---------------------------------------------------------------- planos
CREATE TABLE IF NOT EXISTS public.planos (
  id             text PRIMARY KEY,
  nome           text NOT NULL,
  publico        text NOT NULL CHECK (publico IN ('empresa','escritorio')),
  valor_centavos int  NOT NULL CHECK (valor_centavos >= 0),
  ciclo          text NOT NULL DEFAULT 'MONTHLY' CHECK (ciclo IN ('MONTHLY','YEARLY')),
  clientes_min   int,
  clientes_max   int,
  trial_dias     int  NOT NULL DEFAULT 7 CHECK (trial_dias >= 0),
  ativo          boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Seed inicial. Valores provisorios: o AdminBalu edita em /admin/assinaturas.
INSERT INTO public.planos (id, nome, publico, valor_centavos, clientes_min, clientes_max) VALUES
  ('empresario_mensal',   'Empresario — mensal',         'empresa',     4990, NULL, NULL),
  ('escritorio_ate_50',   'Escritorio — ate 50 clientes','escritorio', 19900,    0,   50),
  ('escritorio_51_200',   'Escritorio — 51 a 200',       'escritorio', 39900,   51,  200),
  ('escritorio_201_mais', 'Escritorio — 201 ou mais',    'escritorio', 79900,  201, NULL)
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------- assinaturas
CREATE TABLE IF NOT EXISTS public.assinaturas (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contabilidade_id      uuid REFERENCES public.contabilidades(id) ON DELETE CASCADE,
  company_id            uuid REFERENCES public.companies(id)      ON DELETE CASCADE,
  plano_id              text REFERENCES public.planos(id),
  status                text NOT NULL CHECK (status IN
                          ('trial','ativa','inadimplente','cancelada','cortesia')),
  trial_termina_em      date,
  proxima_cobranca_em   date,
  asaas_customer_id     text,
  asaas_subscription_id text,
  cancelada_em          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assinaturas_titular_chk CHECK (
    (contabilidade_id IS NOT NULL AND company_id IS NULL) OR
    (contabilidade_id IS NULL AND company_id IS NOT NULL)
  )
);

-- Uma assinatura por titular. Sem isto, dois webhooks concorrentes criam
-- linhas duplicadas e o gate le a errada.
CREATE UNIQUE INDEX IF NOT EXISTS assinaturas_contabilidade_uidx
  ON public.assinaturas(contabilidade_id) WHERE contabilidade_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS assinaturas_company_uidx
  ON public.assinaturas(company_id) WHERE company_id IS NOT NULL;
-- O webhook acha a assinatura pelo id do Asaas.
CREATE INDEX IF NOT EXISTS assinaturas_asaas_sub_idx
  ON public.assinaturas(asaas_subscription_id) WHERE asaas_subscription_id IS NOT NULL;

-- ------------------------------------------------------------- cobrancas
CREATE TABLE IF NOT EXISTS public.cobrancas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assinatura_id   uuid NOT NULL REFERENCES public.assinaturas(id) ON DELETE CASCADE,
  asaas_charge_id text NOT NULL UNIQUE,
  status          text NOT NULL,
  valor_centavos  int  NOT NULL,
  vencimento      date NOT NULL,
  pago_em         date,
  link_fatura     text,
  pix_copia_cola  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cobrancas_assinatura_idx ON public.cobrancas(assinatura_id);

-- ------------------------------------------------------------------- RLS
ALTER TABLE public.planos      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assinaturas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cobrancas   ENABLE ROW LEVEL SECURITY;

-- planos: catalogo legivel por qualquer autenticado (a tela de assinatura
-- precisa mostrar as opcoes). Escrita so pelo service role (tela de admin).
DROP POLICY IF EXISTS planos_select_auth ON public.planos;
CREATE POLICY planos_select_auth ON public.planos
  FOR SELECT TO authenticated USING (true);

-- assinaturas: o titular le a propria. Sem policy de INSERT/UPDATE — mesma
-- forma de notifications (0045): so a trigger e o service role escrevem.
DROP POLICY IF EXISTS assinaturas_select_titular ON public.assinaturas;
CREATE POLICY assinaturas_select_titular ON public.assinaturas
  FOR SELECT USING (
    (company_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.companies c
        WHERE c.id = assinaturas.company_id AND c.user_id = auth.uid()))
    OR
    (contabilidade_id IS NOT NULL AND contabilidade_id = public.minha_contabilidade_membro())
  );

DROP POLICY IF EXISTS cobrancas_select_titular ON public.cobrancas;
CREATE POLICY cobrancas_select_titular ON public.cobrancas
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.assinaturas a
     WHERE a.id = cobrancas.assinatura_id
       AND (
         (a.company_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.companies c
             WHERE c.id = a.company_id AND c.user_id = auth.uid()))
         OR
         (a.contabilidade_id IS NOT NULL
          AND a.contabilidade_id = public.minha_contabilidade_membro())
       )
  ));

-- -------------------------------------------- assinatura ao criar titular
-- Trigger, e nao chamada nas actions: company nasce em varios caminhos
-- (onboarding, contador cria cliente, stub de abertura). Uma trigger cobre
-- todos; espalhar a criacao pelas actions garantiria esquecer um.
CREATE OR REPLACE FUNCTION public.criar_assinatura_trial()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_dias int;
BEGIN
  IF TG_TABLE_NAME = 'companies' AND NEW.contabilidade_id IS NOT NULL THEN
    RETURN NEW;  -- coberta pela assinatura do escritorio
  END IF;

  SELECT trial_dias INTO v_dias FROM public.planos
   WHERE publico = CASE TG_TABLE_NAME WHEN 'companies' THEN 'empresa' ELSE 'escritorio' END
     AND ativo ORDER BY valor_centavos LIMIT 1;
  v_dias := COALESCE(v_dias, 7);

  IF TG_TABLE_NAME = 'companies' THEN
    INSERT INTO public.assinaturas (company_id, status, trial_termina_em)
      VALUES (NEW.id, 'trial', (now() AT TIME ZONE 'America/Sao_Paulo')::date + v_dias)
      ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO public.assinaturas (contabilidade_id, status, trial_termina_em)
      VALUES (NEW.id, 'trial', (now() AT TIME ZONE 'America/Sao_Paulo')::date + v_dias)
      ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_assinatura_company       ON public.companies;
CREATE TRIGGER trg_assinatura_company       AFTER INSERT ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.criar_assinatura_trial();
DROP TRIGGER IF EXISTS trg_assinatura_contabilidade ON public.contabilidades;
CREATE TRIGGER trg_assinatura_contabilidade AFTER INSERT ON public.contabilidades
  FOR EACH ROW EXECUTE FUNCTION public.criar_assinatura_trial();

-- ------------------------------------- cortesia para o que JA existe hoje
-- Sem isto o deploy bloqueia todo mundo, inclusive os pilotos e as contas
-- de teste. Cortesia nao tem vinculo Asaas nem vencimento: nunca bloqueia.
INSERT INTO public.assinaturas (contabilidade_id, status)
  SELECT id, 'cortesia' FROM public.contabilidades
  ON CONFLICT DO NOTHING;
INSERT INTO public.assinaturas (company_id, status)
  SELECT id, 'cortesia' FROM public.companies
   WHERE contabilidade_id IS NULL AND deleted_at IS NULL
  ON CONFLICT DO NOTHING;

-- ---------------------------------- ampliar o CHECK de notifications.tipo
-- ARMADILHA: a lista e fechada (0045:10-12). Inserir tipo novo sem este
-- ALTER falha com check_violation em RUNTIME, nao em compilacao. A lista
-- antiga tem de ser repetida INTEIRA — omitir um valor quebra linhas ja
-- gravadas.
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_tipo_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_tipo_check CHECK (tipo IN (
  'das_a_vencer','das_vencido','pgdas_pendente','dasn_pendente','defis_pendente',
  'cert_a_vencer','cert_vencido','limite_faturamento','honorario_a_vencer','abertura_etapa',
  'assinatura_trial_acabando','assinatura_cobranca_vencida'));
