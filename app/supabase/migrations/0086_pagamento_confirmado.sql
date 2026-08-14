-- Frente 3 (avisos de pagamento) — Task 1: o tipo `pagamento_confirmado`.
-- Spec: docs/superpowers/specs/2026-08-13-frente-3-avisos-de-pagamento-design.md §3.4
--
-- UM tipo para as DUAS fontes (Receita e Asaas), nao um por fonte: do ponto de
-- vista do usuario a pergunta e uma so — "quero saber quando um pagamento meu
-- for confirmado?" — e dois tipos duplicariam a mesma preferencia.
--
-- ⚠️ A lista abaixo e a VIVA, lida do banco em 14/08/2026 (16 tipos, conferida
-- com pg_get_constraintdef), mais o novo. Mesmo ritual que a 0081 e a 0070
-- documentam: remontar esta constraint "da lista do plano" ja quase apagou dois
-- tipos uma vez (acidente da 0061).
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_tipo_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_tipo_check CHECK (tipo IN (
  'das_a_vencer','das_vencido','pgdas_pendente','dasn_pendente','defis_pendente',
  'cert_a_vencer','cert_vencido','limite_faturamento','honorario_a_vencer','abertura_etapa',
  'assinatura_trial_acabando','assinatura_cobranca_vencida',
  'whatsapp_escalado',
  'sla_estourado','pagamento_nao_detectado',
  'parametro_fiscal_desatualizado',
  'pagamento_confirmado'
));
