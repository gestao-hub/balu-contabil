-- Fecha as duas pendencias que sobraram do /code-review da sessao 21:
--
-- (1) A recomendacao arquitetural: resolver a notificacao NO PONTO DE
--     ESCRITA em vez de filtrar em cada RPC de leitura. As 0065/0066
--     filtram whatsapp/email/sino, mas todo consumidor NOVO nasce com o
--     mesmo bug ate alguem lembrar de repetir o LEFT JOIN. Agora
--     marcarGuiaPagaAction chama `resolver_notificacoes_guia`, que carimba
--     `notifications.resolvida_em` das notificacoes daquela guia — um
--     estado explicito na linha, que qualquer leitor futuro respeita com um
--     `resolvida_em IS NULL` trivial.
--
-- (2) A pagina /notificacoes (nao so o sino) lia `notifications` direto,
--     sem join — mostrava "DAS a vencer" nao-lido de guia ja quitada. Ela
--     passa a usar `notificacoes_sino`, que ganha `norma` no retorno (a
--     pagina mostra a norma, o sino nao). Trocar o retorno exige DROP: o
--     CREATE OR REPLACE do Postgres nao muda a assinatura de saida.
--
-- Os filtros de leitura das 0065/0066 FICAM (defesa em profundidade): eles
-- cobrem a guia paga por um caminho que nao passe pela action — importacao,
-- SQL manual, conciliacao futura — enquanto `resolvida_em` cobre qualquer
-- consumidor novo que esqueca o join.

-- ── 1. Estado explicito na linha ────────────────────────────────────────
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS resolvida_em timestamptz;

COMMENT ON COLUMN public.notifications.resolvida_em IS
  'Momento em que o fato que gerou o aviso deixou de valer (ex.: a guia do das_a_vencer foi paga). Carimbado no ponto de escrita; todo leitor deve filtrar resolvida_em IS NULL.';

-- Backfill: o que ja esta resolvido no mundo passa a estar resolvido na
-- linha. Mesma definicao de "guia em aberto" de materializar_obrigacoes
-- (0045b) e das RPCs da 0066.
-- O cast do entidade_ref fica dentro de um CASE por tipo: entidade_ref
-- guarda texto livre para outros tipos de aviso (cert_a_vencer etc.) e um
-- `::uuid` solto quebraria a migration inteira com "invalid input syntax"
-- se o planner avaliasse o cast antes do filtro de tipo.
UPDATE public.notifications n
SET resolvida_em = now()
FROM public.guias_fiscais g
WHERE n.resolvida_em IS NULL
  AND g.id = (CASE WHEN n.tipo IN ('das_a_vencer', 'das_vencido') THEN n.entidade_ref END)::uuid
  AND (g.data_pagamento IS NOT NULL OR g.deleted_at IS NOT NULL OR g.status = 'erro');

CREATE INDEX IF NOT EXISTS notifications_owner_naoresolvida_idx
  ON public.notifications(owner_user_id) WHERE resolvida_em IS NULL;

-- ── 2. RPC do ponto de escrita ──────────────────────────────────────────
-- SECURITY DEFINER porque a notificacao pertence ao DONO da empresa
-- (owner_user_id), que nao e necessariamente quem clicou "marcar como paga"
-- num cenario multi-usuario; a policy notifications_update_own so deixaria
-- a propria linha. A autorizacao aqui e a mesma da action: quem chama tem
-- que ser dono da empresa da guia (`user_owns_company`), senao nao resolve
-- nada. Sem isso, um autenticado qualquer calaria avisos alheios sabendo
-- so o uuid da guia.
CREATE OR REPLACE FUNCTION public.resolver_notificacoes_guia(p_guia_id uuid)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_company uuid;
  v_n int;
