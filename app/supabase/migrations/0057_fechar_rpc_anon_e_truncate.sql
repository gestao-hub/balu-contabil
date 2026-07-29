-- 0057 — fecha o que o default privileges do Supabase abriu sozinho.
--
-- COMO ISTO FOI DESCOBERTO. Ao conferir o EFEITO da 0056 no banco (e nao o SQL
-- dela ter rodado), apareceram dois privilegios que ninguem escreveu: TRUNCATE
-- para anon/authenticated na tabela nova, e EXECUTE da RPC nova para anon. A
-- causa esta em `pg_default_acl`: a role `postgres` — que e quem roda nossas
-- migrations — tem default privilege `anon=arwdDxtm` para TABELAS e `anon=X`
-- para FUNCOES em `public`. Ou seja: toda tabela e toda funcao nascem abertas,
-- em silencio, desde a 0001.
--
-- O QUE ISSO VALIA NA PRATICA (verificado por HTTP com a anon key, que e
-- publica e roda no navegador):
--   POST /rest/v1/rpc/notificacoes_pendentes_email  -> 200 com e-mail e conteudo
--        de notificacao de TODOS os usuarios, sem login. Vazamento de dado
--        pessoal.
--   POST /rest/v1/rpc/anonimizar_usuario            -> executa. So parou no FK
--        do audit_log porque a sonda usou um UUID inexistente; com um user_id
--        real, apaga perfil, empresa, credenciais e certificado de quem o
--        chamador quiser.
--   POST /rest/v1/rpc/gerar_honorarios_recorrentes  -> 200, criou honorario.
--   POST /rest/v1/rpc/materializar_obrigacoes       -> 200, criou notificacoes.
--
-- E TRUNCATE IGNORA RLS: das 66 tabelas de `public`, todas com RLS ligada,
-- qualquer sessao com a role authenticated tinha o privilegio de esvaziar
-- qualquer uma delas de uma vez — a policy nao e nem consultada num TRUNCATE.

-- ------------------------------------------------ 1. TRUNCATE, em todas
-- Nenhum caminho legitimo do cliente trunca tabela: o app fala por PostgREST,
-- que nao expoe TRUNCATE. REFERENCES e TRIGGER caem junto pela mesma razao —
-- sao privilegios de DDL, e cliente nao faz DDL.
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

-- ------------------------------------------------ 2. as RPCs que so o servidor chama
-- Todas estas sao chamadas pelo `createAdminClient()` (service_role) — cron ou
-- server action. Conferido caso a caso no codigo, nao suposto:
--   anonimizar_usuario            <- (gated)/conta/actions.ts:96      admin
--   notificacoes_pendentes_email  <- api/cron/obrigacoes/route.ts:39  admin
--   materializar_obrigacoes       <- api/cron/obrigacoes/route.ts:33  admin
--   gerar_honorarios_recorrentes  <- api/cron/honorarios-recorrentes  admin
--   check_rate_limit              <- lib/security/rate-limit.ts:9     admin
--   reservar/liberar_reserva      <- lib/billing/emitir-cobranca.ts,  admin
--                                    via honorarios/cobrar-actions.ts:93
REVOKE ALL ON FUNCTION public.anonimizar_usuario(uuid)                        FROM anon, authenticated, public;
REVOKE ALL ON FUNCTION public.notificacoes_pendentes_email(integer)           FROM anon, authenticated, public;
REVOKE ALL ON FUNCTION public.materializar_obrigacoes(date)                   FROM anon, authenticated, public;
REVOKE ALL ON FUNCTION public.gerar_honorarios_recorrentes()                  FROM anon, authenticated, public;
REVOKE ALL ON FUNCTION public.check_rate_limit(text, integer, integer)        FROM anon, authenticated, public;
REVOKE ALL ON FUNCTION public.reservar_emissao_cobranca(uuid, text, integer)  FROM anon, authenticated, public;
REVOKE ALL ON FUNCTION public.liberar_reserva_cobranca(uuid, text, uuid)      FROM anon, authenticated, public;

