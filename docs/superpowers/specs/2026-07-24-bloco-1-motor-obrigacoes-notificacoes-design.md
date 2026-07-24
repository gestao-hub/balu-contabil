# Spec — Bloco 1: Motor de Obrigações + Notificações

> **Data:** 2026-07-24 · **Status:** aprovada (design) · **Bloco:** 1 de 7 do `PRD-MASTER-Balu-2026-07-24.md`
> **Pré-requisito de leitura:** §3 (princípios anti-bug) e §4 Bloco 1 do Master PRD.
> **Natureza:** 🟢 buildável agora, sem dependência externa. Entrega o núcleo do valor ("cuidamos dos seus prazos").
> **Base factual:** auditoria do código real em 2026-07-24 (migrations até `0044`, `db_atual.sql`, `src/`). Todos os seams abaixo citam arquivo:linha reais.

---

## 1. Objetivo

Um mecanismo **determinístico** que, todo dia, (a) **calcula as obrigações de cada empresa** a partir dos dados reais, (b) **materializa notificações** in-app idempotentes e (c) **dispara e-mail** (com a marca do escritório) para o que entra em janela de aviso. Hoje não há aviso proativo nenhum; tudo é disparado manualmente pelo usuário.

Fronteira: este bloco é a **camada de consciência** (avisar). Ele **não** roda apuração automática nem transmite nada (isso é dos Blocos 3/5). A IA que explica é do Bloco 6.

## 2. Escopo

**Dentro:**
- Tabela `notifications` (in-app, por usuário, idempotente) + tabela `notification_preferences` (opt-out de canal por tipo).
- RPC `materializar_obrigacoes(p_hoje date)` (`SECURITY DEFINER`) que computa as obrigações e insere as notificações do dia, idempotentemente.
- Cron **diário** (`/api/cron/obrigacoes`) que chama a RPC e depois **envia os e-mails** pendentes (respeitando opt-out).
- **Sino** no `MenuLateral` (badge de não-lidas + dropdown) e página `/notificacoes`.
- Aba de **preferências de notificação** em `/conta`.
- Correção do **certificado A1 vencendo** como pendência (o TODO em `queries.ts` está desatualizado — a coluna existe).

**Fora (blocos posteriores):** canal WhatsApp (Bloco 6); IA que explica (Bloco 6); notificação na transição de abertura (Bloco 2 chama este motor); apuração automática mensal; push/SMS; digest para o contador (o contador já tem o painel/semáforo do Bloco A).

## 3. Modelo de dados

Migration nova: **`0045_notificacoes.sql`**. **Regra das 3 fontes (Master §3.1): confirmar colunas das tabelas-fonte contra o banco real antes de aplicar.** O `db_atual.sql` (22/07) está **defasado para as tabelas do Bloco A** (`companies.contabilidade_id` e `contabilidades` só existem via migrations 0030/0031, não no dump). As colunas-fonte abaixo já foram verificadas nesta auditoria.

### 3.1 `notifications`

```sql
CREATE TABLE public.notifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,              -- destinatário = companies.user_id (dono da empresa)
  company_id    uuid,                       -- empresa de origem (null p/ avisos sem empresa)
  tipo          text NOT NULL,              -- ver §5 (enum lógico, CHECK)
  severidade    text NOT NULL DEFAULT 'info' CHECK (severidade IN ('info','warning','danger')),
  titulo        text NOT NULL,
  corpo         text NOT NULL,              -- PT simples; reusa motivo.texto do semáforo
  norma         text,                       -- citação legal (didático), quando aplicável
  entidade_ref  text,                       -- id da guia/declaração/cert de origem (rastreio)
  action_href   text,                       -- ex.: '/impostos'
  chave         text NOT NULL,              -- idempotência (ver §3.3)
  agendada_para date,                       -- data-alvo da obrigação (p/ ordenação)
  lida_em       timestamptz,
  enviada_email_em timestamptz,             -- null = e-mail ainda não enviado
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Idempotência: uma notificação por (usuário, chave). Ver §3.3.
CREATE UNIQUE INDEX notifications_owner_chave_uidx ON public.notifications(owner_user_id, chave);
CREATE INDEX notifications_owner_unread_idx ON public.notifications(owner_user_id) WHERE lida_em IS NULL;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
-- Modelo de RLS igual ao de declaracoes_fiscais (0025:36-40): titular só vê/edita o que é seu.
CREATE POLICY notifications_select_own ON public.notifications
  FOR SELECT USING (owner_user_id = auth.uid());
CREATE POLICY notifications_update_own ON public.notifications
  FOR UPDATE USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid());
-- INSERT só pela RPC (SECURITY DEFINER) / service role — sem policy de insert p/ authenticated.
```

