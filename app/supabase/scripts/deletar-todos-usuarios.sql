-- ⚠️ DESTRUTIVO E IRREVERSÍVEL — apaga TODOS os usuários do Supabase Auth.
-- Uso: cole no SQL Editor do Supabase e rode.
--
-- Todas as FKs para auth.users são ON DELETE CASCADE, então isto também apaga,
-- em cascata, os dados de aplicação dos usuários:
--   companies, empresas_fiscais, clientes, profiles, apuracoes_fiscais,
--   guias_fiscais, abertura_empresas/alteracoes, role_types
--   + tabelas internas auth.* (identities, sessions, refresh tokens, mfa, etc.)
-- E, via cascade de companies: company_cnaes, arquivos_auxiliares (certificados), etc.

-- Antes (confira a contagem):
select count(*) as usuarios_antes from auth.users;

-- Deleta TODOS os usuários:
delete from auth.users;

-- Depois (deve retornar 0):
select count(*) as usuarios_depois from auth.users;
