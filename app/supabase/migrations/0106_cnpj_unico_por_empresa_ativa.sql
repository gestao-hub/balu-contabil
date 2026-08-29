-- 0106 — um CNPJ, uma empresa ativa. Fecha a duplicidade entre escritórios.
--
-- ACHADO (auditoria funcional de 29/08/2026): o painel do AdminBalu mostrava o
-- MESMO CNPJ ativo em registros pertencentes a contas diferentes. A auditoria
-- não classificou como quebra de tenant porque faltava a regra de negócio.
-- Ela veio em 29/08: **um CNPJ não pode existir em dois escritórios**. Numa
-- troca de contador, a empresa é DESLIGADA do escritório atual e só então
-- ligada ao novo — nunca duplicada.
--
-- POR QUE O ÍNDICE DE HOJE NÃO PEGA NADA DISSO. A 0001 (linha 299) criou:
--
--   companies_owner_cnpj_uniq on companies (user_id, cnpj) where deleted_at is null
--
-- Ele nunca teve a intenção de ser único global — e, no caminho que mais
-- importa, não é único de jeito nenhum: empresa cadastrada PELO ESCRITÓRIO
-- nasce com `user_id` NULL (por desenho, `criarEmpresaClienteAction`), e no
-- Postgres NULL nunca colide com NULL. Duas linhas com user_id NULL e o MESMO
-- CNPJ passam pelo índice sem reclamar. Ou seja: o caminho do contador, que é
-- o que mais cria empresa no produto, não tinha trava nenhuma.
--
-- O NOVO ÍNDICE é global e parcial:
--   * `cnpj is not null` — empresa em abertura nasce sem CNPJ (`status =
--     'em_abertura'`, ver `criarAberturaClienteAction`). Sem esta cláusula,
--     a segunda abertura simultânea quebraria.
--   * `deleted_at is null` — o produto usa soft delete. Uma empresa excluída
--     não pode reservar o CNPJ dela para sempre.
--
-- SUBSTITUI o índice antigo, que passa a ser redundante: unicidade global de
-- `cnpj` é estritamente mais forte que unicidade de `(user_id, cnpj)`.
--
-- ─── ANTES DE APLICAR: CONFIRA OS DADOS ────────────────────────────────────
--
-- Esta migration ABORTA se houver duplicata — de propósito. Ela não escolhe
-- qual linha sobrevive: essa decisão é de negócio (qual escritório fica com o
-- cliente) e não pode ser tomada por um script. Rode isto ANTES para ver o
-- tamanho do problema:
--
--   select cnpj,
--          count(*) as linhas,
--          array_agg(id) as company_ids,
--          array_agg(distinct contabilidade_id) as escritorios,
--          array_agg(distinct user_id) as donos
--     from public.companies
--    where deleted_at is null and cnpj is not null
--    group by cnpj
--   having count(*) > 1
--    order by count(*) desc;
--
-- Para cada CNPJ listado, decida qual linha é a boa e desligue/exclua as
-- outras (soft delete: `update companies set deleted_at = now() where id = …`).
-- Só então aplique esta migration.

-- ─── PARTE 1: a guarda que impede aplicação sobre dado sujo ────────────────
DO $$
DECLARE
  duplicados integer;
  amostra text;
BEGIN
  SELECT count(*) INTO duplicados
    FROM (
      SELECT cnpj
        FROM public.companies
       WHERE deleted_at IS NULL AND cnpj IS NOT NULL
       GROUP BY cnpj
      HAVING count(*) > 1
    ) d;

  IF duplicados > 0 THEN
    -- Só a QUANTIDADE de linhas por CNPJ na mensagem; o CNPJ inteiro fica para
    -- a consulta de diagnóstico acima, que o operador roda deliberadamente.
    SELECT string_agg(format('…%s (%s linhas)', right(cnpj, 4), n), ', ')
      INTO amostra
      FROM (
        SELECT cnpj, count(*) AS n
          FROM public.companies
         WHERE deleted_at IS NULL AND cnpj IS NOT NULL
         GROUP BY cnpj
        HAVING count(*) > 1
         ORDER BY count(*) DESC
         LIMIT 5
      ) t;

    RAISE EXCEPTION
      'ABORTADO: % CNPJ(s) com mais de uma empresa ativa. Resolva antes de aplicar (ver a consulta de diagnóstico no topo desta migration). Amostra: %',
      duplicados, amostra;
  END IF;
END $$;

-- ─── PARTE 2: a trava ──────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS companies_cnpj_ativo_uniq
  ON public.companies (cnpj)
  WHERE cnpj IS NOT NULL AND deleted_at IS NULL;

COMMENT ON INDEX public.companies_cnpj_ativo_uniq IS
  'Um CNPJ, uma empresa ativa (regra de 29/08/2026). Troca de contador desliga do escritório atual e religa no novo — nunca duplica a empresa. Parcial: em_abertura não tem CNPJ, e soft delete libera o CNPJ.';

-- ─── PARTE 3: remove o índice que virou redundante ─────────────────────────
-- Unicidade global de `cnpj` implica unicidade de `(user_id, cnpj)`. Manter os
-- dois só custaria escrita e daria a impressão de que existem duas regras.
DROP INDEX IF EXISTS public.companies_owner_cnpj_uniq;
