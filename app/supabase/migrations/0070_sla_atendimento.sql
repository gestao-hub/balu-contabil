-- Bloco 7, Task 5 — SLA de atendimento: a escalada do 6B vira fila com dono,
-- relogio e alerta.
-- Spec: docs/superpowers/specs/2026-08-12-bloco-7-dominio-sla-conciliacao-design.md §2.4
--
-- A `whatsapp_atendimentos` nasceu na 0061 como "service_role apenas, sem
-- tela nesta rodada". Esta e a rodada em que ela ganha tela: sem um lugar
-- pra marcar "atendido", o alerta de SLA dispararia pra sempre sem ter como
-- ser fechado — e um alarme que nao se desliga e pior que nenhum alarme.

ALTER TABLE public.whatsapp_atendimentos
  ADD COLUMN IF NOT EXISTS contabilidade_id  uuid REFERENCES public.contabilidades(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS atendido_em       timestamptz,
  ADD COLUMN IF NOT EXISTS atendido_por      uuid,
  ADD COLUMN IF NOT EXISTS sla_alertado_em   timestamptz;

-- FK de auditoria pra `atendido_por`, mesmo padrao de audit_log.actor_user_id
-- (0038) e do proprio profile_user_id desta tabela: referencia o usuario sem
-- travar a linha se ele for apagado.
ALTER TABLE public.whatsapp_atendimentos DROP CONSTRAINT IF EXISTS whatsapp_atendimentos_atendido_por_fkey;
ALTER TABLE public.whatsapp_atendimentos
  ADD CONSTRAINT whatsapp_atendimentos_atendido_por_fkey
  FOREIGN KEY (atendido_por) REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.whatsapp_atendimentos.contabilidade_id IS
  'Escritorio dono da fila. Preenchido na escalada, via profile -> company -> contabilidade.';
COMMENT ON COLUMN public.whatsapp_atendimentos.atendido_em IS
  'Para o relogio do SLA: marca quando alguem do escritorio assumiu a escalada.';
COMMENT ON COLUMN public.whatsapp_atendimentos.sla_alertado_em IS
  'Idempotencia do alerta de SLA estourado — mesmo espirito de enviada_email_em.';

-- Fila: as nao atendidas de um escritorio, mais antiga primeiro.
CREATE INDEX IF NOT EXISTS whatsapp_atendimentos_fila_idx
  ON public.whatsapp_atendimentos (contabilidade_id, created_at)
  WHERE atendido_em IS NULL;

-- Backfill do que ja existe: sem isto as escaladas antigas ficariam invisiveis
-- na tela nova (contabilidade_id NULL nao casa com policy nenhuma).
UPDATE public.whatsapp_atendimentos a
SET contabilidade_id = c.contabilidade_id
FROM public.profiles p
JOIN public.companies c ON c.id = p.current_company
WHERE a.contabilidade_id IS NULL
  AND p.user_id = a.profile_user_id
  AND c.contabilidade_id IS NOT NULL;

-- ── RLS: a fila e do escritorio ───────────────────────────────────────────
--
-- A tabela segue sem grant nenhum pra `anon` (a 0061 fez REVOKE ALL explicito
-- por causa do ALTER DEFAULT PRIVILEGES do Supabase). Aqui abrimos SELECT e
-- UPDATE apenas pra membro do escritorio dono da linha, via o helper
-- SECURITY DEFINER da 0035.
--
-- O CLIENTE FINAL nao le esta tabela: o conteudo e a conversa dele, mas a
-- tela e do escritorio, e o dado aqui inclui o rascunho de resposta da IA e
-- o estado de atendimento — informacao operacional, nao do cliente.
GRANT SELECT, UPDATE ON public.whatsapp_atendimentos TO authenticated;

DROP POLICY IF EXISTS whatsapp_atendimentos_select_escritorio ON public.whatsapp_atendimentos;
CREATE POLICY whatsapp_atendimentos_select_escritorio ON public.whatsapp_atendimentos
  FOR SELECT USING (contabilidade_id = public.minha_contabilidade_membro());

-- UPDATE so pra marcar atendimento. O WITH CHECK repete a mesma condicao pra
-- ninguem "mover" uma escalada pra outro escritorio no proprio update.
DROP POLICY IF EXISTS whatsapp_atendimentos_update_escritorio ON public.whatsapp_atendimentos;
CREATE POLICY whatsapp_atendimentos_update_escritorio ON public.whatsapp_atendimentos
  FOR UPDATE USING (contabilidade_id = public.minha_contabilidade_membro())
  WITH CHECK (contabilidade_id = public.minha_contabilidade_membro());

-- ── Tipos novos de notificacao ────────────────────────────────────────────
--
-- ⚠️ A lista abaixo e a VIVA, lida do banco em 12/08/2026 (13 tipos), mais os
-- dois novos. Recriar a constraint com uma lista "do plano" ja quase apagou
-- 'assinatura_trial_acabando' e 'assinatura_cobranca_vencida' uma vez — o
-- acidente esta documentado na 0061.
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_tipo_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_tipo_check CHECK (tipo IN (
  'das_a_vencer','das_vencido','pgdas_pendente','dasn_pendente','defis_pendente',
  'cert_a_vencer','cert_vencido','limite_faturamento','honorario_a_vencer','abertura_etapa',
  'assinatura_trial_acabando','assinatura_cobranca_vencida',
  'whatsapp_escalado',
  'sla_estourado','pagamento_nao_detectado'
));

-- ── Alerta de SLA estourado ───────────────────────────────────────────────
--
-- Escalada sem atendimento ha mais tempo que o SLA do escritorio vira aviso
-- pra CADA membro dele (a fila e coletiva; avisar so o primeiro membro faria
-- o alerta morrer nas ferias de uma pessoa).
--
-- Escritorio sem `sla_resposta_horas` nao gera nada: quem nao prometeu prazo
-- nao pode estourar prazo.
--
-- Idempotente por `sla_alertado_em` (carimbado ao fim) E pelo indice unico
-- (owner_user_id, chave) das notifications — defesa em profundidade, mesmo
-- padrao de materializar_obrigacoes.
CREATE OR REPLACE FUNCTION public.materializar_sla_estourado()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_n integer := 0;
BEGIN
  WITH estouradas AS (
    SELECT a.id, a.contabilidade_id, a.created_at, ct.nome AS escritorio,
           ct.sla_resposta_horas,
           floor(EXTRACT(EPOCH FROM (now() - a.created_at)) / 3600)::int AS horas
    FROM public.whatsapp_atendimentos a
    JOIN public.contabilidades ct ON ct.id = a.contabilidade_id
    WHERE a.atendido_em IS NULL
      AND a.sla_alertado_em IS NULL
      AND ct.sla_resposta_horas IS NOT NULL
      AND a.created_at < now() - make_interval(hours => ct.sla_resposta_horas)
  ),
  ins AS (
    INSERT INTO public.notifications
      (owner_user_id, company_id, tipo, severidade, titulo, corpo, entidade_ref, action_href, chave)
    SELECT m.user_id, NULL, 'sla_estourado', 'warning',
      'Atendimento sem resposta além do prazo',
      'Um cliente aguarda resposta há ' || e.horas || 'h — acima do prazo de ' ||
        e.sla_resposta_horas || 'h que o escritório definiu.',
      e.id::text, '/contador/atendimentos',
      'sla_estourado:' || e.id::text
    FROM estouradas e
    JOIN public.contabilidade_membros m ON m.contabilidade_id = e.contabilidade_id
    ON CONFLICT (owner_user_id, chave) DO NOTHING
    RETURNING 1
  ),
  marca AS (
    UPDATE public.whatsapp_atendimentos a
    SET sla_alertado_em = now()
    FROM estouradas e WHERE a.id = e.id
    RETURNING 1
  )
  -- `marca` nao aparece no SELECT final DE PROPOSITO e ainda assim roda: no
  -- Postgres, CTE que modifica dado e executado exatamente uma vez e ate o
  -- fim, seja ou nao lido pela consulta principal.
  SELECT (SELECT count(*) FROM ins) INTO v_n;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.materializar_sla_estourado() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.materializar_sla_estourado() TO service_role;
