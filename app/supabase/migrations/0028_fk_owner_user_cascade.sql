-- @custom — Exclusão de usuário (auth.users) falhava: "Database error deleting user".
-- Causa: FKs owner_user_id -> auth.users SEM ON DELETE CASCADE no banco real (divergência
-- das migrations, que já declaravam cascade). As demais (companies, clientes, empresas_fiscais,
-- abertura_*, role_types) já estavam CASCADE; faltavam apuracoes_fiscais e guias_fiscais.
-- Com isso, deletar o usuário cascateia limpo (empresas + dados fiscais do dono).
-- Verificado ao vivo: DELETE FROM auth.users ... passa após estas duas (rollback de teste).

ALTER TABLE public.apuracoes_fiscais DROP CONSTRAINT IF EXISTS apuracoes_fiscais_owner_user_id_fkey;
ALTER TABLE public.apuracoes_fiscais
  ADD CONSTRAINT apuracoes_fiscais_owner_user_id_fkey
  FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.guias_fiscais DROP CONSTRAINT IF EXISTS guias_fiscais_owner_user_id_fkey;
ALTER TABLE public.guias_fiscais
  ADD CONSTRAINT guias_fiscais_owner_user_id_fkey
  FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
