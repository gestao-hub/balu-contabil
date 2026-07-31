-- Bloco 6B — canal de WhatsApp (uazapi).
--
-- Tudo aditivo: nenhuma linha do caminho de e-mail (Bloco 1) muda aqui.
-- Consentimento é do NÚMERO, informado pelo próprio cliente — nunca herdado
-- de `companies.telefone`, que é contato genérico e pode estar errado.

-- ------------------------------------------------ consentimento
-- Em profiles.user_id (NÃO profiles.id — ver nota do plano/CHECKPOINT sobre a
-- divergência entre o schema real e o 0001_init.sql idealizado), porque é essa
-- a coluna que o resto do app já usa para achar o perfil da sessão.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS whatsapp_numero text,
  ADD COLUMN IF NOT EXISTS whatsapp_habilitado_em timestamptz;

-- Único: dois usuários não podem reivindicar o mesmo número. Parcial (WHERE
-- NOT NULL) para não travar as linhas que nunca ativaram o canal.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_whatsapp_numero_uidx
  ON public.profiles (whatsapp_numero)
  WHERE whatsapp_numero IS NOT NULL;

-- ------------------------------------------------ disparo proativo
-- Espelha enviada_email_em: NULL até o envio ter sucesso, sem tabela de log
-- separada — mesma idempotência que o Bloco 1 já usa para e-mail.
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS enviada_whatsapp_em timestamptz;

-- Novo tipo, para a escalação de atendimento (Task 6) poder notificar o
-- contador pelo MESMO motor que já materializa DAS a vencer etc.
--
-- DESVIO do plano: a constraint viva em produção (migration 0050_billing.sql)
-- já inclui 'assinatura_trial_acabando' e 'assinatura_cobranca_vencida' (usados
-- por app/src/lib/billing/cron.ts). O SQL original deste plano não os listava;
-- recriar a constraint só com a lista do plano teria removido esses dois
-- valores silenciosamente e quebrado o cron de billing. Mantendo-os aqui.
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_tipo_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_tipo_check CHECK (tipo IN (
  'das_a_vencer','das_vencido','pgdas_pendente','dasn_pendente','defis_pendente',
  'cert_a_vencer','cert_vencido','limite_faturamento','honorario_a_vencer','abertura_etapa',
  'assinatura_trial_acabando','assinatura_cobranca_vencida',
  'whatsapp_escalado'
));

CREATE OR REPLACE FUNCTION public.notificacoes_pendentes_whatsapp(p_limite int DEFAULT 50)
RETURNS TABLE (
  id uuid, owner_user_id uuid, tipo text, titulo text, corpo text,
  action_href text, whatsapp_numero text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT n.id, n.owner_user_id, n.tipo, n.titulo, n.corpo, n.action_href,
         p.whatsapp_numero
  FROM public.notifications n
  JOIN public.profiles p ON p.user_id = n.owner_user_id
  WHERE n.enviada_whatsapp_em IS NULL
    -- whatsapp_escalado é in-app-only por desenho (spec §2.3): é o eco da
    -- própria mensagem do cliente virando notificação pro contador. Se o
    -- contador também tiver optado no canal, mandar isso de volta por
    -- WhatsApp duplicaria a mensagem que ele já está vendo nativamente.
    AND n.tipo <> 'whatsapp_escalado'
    AND p.whatsapp_numero IS NOT NULL
    AND p.whatsapp_habilitado_em IS NOT NULL
  ORDER BY n.created_at
  LIMIT p_limite;
$$;

-- Mesmo padrão de sempre: sem rede/segredo, service_role só.
REVOKE ALL ON FUNCTION public.notificacoes_pendentes_whatsapp(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notificacoes_pendentes_whatsapp(int) TO service_role;

-- ------------------------------------------------ atendimento (Task 6)
-- Idempotência (o webhook pode reenviar) e auditoria mínima — SEM tela nesta
-- rodada (ver spec §2.3: escalação é notificação, não inbox novo).
CREATE TABLE IF NOT EXISTS public.whatsapp_atendimentos (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id_externo text NOT NULL UNIQUE,
  telefone           text NOT NULL,
  profile_user_id    uuid,
  mensagem_recebida  text NOT NULL,
  resposta_enviada   text,
  resolvido          boolean,
  created_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_atendimentos ENABLE ROW LEVEL SECURITY;
-- Sem policy nenhuma + REVOKE explícito: mesma lição da 0053/0055/0058 — o
-- ALTER DEFAULT PRIVILEGES do Supabase concede tudo em `public` para
-- anon/authenticated, calado, em TODA tabela nova.
REVOKE ALL ON public.whatsapp_atendimentos FROM anon, authenticated;

-- FK igual ao padrão de audit_log.actor_user_id (0038): referência a usuário
-- para fim de auditoria, sem travar a linha se o usuário for apagado. Fold
-- fora do CREATE TABLE (que é IF NOT EXISTS) e guardado por DROP/ADD para o
-- arquivo inteiro poder ser reaplicado sem erro de "constraint já existe".
ALTER TABLE public.whatsapp_atendimentos DROP CONSTRAINT IF EXISTS whatsapp_atendimentos_profile_user_id_fkey;
ALTER TABLE public.whatsapp_atendimentos
  ADD CONSTRAINT whatsapp_atendimentos_profile_user_id_fkey
  FOREIGN KEY (profile_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON TABLE public.whatsapp_atendimentos IS
  'Idempotencia e auditoria do atendimento de WhatsApp. Sem tela nesta rodada — service_role apenas.';
COMMENT ON COLUMN public.profiles.whatsapp_numero IS
  'E.164, informado pelo proprio cliente no opt-in. NUNCA herdar de companies.telefone.';

-- Tabela e RPC novas: rodar node app/scratchpad/_reload-postgrest.mjs
