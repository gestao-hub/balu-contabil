-- Endurecimento pós-auditoria de IDOR (14/08/2026).
--
-- ⚠️ NÃO HÁ VULNERABILIDADE ABERTA AQUI. Cada privilégio abaixo já está
-- neutralizado pela RLS — provado contra o banco vivo, com o papel
-- `authenticated` simulado e ROLLBACK garantido. O que esta migration remove é
-- a METADE ARMADA de uma armadilha de dois gatilhos: o GRANT existe, e só não
-- morde porque nenhuma policy de escrita casa com ele.
--
-- O dia em que alguém adicionar uma policy de escrita "só para arrumar uma
-- coisinha", ou desligar RLS de uma tabela para depurar, o GRANT já está lá
-- esperando. Privilégio que ninguém usa é privilégio que ninguém percebe
-- perder — e é o mais barato de devolver, se um dia fizer falta.
--
--
-- ── 1. CATÁLOGO FISCAL: LEITURA PÚBLICA, ESCRITA DE NINGUÉM ─────────────────
--
-- Estas cinco tabelas são catálogo: qualquer usuário logado (e, em duas delas,
-- o visitante) PRECISA ler. Nenhuma precisa ser escrita por eles.
--
-- Conferido arquivo por arquivo antes de revogar: todo acesso a elas pelo
-- client autenticado é SELECT (zero `.upsert/.insert/.update/.delete`). Quem
-- escreve são as telas do AdminBalu e o cron, e os dois usam service_role —
-- `api/cron/sync-municipios` monta o próprio client com
-- SUPABASE_SERVICE_ROLE_KEY, então também não é alcançado por isto.
--
-- O que estaria em jogo se um dia mordesse: `parametros_fiscais` guarda os
-- tetos do MEI e do Simples e a tabela de alíquotas — quem escreve ali decide
-- o imposto de todo mundo e o semáforo de "irregular". `documento_versoes`
-- guarda o texto dos Termos que os clientes ACEITARAM; reescrever o corpo de
-- uma versão já aceita corrompe a prova de consentimento da LGPD.

REVOKE INSERT, UPDATE, DELETE ON public.parametros_fiscais  FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.planos              FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.cnae_anexo          FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.municipios_nfse     FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.documento_versoes   FROM anon, authenticated;


-- ── 2. contabilidades: o INSERT de 28 COLUNAS ───────────────────────────────
--
-- O GRANT de INSERT cobre `status`, `asaas_api_key_cifrada`,
-- `asaas_subconta_criada_por` e `conta_destino_cifrada` — ou seja, a forma
-- exata de um escritório nascer JÁ APROVADO (burlando a validação de CRC do
-- DL 9.295/46) com a conta de saque apontando para onde o criador quiser.
--
-- Hoje não passa: `contabilidades` não tem policy de INSERT nenhuma, então a
-- RLS nega — verificado, o INSERT com status='aprovada' volta "new row
-- violates row-level security policy". O caminho legítimo é a action de
-- cadastro, por service_role, que grava 'pendente' e espera o AdminBalu.
--
-- O UPDATE **não** é revogado: ele já é por coluna e cobre exatamente os cinco
-- campos de branding (nome, logo_url, whatsapp_suporte, email_remetente_nome,
-- sla_resposta_horas). É o que a tela do escritório edita, e está correto.

REVOKE INSERT ON public.contabilidades FROM anon, authenticated;


-- ── 3. notifications: UPDATE de 18 COLUNAS para marcar como lida ────────────
--
-- A policy `notifications_update_own` amarra a linha ao dono nos dois lados
-- (USING e WITH CHECK), então ninguém alcança a notificação de outra pessoa —
-- testado, e o WITH CHECK também impede transplantar a própria para outro dono.
--
-- O excesso é de COLUNA: com UPDATE na tabela inteira, o dono reescreve
-- `titulo`, `corpo`, `tipo`, `action_href`, `chave`, `entidade_ref`,
-- `resolvida_em` e os carimbos de envio da própria notificação. O alvo é ele
-- mesmo, então o estrago é limitado — mas foi esse GRANT que tornou o desvio
-- de `action_href` alcançável (o guard de redirect foi endurecido em
-- `lib/notifications/rota-interna.ts` na mesma rodada).
--
-- O app, como `authenticated`, só escreve `lida_em` — os três pontos que
-- atualizam notificação pela sessão do usuário (`notificacoes/actions.ts`,
-- `notificacoes/page.tsx`, `notificacoes/abrir/[id]/route.ts`) gravam esse
-- campo e mais nada. `enviada_email_em` e `enviada_whatsapp_em` são do cron,
-- por service_role, que não passa por este GRANT.

REVOKE UPDATE ON public.notifications FROM anon, authenticated;
GRANT  UPDATE (lida_em) ON public.notifications TO authenticated;