BEGIN
  SELECT company_id INTO v_company FROM public.guias_fiscais WHERE id = p_guia_id;
  IF v_company IS NULL THEN RETURN 0; END IF;
  IF NOT public.user_owns_company(v_company) THEN RETURN 0; END IF;

  UPDATE public.notifications
  SET resolvida_em = now(),
      lida_em = COALESCE(lida_em, now())
  WHERE resolvida_em IS NULL
    AND tipo IN ('das_a_vencer', 'das_vencido')
    AND entidade_ref = p_guia_id::text;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.resolver_notificacoes_guia(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolver_notificacoes_guia(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolver_notificacoes_guia(uuid) TO service_role;

-- ── 3. Leitores respeitam resolvida_em ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.notificacoes_pendentes_whatsapp(p_limite int DEFAULT 50)
RETURNS TABLE (
  id uuid, owner_user_id uuid, tipo text, titulo text, corpo text,
  action_href text, whatsapp_numero text, linha_digitavel text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT n.id, n.owner_user_id, n.tipo, n.titulo, n.corpo, n.action_href,
         p.whatsapp_numero, g.linha_digitavel
  FROM public.notifications n
  JOIN public.profiles p ON p.user_id = n.owner_user_id
  LEFT JOIN public.guias_fiscais g
    ON g.id = (CASE WHEN n.tipo IN ('das_a_vencer', 'das_vencido') THEN n.entidade_ref END)::uuid
  WHERE n.enviada_whatsapp_em IS NULL
    AND n.resolvida_em IS NULL
    AND n.tipo <> 'whatsapp_escalado'
    AND p.whatsapp_numero IS NOT NULL
    AND p.whatsapp_habilitado_em IS NOT NULL
    AND (
      n.tipo NOT IN ('das_a_vencer', 'das_vencido')
      OR (g.data_pagamento IS NULL AND g.deleted_at IS NULL AND g.status IS DISTINCT FROM 'erro')
    )
  ORDER BY n.created_at
  LIMIT p_limite;
$$;

REVOKE ALL ON FUNCTION public.notificacoes_pendentes_whatsapp(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notificacoes_pendentes_whatsapp(int) TO service_role;

CREATE OR REPLACE FUNCTION public.notificacoes_pendentes_email(p_limite int DEFAULT 200)
RETURNS TABLE (
  id uuid, owner_user_id uuid, tipo text, titulo text, corpo text, norma text,
  action_href text, destinatario_email text, escritorio_nome text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT n.id, n.owner_user_id, n.tipo, n.titulo, n.corpo, n.norma, n.action_href,
         u.email::text AS destinatario_email,
         COALESCE(ct.email_remetente_nome, ct.nome) AS escritorio_nome
  FROM public.notifications n
  JOIN auth.users u ON u.id = n.owner_user_id
  LEFT JOIN public.companies c ON c.id = n.company_id
  LEFT JOIN public.contabilidades ct ON ct.id = c.contabilidade_id
  LEFT JOIN public.notification_preferences p
    ON p.owner_user_id = n.owner_user_id AND p.tipo = n.tipo
  LEFT JOIN public.guias_fiscais g
    ON g.id = (CASE WHEN n.tipo IN ('das_a_vencer', 'das_vencido') THEN n.entidade_ref END)::uuid
  WHERE n.enviada_email_em IS NULL
    AND n.resolvida_em IS NULL
    AND u.email IS NOT NULL
    AND COALESCE(p.email_enabled, true) = true
    AND (
      n.tipo NOT IN ('das_a_vencer', 'das_vencido')
      OR (g.data_pagamento IS NULL AND g.deleted_at IS NULL AND g.status IS DISTINCT FROM 'erro')
    )
  ORDER BY n.created_at
  LIMIT p_limite;
$$;

REVOKE ALL ON FUNCTION public.notificacoes_pendentes_email(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notificacoes_pendentes_email(int) TO service_role;

-- `norma` entra no retorno pra pagina /notificacoes (que mostra a norma)
-- poder usar a mesma RPC do sino. DROP obrigatorio: mudanca de assinatura.
DROP FUNCTION IF EXISTS public.notificacoes_sino(int);
CREATE FUNCTION public.notificacoes_sino(p_limite int DEFAULT 15)
RETURNS TABLE (
  id uuid, titulo text, corpo text, norma text, severidade text, action_href text,
  lida_em timestamptz, created_at timestamptz, company_id uuid
)
LANGUAGE sql STABLE AS $$
  SELECT n.id, n.titulo, n.corpo, n.norma, n.severidade, n.action_href,
         n.lida_em, n.created_at, n.company_id
  FROM public.notifications n
  LEFT JOIN public.guias_fiscais g
    ON g.id = (CASE WHEN n.tipo IN ('das_a_vencer', 'das_vencido') THEN n.entidade_ref END)::uuid
  WHERE n.resolvida_em IS NULL
    AND (
      n.tipo NOT IN ('das_a_vencer', 'das_vencido')
      OR (g.data_pagamento IS NULL AND g.deleted_at IS NULL AND g.status IS DISTINCT FROM 'erro')
    )
  ORDER BY n.created_at DESC
  LIMIT p_limite;
$$;

REVOKE ALL ON FUNCTION public.notificacoes_sino(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notificacoes_sino(int) TO authenticated;
