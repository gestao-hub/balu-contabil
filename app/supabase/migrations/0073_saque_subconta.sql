-- Saldo e saque da subconta Asaas do escritorio.
-- Origem: resposta do cliente ao P1 (12/08/2026) — "o saldo disponivel e, na
-- pagina de conta, ver os valores recebidos na conta Asaas, com a opcao de
-- transferir para a conta pessoal ou PJ do contador".
--
-- ⚠️ ISTO TIRA DINHEIRO DE UMA CONTA. Nao e tela de leitura. As tres decisoes
-- do desenho (tomadas com o usuario em 12/08) estao materializadas aqui:
--   1. mora dentro de "Conta de recebimento" (Bloco 4B), onde a subconta vive;
--   2. a conta de destino e cadastrada UMA VEZ, e o saque so confirma valor —
--      digitar dados bancarios a cada saque e como se erra destino;
--   3. so QUEM CRIOU a subconta saca.

ALTER TABLE public.contabilidades
  -- A 0053 guardava `asaas_subconta_criada_em` mas nao quem criou. Sem isso a
  -- regra "so o criador saca" nao teria como ser aplicada.
  ADD COLUMN IF NOT EXISTS asaas_subconta_criada_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- JSON cifrado (cifrarCampo, AES-256-GCM do Bloco E) com os dados bancarios
  -- de destino. Dado bancario nunca em claro, mesma regra da apiKey.
  ADD COLUMN IF NOT EXISTS conta_destino_cifrada text,
  -- Texto curto e SEM dado sensivel, so pra tela dizer pra onde vai o dinheiro
  -- ("Banco 341 · ag 1234 · conta ****5678"). Evita decifrar a cada render.
  ADD COLUMN IF NOT EXISTS conta_destino_resumo  text,
  ADD COLUMN IF NOT EXISTS conta_destino_em      timestamptz;

COMMENT ON COLUMN public.contabilidades.asaas_subconta_criada_por IS
  'Quem criou a subconta. E quem pode sacar — o modelo atual nao tem papeis internos (1 escritorio = N usuarios iguais), e isto e o mais proximo de "titular" sem inventar papel.';
COMMENT ON COLUMN public.contabilidades.conta_destino_cifrada IS
  'JSON dos dados bancarios de destino, cifrado por cifrarCampo. Nunca sai para o cliente, nunca entra em log.';

-- Backfill: as subcontas que ja existem nao tem criador registrado. Cair no
-- MEMBRO MAIS ANTIGO segue o precedente ja usado em `donoDaAssinatura`
-- (billing) e na escalacao do 6B — nenhum papel novo e inventado aqui.
UPDATE public.contabilidades ct
SET asaas_subconta_criada_por = m.user_id
FROM (
  SELECT DISTINCT ON (contabilidade_id) contabilidade_id, user_id
  FROM public.contabilidade_membros ORDER BY contabilidade_id, created_at
) m
WHERE ct.asaas_subconta_criada_por IS NULL
  AND ct.asaas_subconta_id IS NOT NULL
  AND m.contabilidade_id = ct.id;

-- Trilha de saques. Tabela propria, e nao so audit_log: dinheiro que sai
-- precisa de historico consultavel pelo dono, com estado e id externo pra
-- conciliar com o extrato do Asaas depois.
CREATE TABLE IF NOT EXISTS public.saques_escritorio (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contabilidade_id  uuid NOT NULL REFERENCES public.contabilidades(id) ON DELETE CASCADE,
  valor_centavos    bigint NOT NULL CHECK (valor_centavos > 0),
  status            text NOT NULL DEFAULT 'solicitado',
  asaas_transfer_id text,
  destino_resumo    text,
  erro              text,
  solicitado_por    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.saques_escritorio DROP CONSTRAINT IF EXISTS saques_escritorio_status_check;
ALTER TABLE public.saques_escritorio ADD CONSTRAINT saques_escritorio_status_check
  CHECK (status IN ('solicitado','confirmado','falhou'));

CREATE INDEX IF NOT EXISTS saques_escritorio_ct_idx
  ON public.saques_escritorio (contabilidade_id, created_at DESC);

-- REVOKE antes de qualquer policy (ALTER DEFAULT PRIVILEGES do Supabase).
REVOKE ALL ON public.saques_escritorio FROM anon, authenticated;
ALTER TABLE public.saques_escritorio ENABLE ROW LEVEL SECURITY;

-- O time do escritorio LE o historico (transparencia interna: todos veem o que
-- saiu). Quem ESCREVE e o service_role, pela action — a linha so nasce depois
-- do Asaas responder, e ninguem pode inventar um saque no historico.
GRANT SELECT ON public.saques_escritorio TO authenticated;
DROP POLICY IF EXISTS saques_escritorio_select ON public.saques_escritorio;
CREATE POLICY saques_escritorio_select ON public.saques_escritorio
  FOR SELECT USING (contabilidade_id = public.minha_contabilidade_membro());
