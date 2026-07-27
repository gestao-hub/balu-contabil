-- 0051 — Liberação manual de acesso pelo admin da Balu.
--
-- POR QUE UMA COLUNA E NÃO "botar status = ativa": quem paga por boleto fica
-- bloqueado até a compensação (1 a 3 dias úteis). Marcar 'ativa' na mão
-- resolveria por algumas horas e seria DESFEITO sozinho: a reconciliação
-- (lib/billing/reconciliar.ts) lê as cobranças no Asaas e, no dia do
-- vencimento, um boleto ainda não compensado vira OVERDUE → 'inadimplente'.
-- O cliente que mandou o comprovante seria bloqueado de novo na madrugada.
--
-- A liberação vive num campo PRÓPRIO, com prazo. Nada que venha do Asaas a
-- apaga, e ela expira sozinha — nenhuma liberação é eterna por esquecimento.
--
-- Quando o pagamento cair de verdade, o webhook põe 'ativa' normalmente e a
-- liberação simplesmente deixa de importar (o status já libera).

ALTER TABLE public.assinaturas
  -- Data civil (BRT), YYYY-MM-DD, comparada como string em statusEfetivo.
  -- NULL = sem liberação manual.
  ADD COLUMN IF NOT EXISTS liberado_ate     date,
  -- Por que foi liberado. Obrigatório na aplicação: uma liberação sem
  -- justificativa é indistinguível de um erro de clique meses depois.
  ADD COLUMN IF NOT EXISTS liberacao_motivo text,
  ADD COLUMN IF NOT EXISTS liberacao_por    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS liberacao_em     timestamptz;

COMMENT ON COLUMN public.assinaturas.liberado_ate IS
  'Liberação manual do admin da Balu (comprovante de boleto ainda não compensado). Libera o gate até esta data, independente do status. Expira sozinha.';

-- Índice parcial: as consultas de acompanhamento ("quais liberações estão de
-- pé?") olham só as linhas com liberação — que são poucas.
CREATE INDEX IF NOT EXISTS assinaturas_liberado_ate_idx
  ON public.assinaturas (liberado_ate)
  WHERE liberado_ate IS NOT NULL;

-- A RLS de leitura já existente (assinaturas_select_titular) cobre as colunas
-- novas: policy é por LINHA, não por coluna. O titular passa a enxergar que
-- está liberado até tal dia — que é exatamente o que ele precisa saber.
--
-- A ESCRITA continua sem policy de UPDATE para o titular: só o service role
-- (admin client) grava aqui, a partir da tela do admin da Balu. Sem isso,
-- qualquer titular poderia liberar a si mesmo.
