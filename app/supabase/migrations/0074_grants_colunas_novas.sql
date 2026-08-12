-- Conserta um efeito colateral silencioso das 0069 e 0073.
--
-- A 0053 revogou o SELECT de TABELA em `contabilidades` e reconcedeu coluna a
-- coluna (para manter `asaas_api_key_cifrada` fora do alcance da sessao). O
-- detalhe que morde: **GRANT por coluna nao alcanca coluna criada depois**.
--
-- Resultado observado no smoke de 12/08: a tela "Conta de recebimento" lia
-- `asaas_subconta_criada_por` e `conta_destino_resumo` pela SESSAO, o select
-- inteiro falhava por permissao, `cont` vinha nulo — e a pagina concluia "este
-- escritorio nao tem subconta", oferecendo criar uma segunda. O mesmo valia
-- para dominio/SLA em /contador/configuracoes, que renderizava com os valores
-- default como se nada estivesse cadastrado.
--
-- ⚠️ Falha silenciosa por natureza: `.maybeSingle()` devolve `data: null` e o
-- erro so aparece se alguem olhar `error`. Nao ha excecao, nao ha log.
--
-- O que NAO entra neste grant, de proposito:
--   • `asaas_api_key_cifrada` — a chave que movimenta dinheiro de terceiro.
--   • `conta_destino_cifrada` — dados bancarios completos; a tela usa so o
--     `conta_destino_resumo` (sem CPF, sem conta inteira), e quem precisa dos
--     dados de verdade e a action de saque, que roda com service_role.
--   • `dominio_token` — o token de verificacao de dominio tem RPC propria
--     (`dominio_token_por_host`), que devolve o token DAQUELE host e nada mais.
GRANT SELECT (
  dominio_customizado,
  dominio_status,
  dominio_verificado_em,
  dominio_erro,
  sla_resposta_horas,
  asaas_subconta_criada_por,
  conta_destino_resumo,
  conta_destino_em
) ON public.contabilidades TO authenticated;
