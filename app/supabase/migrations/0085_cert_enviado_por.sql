-- Quem subiu o certificado A1, e quando (card P11 — piloto com ate 30 empresas
-- por regime).
--
-- POR QUE EXISTE: ate agora o unico caminho de entrada de PFX no produto era
-- `uploadCertificadoAction`, que resolve a empresa por `profiles.current_company`
-- do usuario logado — ou seja, so o DONO conseguia subir o proprio certificado.
-- O Michel respondeu que consegue coletar o PFX e a senha de cada cliente, e
-- essa operacao nao existia no app. Com o contador podendo subir pelo painel,
-- a linha precisa dizer POR QUEM ela foi escrita: a chave privada guardada ali
-- assina Termo de Autorizacao em nome do CNPJ do cliente, e "quem colocou esta
-- chave aqui" deixa de ser obvio no momento em que existe mais de um caminho.
--
-- NULL e estado legitimo e permanente: as linhas anteriores a esta migration
-- (1 no banco em 13/08/2026) nao tem como saber quem subiu, e inventar um
-- responsavel retroativo seria pior que admitir a lacuna.
--
-- ESTA COLUNA E PARA EXIBICAO, NAO E A TRILHA DE AUDITORIA. A policy de UPDATE
-- do dono (`arquivos_auxiliares_update`, USING/CHECK user_owns_company) permite
-- que ele escreva qualquer valor aqui na propria empresa. O registro que vale
-- para auditoria e o `audit_log` (acao 'cert.upload_contador'), que so o
-- service_role escreve.
ALTER TABLE public.arquivos_auxiliares
  ADD COLUMN IF NOT EXISTS cert_enviado_por uuid,
  ADD COLUMN IF NOT EXISTS cert_enviado_em timestamptz;

COMMENT ON COLUMN public.arquivos_auxiliares.cert_enviado_por IS
  'auth.users.id de quem subiu o certificado (dono ou contador do escritorio). NULL = anterior a 0085. Exibicao; a trilha e o audit_log.';
COMMENT ON COLUMN public.arquivos_auxiliares.cert_enviado_em IS
  'Quando o certificado foi subido. NULL = anterior a 0085.';

-- SEM FK para auth.users, de proposito: a exclusao de conta do Bloco E
-- ANONIMIZA e mantem o registro fiscal em vez de apagar (nunca deleta o
-- auth.user). Uma FK com CASCADE apagaria a linha do certificado junto com um
-- usuario; com SET NULL, apagaria justamente o dado que a coluna existe para
-- guardar. Fica uuid solto, igual a `audit_log.actor_user_id`.
--
-- SEM GRANT NOVO, e isso foi CONFERIDO, nao presumido (armadilha das 0074/0076,
-- onde coluna nova nao herdou grant concedido COLUNA A COLUNA). Lido do banco em
-- 13/08/2026 via information_schema.role_table_grants: `arquivos_auxiliares` tem
-- grant de TABELA para `authenticated` (SELECT/INSERT/UPDATE/DELETE), e grant de
-- tabela alcanca coluna nova automaticamente.
