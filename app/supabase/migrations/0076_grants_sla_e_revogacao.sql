-- Fecha dois defeitos que o /code-review de 12/08 achou, no lugar certo: no
-- banco, e nao contornando o banco com service_role.
--
-- ── 1. Salvar o SLA nunca funcionou ───────────────────────────────────────
-- A 0053 revogou o UPDATE de TABELA em `contabilidades` e reconcedeu coluna a
-- coluna (nome, logo_url, whatsapp_suporte, email_remetente_nome).
-- `sla_resposta_horas` nasceu na 0069, DEPOIS disso — e GRANT por coluna nao
-- alcanca coluna nova. Resultado: `salvarSlaAction` levava "permission denied"
-- e a funcionalidade inteira de SLA era inerte.
--
-- Mesma armadilha que a 0074 corrigiu para SELECT. Ela existe duas vezes
-- porque privilegio de SELECT e de UPDATE sao listas separadas — corrigir uma
-- nao corrige a outra, e nada avisa.
--
-- A policy de linha ja existe (`contabilidades_update_membro`: id =
-- minha_contabilidade_membro()), entao o grant de coluna e tudo que falta
-- para a sessao voltar a escrever com a RLS como fronteira.
GRANT UPDATE (sla_resposta_horas) ON public.contabilidades TO authenticated;

-- ── 2. Revogar consentimento de Open Finance nunca funcionou ──────────────
-- A 0071 concedeu so SELECT de `conciliacao_transacoes` a `authenticated`
-- ("extrato nao se edita a mao; quem escreve e o cron"). A regra continua
-- certa para escrita — mas APAGAR o proprio extrato nao e edicao: e o titular
-- exercendo o art. 18, VI da LGPD. Sem isto, `desconectarContaAction` falhava
-- e o dado bancario ficava no banco depois de o consentimento ser retirado.
GRANT DELETE ON public.conciliacao_transacoes TO authenticated;

DROP POLICY IF EXISTS conciliacao_transacoes_delete_dono ON public.conciliacao_transacoes;
CREATE POLICY conciliacao_transacoes_delete_dono ON public.conciliacao_transacoes
  FOR DELETE USING (public.user_owns_company(company_id));

-- Continua sem INSERT e sem UPDATE de propósito: o extrato e escrito pelo
-- cron (service_role) e nao pode ser inventado nem corrigido pela tela.
