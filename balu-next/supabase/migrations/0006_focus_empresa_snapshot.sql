-- @custom — Focus 2.0: snapshot do estado da empresa na Focus em `empresas_fiscais`.
--
-- A Focus NÃO expõe metadados de município via API (não há GET /v2/municipios;
-- a info vive nas páginas de guide em HTML). O que ela expõe via API são as
-- FLAGS POR-EMPRESA (`habilita_nfse`, `habilita_nfsen_*`, `codigo_municipio`)
-- via GET /v2/empresas/:id. Estas colunas armazenam esse snapshot — atualizado
-- após cada POST/PUT bem-sucedido na Focus — pra que a aba "Saúde da empresa"
-- possa renderizar o estado real sem chamar a Focus a cada page load.
--
-- focus_empresa_id: id numérico que a Focus devolve no POST (chave pro GET).
-- focus_codigo_municipio: IBGE do município (confirma identidade pra cross-check).
-- focus_habilita_nfse: padrão municipal antigo (caminho legado).
-- focus_habilita_nfsen_producao/homologacao: NFSe Nacional (caminho novo;
--   Londrina migrou em 01/01/2026 — Decreto 1.627/2025).
-- focus_sync_em: quando foi a última sincronização Focus → snapshot.
--
-- Mutualmente exclusivo na Focus em produção:
-- `habilita_nfse` XOR `habilita_nfsen_producao`. O PUT do Focus 2.1 vai
-- escolher entre os dois com base na adesão da cidade ao Nacional.

ALTER TABLE public.empresas_fiscais
  ADD COLUMN IF NOT EXISTS focus_empresa_id                 INTEGER     NULL,
  ADD COLUMN IF NOT EXISTS focus_codigo_municipio           TEXT        NULL,
  ADD COLUMN IF NOT EXISTS focus_habilita_nfse              BOOLEAN     NULL,
  ADD COLUMN IF NOT EXISTS focus_habilita_nfsen_producao    BOOLEAN     NULL,
  ADD COLUMN IF NOT EXISTS focus_habilita_nfsen_homologacao BOOLEAN     NULL,
  ADD COLUMN IF NOT EXISTS focus_sync_em                    TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.empresas_fiscais.focus_empresa_id                 IS 'ID numérico da empresa na Focus (devolvido no POST /v2/empresas).';
COMMENT ON COLUMN public.empresas_fiscais.focus_codigo_municipio           IS 'Código IBGE do município conforme a Focus (cross-check com companies.codigo_municipio).';
COMMENT ON COLUMN public.empresas_fiscais.focus_habilita_nfse              IS 'NFS-e padrão municipal antigo habilitada na Focus.';
COMMENT ON COLUMN public.empresas_fiscais.focus_habilita_nfsen_producao    IS 'NFSe Nacional (produção) habilitada na Focus.';
COMMENT ON COLUMN public.empresas_fiscais.focus_habilita_nfsen_homologacao IS 'NFSe Nacional (homologação) habilitada na Focus.';
COMMENT ON COLUMN public.empresas_fiscais.focus_sync_em                    IS 'Última sincronização Focus → snapshot.';
