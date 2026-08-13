-- Passo 4 — o que ficou de fora quando o banco veio do Bubble.
--
-- Tres objetos que EXISTEM em producao e nunca estiveram em
-- supabase/migrations: o enum `user_types`, a tabela `role_types` e a funcao
-- `add_company_to_profile`. Um banco criado do zero a partir das migrations
-- nao subiria: a 0002 insere em `role_types` e faz cast para `user_types`, e
-- nenhuma das duas coisas existiria.
--
-- Tudo aqui e idempotente e reproduz o que foi LIDO do banco em 12/08/2026 —
-- nao o que a memoria dizia que devia estar la.
--
-- `receitas_fiscais`, o terceiro item do card, ja estava resolvido: a 0014
-- dropou a tabela em 31/05/2026 depois de confirmar que nao havia gravador
-- nenhum. Nao ha o que versionar.

-- ── 1. enum user_types ──────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE public.user_types AS ENUM ('Empresa', 'Contador', 'AdminBalu');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. tabela role_types ────────────────────────────────────────────────────
-- Um papel por usuario; o indice unico veio na 0077.
CREATE TABLE IF NOT EXISTS public.role_types (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON UPDATE CASCADE ON DELETE CASCADE,
  type       public.user_types NOT NULL DEFAULT 'Empresa'
);

-- O default de `user_id` era `gen_random_uuid()`, herdado do Bubble. Um UUID
-- aleatorio nunca corresponde a um usuario real, e a FK para auth.users
-- recusaria a linha — ou seja, o default so podia produzir erro. Removido: ele
-- nao protegia nada e escondia a obrigatoriedade do campo.
ALTER TABLE public.role_types ALTER COLUMN user_id DROP DEFAULT;

-- ── 3. profiles: UNIQUE(user_id) ────────────────────────────────────────────
-- Mesma armadilha que a 0077 fechou em `role_types`, e nesta e pior: o app le
-- o perfil com `.single()` em varios lugares (impostos, onboarding, notas), e
-- `.single()` ERRA com mais de uma linha. Uma duplicata aqui nao degrada uma
-- tela — derruba o usuario inteiro.
--
-- Ate hoje nada garantia unicidade: a tabela so tinha PK em `id` e um indice
-- unico em `whatsapp_numero`. Os dois pontos do app que criam perfil fazem
-- "le, e se nao achar insere", que e uma corrida esperando por duas abas.
--
-- Estado conferido antes de aplicar (12/08/2026): 4 perfis, 0 user_id
-- duplicado. O indice entra limpo.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_user_id_uidx
  ON public.profiles (user_id);

COMMENT ON INDEX public.profiles_user_id_uidx IS
  'Um perfil por usuario. Sem isto, uma duplicata faz o .single() do app falhar e derruba esse usuario. Tambem e o alvo do ON CONFLICT de add_company_to_profile.';

-- ── 4. add_company_to_profile, corrigida ────────────────────────────────────
-- A versao que estava em producao (lida em 12/08/2026):
--
--   UPDATE profiles SET company_id = p_company_id WHERE user_id = p_user_id;
--
-- Dois defeitos, e o app ja sabia dos dois — `onboarding/actions.ts` carregava
-- o comentario "nao usamos o RPC: no banco ele escreve em company_id (nao
-- current_company) e assume um profile pre-existente":
--
--   1. ESCREVIA A COLUNA ERRADA. `profiles.company_id` nao e lida por nada no
--      app; a empresa ativa e `current_company`. A funcao gravava num campo
--      morto e devolvia `success: true`.
--   2. NAO CRIAVA PERFIL. O UPDATE sem linha nao e erro em SQL: afeta zero
--      linhas e retorna sucesso do mesmo jeito. Como o trigger que criava
--      perfis no signup nao existe, o caso comum era exatamente esse.
--
-- Corrigida para gravar `current_company` e fazer upsert atomico — que so
-- agora e possivel, porque o ON CONFLICT precisa do indice unico criado acima.
-- Isso substitui o "le, e se nao achar insere" dos dois pontos do app por uma
-- instrucao so, sem corrida entre elas.
--
-- SECURITY INVOKER (o padrao, mantido de proposito): a RLS de `profiles` vale,
-- entao passar o user_id de outra pessoa nao escreve nada. Uma funcao DEFINER
-- aqui transformaria um parametro numa forma de escrever no perfil alheio.
CREATE OR REPLACE FUNCTION public.add_company_to_profile(p_user_id uuid, p_company_id uuid)
RETURNS json
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.profiles (user_id, current_company)
  VALUES (p_user_id, p_company_id)
  ON CONFLICT (user_id) DO UPDATE SET current_company = EXCLUDED.current_company
  RETURNING id INTO v_id;

  RETURN json_build_object(
    'success', v_id IS NOT NULL,
    'user_id', p_user_id,
    'company_id', p_company_id
  );
END;
$$;

COMMENT ON FUNCTION public.add_company_to_profile(uuid, uuid) IS
  'Define a empresa ATIVA (current_company) do perfil, criando o perfil se nao existir. Ate a 0083 escrevia profiles.company_id, coluna que o app nao le, e nao criava perfil nenhum.';
