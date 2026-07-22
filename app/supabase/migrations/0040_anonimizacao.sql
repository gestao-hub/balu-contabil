-- 0040: anonimização do titular mantendo documentos fiscais (LGPD art. 16, I).
-- NÃO deleta auth.users (FKs são CASCADE → destruiria notas/guias). O bloqueio de
-- login e a neutralização de nome/e-mail no auth são feitos pela server action.
CREATE OR REPLACE FUNCTION public.anonimizar_usuario(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- profiles não tem dado pessoal além do vínculo; marca excluído.
  UPDATE profiles SET deleted_at = now(), updated_at = now()
    WHERE user_id = p_user_id;
  -- empresas do titular: fiscal RETIDO; marca excluída e desvincula de escritório.
  UPDATE companies SET deleted_at = COALESCE(deleted_at, now()), contabilidade_id = NULL,
                       updated_at = now()
    WHERE user_id = p_user_id;
  -- clientes do titular: anonimiza contato/endereço/nome; mantém `document`
  -- (id fiscal do terceiro é exigido para a guarda do documento fiscal) e histórico.
  UPDATE clientes SET razao_social = 'Removido', email = NULL, telefone = NULL,
                      logradouro = NULL, numero = NULL, complemento = NULL,
                      bairro = NULL, cep = NULL, deleted_at = COALESCE(deleted_at, now()),
                      updated_at = now()
    WHERE owner_user_id = p_user_id;
  INSERT INTO audit_log (actor_user_id, acao, alvo_tipo, alvo_id)
    VALUES (p_user_id, 'conta.exclusao', 'user', p_user_id);
END $$;
REVOKE ALL ON FUNCTION public.anonimizar_usuario(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.anonimizar_usuario(uuid) TO service_role;
