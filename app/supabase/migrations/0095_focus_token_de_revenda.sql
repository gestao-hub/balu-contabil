-- 0095 — corrige a 0094: a Focus tem UM token de revenda, não dois por ambiente.
--
-- O QUE A 0094 ERROU. Ela criou `config_focus.token_hom_cifrado` e
-- `token_prod_cifrado` supondo que o token de revenda tivesse uma versão por
-- ambiente, e migrou para lá o `FOCUS_NFE_HOMOLOGAÇÃO` e o
-- `FOCUS_NFE_TOKEN_PRODUÇÃO` do `.env.local`.
--
-- COMO SE DESCOBRIU. Sondando a Focus de verdade, em 20/08/2026:
--
--   GET /v2/codigos_cnae/6201501  com os dois tokens → 200  (parecia certo)
--   GET /v2/empresas/216964       com os dois tokens → 401
--   GET /v2/empresas/1            com os dois tokens → 401
--
-- 401 até para um id qualquer significa que esses tokens NÃO têm acesso à API
-- de revenda — não que apontem para outra conta. Ou seja: nenhum dos dois é o
-- token de revenda. O de revenda é o `FOCUS_NFE_TOKEN` que existe só nas
-- variáveis de produção da Vercel (valor "Sensitive", que o `vercel env pull`
-- devolve como `[SENSITIVE]` e portanto não dá para conferir daqui).
--
-- Tivesse a 0094 ido para produção como estava, `criarEmpresa`,
-- `consultarEmpresa` e `atualizarEmpresa` passariam a mandar um token sem
-- acesso à revenda — e o cadastro de empresa quebraria, porque o valor do banco
-- vence o da variável de ambiente.
--
-- O MODELO CERTO, que é o que `lib/clients/focus-nfe.ts` sempre usou:
--   - UM token de revenda, para `/v2/empresas*`, `/v2/cnpjs`, `/v2/codigos_cnae`
--     e `/v2/municipios`. A revenda só existe em `api.focusnfe.com.br`.
--   - A emissão NÃO usa este token: usa o token DA EMPRESA, que a Focus devolve
--     no POST /v2/empresas e que mora em `companies.focus_token`.
-- O par hom/prod pertence ao token da empresa, não ao da revenda.
--
-- Aditiva e idempotente: pode rodar 2x sem erro.

ALTER TABLE public.config_focus
  ADD COLUMN IF NOT EXISTS token_revenda_cifrado text;

-- As duas colunas da 0094 saem, e com elas os valores migrados por engano.
-- Não é perda: o que estava ali não servia para o que a coluna prometia, e
-- deixar um segredo inútil guardado é pior que não guardar nada — alguém
-- confiaria nele.
ALTER TABLE public.config_focus
  DROP COLUMN IF EXISTS token_hom_cifrado,
  DROP COLUMN IF EXISTS token_prod_cifrado;

COMMENT ON COLUMN public.config_focus.token_revenda_cifrado IS
  'Token de REVENDA da Focus, cifrado (enc:v1:). Único válido em /v2/empresas*. '
  'A emissão usa companies.focus_token, que é por empresa e não vem daqui.';

COMMENT ON TABLE public.config_focus IS
  'Token de revenda da Focus NFe, cifrado. Singleton id=1. Lido só pelo '
  'service_role; a tela é /admin/configuracoes/focus.';
