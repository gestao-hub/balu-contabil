-- Nao reenviar aviso de vencimento de WhatsApp para uma guia ja paga.
--
-- Achado numa revisao adversarial holistica, depois das duas tasks da
-- feature "linha digitavel no WhatsApp" (0064) ja terem passado por revisao
-- de spec+qualidade individualmente: nada no sistema cancela ou marca como
-- resolvida uma notificacao das_a_vencer/das_vencido pendente quando a guia
-- referenciada e paga. marcarGuiaPagaAction (impostos/actions.ts) so faz
-- UPDATE guias_fiscais SET status='paga', data_pagamento=...  — nunca toca
-- em notifications. Confirmado tambem que nenhuma migration cria trigger
-- ou funcao que faca essa ponte.
--
-- Antes da 0064 isso ja era um bug latente (reenviar um lembrete generico
-- pra uma guia paga e feio, mas inofensivo). A 0064 piora o cenario: agora
-- a mensagem carrega a linha_digitavel — um codigo de pagamento acionavel,
-- nao so um aviso. Hoje em producao o UAZAPI_TOKEN nao esta configurado
-- (todo envio de WhatsApp e no-op), entao o backlog de notificacoes
-- pendentes fica se acumulando silenciosamente — no dia em que a instancia
-- for provisionada, esse backlog dispararia em massa, incluindo codigo de
-- pagamento pra guias ja quitadas, sem revalidar nada.
--
-- Fix minimo e cirurgico: excluir da fila de WhatsApp qualquer notificacao
-- das_a_vencer/das_vencido cuja guia ja tem data_pagamento preenchida.
-- Mesmo predicado (`data_pagamento IS NULL`) que materializar_obrigacoes ja
-- usa pra decidir quais guias contam como "em aberto" (0045b, CTE `guias`)
-- — nao e um criterio novo, e o mesmo criterio de sempre aplicado no ponto
-- que faltava.
--
-- Nao mexe em notificacoes_pendentes_email (mesma causa-raiz, mas fora do
-- escopo desta feature — registrar como pendencia separada, nao bloquear
-- este push por causa dela).
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
    AND (n.tipo NOT IN ('das_a_vencer', 'das_vencido') OR g.data_pagamento IS NULL)
  ORDER BY n.created_at
  LIMIT p_limite;
$$;

REVOKE ALL ON FUNCTION public.notificacoes_pendentes_whatsapp(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notificacoes_pendentes_whatsapp(int) TO service_role;
