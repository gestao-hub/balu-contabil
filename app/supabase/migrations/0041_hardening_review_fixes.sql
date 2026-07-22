-- 0041: correções do code review final do Bloco E (2026-07-22).
-- (B) anonimizar_usuario deixava dados pessoais em companies/empresas_fiscais/
--     certificado. Estende a anonimização (para MEI, razao_social/endereço = pessoa).
-- (E) aceites aceitava qualquer (tipo,versao) via REST direto (sem validar que é
--     documento publicado) → consentimento auto-fabricado. Trigger valida no banco.

-- ── (B) anonimização mais completa ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.anonimizar_usuario(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE profiles SET deleted_at = now(), updated_at = now()
    WHERE user_id = p_user_id;

  -- companies: retém CNPJ/inscrições (id fiscal), anonimiza nome e contato/endereço
  -- (para MEI, nome/razao_social é a pessoa; rua/número/cep é a residência).
  UPDATE companies SET
      nome = 'Removido', razao_social = 'Removido',
      email = NULL, telefone = NULL,
      logradouro = NULL, numero = NULL, complemento = NULL, bairro = NULL, cep = NULL,
      deleted_at = COALESCE(deleted_at, now()), updated_at = now()
    WHERE user_id = p_user_id;

  -- empresas_fiscais: zera credenciais/contatos pessoais de acesso ao provedor.
  UPDATE empresas_fiscais SET
      login_responsavel = NULL, senha_responsavel = NULL,
      email_provedor = NULL, whatsapp_provedor = NULL, nfse_usuario_login = NULL,
      nfse_senha_login = NULL, nfse_token_api = NULL, nfse_chave_api = NULL,
      nfse_frase_secreta = NULL, token_portal = NULL,
      updated_at = now()
    WHERE empresa_id IN (SELECT id FROM companies WHERE user_id = p_user_id);

  -- certificado A1: material privado/sensível não serve à guarda fiscal — zera.
  UPDATE arquivos_auxiliares SET
      cert_password = NULL, cert_subject_cn = NULL, cert_cnpj = NULL,
      cert_fingerprint = NULL, updated_at = now()
    WHERE company_id IN (SELECT id FROM companies WHERE user_id = p_user_id);

  -- clientes do titular: anonimiza contato/endereço/nome; mantém `document` e
  -- histórico (id fiscal do terceiro é exigido para a guarda do documento fiscal).
  UPDATE clientes SET razao_social = 'Removido', email = NULL, telefone = NULL,
                      logradouro = NULL, numero = NULL, complemento = NULL,
                      bairro = NULL, cep = NULL, deleted_at = COALESCE(deleted_at, now()),
                      updated_at = now()
    WHERE owner_user_id = p_user_id;

  INSERT INTO audit_log (actor_user_id, acao, alvo_tipo, alvo_id)
    VALUES (p_user_id, 'conta.exclusao', 'user', p_user_id);
END $$;

-- ── (E) aceites só de documento realmente publicado ─────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_aceites_valida_versao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM documento_versoes
    WHERE tipo = NEW.tipo AND versao = NEW.versao AND publicado_em IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'ACEITE_VERSAO_INVALIDA: (%, %) não é um documento publicado', NEW.tipo, NEW.versao;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_aceites_valida_versao ON public.aceites;
CREATE TRIGGER tg_aceites_valida_versao
  BEFORE INSERT OR UPDATE ON public.aceites
  FOR EACH ROW EXECUTE FUNCTION public.tg_aceites_valida_versao();