Sem `deleted_at` (notificação não é dado fiscal; "apagar" = marcar lida ou expurgo por retenção futura).

### 3.2 `notification_preferences`

```sql
CREATE TABLE public.notification_preferences (
  owner_user_id uuid NOT NULL,
  tipo          text NOT NULL,
  email_enabled boolean NOT NULL DEFAULT true,
  -- whatsapp_enabled boolean NOT NULL DEFAULT true,  -- Bloco 6
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_user_id, tipo)
);
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY notif_prefs_all_own ON public.notification_preferences
  FOR ALL USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid());
```

**Semântica de opt-out (decisão de design):** a preferência controla **apenas o canal de entrega** (e-mail, e futuramente WhatsApp). O **in-app é sempre materializado** — é o próprio dado fiscal do usuário (legítimo interesse, LGPD art. 7º IX) e não é intrusivo. Ausência de linha = default habilitado. Marketing seria opt-in separado (fora deste bloco).

### 3.3 Chave de idempotência

`chave` = string totalmente qualificada `{tipo}:{entidade_ref|competencia}:{bucket}`. Exemplos:
- `das_a_vencer:{guia_id}:D7`
- `das_vencido:{guia_id}:V`
- `pgdas_pendente:202607:D3`
- `cert_a_vencer:{arquivo_id}:D30`

O `bucket` codifica a janela de aviso (ver §5) para que **cada janela dispare no máximo uma vez**. `ON CONFLICT (owner_user_id, chave) DO NOTHING` garante idempotência — rodar o cron 2× no mesmo dia (ou reprocessar) não duplica. O predicado do `ON CONFLICT` **casa exatamente** com o índice único (Master §3.6 — bug histórico do `0036`).

## 4. RPC de materialização

```
public.materializar_obrigacoes(p_hoje date DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date)
  RETURNS integer   -- nº de notificações criadas
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
```

**Por que RPC `SECURITY DEFINER`:** roda pelo cron (service role), itera **todas** as empresas ativas (não só `minha_contabilidade()`), precisa ler `auth.users.email` (schema `auth`) para resolver o destinatário, e concentra a idempotência no Postgres (padrão `gerar_honorarios_recorrentes`, `0036:164`).

**O que computa** (reusando as MESMAS expressões de `painel_contador`, `0036:71-116` — não reimplementar limiares):

Para cada `companies` com `deleted_at IS NULL` e `status <> 'em_abertura'`, resolve `owner_user_id = companies.user_id`, o regime (`empresas_fiscais."Code_regime_tributario"`) e:

| Obrigação | Fonte / expressão | Tipo(s) de notificação |
|---|---|---|
| DAS a vencer / vencido | `guias_fiscais`: `deleted_at IS NULL AND status <> 'erro' AND data_pagamento IS NULL`; `dias = data_vencimento - p_hoje` | `das_a_vencer` (dias ∈ buckets 7/3/1) · `das_vencido` (dias < 0) |
| PGDAS-D do mês anterior | Simples (`Code` 1/2) e **não** existe em `declaracoes_fiscais` `tipo='PGDAS-D'`, `data_transmissao NOT NULL`, `competencia_referencia = to_char(p_hoje - interval '1 month','YYYYMM')` | `pgdas_pendente` (buckets pré-dia-20; `danger` após dia 20) |
| DASN-SIMEI ano anterior | MEI (`Code` 4), janela jan–mai, e **não** transmitida (`tipo='DASN-SIMEI'`, `competencia_referencia = (extract(year from p_hoje)-1)::text`) | `dasn_pendente` |
| DEFIS ano anterior | Simples, janela até 31/03, e não registrada (`tipo='DEFIS'`) | `defis_pendente` |
| Certificado A1 | `max(cert_not_after) FROM arquivos_auxiliares WHERE company_id = c.id AND deleted_at IS NULL`; `dias = cert_not_after::date - p_hoje` | `cert_a_vencer` (dias < 30) · `cert_vencido` (dias < 0) |
| Limite de faturamento | `faturamento_ano >= 0.8 * limite_do_regime` (limites de `parametros_fiscais` via a mesma fonte do painel) | `limite_faturamento` |
| Honorário a vencer | `honorarios`: não pago, `data_vencimento` em janela; destinatário = dono da empresa-cliente | `honorario_a_vencer` |

