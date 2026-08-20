-- 0093 — aviso de apuração bloqueada por configuração faltando.
--
-- BUG REAL, encontrado no cron de PRODUÇÃO em 19/08/2026:
--
--   [apuracao-cron] empresa c2410872-… falhou
--   Anexo do Simples não informado para apuração.
--
-- A empresa é do Simples, não tem `anexo_simples` preenchido, e o CNAE dela
-- (7319002) existe no catálogo `cnae_anexo` com `anexo_base` **NULL** — ou
-- seja, o catálogo conhece o CNAE e não diz qual anexo é. Sem anexo, o cálculo
-- lança; e retentar no dia seguinte não cria uma configuração que ninguém
-- preencheu. A falha se repetia TODO DIA.
--
-- O que a tornava perigosa era o silêncio composto:
--   1. a tela continuava mostrando uma apuração ANTIGA marcada `calculada`;
--   2. o resumo do cron dizia "1 erro", sem dizer de quê;
--   3. um erro NOVO e de verdade subiria de 1 para 2 — invisível.
--
-- Agora a condição tem classe própria (`ConfiguracaoIncompletaError`), conta
-- separado de `erros`, e o DONO da empresa é avisado. O contador não é avisado
-- de propósito: o painel dele é somente leitura, então ele não teria como
-- resolver — quem edita o regime tributário é o empresário.
--
-- ⚠️ A CONSTRAINT É REMONTADA POR INTEIRO, nunca "da lista do plano" (o
-- acidente da 0061 quase apagou dois tipos). Lista da 0092 mais o tipo novo.

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_tipo_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_tipo_check CHECK (tipo IN (
  'das_a_vencer','das_vencido','pgdas_pendente','dasn_pendente','defis_pendente',
  'cert_a_vencer','cert_vencido','limite_faturamento','honorario_a_vencer','abertura_etapa',
  'assinatura_trial_acabando','assinatura_cobranca_vencida',
  'whatsapp_escalado',
  'sla_estourado','pagamento_nao_detectado',
  'parametro_fiscal_desatualizado',
  'pagamento_confirmado',
  'whatsapp_desconectado',
  'apuracao_bloqueada'
));
