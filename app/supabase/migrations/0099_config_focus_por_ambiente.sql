-- 0099 — desfaz a 0095: os tokens SÃO por ambiente. O 401 era da CONTA, não do
-- tipo de token.
--
-- O ERRO QUE ISTO CORRIGE. Em 20/08/2026 alguém sondou os dois tokens do
-- `.env.local` (`FOCUS_NFE_HOMOLOGACAO` / `FOCUS_NFE_TOKEN_PRODUCAO`) contra
-- `GET /v2/empresas/:id` — a API que CADASTRA empresa —, viu 401 e concluiu
-- "esses tokens não são de revenda". A 0095 gravou essa conclusão em schema:
-- devolveu a coluna a UM token só e apontou `/v2/empresas*` para ele.
--
-- A conclusão estava errada. O corpo do 401 que a Focus devolveu dizia outra
-- coisa:
--
--   {"codigo":"permissao_negada","mensagem":"Permissão negada no Gateway.
--    Contate o suporte técnico"}
--
-- Isso é permissão FALTANDO NA CONTA em `/v2/empresas`, não um token do tipo
-- errado — a Focus tem um código específico para "token inválido"
-- (`nao_autorizado`) e não foi esse que voltou. O histórico do próprio banco
-- confirma: a MESMA conta cadastrou empresa com sucesso em 09/06/2026, e só
-- passou a levar 401 em `/v2/empresas` a partir de 23/07/2026 — o token não
-- mudou nesse intervalo; o que mudou foi a permissão da conta no Gateway da
-- Focus.
--
-- A MEDIÇÃO QUE PROVA O PAR HOM/PROD (20/08/2026), sondando o catálogo, que é
-- o endpoint que discrimina por token sem depender da permissão quebrada:
--
--   token          homologacao.focusnfe.com.br   api.focusnfe.com.br
--   ------------   ----------------------------  --------------------
--   homologação    200 (/v2/codigos_cnae/6201501)  401
--   produção       401                              200 (/v2/codigos_cnae/6201501)
--
-- Os dois tokens SÃO reconhecidos pela Focus, cada um no seu ambiente — só não
-- servem para `/v2/empresas`, em NENHUM dos dois ambientes, porque essa conta
-- está sem essa permissão específica lá. Enquanto o suporte da Focus não
-- resolver isso, cadastro de empresa fica bloqueado de qualquer forma — com
-- um token ou com dois; não é este schema que resolve.
--
-- O QUE ESTA MIGRATION FAZ: volta `config_focus` a ter os dois campos que a
-- 0094 já tinha criado, com o mesmo par de nomes. Não é reversão cega da 0095
-- — a tabela criada na 0094, o RLS e os grants dela continuam de pé; só as
-- colunas voltam.
--
-- `token_revenda_cifrado` (0095) FICA por enquanto: pode ter algo gravado
-- pela tela de hoje, e derrubar a coluna sem necessidade descartaria esse
-- valor sem motivo. Marcada obsoleta no COMMENT abaixo; sai numa migration
-- futura, depois que a tela nova estiver no ar e confirmada.
--
-- NUMERAÇÃO: existe uma branch `bloco-5-producao-fiscal`, ainda não
-- mesclada nesta, com as migrations 0096, 0097 e 0098. O salto de 0095 para
-- 0099 é proposital — reserva o intervalo para quando aquela branch chegar
-- a `main`, em vez de colidir número com ela.
--
-- Aditiva e idempotente: pode rodar 2x sem erro.

ALTER TABLE public.config_focus
  ADD COLUMN IF NOT EXISTS token_hom_cifrado  text,
  ADD COLUMN IF NOT EXISTS token_prod_cifrado text;

COMMENT ON COLUMN public.config_focus.token_hom_cifrado IS
  'Token de HOMOLOGAÇÃO da Focus para a conta da plataforma, cifrado (enc:v1:). '
  'Válido em homologacao.focusnfe.com.br (ex.: /v2/codigos_cnae); 401 em '
  'api.focusnfe.com.br. NÃO substitui companies.focus_token, que é por empresa '
  'e usado na emissão.';

COMMENT ON COLUMN public.config_focus.token_prod_cifrado IS
  'Token de PRODUÇÃO da Focus para a conta da plataforma, cifrado (enc:v1:). '
  'Válido em api.focusnfe.com.br (ex.: /v2/codigos_cnae); 401 em '
  'homologacao.focusnfe.com.br. NÃO substitui companies.focus_token, que é por '
  'empresa e usado na emissão.';

COMMENT ON COLUMN public.config_focus.token_revenda_cifrado IS
  'OBSOLETA (0099) — nasceu na 0095, que supôs um único token de revenda sem '
  'ambiente. Era engano: os tokens são por ambiente (token_hom_cifrado / '
  'token_prod_cifrado); o 401 em /v2/empresas era permissão da CONTA, não tipo '
  'de token. Mantida por ora para não descartar valor já gravado; nenhum '
  'código novo lê ou grava esta coluna. Candidata a DROP numa migration '
  'futura, depois que a tela nova estiver confirmada em produção.';

COMMENT ON TABLE public.config_focus IS
  'Tokens da Focus NFe para a conta da plataforma, por ambiente (hom/prod), '
  'cifrados. Singleton id=1. Lido só pelo service_role; a tela é '
  '/admin/configuracoes/focus. token_revenda_cifrado é obsoleta — ver comentário '
  'da coluna.';
