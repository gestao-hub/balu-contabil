-- 0043: convite só pode ser aceito pela conta cujo e-mail bate com o do convite.
-- Descoberto em teste (2026-07-23): a sessão do CONTADOR estava ativa, ele abriu o
-- link do convite de cliente e o `aceitar_convite` deixou-o assumir a empresa do
-- próprio cliente — a RPC só checava auth.uid(), nunca o e-mail do convite. Isso
-- vale para link vazado/encaminhado também. Agora exige que o e-mail da conta
-- logada (auth.users) seja igual (case-insensitive, trim) ao `convites.email`.
-- Aplica-se aos dois tipos ('membro' e 'cliente') — ambos são dirigidos a um e-mail.
-- Reescreve a função inteira (a base é a 0036); única mudança é o bloco EMAIL_NAO_CONFERE.
CREATE OR REPLACE FUNCTION public.aceitar_convite(p_token text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v convites%ROWTYPE; v_uid uuid := auth.uid(); v_status text; v_atual uuid; v_email text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'NAO_AUTENTICADO'; END IF;
  SELECT * INTO v FROM convites WHERE token = p_token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONVITE_INVALIDO'; END IF;
  IF v.revogado_em IS NOT NULL THEN RAISE EXCEPTION 'CONVITE_REVOGADO'; END IF;
  IF v.expira_em IS NOT NULL AND v.expira_em < now() THEN RAISE EXCEPTION 'CONVITE_EXPIRADO'; END IF;
  IF v.usado_em IS NOT NULL THEN
    IF v.usado_por = v_uid THEN RETURN COALESCE(v.company_id, v.contabilidade_id); END IF; -- no-op idempotente
    RAISE EXCEPTION 'CONVITE_USADO';
  END IF;

  -- Trava de e-mail (0043): a conta que aceita tem de ser a destinatária do convite.
  -- auth.users é a fonte da verdade do e-mail; auth.email() do JWT poderia divergir.
  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
  IF lower(btrim(v_email)) IS DISTINCT FROM lower(btrim(v.email)) THEN
    RAISE EXCEPTION 'EMAIL_NAO_CONFERE';
  END IF;

  SELECT status INTO v_status FROM contabilidades WHERE id = v.contabilidade_id;
  IF v_status IS DISTINCT FROM 'aprovada' THEN RAISE EXCEPTION 'ESCRITORIO_INATIVO'; END IF;

  IF v.tipo = 'membro' THEN
    SELECT contabilidade_id INTO v_atual FROM contabilidade_membros WHERE user_id = v_uid;
    IF v_atual IS NOT NULL AND v_atual <> v.contabilidade_id THEN
      RAISE EXCEPTION 'JA_MEMBRO_OUTRO_ESCRITORIO';
    END IF;
    INSERT INTO contabilidade_membros (contabilidade_id, user_id)
      VALUES (v.contabilidade_id, v_uid)
      ON CONFLICT (contabilidade_id, user_id) DO NOTHING;
    UPDATE convites SET usado_em = now(), usado_por = v_uid WHERE id = v.id;
    RETURN v.contabilidade_id;
  END IF;

  -- tipo 'cliente' dirigido: assume a empresa pré-cadastrada
  IF v.company_id IS NULL THEN RAISE EXCEPTION 'CONVITE_SEM_EMPRESA'; END IF;
  IF NOT EXISTS (SELECT 1 FROM companies
                 WHERE id = v.company_id AND contabilidade_id = v.contabilidade_id) THEN
    RAISE EXCEPTION 'EMPRESA_FORA_DA_CARTEIRA';
  END IF;
  UPDATE companies SET user_id = v_uid
    WHERE id = v.company_id AND contabilidade_id = v.contabilidade_id AND user_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'EMPRESA_JA_TEM_DONO'; END IF;
  UPDATE convites SET usado_em = now(), usado_por = v_uid WHERE id = v.id;
  RETURN v.company_id;
END $$;
