-- 0045_notificacoes.sql — Bloco 1: Motor de Obrigacoes + Notificacoes
-- Parte do schema REAL (db_atual.sql + migrations 0025+), NAO do 0001 (idealizado).
-- Idempotente: pode rodar 2x sem erro.

-- Tabela de notificacoes in-app (por usuario/titular).
CREATE TABLE IF NOT EXISTS public.notifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  company_id    uuid,
  tipo          text NOT NULL CHECK (tipo IN (
    'das_a_vencer','das_vencido','pgdas_pendente','dasn_pendente','defis_pendente',
    'cert_a_vencer','cert_vencido','limite_faturamento','honorario_a_vencer','abertura_etapa')),
  severidade    text NOT NULL DEFAULT 'info' CHECK (severidade IN ('info','warning','danger')),
  titulo        text NOT NULL,
  corpo         text NOT NULL,
  norma         text,
  entidade_ref  text,
  action_href   text,
  chave         text NOT NULL,
  agendada_para date,
  lida_em       timestamptz,
  enviada_email_em timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Idempotencia do cron: uma notificacao por (usuario, chave). ON CONFLICT casa com este indice.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_owner_chave_uidx
  ON public.notifications(owner_user_id, chave);
CREATE INDEX IF NOT EXISTS notifications_owner_unread_idx
  ON public.notifications(owner_user_id) WHERE lida_em IS NULL;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notifications_select_own ON public.notifications;
CREATE POLICY notifications_select_own ON public.notifications
  FOR SELECT USING (owner_user_id = auth.uid());
DROP POLICY IF EXISTS notifications_update_own ON public.notifications;
CREATE POLICY notifications_update_own ON public.notifications
  FOR UPDATE USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid());
-- Sem policy de INSERT: apenas a RPC (SECURITY DEFINER) e o service role inserem.

-- Preferencias de canal (opt-out de e-mail por tipo). In-app e sempre materializado.
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  owner_user_id uuid NOT NULL,
  tipo          text NOT NULL,
  email_enabled boolean NOT NULL DEFAULT true,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_user_id, tipo)
);
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notif_prefs_all_own ON public.notification_preferences;
CREATE POLICY notif_prefs_all_own ON public.notification_preferences
  FOR ALL USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid());

-- Realtime para o sino (respeita RLS). Guarda idempotente: nao falha se ja for membro / sem publication.
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
EXCEPTION
  WHEN duplicate_object THEN NULL;   -- ja e membro
  WHEN undefined_object THEN NULL;   -- publication nao existe neste ambiente
END $$;
