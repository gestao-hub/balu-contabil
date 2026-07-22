-- 0042: fecha as lacunas da anonimização apontadas no code review final do Bloco E.
-- (REGRESSÃO da 0041) o rewrite perdeu `contabilidade_id = NULL` — sem isso a
--   empresa de um usuário excluído continua visível ao escritório contábil para
--   sempre (RLS do contador chaveia por contabilidade_id e não checa deleted_at).
-- (GAP) abertura_empresas/abertura_alteracoes guardam CPF/RG/nome da mãe do titular
--   e não eram tocadas — são dados operacionais (não documento fiscal a reter): apaga.
-- (GAP) zera o ponteiro do blob do certificado (a remoção do arquivo no Storage é
--   feita pela server action, que tem acesso ao Storage).
CREATE OR REPLACE FUNCTION public.anonimizar_usuario(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE profiles SET deleted_at = now(), updated_at = now()
    WHERE user_id = p_user_id;

  -- companies: retém CNPJ/inscrições (id fiscal), anonimiza nome e contato/endereço,
  -- DESVINCULA do escritório (contabilidade_id = NULL) para cortar o acesso do contador.
  UPDATE companies SET
      nome = 'Removido', razao_social = 'Removido',
      email = NULL, telefone = NULL,
      logradouro = NULL, numero = NULL, complemento = NULL, bairro = NULL, cep = NULL,
      contabilidade_id = NULL,
      deleted_at = COALESCE(deleted_at, now()), updated_at = now()
    WHERE user_id = p_user_id;

  UPDATE empresas_fiscais SET
      login_responsavel = NULL, senha_responsavel = NULL,
      email_provedor = NULL, whatsapp_provedor = NULL, nfse_usuario_login = NULL,
      nfse_senha_login = NULL, nfse_token_api = NULL, nfse_chave_api = NULL,
      nfse_frase_secreta = NULL, token_portal = NULL,
      updated_at = now()
    WHERE empresa_id IN (SELECT id FROM companies WHERE user_id = p_user_id);

  -- certificado A1: zera metadados sensíveis + o ponteiro do arquivo (o blob no
  -- Storage é removido pela server action deleteAccountAction).
  UPDATE arquivos_auxiliares SET
      cert_password = NULL, cert_subject_cn = NULL, cert_cnpj = NULL,
      cert_fingerprint = NULL, storage_key = NULL, supabase_file_path = NULL,
      updated_at = now()
    WHERE company_id IN (SELECT id FROM companies WHERE user_id = p_user_id);

  -- clientes do titular: anonimiza contato/endereço/nome; mantém `document` e histórico.
  UPDATE clientes SET razao_social = 'Removido', email = NULL, telefone = NULL,
                      logradouro = NULL, numero = NULL, complemento = NULL,
                      bairro = NULL, cep = NULL, deleted_at = COALESCE(deleted_at, now()),
                      updated_at = now()
    WHERE owner_user_id = p_user_id;

  -- abertura de empresa: dados operacionais com PII forte (CPF, RG, nome da mãe,
  -- data de nascimento) — não é documento fiscal a reter; apaga por minimização.
  DELETE FROM abertura_alteracoes WHERE user_id = p_user_id;
  DELETE FROM abertura_empresas WHERE user_id = p_user_id;

  INSERT INTO audit_log (actor_user_id, acao, alvo_tipo, alvo_id)
    VALUES (p_user_id, 'conta.exclusao', 'user', p_user_id);
END $$;
