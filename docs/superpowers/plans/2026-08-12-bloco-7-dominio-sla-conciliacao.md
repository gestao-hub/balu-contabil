# Bloco 7 — domínio próprio + SLA de atendimento + conciliação bancária — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** fechar os pilares 4 e 8 do PRD Master — (a) escritório atende a
carteira em domínio próprio com a marca dele; (b) SLA de atendimento
configurável, exibido ao cliente e alertado quando estoura; (c) pagamento de
DAS confirmado automaticamente a partir do extrato bancário, com baixa
automática só em match inequívoco.

**Architecture:** três frentes independentes sobre o que já existe. O domínio
é resolvido no layout via `headers()` (**sem middleware** — ver §2.1 da spec) e
verificado por HTTP contra o próprio host. O SLA cronometra as escaladas do
Bloco 6B (`whatsapp_atendimentos`), que ganham tela pela primeira vez. A
conciliação entra por um adapter de provedor com **mock como default** e
escreve por um **ponto de escrita único** (`registrar_pagamento_guia`), que a
action manual passa a usar também — continuação direta da `0067`.

**Tech Stack:** Postgres/Supabase (migrations + RPC, aplicadas pelo runner
node+pg do scratchpad), Next.js App Router (Server Components, route handlers,
server actions), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-12-bloco-7-dominio-sla-conciliacao-design.md`

**Verificado antes do plano (landmine 6.4 da spec):** `guias_fiscais.valor_total`
é `numeric(15,2)` **em reais** (`12666.19`), enquanto
`cobrancas_escritorio.valor_centavos` é `integer` em centavos. As duas unidades
convivem no banco — o matcher converte na fronteira e nunca compara `numeric`
com `int` direto. Helpers `minha_contabilidade()` e
`minha_contabilidade_membro()` existem e devolvem `uuid` (não boolean).

---

- [ ] **Task 0: branch**

```bash
git checkout main && git pull origin main
git checkout -b feat/bloco-7-dominio-sla-conciliacao
```

---

## Frente 1 — domínio próprio

### Task 1: Migration `0069` — colunas de domínio/SLA + `branding_por_host`

**Files:** `app/supabase/migrations/0069_dominio_sla.sql`

- [ ] `ALTER TABLE contabilidades` com `dominio_customizado text UNIQUE`,
  `dominio_status text CHECK (pendente|ativo|erro) DEFAULT 'pendente'`,
  `dominio_token text`, `dominio_verificado_em timestamptz`,
  `dominio_erro text`, `sla_resposta_horas int`.
- [ ] RPC `branding_por_host(p_host text)` `SECURITY DEFINER`, retorno mínimo
  (`contabilidade_id, nome, logo_url, sla_resposta_horas`), só para
  `dominio_status='ativo' AND status='aprovada'`. `REVOKE ALL FROM PUBLIC` +
  `GRANT EXECUTE TO anon, authenticated`.
- [ ] Aplicar com runner em transação + verificações (coluna existe; `anon`
  executa a RPC; `anon` **não** enxerga contabilidade não-ativa; a RPC não
  devolve CNPJ/CRC).
- [ ] `node scratchpad/_reload-postgrest.mjs`.

### Task 2: `lib/dominios` — normalização e verificação (TDD)

**Files:** `app/src/lib/dominios/host.ts` + `.test.ts`,
`app/src/lib/dominios/provedor.ts` + `.test.ts`

- [ ] `normalizarHost`: minúsculo, sem esquema, sem porta, sem barra final,
  sem `www.`? (**não** — `www` é host distinto, documentar). Rejeita host
  vazio, IP, `localhost`, e qualquer coisa que não bata o formato de domínio.
  Testes de fronteira: `APP.X.com.br:443`, `https://x.com.br/`, `x`, ``.
- [ ] `hostDaRequisicao(headers)`: `x-forwarded-host` primeiro, `host` como
  fallback, normalizado. Teste com os dois presentes e divergentes.
- [ ] `provedorDeEnv()`: devolve `null` sem `VERCEL_API_TOKEN`/`VERCEL_PROJECT_ID`
  (modo manual). Com token, um cliente da Vercel Domains API com retry — mesmo
  padrão de `focus-nfe.ts`. **Falha na chamada, nunca no import.**

### Task 3: cadastro + verificação do domínio (UI + endpoint)

**Files:** `app/src/app/api/dominio/verificacao/route.ts`,
`app/src/app/(auth)/(gated)/contador/configuracoes/actions.ts` (estender),
`.../EscritorioConfigForm.tsx` (estender)

