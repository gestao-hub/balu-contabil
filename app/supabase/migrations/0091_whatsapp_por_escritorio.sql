-- 0091 — canal de WhatsApp por escritório (multi-tenant do atendimento).
-- Spec: docs/superpowers/specs/2026-08-20-canal-whatsapp-por-escritorio-design.md
--
-- Até aqui o canal era UM número para a plataforma inteira (`UAZAPI_TOKEN` em
-- variável de ambiente). Cada escritório passa a ter a própria instância, e o
-- atendimento por IA passa a ser escopado ao escritório do canal.
--
-- Aditiva e idempotente: pode rodar 2x sem erro.

-- ------------------------------------------------ instância por escritório
ALTER TABLE public.contabilidades
  ADD COLUMN IF NOT EXISTS uazapi_instancia_id  text,
  -- Cifrado com cifrarCampo (envelope AES-256-GCM). NUNCA em claro: com este
  -- token qualquer um envia mensagem em nome do escritório.
  ADD COLUMN IF NOT EXISTS uazapi_token_cifrado text,
  ADD COLUMN IF NOT EXISTS uazapi_numero        text,
  ADD COLUMN IF NOT EXISTS uazapi_status        text NOT NULL DEFAULT 'desconectado',
  -- Identifica o TENANT na entrada. A URL do webhook é montada por nós no
  -- provisionamento (`?t=<este valor>`), e o escritório nunca a vê.
  --
  -- Por que não ler a instância do corpo da mensagem: o envelope da uazapi não
  -- tem contrato conhecido (ver lib/uazapi/payload.ts), e o projeto já pagou
  -- por apostar nisso em 12/08/2026 — a mensagem chegava e o webhook não
  -- produzia nem linha de auditoria. A URL é nossa; o payload é deles.
  ADD COLUMN IF NOT EXISTS uazapi_webhook_token text,
  ADD COLUMN IF NOT EXISTS uazapi_conectado_em  timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contabilidades_uazapi_status_check'
  ) THEN
    ALTER TABLE public.contabilidades
      ADD CONSTRAINT contabilidades_uazapi_status_check
      CHECK (uazapi_status IN ('desconectado', 'conectando', 'conectado'));
  END IF;
END $$;

-- Um token, um escritório. UNIQUE parcial porque a coluna é nula até o
-- primeiro provisionamento, e NULL não colide com NULL.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_contabilidades_uazapi_webhook_token
  ON public.contabilidades (uazapi_webhook_token)
  WHERE uazapi_webhook_token IS NOT NULL;

-- ------------------------------------------------ privilégios
-- Padrão da 0076: GRANT por COLUNA. A tela do contador precisa ver o número e
-- o status; o token da instância e o token do webhook NÃO são legíveis por
-- `authenticated` — nem por quem é dono do escritório. Quem escreve é sempre
-- o service_role, pelas actions do servidor.
GRANT SELECT (uazapi_numero, uazapi_status, uazapi_conectado_em)
  ON public.contabilidades TO authenticated;

-- ------------------------------------------------ carteira sem sessão
-- `painel_contador()` escopa por `minha_contabilidade()`, que depende de
-- auth.uid(). O webhook do WhatsApp NÃO tem sessão (é service_role), e o modo
-- ESCRITÓRIO precisa dos mesmos fatos.
--
-- Em vez de reimplementar a consulta em TypeScript — duas fontes da mesma
-- verdade, divergindo na primeira mudança —, esta é a MESMA consulta com o
-- escritório vindo por parâmetro.
--
-- ⚠️ Sem GRANT para `authenticated`: um usuário logado que pudesse chamá-la
-- passando outro `p_contabilidade_id` leria a carteira alheia. Só service_role.
CREATE OR REPLACE FUNCTION public.painel_contador_por_id(p_contabilidade_id uuid)
RETURNS TABLE (
  company_id uuid, nome text, razao_social text, cnpj text,
  regime_code text, convite_pendente boolean,
  faturamento_ano numeric, faturamento_12m numeric,
  das_vencidos int, pgdas_mes_anterior_transmitida boolean,
  dasn_ano_anterior_transmitida boolean, cert_not_after timestamptz,
  honorarios_aberto numeric, honorarios_atrasado numeric
) LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT
    c.id, c.nome, c.razao_social, c.cnpj,
    ef."Code_regime_tributario"::text,
    (c.user_id IS NULL),
    COALESCE((SELECT sum(n.valor_total) FROM notas_fiscais n
      WHERE n.company_id = c.id AND n.status IN ('ativa','lancada')
        AND n.tipo_documento IN ('NFe','NFCe','NFSe')
        AND n.data_emissao >= date_trunc('year', now())), 0),
    COALESCE((SELECT sum(n.valor_total) FROM notas_fiscais n
      WHERE n.company_id = c.id AND n.status IN ('ativa','lancada')
        AND n.tipo_documento IN ('NFe','NFCe','NFSe')
        AND n.data_emissao >= date_trunc('month', now()) - interval '12 months'), 0),
    (SELECT count(*)::int FROM guias_fiscais g
      WHERE g.company_id = c.id AND g.deleted_at IS NULL
        AND g.data_pagamento IS NULL AND g.data_vencimento < current_date),
    EXISTS (SELECT 1 FROM declaracoes_fiscais d
      WHERE d.company_id = c.id AND d.tipo = 'PGDAS-D' AND d.data_transmissao IS NOT NULL
        AND d.competencia_referencia = to_char(date_trunc('month', now()) - interval '1 month', 'YYYY-MM')),
    EXISTS (SELECT 1 FROM declaracoes_fiscais d
      WHERE d.company_id = c.id AND d.tipo = 'DASN-SIMEI' AND d.data_transmissao IS NOT NULL
        AND d.competencia_referencia LIKE (extract(year FROM now())::int - 1)::text || '%'),
    (SELECT max(a.cert_not_after) FROM arquivos_auxiliares a WHERE a.company_id = c.id),
    COALESCE((SELECT sum(h.valor) FROM honorarios h
      WHERE h.empresa_cliente_id = c.id AND h.contabilidade_id = c.contabilidade_id
        AND h.data_pagamento IS NULL AND h.data_vencimento >= current_date), 0),
    COALESCE((SELECT sum(h.valor) FROM honorarios h
      WHERE h.empresa_cliente_id = c.id AND h.contabilidade_id = c.contabilidade_id
        AND h.data_pagamento IS NULL AND h.data_vencimento < current_date), 0)
  FROM companies c
  LEFT JOIN empresas_fiscais ef ON ef.empresa_id = c.id AND ef.deleted_at IS NULL
  WHERE c.deleted_at IS NULL
    AND c.contabilidade_id = p_contabilidade_id
  ORDER BY c.nome NULLS LAST
$$;

REVOKE ALL ON FUNCTION public.painel_contador_por_id(uuid) FROM public;
REVOKE ALL ON FUNCTION public.painel_contador_por_id(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.painel_contador_por_id(uuid) TO service_role;

COMMENT ON COLUMN public.contabilidades.uazapi_webhook_token IS
  'Segredo por escritório na URL do webhook (?t=). Identifica o tenant na entrada. Nunca legível por authenticated.';
COMMENT ON FUNCTION public.painel_contador_por_id(uuid) IS
  'Mesmos fatos de painel_contador(), com o escritório por parâmetro — para o webhook do WhatsApp, que não tem sessão. Só service_role.';
