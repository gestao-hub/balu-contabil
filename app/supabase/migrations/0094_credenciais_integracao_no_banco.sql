-- 0094 — credenciais de integração no banco, não em variável de ambiente.
--
-- MOTIVO CONCRETO, não preferência de arquitetura: em 20/08/2026 o `.env.local`
-- tinha `FOCUS_NFE_TOKEN_PRODUÇÃO` e `FOCUS_NFE_HOMOLOGAÇÃO`, e o código lê
-- `process.env.FOCUS_NFE_TOKEN` (lib/clients/focus-nfe.ts, focus-municipios.ts).
-- Nome com acento, nome que ninguém lê: toda chamada à Focus morria em
-- "FOCUS_NFE_TOKEN não configurado" — em silêncio, sem tela que denunciasse.
-- Variável de ambiente erra de nome sem avisar; formulário com campo nomeado,
-- não. É o mesmo raciocínio da 0091 (o token da uazapi saiu do ambiente).
--
-- MOLDE: `config_ia` da 0056 — singleton `id = 1`, segredo SEMPRE cifrado
-- (prefixo `enc:v1:`, envelope AES-256-GCM de lib/crypto/envelope.ts), tabela
-- fechada para as roles do cliente e escrita só pelas actions do AdminBalu.
--
-- Aditiva e idempotente: pode rodar 2x sem erro.

-- ------------------------------------------------ Focus NFe (token de revenda)
--
-- Dois tokens porque a Focus emite dois, e são valores DIFERENTES: o de
-- homologação e o de produção. Guardar um campo só foi o erro que já mora em
-- `companies.focus_token` (grava `token_homologacao ?? token_producao` e depois
-- não sabe qual tem) — não repetir aqui.
--
-- Qual dos dois é usado NÃO se decide nesta tabela: quem decide é o `FocusEnv`
-- do ponto de emissão. Esta tabela só guarda; o Bloco 5 é que vai escolher.
CREATE TABLE IF NOT EXISTS public.config_focus (
  id                 int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  -- SEMPRE cifrados (prefixo enc:v1:). Nunca voltam para a tela.
  token_hom_cifrado  text,
  token_prod_cifrado text,
  atualizado_por     uuid,
  atualizado_em      timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------ SERPRO Integra Contador
--
-- SEM coluna de ambiente, de propósito. `lib/clients/serpro.ts` tem um
-- `SerproEnv 'prod'|'trial'`, mas ele só alcança o caminho `call()`/
-- SERPRO_SERVICES, que NENHUM código de produto chama: o caminho real é
-- `requestComProcurador`, com `/integra-contador/v1/...` fixo em produção
-- (conferido nos importadores em 20/08/2026 — todos usam *ComProcurador).
-- Guardar um seletor de ambiente aqui seria um botão que não liga nada, e o
-- admin passaria a acreditar que trocou de ambiente sem ter trocado.
CREATE TABLE IF NOT EXISTS public.config_serpro (
  id                      int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  consumer_key_cifrado    text,
  consumer_secret_cifrado text,
  atualizado_por          uuid,
  atualizado_em           timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------ privilégios
--
-- Estas duas tabelas guardam a credencial que fala com a Receita e com a
-- prefeitura em nome de TODOS os clientes. Não há leitura legítima pela sessão
-- do usuário: quem lê é a action do AdminBalu, pelo service_role.
ALTER TABLE public.config_focus  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.config_serpro ENABLE ROW LEVEL SECURITY;

-- REVOKE ALL (e não "REVOKE SELECT, INSERT, UPDATE, DELETE"): o default
-- privileges do Supabase concede ALL, e ALL inclui TRUNCATE — que IGNORA RLS.
-- Mesma lição registrada na 0056 e reconfirmada na 0090.
REVOKE ALL ON public.config_focus  FROM anon, authenticated;
REVOKE ALL ON public.config_serpro FROM anon, authenticated;
GRANT  ALL ON public.config_focus  TO service_role;
GRANT  ALL ON public.config_serpro TO service_role;

COMMENT ON TABLE public.config_focus IS
  'Tokens de revenda da Focus NFe (hom e prod), cifrados. Singleton id=1. '
  'Lido só pelo service_role; a tela é /admin/configuracoes/focus.';

COMMENT ON TABLE public.config_serpro IS
  'Credenciais do SERPRO Integra Contador (consumer key/secret), cifradas. '
  'Singleton id=1. Lido só pelo service_role; a tela é '
  '/admin/configuracoes/serpro. O certificado do contratante mora em '
  'serpro_contratante, que já existia.';
