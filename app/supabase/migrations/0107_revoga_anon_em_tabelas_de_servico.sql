-- 0107 — tira `anon` e `authenticated` de duas tabelas que só o backend usa.
--
-- ─── O QUE A AUDITORIA DE 01/09/2026 MEDIU ──────────────────────────────────
-- A consulta 3 de `rls-audit.sql` (grant efetivo SEM RLS que o contenha) apontou
-- `rate_limit_hits` e `serpro_contratante`. Olhando os grants por inteiro, é
-- mais largo do que aquela consulta mostrava:
--
--   rate_limit_hits     anon, authenticated  ->  DELETE, INSERT, SELECT, UPDATE
--   serpro_contratante  anon, authenticated  ->  DELETE, INSERT, SELECT, UPDATE
--
-- São os grants que o Supabase concede por default privilege a toda tabela nova
-- do schema `public`. Ninguém os pediu.
--
-- ─── POR QUE ISTO NÃO É URGENTE, E MESMO ASSIM É PARA FAZER ─────────────────
-- Hoje o grant é INERTE, e isso foi provado ao vivo com a chave anon
-- (`security-evidence/2026-09-01/BAAS-RLS-anon-probe.txt`): as duas tabelas têm
-- RLS ligada e ZERO policies, então o SELECT devolve 0 linhas e o INSERT morre
-- com 42501. Não há vazamento hoje.
--
-- O que se fecha aqui é o dia seguinte. A única coisa entre o grant e o acesso é
-- a AUSÊNCIA de policy — um estado que ninguém declarou e que uma policy nova,
-- adicionada por outro motivo, desfaz sem aviso. `serpro_contratante` guarda os
-- dados do contratante SERPRO; `rate_limit_hits` é o estado do rate limiting, e
-- INSERT ali por `anon` seria envenenar o próprio freio contra abuso.
--
-- ─── POR QUE É SEGURO ───────────────────────────────────────────────────────
-- Medido antes de escrever: as duas tabelas são acessadas EXCLUSIVAMENTE por
-- `createAdminClient()` (service_role) —
--   `lib/security/rate-limit.ts:8`
--   `admin/configuracoes/serpro/actions.ts:55,229,322`
-- Nenhum caminho do produto chega nelas com a sessão do usuário, então revogar
-- não tira capacidade de ninguém.
--
-- `service_role` e `postgres` NÃO são tocados: são eles que operam as tabelas.
--
-- Aditiva e idempotente: `REVOKE` de privilégio que já não existe é no-op.

REVOKE ALL ON TABLE public.rate_limit_hits    FROM anon, authenticated;
REVOKE ALL ON TABLE public.serpro_contratante FROM anon, authenticated;

COMMENT ON TABLE public.rate_limit_hits IS
  'Estado do rate limiting. SOMENTE service_role — anon/authenticated revogados na 0107.';
COMMENT ON TABLE public.serpro_contratante IS
  'Dados do contratante SERPRO. SOMENTE service_role — anon/authenticated revogados na 0107.';