GRANT EXECUTE ON FUNCTION public.anonimizar_usuario(uuid)                       TO service_role;
GRANT EXECUTE ON FUNCTION public.notificacoes_pendentes_email(integer)          TO service_role;
GRANT EXECUTE ON FUNCTION public.materializar_obrigacoes(date)                  TO service_role;
GRANT EXECUTE ON FUNCTION public.gerar_honorarios_recorrentes()                 TO service_role;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, integer, integer)       TO service_role;
GRANT EXECUTE ON FUNCTION public.reservar_emissao_cobranca(uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.liberar_reserva_cobranca(uuid, text, uuid)     TO service_role;

-- ------------------------------------------------ 3. as RPCs da sessao do usuario
-- Estas SAO chamadas pela sessao do usuario logado (`createServerClient()`), e
-- por isso mantem `authenticated`. Perdem so `anon`: todas exigem usuario
-- identificado para fazer sentido, e nenhuma tela publica as chama.
--   aceitar_convite          <- contador/convites-actions.ts:136
--   vincular_empresa_por_link<- onboarding/actions.ts:183
--   painel_contador          <- contador/page.tsx:18
--   resumo_escritorio        <- contador/page.tsx:19
REVOKE ALL ON FUNCTION public.aceitar_convite(text)                      FROM anon, public;
REVOKE ALL ON FUNCTION public.vincular_empresa_por_link(text, uuid)      FROM anon, public;
REVOKE ALL ON FUNCTION public.painel_contador()                          FROM anon, public;
REVOKE ALL ON FUNCTION public.resumo_escritorio()                        FROM anon, public;

GRANT EXECUTE ON FUNCTION public.aceitar_convite(text)                 TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vincular_empresa_por_link(text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.painel_contador()                     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resumo_escritorio()                   TO authenticated, service_role;

-- ------------------------------------------------ 4. o que NAO se mexe, e por que
-- `minha_contabilidade`, `minha_contabilidade_membro` e `user_owns_company`
-- aparecem DENTRO das policies de RLS (20, 7 e 28 policies respectivamente).
-- Policy e avaliada com os privilegios da role que consulta — revogar o EXECUTE
-- delas nao "fecharia" nada, quebraria TODA consulta da tela com erro de
-- permissao. As tres ja se defendem sozinhas: derivam de `auth.uid()` e
-- devolvem NULL para quem nao esta logado.
--
-- As funcoes de trigger (criar_assinatura_trial, handle_new_user_role,
-- tg_aceites_valida_versao, tg_convites_valida_company) tambem ficam: retornam
-- `trigger` e o PostgREST nao as expoe em /rpc — nao ha porta para fechar.

-- ------------------------------------------------ 5. a raiz, para nao voltar
-- Sem isto, a PROXIMA tabela e a PROXIMA funcao nascem abertas de novo, e o
-- proximo bloco recomeca a caçada. Vale para objetos criados pela role
-- `postgres` em `public` — que e exatamente como nossas migrations rodam.
--
-- ⛔ ERRATA (ver 0058): a frase que estava aqui — "a partir daqui, funcao nova
-- NAO e executavel por ninguem alem do dono" — era FALSA, e um code-review a
-- pegou. A linha de FUNCTIONS abaixo tira so os grants NOMINais de
-- anon/authenticated; o EXECUTE que `acldefault()` concede a PUBLIC sobrevive, e
-- anon e membro de PUBLIC. Medido: funcao criada depois desta migration nascia
-- com `=X/postgres` e `has_function_privilege('anon', ...)` = TRUE.
-- Quem fecha de verdade e a **0058**, com a variante GLOBAL (sem `IN SCHEMA`).
-- A linha de TABLES abaixo esta correta e continua valendo.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;

-- Privilegio mudou: rodar `node app/scratchpad/_reload-postgrest.mjs`.
