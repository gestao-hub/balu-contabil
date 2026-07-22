-- 0034: RPCs do Bloco A. painel_contador retorna FATOS CRUS; a classificação do semáforo
-- vive em src/lib/fiscal/semaforo.ts (testável por norma no Vitest).

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
    AND c.contabilidade_id = public.minha_contabilidade()
  ORDER BY c.nome NULLS LAST
$$;
REVOKE ALL ON FUNCTION public.painel_contador() FROM public;
GRANT EXECUTE ON FUNCTION public.painel_contador() TO authenticated;

CREATE OR REPLACE FUNCTION public.resumo_escritorio()
RETURNS TABLE (total_clientes int, honorarios_aberto numeric, honorarios_atrasado numeric)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT
    (SELECT count(*)::int FROM companies
      WHERE contabilidade_id = public.minha_contabilidade() AND deleted_at IS NULL),
    COALESCE((SELECT sum(valor) FROM honorarios
      WHERE contabilidade_id = public.minha_contabilidade()
        AND data_pagamento IS NULL AND data_vencimento >= current_date), 0),
    COALESCE((SELECT sum(valor) FROM honorarios
      WHERE contabilidade_id = public.minha_contabilidade()
        AND data_pagamento IS NULL AND data_vencimento < current_date), 0)
$$;
REVOKE ALL ON FUNCTION public.resumo_escritorio() FROM public;
GRANT EXECUTE ON FUNCTION public.resumo_escritorio() TO authenticated;

-- Aceite de convite DIRIGIDO (cliente com empresa pré-cadastrada, ou membro).
-- Transacional (função = transação), idempotente no re-clique do mesmo usuário.
CREATE OR REPLACE FUNCTION public.aceitar_convite(p_token text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v convites%ROWTYPE; v_uid uuid := auth.uid(); v_status text;
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
    INSERT INTO contabilidade_membros (contabilidade_id, user_id)
      VALUES (v.contabilidade_id, v_uid) ON CONFLICT DO NOTHING;
    UPDATE convites SET usado_em = now(), usado_por = v_uid WHERE id = v.id;
    RETURN v.contabilidade_id;
  END IF;

  -- tipo 'cliente' dirigido: assume a empresa pré-cadastrada
  IF v.company_id IS NULL THEN RAISE EXCEPTION 'CONVITE_SEM_EMPRESA'; END IF;
  UPDATE companies SET user_id = v_uid
    WHERE id = v.company_id AND contabilidade_id = v.contabilidade_id AND user_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'EMPRESA_JA_TEM_DONO'; END IF;
  UPDATE convites SET usado_em = now(), usado_por = v_uid WHERE id = v.id;
  RETURN v.company_id;
END $$;
REVOKE ALL ON FUNCTION public.aceitar_convite(text) FROM public;
GRANT EXECUTE ON FUNCTION public.aceitar_convite(text) TO authenticated;

-- Vínculo pelo LINK do escritório (empresa existente do próprio usuário)
CREATE OR REPLACE FUNCTION public.vincular_empresa_por_link(p_token text, p_company_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v convites%ROWTYPE; v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'NAO_AUTENTICADO'; END IF;
  SELECT * INTO v FROM convites WHERE token = p_token
    AND tipo = 'cliente' AND email IS NULL AND company_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONVITE_INVALIDO'; END IF;
  IF v.revogado_em IS NOT NULL THEN RAISE EXCEPTION 'CONVITE_REVOGADO'; END IF;
  IF (SELECT status FROM contabilidades WHERE id = v.contabilidade_id) IS DISTINCT FROM 'aprovada'
    THEN RAISE EXCEPTION 'ESCRITORIO_INATIVO'; END IF;
  UPDATE companies SET contabilidade_id = v.contabilidade_id
    WHERE id = p_company_id AND user_id = v_uid AND contabilidade_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'EMPRESA_INDISPONIVEL'; END IF; -- não é sua ou já vinculada
END $$;
REVOKE ALL ON FUNCTION public.vincular_empresa_por_link(text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.vincular_empresa_por_link(text, uuid) TO authenticated;

-- Cron mensal: materializa a competência corrente dos honorários recorrentes.
-- Idempotente pelo índice honorarios_recorrencia_unique. Roda com service_role (sem grant p/ authenticated).
CREATE OR REPLACE FUNCTION public.gerar_honorarios_recorrentes()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  INSERT INTO honorarios (contabilidade_id, empresa_cliente_id, company_id, mes_referencia,
                          valor, data_vencimento, status, recorrente, recorrencia_dia)
  SELECT t.contabilidade_id, t.empresa_cliente_id, t.company_id, date_trunc('month', now())::date,
         t.valor,
         make_date(extract(year FROM now())::int, extract(month FROM now())::int, t.recorrencia_dia),
         'pendente', true, t.recorrencia_dia
  FROM (
    SELECT DISTINCT ON (contabilidade_id, empresa_cliente_id) *
    FROM honorarios
    WHERE recorrente = true AND contabilidade_id IS NOT NULL AND empresa_cliente_id IS NOT NULL
    ORDER BY contabilidade_id, empresa_cliente_id, mes_referencia DESC
  ) t
  JOIN contabilidades ct ON ct.id = t.contabilidade_id AND ct.status = 'aprovada'
  WHERE t.mes_referencia < date_trunc('month', now())::date
  ON CONFLICT (contabilidade_id, empresa_cliente_id, mes_referencia) WHERE recorrente DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.gerar_honorarios_recorrentes() FROM public;
