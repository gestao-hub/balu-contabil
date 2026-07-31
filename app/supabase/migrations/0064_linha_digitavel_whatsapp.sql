-- Linha digitavel do DAS na mensagem de WhatsApp de vencimento.
--
-- O item original do PRD Master ("Pix Copia-e-Cola via SERPRO") foi
-- investigado e refutado no brainstorming desta sessao — a SERPRO nao
-- devolve Pix para DAS em nenhum servico identificado (ver
-- docs/superpowers/specs/2026-07-31-linha-digitavel-whatsapp-design.md).
-- O que existe de verdade e guias_fiscais.linha_digitavel, ja persistida
-- desde a geracao da guia (gerarDasMeiAction/gerarDasSimplesAction).
--
-- A notificacao das_a_vencer/das_vencido so e materializada quando ja existe
-- uma guia (materializar_obrigacoes, 0045b: entidade_ref = gid::text da
-- guia) — entao o join abaixo nunca precisa gerar nada, so ler o que ja
-- esta la.
--
-- O CASE antes do ::uuid restringe a tentativa de cast aos dois tipos que
-- sabemos que gravam um entidade_ref de guia real (materializar_obrigacoes
-- e o unico writer desses tipos) — para qualquer outro tipo de notificacao,
-- o CASE devolve NULL e NULL::uuid nunca lanca.
--
-- DESVIO do plano: CREATE OR REPLACE FUNCTION falha com "cannot change
-- return type of existing function" (42P13) quando o RETURNS TABLE ganha
-- uma coluna nova — Postgres trata isso como troca do tipo composto de
-- retorno, não como substituição compatível. Confirmado ao aplicar contra o
-- banco de produção nesta sessão. DROP FUNCTION antes do CREATE resolve;
-- os GRANT/REVOKE abaixo recriam os privilégios do zero de qualquer forma.
DROP FUNCTION IF EXISTS public.notificacoes_pendentes_whatsapp(int);

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
  ORDER BY n.created_at
  LIMIT p_limite;
$$;

REVOKE ALL ON FUNCTION public.notificacoes_pendentes_whatsapp(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notificacoes_pendentes_whatsapp(int) TO service_role;
