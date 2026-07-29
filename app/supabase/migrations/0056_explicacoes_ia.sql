-- Bloco 6A — explicação de imposto com IA.
--
-- Três tabelas, e nenhuma delas guarda dado de contribuinte: o catálogo é por
-- SITUAÇÃO fiscal, não por cliente. É essa propriedade que permite gerar o
-- texto uma única vez e revisá-lo antes de qualquer cliente ver.

-- ------------------------------------------------ catalogo
CREATE TABLE IF NOT EXISTS public.explicacoes_fiscais (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Chave canonica da situacao (ver lib/fiscal/situacao-fiscal.ts). Ex.:
  -- 'das-mei:icms+inss+iss'. Componentes em ordem alfabetica de proposito —
  -- sem isso o catalogo duplica sozinho.
  chave        text NOT NULL UNIQUE,
  -- Texto COM MARCADORES (`{inss}`), nunca com valores.
  texto        text NOT NULL,
  status       text NOT NULL DEFAULT 'rascunho'
                 CHECK (status IN ('rascunho','aprovado')),
  -- Quem carimbou. Editar derruba a aprovacao (regra na action, §5.6 da spec).
  aprovado_por uuid,
  aprovado_em  timestamptz,
  -- Rastro de origem: qual provedor/modelo redigiu o rascunho. Nao e segredo.
  gerado_por   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------ configuracao do provedor
-- LINHA UNICA, e nao chave-valor: sao campos que so fazem sentido juntos —
-- modelo sem provedor, ou chave sem URL base no modo personalizado, e estado
-- invalido. Uma linha torna o estado invalido irrepresentavel.
CREATE TABLE IF NOT EXISTS public.config_ia (
  id             int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  provedor       text CHECK (provedor IN
                   ('anthropic','gemini','openai','openrouter','groq',
                    'deepseek','mistral','personalizado')),
  modelo         text,
  -- So usado em 'personalizado'; nos demais o adaptador conhece a URL.
  base_url       text,
  -- SEMPRE cifrada (prefixo enc:v1:). Nunca volta para a tela.
  chave_cifrada  text,
  atualizado_por uuid,
  atualizado_em  timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------ o buraco, contado
-- Situacao exibida SEM texto aprovado. Sem isto o catalogo cresceria por
-- adivinhacao; com isto, cresce por demanda real. Mesmo principio do contador
-- de boletos orfaos do 4B: buraco silencioso e pior que buraco.
CREATE TABLE IF NOT EXISTS public.explicacoes_faltando (
  chave       text PRIMARY KEY,
  vistas      bigint NOT NULL DEFAULT 0,
  primeira_em timestamptz NOT NULL DEFAULT now(),
  ultima_em   timestamptz NOT NULL DEFAULT now()
);

-- Incremento atomico e sem corrida. SECURITY DEFINER porque a tabela e fechada
-- para as roles do cliente (ver privilegios abaixo) e quem chama e a tela do
-- empresario, pela sessao dele.
CREATE OR REPLACE FUNCTION public.registrar_explicacao_faltando(p_chave text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO explicacoes_faltando (chave, vistas)
  VALUES (p_chave, 1)
  ON CONFLICT (chave) DO UPDATE
     SET vistas = explicacoes_faltando.vistas + 1,
         ultima_em = now();
END $$;

-- ------------------------------------------------ RLS e privilegios
ALTER TABLE public.explicacoes_fiscais   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.config_ia             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.explicacoes_faltando  ENABLE ROW LEVEL SECURITY;

-- O cliente le SO o que esta aprovado. Rascunho nao vaza para tela nenhuma —
-- e a trava que faz a revisao humana valer alguma coisa.
DROP POLICY IF EXISTS explicacoes_select_aprovadas ON public.explicacoes_fiscais;
CREATE POLICY explicacoes_select_aprovadas ON public.explicacoes_fiscais
  FOR SELECT USING (status = 'aprovado');

-- Escrita do catalogo: so service role (as actions do admin). Sem policy.
--
-- REVOKE ALL e depois GRANT SELECT, e nao "REVOKE INSERT, UPDATE, DELETE": o
-- default privileges do Supabase concede ALL, e ALL inclui TRUNCATE — que
-- IGNORA RLS. Revogar so os tres verbos obvios deixaria qualquer usuario logado
-- capaz de esvaziar o catalogo inteiro. Conferido no banco, nao suposto.
REVOKE ALL ON public.explicacoes_fiscais FROM anon, authenticated;
GRANT SELECT ON public.explicacoes_fiscais TO anon, authenticated;
GRANT ALL ON public.explicacoes_fiscais TO service_role;

-- CONFIG E SEGREDO: RLS ligada SEM POLICY ja fecha, mas o REVOKE explicito e a
-- licao da 0053/0055 — o ALTER DEFAULT PRIVILEGES do Supabase concede tudo em
-- `public` para anon/authenticated, calado, em TODA tabela nova.
REVOKE ALL ON public.config_ia FROM anon, authenticated;
GRANT ALL ON public.config_ia TO service_role;

-- Faltantes: ninguem le pela sessao; o incremento passa pela funcao acima.
REVOKE ALL ON public.explicacoes_faltando FROM anon, authenticated;
GRANT ALL ON public.explicacoes_faltando TO service_role;

-- A RPC vai SO para `authenticated` — a tela de impostos e gated, entao
-- visitante anonimo nao tem situacao fiscal nenhuma para contar; so teria como
-- inflar o contador de uma funcao SECURITY DEFINER.
--
-- REVOKE de `anon` EXPLICITO: o default privileges do Supabase concede EXECUTE
-- diretamente a anon/authenticated em toda funcao nova, e `REVOKE FROM public`
-- NAO desfaz um grant nominal. Conferido no banco — a primeira versao desta
-- migration achava que tinha fechado, e `anon=X` continuava la.
REVOKE ALL ON FUNCTION public.registrar_explicacao_faltando(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.registrar_explicacao_faltando(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_explicacao_faltando(text) TO service_role;

COMMENT ON TABLE public.explicacoes_fiscais IS
  'Catalogo de explicacoes por SITUACAO fiscal (nunca por cliente). Texto com marcadores; a tela preenche os valores.';
COMMENT ON TABLE public.config_ia IS
  'Linha unica. chave_cifrada SEMPRE com prefixo enc:v1:. Fechada para anon/authenticated.';
COMMENT ON TABLE public.explicacoes_faltando IS
  'Situacao exibida sem texto aprovado, contada. E o que faz o catalogo crescer por demanda real em vez de adivinhacao.';

-- Tabelas e RPC novas: rodar `node app/scratchpad/_reload-postgrest.mjs`.
