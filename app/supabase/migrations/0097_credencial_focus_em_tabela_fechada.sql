-- 0097 — corrige a 0096: os tokens da empresa saem de `companies`.
--
-- O QUE A 0096 ERROU. Ela criou `companies.focus_token_hom_cifrado` e
-- `focus_token_prod_cifrado` supondo que dava para proteger a coluna com
-- `REVOKE ALL (coluna) ... FROM authenticated`. **Não dá.** Em Postgres, ACL de
-- coluna só ACRESCENTA acesso além do que a tabela concede — nunca subtrai.
-- Medido no banco em 20/08/2026:
--
--   relacl de companies              → authenticated=arwdm/postgres
--   attacl das colunas de token      → null (nunca houve ACL de coluna)
--   has_column_privilege(authenticated, focus_token_hom_cifrado, SELECT) → true
--                                                                UPDATE  → true
--
-- POR QUE ISSO IMPORTA — o ataque, com as policies reais desta tabela:
--
--   [SELECT] companies_select_contador → contabilidade_id = minha_contabilidade()
--   [UPDATE] companies_update          → user_id = auth.uid()
--
-- Quem é contador E dono de uma empresa lê o texto cifrado do token de um
-- CLIENTE pela primeira policy, e o grava na PRÓPRIA empresa pela segunda. Duas
-- chamadas PostgREST. Depois emite pelo Balu — e é o servidor que decifra e
-- emite, no CNPJ do cliente. A chave de cifra nunca é necessária: o texto
-- cifrado funciona como credencial ao portador.
--
-- O CONSERTO: tabela própria, sem grant nenhum para anon/authenticated. É o
-- mesmo molde de `config_focus`/`config_serpro` (0094/0095), onde a conferência
-- no banco devolveu "SEM NENHUM privilegio" para as duas roles. REVOKE de
-- TABELA funciona; o de coluna é que não.
--
-- O rastro (`focus_token_por`/`focus_token_em`) FICA em `companies` de
-- propósito: não é segredo, e o titular precisa enxergar que o escritório
-- cadastrou a credencial dele — é o que faz a declaração de custódia valer
-- alguma coisa.
--
-- Aditiva e idempotente: pode rodar 2x sem erro.

CREATE TABLE IF NOT EXISTS public.empresa_credenciais_focus (
  empresa_id         uuid PRIMARY KEY
                       REFERENCES public.companies(id) ON DELETE CASCADE,
  -- SEMPRE cifrados (prefixo enc:v1:). Dois campos porque a Focus emite dois
  -- tokens por empresa e eles NÃO são intercambiáveis: o de homologação leva
  -- 401 na base de produção e vice-versa (provado em 20/08/2026).
  token_hom_cifrado  text,
  token_prod_cifrado text,
  atualizado_por     uuid,
  atualizado_em      timestamptz NOT NULL DEFAULT now()
);

-- ON DELETE CASCADE acima não é detalhe: o app vai ser entregue zerado, e
-- `scripts/wipe-companies.ts` apaga `companies`. Sem o cascade, credencial de
-- emissão fiscal sobreviveria à empresa que ela representa.

ALTER TABLE public.empresa_credenciais_focus ENABLE ROW LEVEL SECURITY;

-- REVOKE ALL (e não "REVOKE SELECT, INSERT, UPDATE, DELETE"): o default
-- privileges do Supabase concede ALL, e ALL inclui TRUNCATE — que IGNORA RLS.
-- Mesma lição registrada na 0056, reconfirmada na 0090 e na 0094.
REVOKE ALL ON public.empresa_credenciais_focus FROM anon, authenticated;
GRANT  ALL ON public.empresa_credenciais_focus TO service_role;

-- As colunas da 0096 saem. Nunca foram lidas por código nenhum — a 0096 entrou
-- hoje e as tasks que as consumiriam ainda não rodaram. Derrubar agora custa
-- uma migration; depois custaria migração de dado vivo.
ALTER TABLE public.companies
  DROP COLUMN IF EXISTS focus_token_hom_cifrado,
  DROP COLUMN IF EXISTS focus_token_prod_cifrado;

COMMENT ON TABLE public.empresa_credenciais_focus IS
  'Tokens de emissao da Focus por empresa (hom e prod), cifrados. Fechada para '
  'anon e authenticated: ACL de coluna em companies nao consegue restringir o '
  'grant de tabela do Supabase, e o texto cifrado vale como credencial ao '
  'portador. Lida so pelo service_role. Ver o cabecalho da 0097.';

COMMENT ON COLUMN public.companies.focus_token_por IS
  'Quem cadastrou a credencial da Focus desta empresa. Rastro, nao segredo: o '
  'titular precisa ver que o escritorio cadastrou por ele.';
