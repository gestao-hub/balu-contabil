-- Frente 3 (avisos de pagamento) — Task 3: carimbo da ultima consulta de
-- pagamentos na SERPRO, por empresa.
--
-- POR QUE UMA COLUNA, E NAO UM PROXY
-- A varredura diaria nao cabe inteira no cron (uma chamada PAGTOWEB por
-- empresa, dentro de um `maxDuration` de 60s compartilhado com tudo o mais), e
-- por isso ela se corta por orcamento e continua no dia seguinte. Isso so e
-- justo se a fila souber QUEM ficou para tras — senao o corte pega sempre as
-- mesmas empresas do comeco da lista e as ultimas nunca sao consultadas.
--
-- O proxy obvio (`max(guias_fiscais.updated_at)`) nao serve: consulta que nao
-- encontra pagamento novo nao escreve nada em guia nenhuma. A empresa
-- consultada todo dia continuaria parecendo a mais antiga e voltaria para a
-- frente da fila para sempre.
--
-- O carimbo e gravado DEPOIS da consulta, com sucesso ou com falha: o que ele
-- registra e "esta empresa ja teve a vez dela hoje", nao "deu certo".
ALTER TABLE public.empresas_fiscais
  ADD COLUMN IF NOT EXISTS consulta_pagamentos_serpro_em timestamptz;

COMMENT ON COLUMN public.empresas_fiscais.consulta_pagamentos_serpro_em IS
  'Ultima vez que o cron consultou DAS pagos (PAGTOWEB/PAGAMENTOS71) para esta empresa. Ordena a fila do cron; NULL = nunca consultada, entra primeiro.';