- [ ] Endpoint público `GET /api/dominio/verificacao`: devolve o
  `dominio_token` da contabilidade **daquele host**, ou 404. Não recebe
  parâmetro — o host da requisição é a chave. Nada mais no corpo.
- [ ] Action `salvarDominioAction`: normaliza, valida, gera token
  (`crypto.randomUUID`), grava `pendente`. Escopada por
  `minha_contabilidade()` (anti-IDOR).
- [ ] Action `verificarDominioAction`: com provedor, registra na Vercel antes;
  depois faz `GET https://<host>/api/dominio/verificacao` e compara o token.
  Sucesso → `ativo`; falha → `erro` + motivo legível. **Timeout curto** e
  tratamento de DNS/TLS quebrado sem stack trace na tela.
- [ ] UI: campo, estado atual, instruções de CNAME, botão "verificar agora",
  mensagem de erro humana. Modo manual explícito quando não há provedor.

### Task 4: branding por host no layout

**Files:** `app/src/app/(auth)/layout.tsx` (ou onde o co-branding do Bloco A é
montado — confirmar), `app/src/lib/dominios/branding.ts`

- [ ] Resolver host → `branding_por_host` → marca. Host desconhecido cai na
  marca Balu **silenciosamente**.
- [ ] Cache: se usar `unstable_cache`, o host **entra na chave**. Teste que
  prove que dois hosts não compartilham entrada (landmine 6.2 da spec).
- [ ] Teste (Playwright ou unitário do resolvedor) do critério de aceite
  "host não é autorização": sessão da contabilidade A sob o host de B enxerga
  os dados de A.

---

## Frente 2 — SLA de atendimento

### Task 5: Migration `0070` — fila de escaladas + tipo `sla_estourado`

**Files:** `app/supabase/migrations/0070_sla_atendimento.sql`

- [ ] `ALTER TABLE whatsapp_atendimentos` com `contabilidade_id uuid`,
  `atendido_em timestamptz`, `atendido_por uuid`, `sla_alertado_em timestamptz`.
- [ ] RLS: `SELECT`/`UPDATE` para membro do escritório
  (`contabilidade_id = minha_contabilidade_membro()`); `REVOKE ALL` mantido
  para o resto. Cliente final **não** lê.
- [ ] `CHECK` de `notifications.tipo` recriado **com a lista viva completa** +
  `sla_estourado` e `pagamento_nao_detectado` (lição da `0061`).
- [ ] Backfill de `contabilidade_id` nas 3 escaladas existentes, via
  `profile → company → contabilidade`.
- [ ] Aplicar + verificar (membro lê só a própria fila; `anon` não lê nada).

### Task 6: fila de escaladas no painel do contador

**Files:** `app/src/app/(auth)/(gated)/contador/atendimentos/page.tsx` +
`actions.ts`, item no menu

- [ ] Lista das escaladas não atendidas, mais antiga primeiro, com o relógio
  (tempo desde `created_at`) e destaque quando passou do SLA.
- [ ] `marcarAtendidoAction`: grava `atendido_em`/`atendido_por`, escopado por
  `minha_contabilidade_membro()`.
- [ ] Escalada nova (webhook do 6B) passa a gravar `contabilidade_id`.

### Task 7: alerta de SLA + exibição ao cliente

**Files:** `app/supabase/migrations/0071_alerta_sla.sql`,
`app/src/app/api/cron/obrigacoes/route.ts`, componente do cliente

- [ ] RPC `materializar_sla_estourado()`: escaladas sem `atendido_em`, com
  idade > `sla_resposta_horas` do escritório, `sla_alertado_em IS NULL` →
  `notifications` para **cada membro** do escritório + carimba
  `sla_alertado_em` (idempotência, mesmo espírito de `enviada_email_em`).
  Escritório sem SLA configurado não gera nada.
- [ ] Chamada no cron do Bloco 1, com a contagem na resposta.
- [ ] Cliente vê "respondemos em até N horas" (texto diz **horas corridas**)
  onde o suporte é oferecido. Sem SLA configurado, nada aparece.

---

## Frente 3 — conciliação bancária

### Task 8: Migration `0072` — tabelas da conciliação

**Files:** `app/supabase/migrations/0072_conciliacao.sql`

- [ ] `conciliacao_conexoes`, `conciliacao_transacoes` (UNIQUE
  `(conexao_id, id_externo)`), `conciliacao_extrato_mock` conforme §3.4 da spec.
