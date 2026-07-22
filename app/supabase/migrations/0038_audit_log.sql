-- 0038: trilha de auditoria (Bloco E, item 6.6). Leitura só AdminBalu; escrita
-- só service_role (via helper registrarAuditoria).
CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  acao text NOT NULL,
  alvo_tipo text,
  alvo_id uuid,
  contabilidade_id uuid,
  meta jsonb,
  ip inet,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON public.audit_log(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_alvo_idx ON public.audit_log(alvo_tipo, alvo_id);
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_select_admin ON public.audit_log FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.role_types WHERE user_id = auth.uid() AND type = 'AdminBalu'));
GRANT SELECT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;
