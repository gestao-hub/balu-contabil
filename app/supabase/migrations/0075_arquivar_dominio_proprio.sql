-- Arquiva a funcionalidade de dominio proprio (decisao do usuario, 12/08/2026).
-- Mapa de restauracao: docs/arquivo/2026-08-12-dominio-proprio-README.md
--
-- Motivo: o cliente NAO pediu dominio proprio. Na devolutiva (3.4) ele marcou
-- logo, nome, WhatsApp e "e-mails com a marca do escritorio"; dominio veio do
-- PRD Master. O SLA FICA — esse ele pediu, e segue funcionando.
--
-- O que esta migration derruba e o que ela NAO derruba, e por que:
--
-- DERRUBA — superficie publica de verdade. As duas RPCs eram executaveis por
-- `anon` (precisavam ser: a tela de login sob o dominio proprio roda sem
-- sessao). Codigo removido com RPC viva no banco e uma porta aberta sem
-- ninguem olhando — o pior tipo de sobra.
--
-- NAO DERRUBA — as colunas. Apagar coluna e irreversivel e nao devolve nada
-- em troca: elas ficam vazias, sem grant e sem leitor. Manter faz o retorno da
-- feature ser questao de codigo, nao de migration, e nenhum dado se perde no
-- caminho.

DROP FUNCTION IF EXISTS public.branding_por_host(text);
DROP FUNCTION IF EXISTS public.dominio_token_por_host(text);

-- Sem as RPCs, a sessao tambem nao tem mais motivo pra ler as colunas. Isto
-- desfaz o GRANT da 0074 SO para o dominio; `sla_resposta_horas`,
-- `asaas_subconta_criada_por`, `conta_destino_resumo` e `conta_destino_em`
-- continuam concedidas, porque as telas delas continuam de pe.
REVOKE SELECT (
  dominio_customizado,
  dominio_status,
  dominio_verificado_em,
  dominio_erro
) ON public.contabilidades FROM authenticated;

-- Limpa o que o smoke de 12/08 deixou gravado, pra nao ficar dado de teste
-- apontando pra uma feature que nao existe mais.
UPDATE public.contabilidades
SET dominio_customizado = NULL, dominio_token = NULL, dominio_status = 'pendente',
    dominio_verificado_em = NULL, dominio_erro = NULL
WHERE dominio_customizado IS NOT NULL OR dominio_token IS NOT NULL;

COMMENT ON COLUMN public.contabilidades.dominio_customizado IS
  'DORMENTE desde 12/08/2026 — funcionalidade de dominio proprio arquivada (docs/arquivo/2026-08-12-dominio-proprio-README.md). Coluna mantida para restauracao sem migration.';