**Corpo da notificação:** reusar o texto didático do `classificarSemaforo` onde aplicável (os `motivos: {texto, norma}` já estão em PT simples — `semaforo.ts:19`), OU textos análogos por tipo. `action_href` aponta para `/impostos` (DAS/PGDAS/DASN/DEFIS), `/configuracoes` (cert), `/honorarios` (honorário).

**Insert idempotente:**
```sql
INSERT INTO public.notifications (owner_user_id, company_id, tipo, severidade, titulo, corpo, norma, entidade_ref, action_href, chave, agendada_para)
SELECT ... FROM (<obrigações computadas>) o
ON CONFLICT (owner_user_id, chave) DO NOTHING;
```

**Não resolve e-mail aqui** — o e-mail é despachado no TS (§6.2), lendo `notifications` com `enviada_email_em IS NULL`. Isso desacopla materialização de entrega e torna o e-mail retryável (falha → fica `null` → tenta no próximo run).

## 5. Tipos, severidade e janelas (buckets)

| `tipo` | Severidade | Buckets (dias até o prazo) | Canal padrão |
|---|---|---|---|
| `das_a_vencer` | warning | 7, 3, 1 | in-app + e-mail |
| `das_vencido` | danger | vencido (`V`, uma vez) | in-app + e-mail |
| `pgdas_pendente` | warning→danger | pré-dia-20 (D3/D1) → `danger` após dia 20 | in-app + e-mail |
| `dasn_pendente` | warning→danger | jan–abr warning; mai danger; após 31/05 danger | in-app + e-mail |
| `defis_pendente` | warning→danger | análogo (prazo 31/03) | in-app + e-mail |
| `cert_a_vencer` | warning | 30, 15, 7 | in-app + e-mail |
| `cert_vencido` | danger | vencido (`V`) | in-app + e-mail |
| `limite_faturamento` | warning | ≥80% (bucket `80`), ≥100% (`100`, danger) | in-app + e-mail |
| `honorario_a_vencer` | info | 3, 0 | in-app + e-mail |

`CHECK (tipo IN (...))` na tabela com esta lista (Bloco 2 adiciona `abertura_etapa`). Cada bucket materializa uma notificação distinta (múltiplos lembretes são desejados). O `bucket` entra na `chave`.

## 6. Cron

### 6.1 Rota e agendamento
- Nova rota: `src/app/api/cron/obrigacoes/route.ts` (GET).
- Entrada em `vercel.json` (junto do cron existente): `{ "path": "/api/cron/obrigacoes", "schedule": "0 11 * * *" }` → **11:00 UTC = 08:00 BRT**, diário.
- **Auth idêntica** ao `honorarios-recorrentes/route.ts`: lê `process.env.CRON_SECRET` (ausente → 500); compara header `authorization` com `Bearer ${secret}` (senão → 401). Cliente: `createAdminClient()` (service role).

### 6.2 Fluxo do handler
1. `await admin.rpc('materializar_obrigacoes')` → nº criadas.
2. **Despacho de e-mail:** `SELECT` em `notifications` `WHERE enviada_email_em IS NULL` (limitar/paginar), `JOIN` para resolver destinatário (`auth.users.email` via `companies.user_id`) e branding (`companies.contabilidade_id → contabilidades.email_remetente_nome, nome`), e checar `notification_preferences` (se `email_enabled = false` p/ aquele `tipo`, pular — mas **marcar** `enviada_email_em = now()` para não reavaliar sempre, OU manter `null` e filtrar por preferência na query; escolher a query que filtra por preferência e só toca as elegíveis).
   - Resolver destinatário/branding via uma segunda RPC `SECURITY DEFINER` (`notificacoes_pendentes_email()` que já devolve email+fromName), evitando ler `auth.users` do TS.
