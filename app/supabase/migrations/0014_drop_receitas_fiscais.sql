-- 0014_drop_receitas_fiscais.sql
--
-- Remove a tabela `receitas_fiscais` (DECISÃO FINAL 2026-05-31: opção (b)).
--
-- Contexto: `receitas_fiscais` é uma tabela ÓRFÃ — investigação em 2026-05-29
-- confirmou que NENHUM gravador existe (nem Bubble REST, nem RPC, nem trigger,
-- nem o fluxo n8n, nem o app Next). O webhook `consolidar_receitas_fiscais`
-- apenas LÊ (getAll). Os dados foram esvaziados em 2026-05-28 sem backup.
--
-- A fonte canônica de receita para apuração passou a ser `notas_fiscais`
-- (ver src/lib/fiscal/receitas-source.ts :: lerReceitasParaApuracao). Nada no
-- código grava nem lê `receitas_fiscais`, então o drop é seguro.
--
-- CASCADE remove em conjunto: PK, índices (cliente_id/company_id/competencia/status),
-- as FKs próprias (clientes, companies, auth.users), o trigger trg_receitas_fiscais_updated_at
-- e as policies de RLS (select/insert/update/delete da migration 0010). Nenhuma outra
-- tabela referencia `receitas_fiscais` (é folha), logo o CASCADE não tem efeito colateral.

drop table if exists public.receitas_fiscais cascade;
