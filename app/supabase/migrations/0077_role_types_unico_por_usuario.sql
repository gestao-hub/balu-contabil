-- Um usuario, um papel: UNIQUE(user_id) em role_types.
--
-- Por que agora: em 23/07 um insert manual duplicou a linha de um usuario. A
-- duplicata foi removida a mao, mas nada impedia a repeticao — e o efeito da
-- proxima nao seria cosmetico. O layout do app le o papel com `.maybeSingle()`,
-- que ERRA quando vem mais de uma linha (nao devolve a primeira: devolve erro).
-- Ou seja, uma linha duplicada tira o usuario do ar inteiro, nao so a tela do
-- papel.
--
-- A tabela sempre foi de uma linha por usuario na intencao — a 0010 escreveu
-- todas as policies com `user_id = auth.uid()` no singular, e a 0002 faz um
-- insert unico no signup. O que faltava era o banco cobrar isso.
--
-- Estado conferido antes de aplicar (12/08/2026): 7 linhas, 0 user_id nulo,
-- 0 user_id duplicado, unico indice existente = role_types_pkey. O indice
-- entra limpo, sem precisar deduplicar nada.
--
-- NAO e CONCURRENTLY de proposito: a tabela tem 7 linhas, o lock e
-- instantaneo, e CONCURRENTLY nao roda dentro da transacao que o runner de
-- migration usa.
CREATE UNIQUE INDEX IF NOT EXISTS role_types_user_id_uidx
  ON public.role_types (user_id);

COMMENT ON INDEX public.role_types_user_id_uidx IS
  'Um papel por usuario. Sem isto, uma linha duplicada faz o .maybeSingle() do layout falhar e derruba o app para esse usuario.';
