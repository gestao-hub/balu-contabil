-- 0092 — aviso ao escritório quando a instância de WhatsApp cai.
--
-- Fase 2 da spec do canal por escritório. Motivo, com número: em 19/08/2026 o
-- servidor uazapi hospedava 37 instâncias e **24 estavam desconectadas**. Cair
-- é o estado NORMAL de uma sessão de WhatsApp — o aparelho reinicia, o chip
-- sai, o WhatsApp desconecta dispositivos antigos.
--
-- Sem este aviso, o canal do escritório morre em silêncio: os clientes escrevem
-- e ninguém responde, os avisos de DAS param de sair, e o escritório só
-- descobre quando alguém reclama. É o mesmo modo de falhar que este projeto
-- combate desde o primeiro dia — o silêncio que parece sucesso.
--
-- ⚠️ A CONSTRAINT É REMONTADA POR INTEIRO, nunca "da lista do plano": remontar
-- de memória já quase apagou dois tipos uma vez (acidente da 0061). A lista
-- abaixo é a da 0086 MAIS o tipo novo.

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_tipo_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_tipo_check CHECK (tipo IN (
  'das_a_vencer','das_vencido','pgdas_pendente','dasn_pendente','defis_pendente',
  'cert_a_vencer','cert_vencido','limite_faturamento','honorario_a_vencer','abertura_etapa',
  'assinatura_trial_acabando','assinatura_cobranca_vencida',
  'whatsapp_escalado',
  'sla_estourado','pagamento_nao_detectado',
  'parametro_fiscal_desatualizado',
  'pagamento_confirmado',
  'whatsapp_desconectado'
));

COMMENT ON CONSTRAINT notifications_tipo_check ON public.notifications IS
  'Mesma lista de src/lib/notifications/tipos.ts — tipos.test.ts compara as duas.';
