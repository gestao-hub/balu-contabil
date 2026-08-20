-- 0096 — Bloco 5: a credencial da Focus passa a ser por empresa.
--
-- Spec: docs/superpowers/specs/2026-08-20-bloco-5-producao-fiscal-design.md
--
-- MODELO HÍBRIDO (decisão D1): cada empresa ou TRAZ a própria conta Focus, ou
-- COMPRA da Balu (cadastrada na conta da plataforma via /v2/empresas). A origem
-- decide o que a plataforma pode fazer: com 'propria' ela NÃO cadastra, NÃO
-- atualiza e NÃO sobe certificado na Focus — o token da empresa não abre
-- /v2/empresas (401 provado em 20/08/2026).
--
-- Aditiva e idempotente: pode rodar 2x sem erro.

ALTER TABLE public.empresas_fiscais
  -- Default 'balu' porque é o que as empresas existentes SÃO: foram cadastradas
  -- pela API de Empresas. Default 'propria' mentiria sobre elas.
  ADD COLUMN IF NOT EXISTS focus_origem text NOT NULL DEFAULT 'balu',
  -- Feature-flag POR EMPRESA, nunca global (decisão D3). Enquanto ninguém
  -- gravar 'prod' à mão, o comportamento é byte a byte o de hoje.
  ADD COLUMN IF NOT EXISTS focus_ambiente text NOT NULL DEFAULT 'hom',
  -- Para origem='propria' a habilitação NÃO é verificável: o snapshot vem de
  -- GET /v2/empresas, bloqueado. Ela é DECLARADA por quem cadastrou. Guardar
  -- declaração na mesma coluna do fato conferido apagaria a diferença.
  ADD COLUMN IF NOT EXISTS focus_producao_declarada boolean NOT NULL DEFAULT false;

ALTER TABLE public.empresas_fiscais
  DROP CONSTRAINT IF EXISTS empresas_fiscais_focus_origem_check,
  ADD CONSTRAINT empresas_fiscais_focus_origem_check
    CHECK (focus_origem IN ('propria', 'balu'));

ALTER TABLE public.empresas_fiscais
  DROP CONSTRAINT IF EXISTS empresas_fiscais_focus_ambiente_check,
  ADD CONSTRAINT empresas_fiscais_focus_ambiente_check
    CHECK (focus_ambiente IN ('hom', 'prod'));

ALTER TABLE public.companies
  -- Cifrados (prefixo enc:v1:). A Focus emite DOIS tokens por empresa e eles
  -- são valores diferentes: o de homologação leva 401 na base de produção e
  -- vice-versa (provado em 20/08/2026). Guardar um campo só foi o erro que
  -- `focus_token` já carrega — não repetir.
  ADD COLUMN IF NOT EXISTS focus_token_hom_cifrado  text,
  ADD COLUMN IF NOT EXISTS focus_token_prod_cifrado text,
  -- Rastro: a tela do empresário mostra que o escritório cadastrou e quando.
  -- Mesmo princípio de cert_enviado_por/em da 0085.
  ADD COLUMN IF NOT EXISTS focus_token_por uuid,
  ADD COLUMN IF NOT EXISTS focus_token_em  timestamptz;

ALTER TABLE public.notas_fiscais
  -- O ambiente em que a nota NASCEU. Sem isto, o dia em que uma empresa virar
  -- 'prod' transforma toda nota antiga de homologação em 404 no PDF, no XML e
  -- no cancelamento — porque a base é escolhida pelo ambiente do MOMENTO.
  ADD COLUMN IF NOT EXISTS ambiente text NOT NULL DEFAULT 'hom';

ALTER TABLE public.notas_fiscais
  DROP CONSTRAINT IF EXISTS notas_fiscais_ambiente_check,
  ADD CONSTRAINT notas_fiscais_ambiente_check
    CHECK (ambiente IN ('hom', 'prod'));

COMMENT ON COLUMN public.empresas_fiscais.focus_origem IS
  'propria = o cliente traz a conta Focus dele; balu = cadastrada na conta da plataforma.';
COMMENT ON COLUMN public.empresas_fiscais.focus_producao_declarada IS
  'Habilitação de NFS-e produção DECLARADA por quem cadastrou (origem propria). Nao e fato conferido na Focus.';
COMMENT ON COLUMN public.notas_fiscais.ambiente IS
  'Ambiente em que a nota foi emitida. Manda nas leituras posteriores (status, download, cancelamento).';
