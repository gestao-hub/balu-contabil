-- Fecha os dois consumidores de notificacao que o /code-review achou com o
-- mesmo bug que a 0065 corrigiu so pro WhatsApp: nada cancela uma
-- notificacao das_a_vencer/das_vencido quando a guia e paga, e nem toda
-- guia "em aberto" segundo materializar_obrigacoes (0045b: deleted_at IS
-- NULL AND status <> 'erro' AND data_pagamento IS NULL) era respeitada.
--
-- Tres mudancas:
-- 1. notificacoes_pendentes_whatsapp (0064/0065) ganha o mesmo guard de
--    deleted_at/status que materializar_obrigacoes ja usa pra definir
--    "guia em aberto" — hoje latente (nada seta deleted_at/status='erro'
--    em guias_fiscais ainda), mas evita a mesma classe de bug se um
--    caminho futuro passar a fazer isso.
-- 2. notificacoes_pendentes_email ganha o LEFT JOIN + filtro que faltava
--    por completo — reenviava lembrete de e-mail pra guia ja paga. Hoje o
--    Resend esta bloqueado por dominio nao verificado (nao entrega de
--    verdade), mas o defeito ja esta ativo no codigo.
-- 3. notificacoes_sino, RPC nova pro sino de notificacoes da sidebar
--    (SinoNotificacoes.tsx), que ate aqui lia `notifications` direto sem
--    join nenhum — o usuario continuava vendo "DAS a vencer" nao-lido pra
--    uma guia ja quitada, na tela, agora. SECURITY INVOKER (default, sem
--    SECURITY DEFINER): roda com o papel de quem chama, herdando as RLS
--    policies de notifications (owner_user_id = auth.uid()) e guias_fiscais
--    (user_owns_company) automaticamente — mesma superficie de acesso que
--    o .from('notifications').select() direto que ela substitui.
--
-- Achado ao provar notificacoes_sino contra o banco real (probe com
-- BEGIN/ROLLBACK, simulando RLS via SET ROLE): `g.status <> 'erro'` com
-- `g.status` NULL (LEFT JOIN sem match) avalia pra NULL em SQL — nao TRUE —
-- e uma WHERE com NULL descarta a linha, em vez de mostrar por padrao
-- quando o estado da guia e desconhecido. Trocado por `IS DISTINCT FROM`
-- (null-safe) nas tres funcoes. O padrao original em materializar_obrigacoes
-- (0045b) nao tinha esse problema porque le guias_fiscais direto (FROM, nao
-- LEFT JOIN) — g.status la nunca e NULL pra uma guia que existe.
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

CREATE OR REPLACE FUNCTION public.notificacoes_sino(p_limite int DEFAULT 15)
RETURNS TABLE (
  id uuid, titulo text, corpo text, severidade text, action_href text,
  lida_em timestamptz, created_at timestamptz, company_id uuid
)
LANGUAGE sql STABLE AS $$
  SELECT n.id, n.titulo, n.corpo, n.severidade, n.action_href,
         n.lida_em, n.created_at, n.company_id
  FROM public.notifications n
  LEFT JOIN public.guias_fiscais g
    ON g.id = (CASE WHEN n.tipo IN ('das_a_vencer', 'das_vencido') THEN n.entidade_ref END)::uuid
  WHERE n.tipo NOT IN ('das_a_vencer', 'das_vencido')
     OR (g.data_pagamento IS NULL AND g.deleted_at IS NULL AND g.status IS DISTINCT FROM 'erro')
  ORDER BY n.created_at DESC
  LIMIT p_limite;
$$;

REVOKE ALL ON FUNCTION public.notificacoes_sino(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notificacoes_sino(int) TO authenticated;
