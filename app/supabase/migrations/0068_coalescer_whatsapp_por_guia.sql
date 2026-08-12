-- Rajada de WhatsApp duplicado (pendencia registrada na sessao 21).
--
-- Com UAZAPI_TOKEN nao configurado, enviarMensagem e no-op e nada carimba
-- enviada_whatsapp_em: o backlog D7/D3/D1/vencido da MESMA guia se acumula.
-- No dia em que a instancia for provisionada, o primeiro cron dispara as
-- quatro de uma vez — quatro mensagens quase identicas, com a mesma linha
-- digitavel, em segundos. Do lado do cliente isso le como spam.
--
-- Decisao: coalescer por guia. So a notificacao MAIS RECENTE de cada guia
-- e enviada (ela ja carrega o estado atual — "vence em 1 dia" ou "venceu"
-- torna "vence em 7 dias" obsoleto); as anteriores sao SUPRIMIDAS, nao
-- marcadas como enviadas. Coluna propria (`suprimida_whatsapp_em`) porque
-- gravar enviada_whatsapp_em numa mensagem que nunca saiu seria mentira no
-- dado — e um dia alguem vai auditar "o que foi enviado a este cliente".
--
-- Vale so pro canal WhatsApp: e-mail e sino nao tem o mesmo problema (o
-- e-mail ja saiu na epoca certa; o sino mostra a lista inteira de propostio).

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS suprimida_whatsapp_em timestamptz;

COMMENT ON COLUMN public.notifications.suprimida_whatsapp_em IS
  'Nao foi enviada por WhatsApp porque um aviso mais recente da MESMA guia a tornou obsoleta (coalescencia). Diferente de enviada_whatsapp_em: nada saiu para o cliente.';

-- Marca como suprimida toda notificacao de guia que NAO seja a mais recente
-- daquela guia entre as ainda pendentes. Idempotente: rodar duas vezes nao
-- muda nada, porque as suprimidas saem do conjunto elegivel.
--
-- O agrupamento e por (owner_user_id, entidade_ref) e so para os tipos de
-- guia — dois avisos de guias diferentes, ou de tipos sem entidade_ref de
-- guia (cert_a_vencer, honorario_a_vencer...), nunca se coalescem entre si.
CREATE OR REPLACE FUNCTION public.suprimir_whatsapp_superadas()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n int;
BEGIN
  WITH elegiveis AS (
    SELECT n.id, n.owner_user_id, n.entidade_ref, n.created_at,
           row_number() OVER (
             PARTITION BY n.owner_user_id, n.entidade_ref
             ORDER BY n.created_at DESC, n.id DESC
           ) AS pos
    FROM public.notifications n
    WHERE n.enviada_whatsapp_em IS NULL
      AND n.suprimida_whatsapp_em IS NULL
      AND n.resolvida_em IS NULL
      AND n.tipo IN ('das_a_vencer', 'das_vencido')
      AND n.entidade_ref IS NOT NULL
  )
  UPDATE public.notifications n
  SET suprimida_whatsapp_em = now()
  FROM elegiveis e
  WHERE n.id = e.id AND e.pos > 1;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.suprimir_whatsapp_superadas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.suprimir_whatsapp_superadas() TO service_role;

-- O leitor passa a ignorar as suprimidas. Mantidos os filtros da 0066/0067
-- (guia paga/apagada/erro e resolvida_em) — defesa em profundidade.
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
    AND n.suprimida_whatsapp_em IS NULL
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
