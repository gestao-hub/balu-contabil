# CHECKPOINT — Balu

> Estado vivo do projeto para retomada de contexto. Atualizar ao fim de cada sessão de trabalho.
> **Última atualização:** 2026-07-22 (sessão 2 — execução do Bloco A em andamento)

---

## Onde estamos

**Fase:** implementação do **Bloco A** em andamento na branch `feat/bloco-a-multitenant` (modo subagent-driven).

**Bloco A — progresso (22/07, sessão 2):**
- ✅ Tasks 1–5: migrations 0030–0034 escritas, commitadas e **aplicadas no banco real** com verificação (runner node+pg no scratchpad lendo `SUPABASE_PASSWORD` do `app/.env.local` — MCP Supabase rejeitado pelo usuário; ver memória `balu-migrations-e-env`).
- ✅ Task 6: tipos TS + Zod + helpers dinheiro (`64cc1c7`).
- ✅ Task 7: `lib/fiscal/semaforo.ts` TDD 10/10 (`ed231ab`).
- ✅ Task 8: tetos de `parametros_fiscais` com fallback (`d8cd22c`).
- ✅ Task 9: guards contador + client email (`1d1db91`) — ⚠️ incidente: `.env.example` no disco era cópia do `.env.local` com segredos reais e foi commitado por engano; commit emendado com template sanitizado (sem remote, nada vazou; considerar rotacionar SERVICE_ROLE_KEY por cautela).
- ✅ Task 10: cadastro contabilidade + aguardando (`9009cef`).
- ✅ Task 11: admin aprovação + gate do layout isentando `adminbalu`/`contador` do onboarding (`ee9513a`) — emenda ao plano registrada.
- ✅ Task 12: convites (`73817ab` + fix `01b8695` — revisão pegou open-redirect `\`, HTML injection em e-mails, checagem de dono, `next` no signup; tudo corrigido).
- ✅ Task 13: painel do contador com semáforo (`672a882`).
- ✅ Task 14: drill-down read-only com guard extra de escopo (`9f6fe0b`).
- ✅ Task 15: cliente pelo contador + refactor `posProcessarNovaEmpresa` (`c9a4f2a` + fix normCnpj `37e50bb`).
- ✅ Task 16: honorários v2 + visão do empresário (`b7ee53a`) — FK do join verificado no banco.
- ✅ Task 17: equipe (`acb4a03`).
- ✅ Task 18: white-label + co-branding + desvincular (`65783f5` + menu `29eb854`); bucket `branding` criado no banco.
- ✅ Task 19: cron honorários recorrentes (`ba51b49`).
- ✅ Task 20: **testes de RLS 8/8 verdes** (`206c46e`) — o teste pegou recursão infinita (42P17) nas policies da 0030; corrigida pela **migration 0035** (`ae8426f`, helper `minha_contabilidade_membro()` SECURITY DEFINER), aplicada no banco.
- ✅ Task 21: E2E da jornada 9/9 verde (`6072b20`, inclui fix de upsert de profiles no aceite). Verificação final: typecheck 0 erros · vitest 471/0 · build limpo · Playwright 35/36 (única falha restante: `rls-isolation.spec.ts`, conta externa hardcoded `allanvalle@outlook.com` com senha inválida — genuinamente pré-existente). A "outra falha pré-existente" apontada pelo subagente (`02-cadastro`, hydration #418) era na verdade **regressão da Task 12** — provada por bisect manual e corrigida em `adb4e0e` (useQueryParam pós-mount).

**BLOCO A COMPLETO — 21/21 tasks. Critério de merge (RLS verde) atendido.**

**Code review + systematic debugging (22/07, sessão 2):** 4 revisores (segurança, correção, SQL, UI/mocks) + verificação no banco vivo. UI limpa: zero mocks, zero botões mortos. Achados corrigidos e **verificados**:
- **Migration 0036** (`550064f`): (a) CRÍTICO — qualquer autenticado podia se auto-promover a `AdminBalu` via `role_types` (sem trigger/constraint) — provado explorável e corrigido (trigger com `current_user`/SECURITY INVOKER; atacante bloqueado, service_role liberado — testado); (b) CRÍTICO — semáforo comparava competência `YYYY-MM` mas app grava `YYYYMM` → todo Simples ficava vermelho pra sempre — provado com dados reais e corrigido; (c) `aceitar_convite` queimava convite de membro sem vincular (usuário já em outro escritório); (d) convites exigem escritório aprovado + trigger anti-vazamento de company_id; cert/guias-erro/DASN na RPC.
- **App** (`a477b90`): open-redirect por TAB/CR/LF no `safeNext` (+teste); fuso BRT em statusHonorario/semaforo/marcar-pago (novo `tempo-brt`, +testes de fronteira); erro do profiles-upsert propagado no aceite; CNAE sync disparado no aceite (antes empresa do contador ficava sem CNAE); SVG recusado no upload de logo; **dead-end de UI corrigido** — `/contador` sempre visível pro contador (caminho até o cadastro).
- Não alterado (decisão registrada): compare do cron secret segue `!==` como o cron `sync-municipios` existente (risco timing marginal); policy `apuracoes_select_contador` fica (superfície morta inócua).
- Verificação final: typecheck 0 · vitest **478/0** · build limpo · **RLS 8/8 reconfirmado** após a 0036.

**Falta: decisão de merge para main.**

**Correções ao plano descobertas na execução:**
- `arquivos_auxiliares` usa `company_id` (não `unique_id_empresa`) — plano corrigido, 0033 ajustada.
- Papel `contador` também precisava de isenção no gate `/onboarding` (Task 11 cobriu).
- Policies da 0030 recursavam (42P17) — 0035 corrige (padrão SECURITY DEFINER).

**Gaps conhecidos (aceitos para o lançamento, revisar depois):**
- CNAEs de empresa criada pelo contador ficam vazios até o cliente aceitar o convite (`company_cnaes.owner_user_id NOT NULL`) — sem backfill automático no aceite.
- Convidado NOVO que cria conta pelo botão do convite: `next` só funciona no fluxo auto-confirm; com confirmação por e-mail, ele volta pelo link do convite no e-mail original.
- Logo antigo fica órfão no bucket ao trocar de extensão (higiene de storage, sem impacto).

**Pendências desta fase:** conceder `AdminBalu` ao usuário do Michel (falta o UUID — Step 4 da Task 11); `docs/reference/db_atual.sql` regenerado nesta sessão (conferir commit); decidir merge da branch após E2E verde.

O código do app está congelado desde 15/06/2026 (commit `52a0844`). Em 22/07 foi feita a análise cruzada dos documentos de direcionamento (`Direcionamento/`: batimento, comparativo Contabilizei e devolutiva do Michel) contra o código real, e produzidos os documentos abaixo.

## Documentos-guia (ordem de leitura para retomar contexto)

1. `docs/product/PRD-Balu-V2.md` — **escopo de lançamento**: visão, 5 blocos (A–E), enquadramento legal consolidado, dependências externas, critérios de aceite propostos, pontos a realinhar com o Michel.
2. `docs/product/2026-07-22-bloco-a-multitenant-contador-design.md` — spec aprovada do Bloco A (movida de specs/ por decisão do usuário em 22/07; specs dos próximos blocos seguem em `docs/superpowers/specs/`).
3. `docs/superpowers/plans/2026-07-22-bloco-a-multitenant-contador.md` — **plano de implementação do Bloco A (21 tasks, próximo passo)**.
4. `docs/investigations/BATIMENTO-PLANEJAMENTO-VERDE.md` — o que está entregue vs. planejado (jun/2026, ainda válido).
5. `Direcionamento/devolutiva-dev-preenchido.html` (fora do repo, em `D:\balu-app-v2\Direcionamento\`) — fonte da verdade das decisões do cliente.

## Sequência dos blocos

**A (multi-tenant contador) → E (hardening/LGPD) → D (produção fiscal) → B (billing Asaas) → C (notificações/WhatsApp/IA)**

| Bloco | Spec | Plano | Implementação |
|---|---|---|---|
| A — multi-tenant, painel contador, white-label, honorários v2 | ✅ aprovada | ✅ escrito (21 tasks) | ⬜ não iniciada |
| E — hardening + LGPD | ⬜ | ⬜ | ⬜ |
| D — produção fiscal (Focus prod, PGDAS-D real, DASN assistida, abertura UI) | ⬜ | ⬜ | ⬜ |
| B — billing Asaas | ⬜ | ⬜ | ⬜ |
| C — notificações, WhatsApp, IA | ⬜ | ⬜ | ⬜ |

## Decisões-chave já tomadas (não rediscutir sem motivo novo)

- Multi-escritório desde o lançamento; 1 escritório = N usuários iguais (papéis = V2).
- Painel do contador é **somente visualização**; garantia no banco (RLS sem políticas de escrita).
- Cadastro de escritório com **aprovação por admin** (validação CRC — DL 9.295/46).
- Co-branding (não substituição total); e-mails de auth continuam Balu.
- Honorários v2: controle manual + recorrência via cron; Asaas pluga depois (campos `asaas_*` prontos).
- Semáforo "irregular": 5 critérios fiscais (LC 123 arts. 3º/18-A/21; Res. CGSN 140/2018 arts. 38 e 109); honorário atrasado é coluna separada.
- Tetos fiscais em tabela `parametros_fiscais`, nunca hard-coded.
- IA nunca calcula/transmite — determinístico decide, IA explica (guard-rail de todos os blocos).
- Reforma Tributária: CBS/IBS **não atinge Simples/MEI em 2026** — sem ação no lançamento.

## Pendências externas (cobrar do Michel — travam D/B/C, não A/E)

- [ ] Validar credenciais SERPRO de produção (ele diz "já tenho"; Trial dava 403)
- [ ] Credenciais Asaas de produção (não existem)
- [ ] Credenciais WhatsApp Business API (ele diz que tem)
- [ ] Contrato Focus produção + certificados A1 dos pilotos + procurações RFB
- [ ] Realinhar: "saldo disponível real" no dashboard · DASN-SIMEI sem transmissão automática (fluxo assistido) · DEFIS no lançamento ou V2 · definição de pronto + nº de pilotos

## Próximo passo imediato

Executar o plano do Bloco A (`docs/superpowers/plans/2026-07-22-bloco-a-multitenant-contador.md`), task por task, em branch `feat/bloco-a-multitenant`. Critério de merge: testes de RLS (Task 20) verdes.

**Retomada:** ao voltar, escolher o modo de execução (ficou pendente): (1) subagent-driven — um subagente por task com revisão entre tasks (recomendado), ou (2) inline em lotes com checkpoints. Começar pela Task 1 (migration 0030).

## Convenções da sessão

- Rodar ferramentas a partir de `balu/` (raiz do git). Specs/planos via skills brainstorming → writing-plans.
- Git identity local: Walace <eufacopublicidade@gmail.com>.
- Banco: `docs/reference/db_atual.sql` é a fonte da verdade do schema (a `0001` é idealizada e diverge — ver `docs/investigations/DB-DIVERGENCIA.md`); migrations aplicadas manualmente no SQL Editor.
