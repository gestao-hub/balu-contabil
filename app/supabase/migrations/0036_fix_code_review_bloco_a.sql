-- 0036: correções do code review do Bloco A (2026-07-22).
-- (1) CRÍTICO: bloqueia auto-promoção a AdminBalu via role_types (policies antigas
--     só checavam user_id = auth.uid(), sem restringir o VALOR de type — qualquer
--     autenticado podia se tornar admin). Trigger nega 'AdminBalu' fora do service role.
-- (2) CRÍTICO: painel_contador comparava competência 'YYYY-MM', mas o app grava
--     'YYYYMM' (guia.ts/competenciaReferenciaBrt) → PGDAS sempre "não transmitida"
--     e todo cliente Simples ficava vermelho para sempre. Confirmado no banco real.
-- (3) aceitar_convite: usuário já membro de OUTRO escritório "aceitava" convite de
--     membro com sucesso aparente (ON CONFLICT sem alvo engolia o índice único de
--     1-usuário-1-escritório), queimando o convite sem criar o vínculo.
-- (4) convites: policy usava helper sem filtro de status → membro de escritório
--     pendente/suspenso escrevia convites direto via PostgREST, contornando o gate
--     'aprovada' das actions. Agora exige escritório aprovado (minha_contabilidade()).
-- (5) convites.company_id sem validação de tenant → vazava NOME de empresa alheia
--     na página pública /convite/[token]. Trigger valida pertencimento à carteira.
-- (6) painel_contador: cert_not_after sem filtro deleted_at; guias 'erro' contavam
--     como DAS vencido; DASN usa '=' em vez de LIKE (formato confirmado: ano puro).
-- (7) gerar_honorarios_recorrentes: copia observacao do template; predicado do
--     ON CONFLICT igualado ao do índice parcial (recorrente = true).

-- ── (1) role_types: trava AdminBalu ─────────────────────────────────────────────
-- SECURITY INVOKER é OBRIGATÓRIO aqui: no PostgREST toda requisição loga como
-- 'authenticator' e faz SET ROLE para o alvo do JWT (authenticated/anon/service_role),
-- então quem distingue o chamador é current_user (o alvo do SET ROLE). Num
-- SECURITY DEFINER, current_user viraria o dono da função (postgres) e o gate nunca
-- bloquearia. Escrita de 'AdminBalu' só por service_role (admin client) ou
-- postgres/supabase_admin (Dashboard/migrations) — nunca por 'authenticated'.
CREATE OR REPLACE FUNCTION public.tg_role_types_protege_admin()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.type = 'AdminBalu'::public.user_types
     AND current_user NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'PAPEL_RESTRITO: AdminBalu só pode ser concedido pelo backend';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_role_types_protege_admin ON public.role_types;
CREATE TRIGGER tg_role_types_protege_admin
  BEFORE INSERT OR UPDATE ON public.role_types
  FOR EACH ROW EXECUTE FUNCTION public.tg_role_types_protege_admin();

-- TRUNCATE não passa por RLS; anon/authenticated jamais deveriam tê-lo.
REVOKE TRUNCATE ON public.role_types FROM anon, authenticated;

-- ── (4) convites: escrita só com escritório APROVADO ────────────────────────────
DROP POLICY IF EXISTS convites_all_membro ON public.convites;
CREATE POLICY convites_all_membro ON public.convites FOR ALL
  USING (contabilidade_id = public.minha_contabilidade())
  WITH CHECK (contabilidade_id = public.minha_contabilidade());

-- ── (5) convites.company_id precisa pertencer à carteira do escritório ──────────
CREATE OR REPLACE FUNCTION public.tg_convites_valida_company()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.company_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM companies c
    WHERE c.id = NEW.company_id AND c.contabilidade_id = NEW.contabilidade_id
  ) THEN
    RAISE EXCEPTION 'EMPRESA_FORA_DA_CARTEIRA: company_id não pertence ao escritório do convite';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_convites_valida_company ON public.convites;
CREATE TRIGGER tg_convites_valida_company
  BEFORE INSERT OR UPDATE ON public.convites
  FOR EACH ROW EXECUTE FUNCTION public.tg_convites_valida_company();

-- ── (2)+(6) painel_contador corrigida ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.painel_contador()
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
      WHERE g.company_id = c.id AND g.deleted_at IS NULL AND g.status <> 'erro'
        AND g.data_pagamento IS NULL AND g.data_vencimento < current_date),
    EXISTS (SELECT 1 FROM declaracoes_fiscais d
      WHERE d.company_id = c.id AND d.tipo = 'PGDAS-D' AND d.data_transmissao IS NOT NULL
        -- formato canônico do app: YYYYMM (guia.ts/competenciaReferenciaBrt)
        AND d.competencia_referencia = to_char(date_trunc('month', now()) - interval '1 month', 'YYYYMM')),
    EXISTS (SELECT 1 FROM declaracoes_fiscais d
      WHERE d.company_id = c.id AND d.tipo = 'DASN-SIMEI' AND d.data_transmissao IS NOT NULL
        -- formato canônico do app: ano puro 'YYYY' (impostos/actions.ts)
        AND d.competencia_referencia = (extract(year FROM now())::int - 1)::text),
    (SELECT max(a.cert_not_after) FROM arquivos_auxiliares a
      WHERE a.company_id = c.id AND a.deleted_at IS NULL),
    COALESCE((SELECT sum(h.valor) FROM honorarios h
      WHERE h.empresa_cliente_id = c.id AND h.contabilidade_id = c.contabilidade_id
        AND h.data_pagamento IS NULL AND h.data_vencimento >= current_date), 0),
    COALESCE((SELECT sum(h.valor) FROM honorarios h
      WHERE h.empresa_cliente_id = c.id AND h.contabilidade_id = c.contabilidade_id
        AND h.data_pagamento IS NULL AND h.data_vencimento < current_date), 0)
  FROM companies c
  LEFT JOIN empresas_fiscais ef ON ef.empresa_id = c.id AND ef.deleted_at IS NULL
  WHERE c.deleted_at IS NULL
    AND c.contabilidade_id = public.minha_contabilidade()
  ORDER BY c.nome NULLS LAST
