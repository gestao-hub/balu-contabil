-- @custom — notas_fiscais e profiles estavam SEM nenhuma FK (só PK) no banco real:
-- company_id/cliente_id/user_id/current_company eram colunas soltas, sem integridade
-- referencial nem cascade. Por isso apareciam como "relações" pendentes e geravam órfãos
-- quando empresas/usuários eram deletados. Esta migration cria as FKs no padrão do banco:
--   *_company_id -> companies(id) ON DELETE CASCADE   (nota some com a empresa)
--   notas_fiscais.cliente_id -> clientes(id) ON DELETE SET NULL  (preserva a nota fiscal)
--   profiles.user_id -> auth.users(id) ON DELETE CASCADE  (profile some com o usuário)
--   profiles.company_id / current_company -> companies(id) ON DELETE SET NULL
--
-- ⚠️ DESTRUTIVO: limpa órfãos pré-existentes (de deletes antigos sem FK) antes de criar
-- as constraints, senão o ADD falha. Dry-run ao vivo (rollback) em 2026-06-09:
--   - notas_fiscais com company_id de empresa inexistente  -> DELETE  (~147 linhas)
--   - profiles com user_id de usuário inexistente           -> DELETE  (~5 linhas)
--   - cliente_id / current_company órfãos -> SET NULL (em geral já caem nos DELETEs acima,
--     pois a nota/profile órfão costuma ser o mesmo registro; os UPDATEs sobram por garantia).

BEGIN;

-- 1) Limpeza de órfãos -------------------------------------------------------
-- Notas cuja empresa não existe mais (company_id é NOT NULL → não há SET NULL possível).
DELETE FROM public.notas_fiscais n
 WHERE NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = n.company_id);

-- cliente_id apontando para cliente inexistente → zera (a FK abaixo é SET NULL).
UPDATE public.notas_fiscais n SET cliente_id = NULL
 WHERE n.cliente_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.clientes c WHERE c.id = n.cliente_id);

-- Profiles sem usuário válido (user_id de usuário inexistente) → removidos.
DELETE FROM public.profiles p
 WHERE p.user_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.user_id);

-- Referências de empresa inexistente em profiles → zera (FK SET NULL).
UPDATE public.profiles p SET current_company = NULL
 WHERE p.current_company IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = p.current_company);

UPDATE public.profiles p SET company_id = NULL
 WHERE p.company_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = p.company_id);

-- 2) FKs de notas_fiscais ----------------------------------------------------
ALTER TABLE public.notas_fiscais DROP CONSTRAINT IF EXISTS notas_fiscais_company_id_fkey;
ALTER TABLE public.notas_fiscais
  ADD CONSTRAINT notas_fiscais_company_id_fkey
  FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;

ALTER TABLE public.notas_fiscais DROP CONSTRAINT IF EXISTS notas_fiscais_cliente_id_fkey;
ALTER TABLE public.notas_fiscais
  ADD CONSTRAINT notas_fiscais_cliente_id_fkey
  FOREIGN KEY (cliente_id) REFERENCES public.clientes(id) ON DELETE SET NULL;

-- 3) FKs de profiles ---------------------------------------------------------
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_user_id_fkey;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_company_id_fkey;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_company_id_fkey
  FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_current_company_fkey;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_current_company_fkey
  FOREIGN KEY (current_company) REFERENCES public.companies(id) ON DELETE SET NULL;

COMMIT;