- [ ] **`REVOKE ALL FROM anon, authenticated` em toda tabela nova** antes de
  qualquer policy (lição `0053`/`0055`/`0058`/`0061`), depois RLS por dono da
  empresa nas duas primeiras; a mock fica `service_role` apenas.
- [ ] Aplicar + verificar (`anon` não lê nenhuma das três; dono lê só a dele).
- [ ] `_reload-postgrest.mjs`.

### Task 9: Migration `0073` — `registrar_pagamento_guia`, o ponto de escrita único

**Files:** `app/supabase/migrations/0073_registrar_pagamento_guia.sql`,
`app/src/app/(auth)/(gated)/impostos/actions.ts`

- [ ] RPC `registrar_pagamento_guia(p_guia_id, p_data_pagamento, p_origem,
  p_transacao_id)`: valida ownership (`user_owns_company`) **ou** chamada de
  `service_role`; atualiza `guias_fiscais`; chama a lógica da
  `resolver_notificacoes_guia` (`0067`); grava `audit_log` com a origem.
  Idempotente: guia já paga não muda `data_pagamento` nem duplica auditoria.
- [ ] `marcarGuiaPagaAction` passa a chamar a RPC (deixa de fazer `update`
  direto). Testes existentes seguem verdes; teste novo do caminho idempotente.

### Task 10: matcher determinístico (TDD, função pura)

**Files:** `app/src/lib/conciliacao/matcher.ts` + `.test.ts`

- [ ] Converte `numeric(15,2)` em reais → **centavos inteiros** na fronteira
  (`Math.round(valor * 100)`), nunca compara float.
- [ ] Regra de match inequívoco: crédito, valor exatamente igual, data em
  `[vencimento − 30, vencimento + 60]`, **um único candidato de cada lado**.
- [ ] Testes: match exato; centavo de diferença **não** casa; duas transações
  para a mesma guia → sugestão, não baixa; duas guias para a mesma transação →
  sugestão; débito nunca casa; fora da janela não casa; valor em reais vs.
  centavos (o teste que prova o landmine 6.4).

### Task 11: adapter do provedor + cron de conciliação

**Files:** `app/src/lib/conciliacao/provedor.ts` + `.test.ts`,
`app/src/lib/conciliacao/cron.ts` + `.test.ts`,
`app/src/app/api/cron/obrigacoes/route.ts`

- [ ] `provedorDeEnv()`: sem `OPEN_FINANCE_PROVEDOR` → **mock** lendo
  `conciliacao_extrato_mock`. Interface: `criarConsentimento`,
  `statusConsentimento`, `listarTransacoes(conexao, desde)`.
- [ ] Cron: importa (idempotente) → roda o matcher → baixa via
  `registrar_pagamento_guia(origem 'conciliacao')` → o resto vira sugestão.
- [ ] Alerta `pagamento_nao_detectado`: guia vencida há > 3 dias, empresa
  **com conexão ativa**, sem pagamento. Sem conexão ativa **não** dispara
  (evita duplicar `das_vencido`).
- [ ] Contagens na resposta do cron (`importadas`, `conciliadas`, `sugestoes`).

### Task 12: telas da conciliação

**Files:** `app/src/app/(auth)/(gated)/configuracoes/conciliacao/*`,
seção em `/impostos`

- [ ] Conectar conta: consentimento explícito com texto de LGPD (dado
  bancário), estado da conexão, desconectar (revoga e **apaga** as transações).
- [ ] Sugestões pendentes: transação × guia lado a lado, confirmar (chama a
  mesma RPC, `origem 'conciliacao_confirmada'`) ou descartar.
- [ ] Guia paga por conciliação mostra a origem ("baixa automática pelo
  extrato de DD/MM"), para o cliente não estranhar.

---

### Task 13: fechamento

- [ ] Suíte completa, `tsc --noEmit`, `next build`, Playwright.
- [ ] Roteiro de smoke em `docs/smoke/2026-08-12-bloco-7-roteiro-smoke.md`
  cobrindo os 7 critérios de aceite da spec, incluindo o de host-não-autoriza e
  o de sugestão-em-vez-de-baixa.
- [ ] CHECKPOINT + merge `--no-ff` + push **só com confirmação explícita**.

---

## Ordem e paralelismo

As três frentes não se cruzam, exceto: a Task 9 (ponto de escrita único) é
pré-requisito da 11, e a Task 5 é pré-requisito da 6 e da 7. Domínio (1–4) é
independente de tudo. Se for preciso cortar escopo por prazo, a ordem de corte
é: Frente 3 → Frente 2 → Frente 1, porque a Frente 3 é a única que depende de
credencial externa para valer de verdade em produção.