$$;

-- ── (3) aceitar_convite: erros distintos p/ membro-de-outro-escritório e carteira ─
CREATE OR REPLACE FUNCTION public.aceitar_convite(p_token text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v convites%ROWTYPE; v_uid uuid := auth.uid(); v_status text; v_atual uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'NAO_AUTENTICADO'; END IF;
  SELECT * INTO v FROM convites WHERE token = p_token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONVITE_INVALIDO'; END IF;
  IF v.revogado_em IS NOT NULL THEN RAISE EXCEPTION 'CONVITE_REVOGADO'; END IF;
  IF v.expira_em IS NOT NULL AND v.expira_em < now() THEN RAISE EXCEPTION 'CONVITE_EXPIRADO'; END IF;
  IF v.usado_em IS NOT NULL THEN
    IF v.usado_por = v_uid THEN RETURN COALESCE(v.company_id, v.contabilidade_id); END IF; -- no-op idempotente
    RAISE EXCEPTION 'CONVITE_USADO';
  END IF;
  SELECT status INTO v_status FROM contabilidades WHERE id = v.contabilidade_id;
  IF v_status IS DISTINCT FROM 'aprovada' THEN RAISE EXCEPTION 'ESCRITORIO_INATIVO'; END IF;

  IF v.tipo = 'membro' THEN
    -- lançamento: 1 usuário = 1 escritório. Já membro de outro → erro explícito
    -- (antes: ON CONFLICT sem alvo engolia e queimava o convite sem vincular).
    SELECT contabilidade_id INTO v_atual FROM contabilidade_membros WHERE user_id = v_uid;
    IF v_atual IS NOT NULL AND v_atual <> v.contabilidade_id THEN
      RAISE EXCEPTION 'JA_MEMBRO_OUTRO_ESCRITORIO';
    END IF;
    INSERT INTO contabilidade_membros (contabilidade_id, user_id)
      VALUES (v.contabilidade_id, v_uid)
      ON CONFLICT (contabilidade_id, user_id) DO NOTHING;
    UPDATE convites SET usado_em = now(), usado_por = v_uid WHERE id = v.id;
    RETURN v.contabilidade_id;
  END IF;

  -- tipo 'cliente' dirigido: assume a empresa pré-cadastrada
  IF v.company_id IS NULL THEN RAISE EXCEPTION 'CONVITE_SEM_EMPRESA'; END IF;
  -- empresa saiu da carteira depois do convite → erro próprio (antes conflava com "já tem dono")
  IF NOT EXISTS (SELECT 1 FROM companies
                 WHERE id = v.company_id AND contabilidade_id = v.contabilidade_id) THEN
    RAISE EXCEPTION 'EMPRESA_FORA_DA_CARTEIRA';
  END IF;
  UPDATE companies SET user_id = v_uid
    WHERE id = v.company_id AND contabilidade_id = v.contabilidade_id AND user_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'EMPRESA_JA_TEM_DONO'; END IF;
  UPDATE convites SET usado_em = now(), usado_por = v_uid WHERE id = v.id;
  RETURN v.company_id;
END $$;

-- ── (7) gerar_honorarios_recorrentes: observacao + predicado exato do índice ─────
CREATE OR REPLACE FUNCTION public.gerar_honorarios_recorrentes()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  INSERT INTO honorarios (contabilidade_id, empresa_cliente_id, company_id, mes_referencia,
                          valor, data_vencimento, status, recorrente, recorrencia_dia, observacao)
  SELECT t.contabilidade_id, t.empresa_cliente_id, t.company_id, date_trunc('month', now())::date,
         t.valor,
         make_date(extract(year FROM now())::int, extract(month FROM now())::int, t.recorrencia_dia),
         'pendente', true, t.recorrencia_dia, t.observacao
  FROM (
    SELECT DISTINCT ON (contabilidade_id, empresa_cliente_id) *
    FROM honorarios
    WHERE recorrente = true AND contabilidade_id IS NOT NULL AND empresa_cliente_id IS NOT NULL
    ORDER BY contabilidade_id, empresa_cliente_id, mes_referencia DESC
  ) t
  JOIN contabilidades ct ON ct.id = t.contabilidade_id AND ct.status = 'aprovada'
  WHERE t.mes_referencia < date_trunc('month', now())::date
  ON CONFLICT (contabilidade_id, empresa_cliente_id, mes_referencia) WHERE recorrente = true DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
