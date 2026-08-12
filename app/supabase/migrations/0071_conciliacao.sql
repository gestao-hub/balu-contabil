-- Bloco 7, Task 8 — conciliacao bancaria: as tabelas.
-- Spec: docs/superpowers/specs/2026-08-12-bloco-7-dominio-sla-conciliacao-design.md §3.4
--
-- O pilar 4 do planejamento pede confirmacao AUTOMATICA de pagamento. Hoje a
-- baixa e 100% manual (marcarGuiaPagaAction). Aqui entram o consentimento de
-- Open Finance, o extrato importado e a fonte do mock.
--
-- LGPD: dado bancario e sensivel por consequencia. Guardamos o MINIMO que a
-- conciliacao exige (data, valor, tipo, descricao) — nunca saldo, nunca o
-- extrato inteiro, nunca dado de contraparte alem do que vem na descricao.

-- ── consentimento por empresa ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.conciliacao_conexoes (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  provedor                 text NOT NULL,
  consentimento_id_externo text,
  status                   text NOT NULL DEFAULT 'pendente',
  -- Cifrada com cifrarCampo (envelope AES-256-GCM do Bloco E), como a chave da
  -- subconta Asaas (0053). Credencial de banco de terceiro nunca em claro.
  credencial_cifrada       text,
  consentida_em            timestamptz,
  expira_em                timestamptz,
  criada_por               uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.conciliacao_conexoes DROP CONSTRAINT IF EXISTS conciliacao_conexoes_status_check;
ALTER TABLE public.conciliacao_conexoes ADD CONSTRAINT conciliacao_conexoes_status_check
  CHECK (status IN ('pendente','ativa','expirada','revogada'));

-- Uma conexao VIVA por empresa. Parcial: revogadas/expiradas ficam no
-- historico sem competir — apagar seria perder a trilha de consentimento, que
-- e justamente o que a LGPD manda guardar.
CREATE UNIQUE INDEX IF NOT EXISTS conciliacao_conexoes_viva_uidx
  ON public.conciliacao_conexoes (company_id)
  WHERE status IN ('pendente','ativa');

-- ── extrato importado ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.conciliacao_transacoes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  conexao_id     uuid NOT NULL REFERENCES public.conciliacao_conexoes(id) ON DELETE CASCADE,
  -- Idempotencia da importacao: o cron roda todo dia sobre uma janela que se
  -- sobrepoe de proposito (lancamento pode aparecer com atraso no extrato).
  id_externo     text NOT NULL,
  data           date NOT NULL,
  -- CENTAVOS INTEIROS, ao contrario de guias_fiscais.valor_total, que e
  -- numeric(15,2) em REAIS (verificado no banco em 12/08). A conversao mora no
  -- matcher (lib/conciliacao/matcher.ts) e em lugar nenhum mais.
  valor_centavos bigint NOT NULL,
  tipo           text NOT NULL,
  descricao      text,
  guia_id        uuid REFERENCES public.guias_fiscais(id) ON DELETE SET NULL,
  conciliada_em  timestamptz,
  conciliacao_origem text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.conciliacao_transacoes DROP CONSTRAINT IF EXISTS conciliacao_transacoes_tipo_check;
ALTER TABLE public.conciliacao_transacoes ADD CONSTRAINT conciliacao_transacoes_tipo_check
  CHECK (tipo IN ('credito','debito'));

CREATE UNIQUE INDEX IF NOT EXISTS conciliacao_transacoes_externo_uidx
  ON public.conciliacao_transacoes (conexao_id, id_externo);

-- Candidatas do matcher: credito ainda nao conciliado, por empresa e data.
CREATE INDEX IF NOT EXISTS conciliacao_transacoes_candidatas_idx
  ON public.conciliacao_transacoes (company_id, data)
  WHERE guia_id IS NULL AND tipo = 'credito';

-- ── fonte do adapter mock ─────────────────────────────────────────────────
--
-- Existe pra o mock ser EXPLICITO. Um mock que derivasse transacoes das
-- proprias guias em aberto daria baixa em tudo e nao provaria nada — o teste
-- passaria justamente porque o dado foi fabricado a partir da resposta.
CREATE TABLE IF NOT EXISTS public.conciliacao_extrato_mock (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  id_externo     text NOT NULL,
  data           date NOT NULL,
  valor_centavos bigint NOT NULL,
  tipo           text NOT NULL DEFAULT 'credito',
  descricao      text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS conciliacao_extrato_mock_uidx
  ON public.conciliacao_extrato_mock (company_id, id_externo);

-- ── privilegios ANTES das policies ────────────────────────────────────────
--
-- O ALTER DEFAULT PRIVILEGES do Supabase concede tudo em `public` para
-- anon/authenticated, calado, em TODA tabela nova. Sem este REVOKE, as tres
-- tabelas acima nascem legiveis por qualquer visitante — licao das
-- 0053/0055/0058/0061, e aqui o dado e extrato bancario.
REVOKE ALL ON public.conciliacao_conexoes    FROM anon, authenticated;
REVOKE ALL ON public.conciliacao_transacoes  FROM anon, authenticated;
REVOKE ALL ON public.conciliacao_extrato_mock FROM anon, authenticated;

ALTER TABLE public.conciliacao_conexoes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conciliacao_transacoes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conciliacao_extrato_mock ENABLE ROW LEVEL SECURITY;

-- Conexao: o dono da empresa consente e revoga.
GRANT SELECT, INSERT, UPDATE ON public.conciliacao_conexoes TO authenticated;
DROP POLICY IF EXISTS conciliacao_conexoes_select ON public.conciliacao_conexoes;
CREATE POLICY conciliacao_conexoes_select ON public.conciliacao_conexoes
  FOR SELECT USING (public.user_owns_company(company_id));
DROP POLICY IF EXISTS conciliacao_conexoes_insert ON public.conciliacao_conexoes;
CREATE POLICY conciliacao_conexoes_insert ON public.conciliacao_conexoes
  FOR INSERT WITH CHECK (public.user_owns_company(company_id));
DROP POLICY IF EXISTS conciliacao_conexoes_update ON public.conciliacao_conexoes;
CREATE POLICY conciliacao_conexoes_update ON public.conciliacao_conexoes
  FOR UPDATE USING (public.user_owns_company(company_id))
  WITH CHECK (public.user_owns_company(company_id));

-- Transacao: o dono LE (para conferir e confirmar sugestao). Quem escreve e o
-- cron, com service_role — extrato nao se edita a mao.
GRANT SELECT ON public.conciliacao_transacoes TO authenticated;
DROP POLICY IF EXISTS conciliacao_transacoes_select ON public.conciliacao_transacoes;
CREATE POLICY conciliacao_transacoes_select ON public.conciliacao_transacoes
  FOR SELECT USING (public.user_owns_company(company_id));

-- Mock: service_role apenas. Sem GRANT e sem policy — nem o dono da empresa
-- enxerga, porque isto e instrumento de teste, nao dado dele.
COMMENT ON TABLE public.conciliacao_extrato_mock IS
  'Fonte do adapter mock de Open Finance. service_role apenas — instrumento de teste, nao dado do cliente.';
COMMENT ON COLUMN public.conciliacao_transacoes.valor_centavos IS
  'Centavos INTEIROS. guias_fiscais.valor_total e numeric(15,2) em REAIS — a conversao mora so no matcher.';