3. Para cada elegível: `sendEmail({ to, fromName, subject: titulo, html })`; se retorno `{ ok:true }` → `UPDATE ... SET enviada_email_em = now()`. Se `{ skipped:true }` (sem chave Resend) → **não** marca (fica pendente p/ quando a chave existir) e loga. Se `{ ok:false }` (erro real) → não marca, loga; retry no próximo run.
4. Retorno `{ ok:true, criadas, emails_enviados, emails_pulados }` (207 se falha parcial, padrão `sync-municipios`).

**Co-branding do e-mail:** `fromName = contabilidades.email_remetente_nome ?? contabilidades.nome` quando a empresa tem `contabilidade_id`; senão, remetente Balu padrão. Corpo HTML montado com `escapeHtml` (padrão dos callers existentes de `sendEmail`, ex.: `contador/convites-actions.ts:67`). Sem template reutilizável hoje — criar um helper mínimo `renderNotificacaoEmail({titulo, corpo, norma, actionUrl, escritorioNome})` em `src/lib/notifications/email-template.ts`.

## 7. UI

### 7.1 Sino no `MenuLateral`
- `src/components/MenuLateral.tsx` (`'use client'`): importar `Bell` de `lucide-react` (hoje não importado). Botão com badge de não-lidas.
- **Contagem + lista:** via `createBrowserClient()` (já usado em `changeCompany`, ~L119) — `select count` de não-lidas + últimas N. Assinatura **Realtime** opcional (canal sobre `notifications` filtrado por `owner_user_id`) para atualização ao vivo; baseline = buscar on-mount + ao abrir o dropdown.
- **Dropdown:** reusar o padrão de flutuante com fechar-ao-clicar-fora do seletor de empresa (`companyMenuRef` + `useEffect`, L94-102).
- **Estado recolhido:** tratar `open === false` (`md:w-16`) escondendo o label, como os demais itens (L295 `{open && <span>`). Posições: header mobile (~L163) e topo da sidebar desktop (~L192).

### 7.2 Página `/notificacoes`
- Nova rota server `src/app/(auth)/(gated)/notificacoes/page.tsx`: lista paginada (RLS já filtra por usuário), agrupada por lida/não-lida, com `action_href` clicável.
- Item de menu opcional em `NAV` (`MenuLateral.tsx` L57-76) — ou acesso só pelo sino. Decisão: **só pelo sino** + link "ver todas" no rodapé do dropdown (menos poluição no NAV).

### 7.3 Preferências em `/conta`
- Nova aba `'notificacoes'` no array `TABS` de `src/app/(auth)/(gated)/conta/page.tsx:10`.
- Form que lista os tipos (§5) com toggle de e-mail; grava em `notification_preferences` via nova action em `conta/actions.ts`.

### 7.4 Actions (server)
Novo `src/app/(auth)/(gated)/notificacoes/actions.ts`:
- `marcarNotificacaoLidaAction(id)` · `marcarTodasLidasAction()` (escopadas por RLS; `createServerClient`).
- Preferências: `salvarPreferenciasNotificacaoAction(fd)` em `conta/actions.ts` (upsert em `notification_preferences`).

## 8. Correção do certificado A1 (dívida técnica do dashboard)
`src/lib/dashboard/queries.ts:147-149` tem um TODO afirmando que a pendência de cert A1 é impossível "porque `arquivos_auxiliares` só tem `cert_password`". **Falso** — `cert_not_after` existe desde `0003_certificado_metadata.sql`. Neste bloco: adicionar a pendência de cert (`< 30d` warning, vencido danger) em `getPendingActions` (queries.ts:87) e remover o TODO. Usar o mesmo limiar do semáforo (`< 30`) e do `saude-empresa.ts` (`daysUntilISO`) para consistência.

## 9. Seams de código (recap)

| Alvo | Arquivo:linha | Ação |
|---|---|---|
| Migration | `app/supabase/migrations/0045_notificacoes.sql` (nova) | tabelas + RLS + RPC; partir do banco real (§3) |
| Padrão de idempotência | `0036_fix_code_review_bloco_a.sql:164` | espelhar `gerar_honorarios_recorrentes` |
| Fatos das obrigações | `0036_fix_code_review_bloco_a.sql:71-116` (`painel_contador`) | reusar as expressões SQL |
| Limiares | `src/lib/fiscal/semaforo.ts:19` | fonte única; corpo didático dos motivos |
| Cron template | `src/app/api/cron/honorarios-recorrentes/route.ts` + `vercel.json` | copiar auth |
| E-mail | `src/lib/clients/email.ts` (`sendEmail`) | `fromName` co-branding; tratar `{skipped}` |
| Vínculo escritório | `companies.contabilidade_id` → `contabilidades` (`0030:15`, `0031:4`) | resolver `email_remetente_nome`/`nome` |
| Sino | `src/components/MenuLateral.tsx` (~L163/~L192, dropdown L94-102) | `Bell`, badge, dropdown, estado `open` |
| Preferências | `src/app/(auth)/(gated)/conta/page.tsx:10` (TABS) | nova aba |
| Cert A1 | `src/lib/dashboard/queries.ts:87,147-149` | adicionar pendência; remover TODO |

