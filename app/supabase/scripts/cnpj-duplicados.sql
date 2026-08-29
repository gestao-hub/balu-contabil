-- Diagnóstico da regra de 29/08/2026: um CNPJ, uma empresa ativa.
-- Rode ANTES da migration 0106 — ela aborta se este resultado não vier vazio.
--
--   node scripts/rodar-sql.mjs supabase/scripts/cnpj-duplicados.sql
--
-- Para cada CNPJ listado, decida qual linha é a boa (regra: a empresa fica com
-- UM escritório) e desligue as outras com soft delete:
--
--   update public.companies set deleted_at = now() where id = '<id>';
--
-- Soft delete e não DELETE: notas, guias e apurações apontam para a empresa, e
-- o índice da 0106 já ignora linha com `deleted_at` — apagar de verdade não é
-- necessário e levaria histórico fiscal junto.
SELECT
  c.cnpj,
  count(*)                                             AS linhas_ativas,
  array_agg(c.id ORDER BY c.created_at)                AS company_ids,
  array_agg(DISTINCT c.contabilidade_id)               AS escritorios,
  count(DISTINCT c.contabilidade_id)
    FILTER (WHERE c.contabilidade_id IS NOT NULL)      AS qtd_escritorios,
  count(*) FILTER (WHERE c.user_id IS NULL)            AS sem_dono,
  min(c.created_at)                                    AS primeira,
  max(c.created_at)                                    AS ultima
FROM public.companies c
WHERE c.deleted_at IS NULL
  AND c.cnpj IS NOT NULL
GROUP BY c.cnpj
HAVING count(*) > 1
ORDER BY count(*) DESC, max(c.created_at) DESC;
