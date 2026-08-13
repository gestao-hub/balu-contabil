-- Persistir `status = 'vencida'` em guias_fiscais (card Impostos P2.2).
--
-- Ate aqui "vencida" existia so na tela: HistoricoGuias calculava
-- `isGuiaVencida(vencimento, status)` na renderizacao e pintava o badge, com o
-- comentario "nao muta o status do banco; vira write quando o cron rodar".
-- Este e o cron.
--
-- O que muda de verdade: filtro, relatorio e qualquer consulta fora do React
-- passam a enxergar o mesmo que o usuario ve. Um estado que so existe no
-- componente nao pode ser contado nem agrupado.
--
-- O AVISO AO CLIENTE NAO DEPENDE DISTO E NAO MUDA. Quem notifica DAS vencido e
-- `materializar_obrigacoes` (0045b), que decide por `data_pagamento IS NULL` e
-- `status <> 'erro'` — nunca por `status = 'gerada'`. Conferido antes de
-- escrever: marcar 'gerada' -> 'vencida' nao remove nenhuma guia daquela CTE,
-- e a fila de WhatsApp da 0065 tambem filtra por data_pagamento. Nenhum aviso
-- e ganho nem perdido aqui.
--
-- MESMA REGRA DA TELA, de proposito: vencimento < hoje em America/Sao_Paulo.
-- `isGuiaVencida` compara contra 23:59:59-03:00 do dia do vencimento, ou seja,
-- so vence no dia seguinte — `data_vencimento < hoje` e a traducao exata disso
-- para data. Se as duas divergirem, o badge e o banco passam a discordar num
-- dia por mes, que e o pior tipo de bug para reproduzir.
--
-- SO 'gerada' VIRA 'vencida'. Nao toca em:
--   'paga'    — obvio;
--   'erro'    — a geracao falhou; virar 'vencida' apagaria a causa e faria a
--               guia parecer emitida e nao paga, que e outra historia;
--   'gerando' — ainda esta sendo emitida; nao existe guia para vencer.
-- A tela continua com a regra visual mais larga (qualquer nao-paga vencida
-- aparece como vencida), entao nada muda no que o usuario ve — o que muda e o
-- que fica gravado.
--
-- Idempotente: rodar duas vezes no mesmo dia atualiza zero linhas. Um sync do
-- SERPRO que regrave 'gerada' por cima e corrigido na proxima passada do cron;
-- por isso a funcao e um UPDATE simples e nao uma transicao de uma via so.
CREATE OR REPLACE FUNCTION public.marcar_guias_vencidas(
  p_hoje date DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_n integer;
BEGIN
  UPDATE public.guias_fiscais
     SET status = 'vencida', updated_at = now()
   WHERE deleted_at IS NULL
     AND status = 'gerada'
     AND data_pagamento IS NULL
     AND data_vencimento IS NOT NULL
     AND data_vencimento < p_hoje;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

COMMENT ON FUNCTION public.marcar_guias_vencidas(date) IS
  'Grava status=vencida nas guias geradas, nao pagas e com vencimento anterior a hoje (BRT). Mesma regra de isGuiaVencida. Chamada pelo /api/cron/obrigacoes.';

-- Quem chama e o cron, com service_role. Ninguem mais precisa: a tela nunca
-- decidiu vencimento por escrita, e nao passa a decidir agora.
REVOKE ALL ON FUNCTION public.marcar_guias_vencidas(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.marcar_guias_vencidas(date) TO service_role;