## 10. Landmines (do Master §4 Bloco 1 + auditoria)
1. **Schema real ≠ `0001` ≠ `db_atual.sql`**: confirmar colunas das tabelas-fonte no banco antes de aplicar a `0045`. `companies.contabilidade_id`/`contabilidades` existem no banco (Bloco A) mas **não** no `db_atual.sql`.
2. **Competência `YYYYMM`** (PGDAS) e **`YYYY`** (DASN) — nunca `YYYY-MM`. Para DAS, usar `data_vencimento` direto (sem parse de competência).
3. **Cron em UTC, prazos em BRT** — `p_hoje` default já converte para `America/Sao_Paulo`; qualquer cálculo de dia usa essa data.
4. **`sendEmail` no-op silencioso** sem `RESEND_API_KEY`/`EMAIL_FROM` (`{skipped:true}`) — **não** marcar `enviada_email_em`; fica pendente e loga.
5. **`declaracoes_fiscais` sem `deleted_at`** — não filtrar por `deleted_at` nela (difere de `guias_fiscais`/`arquivos_auxiliares`).
6. **Idempotência**: predicado do `ON CONFLICT` = índice único `(owner_user_id, chave)`.
7. **`apuracoes_fiscais` não é usada** por `src/` — não assumir populada; usar `guias_fiscais`/`declaracoes_fiscais`.
8. **`profiles` não tem e-mail** — destinatário via `auth.users` (dentro da RPC `SECURITY DEFINER`), nunca do client.

## 11. Testes
- **Unit (TS):** helper de bucket/severidade e `renderNotificacaoEmail` (HTML escapado). Vitest, padrão do repo.
- **RPC (integração/SQL):** empresa com DAS vencendo em 7/3/1 dias gera 3 notificações distintas; rodar 2× não duplica (idempotência); cert `<30d` gera `cert_a_vencer`; PGDAS não transmitida do mês anterior (Simples) gera `pgdas_pendente`; opt-out de e-mail não impede a in-app.
- **E2E (Playwright):** sino mostra badge de não-lidas; abrir dropdown e "marcar todas como lidas" zera o badge; aba de preferências salva opt-out.
- **Regressão:** typecheck 0, `vitest` verde, `next build` limpo, RLS suite verde (padrão do repo).

## 12. Critérios de aceite
1. Empresa com DAS vencendo em ≤7 dias recebe notificação in-app **e** e-mail (quando há chave Resend); sem chave, a in-app aparece e o e-mail fica pendente (não perdido).
2. Cert A1 vencendo em <30 dias vira pendência no dashboard **e** notificação; o TODO de `queries.ts` some.
3. Cron idempotente: 2 execuções no mesmo dia não duplicam notificação da mesma obrigação/janela.
4. Opt-out de e-mail por tipo respeitado; in-app permanece.
5. E-mail de cliente de escritório sai com o **nome do escritório** no remetente (co-branding).
6. Sino com contador de não-lidas; marcar como lida funciona; RLS impede ver notificação de outro usuário.

## 13. Fora de escopo / futuro
Canal WhatsApp e Pix na notificação (Bloco 6); IA que explica o aviso (Bloco 6); notificação na transição de abertura (Bloco 2, que chama `materializar_obrigacoes`/insere via a mesma tabela); digest para o contador; retenção/expurgo de notificações antigas; calendário fiscal visual dedicado (a lista de `/notificacoes` cobre o lançamento).

## 14. Próximo passo
Esta spec aprovada → **writing-plans** para o plano de implementação task-a-task (migration `0045` → RPC → cron → sino/UI → preferências → correção cert A1 → testes), executado com verificação entre tasks (typecheck/vitest/build/RLS), no padrão dos Blocos A/E.
