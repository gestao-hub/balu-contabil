-- 0047_dasn_janela_janeiro.sql — corrige a janela do aviso dasn_pendente.
--
-- MOTIVO: a 0045b abria a janela em MARCO (`BETWEEN 3 AND 6`), mas o comentario da
-- propria migration dizia "(jan-jun)" e o Master PRD (Bloco 3) pede aviso "a partir
-- de janeiro". O MEI perdia 2 meses de antecedencia num prazo que vence em 31/05 e
-- tem multa minima de R$ 25 (Res. CGSN 140/2018, art. 111). Comprovado em smoke:
-- com p_hoje = 2026-02-15 a RPC gerava 0 avisos.
--
-- MUDANCA: unica alteracao e `BETWEEN 3 AND 6` -> `BETWEEN 1 AND 6` no bloco DASN.
-- O restante do corpo e identico a 0045b (CREATE OR REPLACE exige a funcao inteira).
-- Severidade segue `month >= 6 -> danger`, senao warning; chave ganha os buckets M1/M2.

CREATE OR REPLACE FUNCTION public.materializar_obrigacoes(
  p_hoje date DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total integer := 0;
  v_n     integer;
BEGIN
  -- ── DAS a vencer (buckets 7/3/1) e vencido ────────────────────────────────
  WITH guias AS (
    SELECT g.id, c.user_id AS owner_user_id, c.id AS company_id,
           g.data_vencimento, (g.data_vencimento - p_hoje) AS dias
    FROM public.guias_fiscais g
    JOIN public.companies c ON c.id = g.company_id
    WHERE g.deleted_at IS NULL AND g.status <> 'erro' AND g.data_pagamento IS NULL
      AND g.data_vencimento IS NOT NULL
      AND c.deleted_at IS NULL AND c.user_id IS NOT NULL
  ),
  cand AS (
    SELECT owner_user_id, company_id, id AS gid, dias, data_vencimento,
      CASE WHEN dias < 0 THEN 'das_vencido' ELSE 'das_a_vencer' END AS tipo,
      CASE WHEN dias < 0 THEN 'V'
           WHEN dias <= 1 THEN 'D1' WHEN dias <= 3 THEN 'D3'
           WHEN dias <= 7 THEN 'D7' ELSE NULL END AS bucket
    FROM guias
  ),
  ins AS (
    INSERT INTO public.notifications
      (owner_user_id, company_id, tipo, severidade, titulo, corpo, norma, entidade_ref, action_href, chave, agendada_para)
    SELECT owner_user_id, company_id, tipo,
      CASE WHEN tipo = 'das_vencido' THEN 'danger' ELSE 'warning' END,
      CASE WHEN tipo = 'das_vencido' THEN 'Você tem DAS vencido'
           ELSE 'Seu DAS está próximo do vencimento' END,
      CASE WHEN tipo = 'das_vencido'
           THEN 'Há guia(s) de DAS vencida(s) sem pagamento registrado. Pague para evitar juros e multa.'
           WHEN dias <= 0 THEN 'Seu DAS vence hoje. Pague pelo app para não atrasar.'
           ELSE 'Seu DAS vence em ' || dias || ' dia(s). Pague pelo app para ficar em dia.' END,
      'LC 123/2006, art. 21', gid::text, '/impostos',
      tipo || ':' || gid::text || ':' || bucket, data_vencimento
    FROM cand WHERE bucket IS NOT NULL
    ON CONFLICT (owner_user_id, chave) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM ins;  v_total := v_total + v_n;

  -- ── Certificado A1 (< 30 dias => a_vencer; < 0 => vencido) ─────────────────
  WITH certs AS (
    SELECT c.user_id AS owner_user_id, c.id AS company_id, max(a.cert_not_after) AS not_after
    FROM public.companies c
    JOIN public.arquivos_auxiliares a ON a.company_id = c.id AND a.deleted_at IS NULL
    WHERE c.deleted_at IS NULL AND c.user_id IS NOT NULL AND a.cert_not_after IS NOT NULL
    GROUP BY c.user_id, c.id
  ),
  cand AS (
    -- cert_not_after em BRT p/ alinhar com p_hoje (evita off-by-one perto da meia-noite)
    SELECT owner_user_id, company_id, not_after,
           ((not_after AT TIME ZONE 'America/Sao_Paulo')::date - p_hoje) AS dias FROM certs
  ),
  ins AS (
    INSERT INTO public.notifications
      (owner_user_id, company_id, tipo, severidade, titulo, corpo, norma, action_href, chave, agendada_para)
    SELECT owner_user_id, company_id,
      CASE WHEN dias < 0 THEN 'cert_vencido' ELSE 'cert_a_vencer' END,
      CASE WHEN dias < 0 THEN 'danger' ELSE 'warning' END,
      CASE WHEN dias < 0 THEN 'Certificado A1 vencido' ELSE 'Certificado A1 vencendo' END,
      CASE WHEN dias < 0 THEN 'Seu certificado digital A1 venceu — a emissão de notas fica bloqueada até você renovar.'
           ELSE 'Seu certificado digital A1 vence em ' || dias || ' dia(s). Renove para não parar a emissão.' END,
      'ICP-Brasil (MP 2.200-2/2001)', '/configuracoes',
      (CASE WHEN dias < 0 THEN 'cert_vencido' ELSE 'cert_a_vencer' END) || ':' || company_id::text || ':' ||
        (CASE WHEN dias < 0 THEN 'V' WHEN dias <= 7 THEN 'D7' WHEN dias <= 15 THEN 'D15' ELSE 'D30' END),
      (not_after AT TIME ZONE 'America/Sao_Paulo')::date
    FROM cand WHERE dias < 30
    ON CONFLICT (owner_user_id, chave) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM ins;  v_total := v_total + v_n;

  -- ── PGDAS-D do mês anterior (Simples: code 1/2) não transmitida ────────────
  WITH base AS (
    SELECT c.user_id AS owner_user_id, c.id AS company_id, ef."Code_regime_tributario" AS code,
           to_char((p_hoje - interval '1 month'), 'YYYYMM') AS comp
    FROM public.companies c
    JOIN public.empresas_fiscais ef ON ef.empresa_id = c.id AND ef.deleted_at IS NULL
    WHERE c.deleted_at IS NULL AND c.user_id IS NOT NULL
  ),
  pend AS (
    SELECT owner_user_id, company_id, comp FROM base b
    WHERE b.code IN ('1','2')  -- Code_regime_tributario e varchar (schema real), nao inteiro
      AND NOT EXISTS (SELECT 1 FROM public.declaracoes_fiscais d
        WHERE d.company_id = b.company_id AND d.tipo = 'PGDAS-D'
          AND d.data_transmissao IS NOT NULL AND d.competencia_referencia = b.comp)
  ),
  ins AS (
    INSERT INTO public.notifications
      (owner_user_id, company_id, tipo, severidade, titulo, corpo, norma, action_href, chave, agendada_para)
    SELECT owner_user_id, company_id, 'pgdas_pendente',
      CASE WHEN extract(day FROM p_hoje) > 20 THEN 'danger' ELSE 'warning' END,
      'Declaração mensal (PGDAS-D) pendente',
      'A declaração do mês ' || comp || ' ainda não foi transmitida. O prazo é o dia 20.',
      'Res. CGSN 140/2018, art. 38', '/impostos',
      'pgdas_pendente:' || company_id::text || ':' || comp || ':' || (CASE WHEN extract(day FROM p_hoje) > 20 THEN 'POS' ELSE 'PRE' END),
      make_date(substring(comp,1,4)::int, substring(comp,5,2)::int, 20)
    FROM pend
    ON CONFLICT (owner_user_id, chave) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM ins;  v_total := v_total + v_n;

  -- ── DASN-SIMEI (MEI: code 4) do ano anterior não transmitida (JANEIRO–junho) ─
  -- 0047: janela era `BETWEEN 3 AND 6`; agora abre em janeiro, como manda o PRD.
  WITH base AS (
    SELECT c.user_id AS owner_user_id, c.id AS company_id, ef."Code_regime_tributario" AS code,
           (extract(year FROM p_hoje)::int - 1) AS ano
    FROM public.companies c
    JOIN public.empresas_fiscais ef ON ef.empresa_id = c.id AND ef.deleted_at IS NULL
    WHERE c.deleted_at IS NULL AND c.user_id IS NOT NULL
  ),
  pend AS (
    SELECT owner_user_id, company_id, ano FROM base b
    WHERE b.code = '4' AND extract(month FROM p_hoje) BETWEEN 1 AND 6  -- code e varchar
      AND NOT EXISTS (SELECT 1 FROM public.declaracoes_fiscais d
        WHERE d.company_id = b.company_id AND d.tipo = 'DASN-SIMEI'
          AND d.data_transmissao IS NOT NULL AND d.competencia_referencia = b.ano::text)
  ),
  ins AS (
    INSERT INTO public.notifications
      (owner_user_id, company_id, tipo, severidade, titulo, corpo, norma, action_href, chave, agendada_para)
    SELECT owner_user_id, company_id, 'dasn_pendente',
      CASE WHEN extract(month FROM p_hoje) >= 6 THEN 'danger' ELSE 'warning' END,
      'Declaração anual do MEI (DASN-SIMEI) pendente',
      'A DASN-SIMEI de ' || ano || ' ainda não foi entregue. O prazo é 31/05.',
      'Res. CGSN 140/2018, art. 109', '/impostos',
      'dasn_pendente:' || company_id::text || ':' || ano::text || ':' ||
        (CASE WHEN extract(month FROM p_hoje) >= 6 THEN 'V' ELSE 'M' || extract(month FROM p_hoje)::text END),
      make_date(extract(year FROM p_hoje)::int, 5, 31)
    FROM pend
    ON CONFLICT (owner_user_id, chave) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM ins;  v_total := v_total + v_n;

  -- ── Honorário a vencer (v2 do contador; destinatário = dono da empresa) ────
  WITH hon AS (
    SELECT h.id, c.user_id AS owner_user_id, c.id AS company_id,
           h.data_vencimento, (h.data_vencimento - p_hoje) AS dias
    FROM public.honorarios h
    JOIN public.companies c ON c.id = h.empresa_cliente_id
    WHERE h.data_pagamento IS NULL AND h.data_vencimento IS NOT NULL
      AND c.deleted_at IS NULL AND c.user_id IS NOT NULL
  ),
  cand AS (
    SELECT owner_user_id, company_id, id AS hid, dias, data_vencimento,
      CASE WHEN dias <= 0 THEN 'D0' WHEN dias <= 3 THEN 'D3' ELSE NULL END AS bucket
    FROM hon WHERE dias >= 0 AND dias <= 3
  ),
  ins AS (
    INSERT INTO public.notifications
      (owner_user_id, company_id, tipo, severidade, titulo, corpo, action_href, chave, agendada_para)
    SELECT owner_user_id, company_id, 'honorario_a_vencer', 'info',
      'Honorário a vencer',
      CASE WHEN dias <= 0 THEN 'Você tem um honorário do seu contador vencendo hoje.'
           ELSE 'Você tem um honorário do seu contador vencendo em ' || dias || ' dia(s).' END,
      '/honorarios', 'honorario_a_vencer:' || hid::text || ':' || bucket, data_vencimento
    FROM cand WHERE bucket IS NOT NULL
    ON CONFLICT (owner_user_id, chave) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM ins;  v_total := v_total + v_n;

  -- TODO(v2 do motor): DEFIS (depende do fluxo assistido do Bloco 3) e
  -- limite_faturamento (depende de confirmar o schema de parametros_fiscais /
  -- reusar getLimitesFiscais). Adicionar blocos análogos quando o upstream existir.

  RETURN v_total;
END; $$;

-- CREATE OR REPLACE preserva a ACL, mas reafirmamos o padrao do 0034/0045b:
-- so o cron (service_role) executa; PUBLIC nao.
REVOKE ALL ON FUNCTION public.materializar_obrigacoes(date) FROM public;
GRANT EXECUTE ON FUNCTION public.materializar_obrigacoes(date) TO service_role;
