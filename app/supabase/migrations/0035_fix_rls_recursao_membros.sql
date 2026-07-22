-- 0035: corrige recursão infinita (42P17) nas políticas RLS da 0030.
-- membros_select subconsultava a própria contabilidade_membros (auto-referência),
-- e as políticas de contabilidades/convites subconsultavam contabilidade_membros
-- (disparando membros_select de novo) → ciclo detectado pelo Postgres em QUALQUER
-- leitura autenticada dessas tabelas (falha fechada, mas quebra o app do contador).
-- Padrão correto (o mesmo da 0033): helper SECURITY DEFINER não re-dispara RLS.
-- Descoberto por tests/rls-contador.spec.ts (caso 6) em 2026-07-22.

-- Membership do usuário SEM filtro de status (diferente de minha_contabilidade(),
-- que exige 'aprovada'): a tela /contador/aguardando precisa ler a própria
-- contabilidade ainda pendente. Lançamento: 1 usuário = no máx. 1 contabilidade
-- (índice único contabilidade_membros_user_unique garante linha única).
CREATE OR REPLACE FUNCTION public.minha_contabilidade_membro()
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT contabilidade_id FROM contabilidade_membros WHERE user_id = auth.uid()
$$;
REVOKE ALL ON FUNCTION public.minha_contabilidade_membro() FROM public;
GRANT EXECUTE ON FUNCTION public.minha_contabilidade_membro() TO authenticated;

DROP POLICY IF EXISTS contabilidades_select_membro ON public.contabilidades;
CREATE POLICY contabilidades_select_membro ON public.contabilidades FOR SELECT
  USING (id = public.minha_contabilidade_membro());

DROP POLICY IF EXISTS contabilidades_update_membro ON public.contabilidades;
CREATE POLICY contabilidades_update_membro ON public.contabilidades FOR UPDATE
  USING (id = public.minha_contabilidade_membro())
  WITH CHECK (id = public.minha_contabilidade_membro());

DROP POLICY IF EXISTS membros_select ON public.contabilidade_membros;
CREATE POLICY membros_select ON public.contabilidade_membros FOR SELECT
  USING (contabilidade_id = public.minha_contabilidade_membro());

DROP POLICY IF EXISTS convites_all_membro ON public.convites;
CREATE POLICY convites_all_membro ON public.convites FOR ALL
  USING (contabilidade_id = public.minha_contabilidade_membro())
  WITH CHECK (contabilidade_id = public.minha_contabilidade_membro());
