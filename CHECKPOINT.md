# CHECKPOINT — Balu

> Estado vivo do projeto para retomada de contexto. Atualizar ao fim de cada sessão de trabalho.
> **Última atualização:** 2026-07-23 (sessão 3 — auto-deploy testado + rodada de QA manual em produção)

---

## Sessão 3 (2026-07-23) — QA manual em produção + fixes

**Auto-deploy Git↔Vercel:** ATIVO e testado — cada push na `main` deploya produção sozinho (~1 min).

**AdminBalu de produção criado:** `eufacopublicidade+admin@gmail.com` (via API admin + SQL). Contas de teste em prod: `testeefluxodeautomacao@gmail.com` (contador, escritório "Escritório Teste Balu" aprovado), `walacesssantos@gmail.com` (empresário, dona da empresa dev.ide), `eufacopublicidade+e2e@gmail.com` (E2E). Cadastros/aceites confirmados manualmente via API admin (Redirect URLs do Supabase ainda pendentes → links de e-mail caem em localhost).

**7 bugs de UX/produto corrigidos** (todos com push→deploy, exceto onde nota):
1. `2513c1a`+`3868866` — **loop de redirect pós-login (tela preta)**: gate de aceite LGPD dependia de header `x-pathname` do middleware que não chega nas navegações RSC na Vercel → loop `/aceite→/aceite`. Gates movidos p/ route group `(auth)/(gated)/` (todas as páginas menos /aceite); middleware removido; ordem aceite→onboarding corrigida.
2. `33951b0` — menu do empresário (Clientes/Notas/Impostos/Honorários/Config) aparecia p/ contador/admin sem empresa → beco "Nenhuma empresa selecionada". Marcados `precisaEmpresa` e filtrados.
3. `ee80f87` — página `/contador/honorarios` estava **órfã** (sem link no menu). Link adicionado ao NAV do contador.
4. `c3935f8` — limite do logo do escritório 1MB→**4MB** (teto de body da Vercel; 500MB pedido é inviável).
5. `937118e` — honorário rejeitava valor com separador de milhar (`1.200,00`). Novo helper `normalizarValorBRL` em `lib/format/dinheiro.ts` + `z.preprocess` no `HonorarioV2Schema`; exige >0.
6. `917b7a3` — **furo: `aceitar_convite` não conferia e-mail** → contador (sessão ativa) abriu o link do convite de cliente e assumiu a empresa do próprio cliente. **Migration 0043** aplicada no banco (trava: e-mail da conta logada = `convites.email`, case-insensitive; erro `EMAIL_NAO_CONFERE`). Vale p/ link vazado também.
7. Gap documentado: `role_types` **sem UNIQUE(user_id)** (permitiu duplicata no insert manual do admin) — candidata a migration futura.

**Migrations aplicadas em prod nesta sessão:** 0043 (via runner node+pg no scratchpad; classifier bloqueia MCP/escrita, usuário roda os scripts com `! node ...`).

**Pendências reabertas:** (a) Supabase Auth Redirect URLs (`https://balu-contabil.vercel.app/**` + Site URL) — trava links de e-mail; (b) **RESEND_API_KEY/EMAIL_FROM ausentes** → nenhum e-mail transacional do app é enviado (convites/avisos são no-op logado); será pré-req do P0.2. Fluxo de convite funciona pelo **link copiável** na tela.

**Não confirmado ainda:** co-branding (logo/nome do escritório na sidebar do empresário) em produção.

---

## Onde estamos

**Fase:** **Bloco A e Bloco E concluídos em `main`; código no GitHub e app no ar na Vercel.** Próximo passo de produto: **P0.2 — motor de obrigações/notificações** (buildável já, sem depender do Michel — ver `docs/novas specs e prd/`). Bloco D/B/C dependem de credenciais externas do Michel. Fluxo por bloco: /brainstorming → spec → writing-plans → execução.

## Infraestrutura (GitHub + Vercel) — configurada em 2026-07-22

**GitHub:** repo **`gestao-hub/balu-contabil`** (⚠️ **público**). `main` + tags (`pre-preview-bloco-a`, `pre-bloco-e`) + as 5 branches antigas empurradas. Remote `origin` já configurado; **push autentica como `grupoideapps`** (colaborador, e-mail contato@grupoidecomunicacao.com). Auditoria de segredos feita antes do push: histórico limpo. `main` = `origin/main`.

**Vercel:** projeto **`balu-contabil`** no scope **`gestao-9664s-projects`** (conta do luan@grupoidecomunicacao.com — NÃO usar tryia-social nem a Vercel do grupoideapps). **App no ar: https://balu-contabil.vercel.app** (deploy de produção via CLI, aponta pro **Supabase de PRODUÇÃO**). Config: 11 env vars em prod+preview (Supabase, Focus, SERPRO, CERT_ENC_KEY, CRON_SECRET, FOCUS_WEBHOOK_SECRET, NEXT_PUBLIC_SITE_URL=https://balu-contabil.vercel.app), `rootDirectory=app`, framework nextjs. Deploy manual: `cd app && npx vercel deploy --prod --scope gestao-9664s-projects`. (Domínio `app.balu.com.br` foi configurado e depois **revertido** a pedido do usuário — projeto só tem `balu-contabil.vercel.app`.)

**Pendências de infra:**
1. ✅ **Auto-deploy (Git integration): ATIVO e testado em 2026-07-23** — usuário conectou o OAuth no navegador; push `accd874` na main disparou build automático (user `gestao-9664`), Ready em 58s, aliased para balu-contabil.vercel.app, smoke test ok (307→/login). Cada push na main deploya produção sozinho.
2. **Supabase Auth:** adicionar `https://balu-contabil.vercel.app/**` em Authentication → URL Configuration → Redirect URLs (senão cadastro/reset/convite por e-mail não redirecionam).
3. **Rotação da `SUPABASE_SERVICE_ROLE_KEY`** (recomendação pendente de incidentes anteriores; a chave também está agora nas env vars da Vercel — legítimo, mas se quiser zero risco residual, rotacionar).

**Bloco E — hardening + LGPD (COMPLETO, direto em `main`, sem branch — repo local):** 16 tasks + 2 rodadas de code-review adversarial com fixes verificados no banco vivo.
- Migrations **0037–0042** aplicadas: rate_limit, audit_log, documento_versoes/aceites, anonimizar_usuario (+ correções), triggers de validação.
- Entregue: rate-limiting (login/cadastro/convite/reset/webhook), anti-SSRF no download (allowlist S3 + redirect:manual), anti-IDOR clientes, webhook Focus com segredo constant-time (`FOCUS_WEBHOOK_SECRET`), cifra AES-256-GCM das credenciais NFS-e, aceite versionado de termos/política + gate de re-aceite (`assertAceitesEmDia` nas ações de escrita), export de dados do titular, **exclusão = anonimiza + retém fiscal + bane login (nunca deleta auth.user — FKs são CASCADE)**, trilha de auditoria, minutas jurídicas (política/termos v1.0 seedadas, DPO placeholder), inventário de dados.
- **Code review (2 rodadas) — todos os achados corrigidos e verificados:** escalação AdminBalu via role_types (0036); PGDAS competência YYYY-MM×YYYYMM; open-redirect TAB/CR/LF no safeNext; fuso BRT; SSRF por redirect-follow; anonimização incompleta (companies/empresas_fiscais/cert/**abertura CPF-RG-nome-mãe**); **regressão que eu introduzi** (0041 perdeu `contabilidade_id=NULL`, corrigida na 0042); aceites auto-fabricáveis (trigger); rate-limit case-splitting. Anonimização **provada end-to-end** no banco (nota retida, PII zerada, abertura apagada, rollback limpo).
- Verificação final: typecheck 0 · vitest **490** · build limpo · Playwright RLS 17/17.
- **Pendências de go-live (não bloqueiam código):** revisão jurídica das minutas + nome/e-mail do DPO + razão/CNPJ do controlador; definir `FOCUS_WEBHOOK_SECRET` na URL de callback da Focus; allowlist de IP da Focus no edge; rotação da service_role.
- **Itens menores documentados (aceitos):** `decifrarCampo` sem uso em runtime hoje (landmine se alguém ler credencial NFS-e do banco no futuro — tem que decifrar); `deleteAccountAction` não é atômica entre RPC e ban do auth (retorna erro se falhar, sem retry); `signOut` não revoga sessões de outros dispositivos (JWT expira naturalmente); entidades do contador (contabilidades) não anonimizadas (identidade de negócio).

**Backup/reversão do Bloco A:** tag `pre-preview-bloco-a` (f1c3f21); main pré-merge estava em `78dd189`. Reverter dados do teste: `scratchpad/reverter-preview.sql` + `docs/reference/RESTORE-POINT-preview-2026-07-22.md`.

**Backup/reversão do Bloco A:** tag `pre-preview-bloco-a` (f1c3f21); main pré-merge estava em `78dd189`. Reverter dados do teste: `scratchpad/reverter-preview.sql` + `docs/reference/RESTORE-POINT-preview-2026-07-22.md`.

**Preview Vercel:** NÃO subido (adiado pelo usuário). Não há projeto Vercel do balu em nenhuma scope da CLI logada (luan-4913: times ide-apps, tryia-social). `app/vercel.json` só tem crons — não linka projeto. Ao retomar o preview: precisa definir a conta/scope (tryia-social foi descartada pelo usuário) e as env vars vão do `app/.env.local` (menos SUPABASE_PASSWORD; NEXT_PUBLIC_SITE_URL = URL do preview). O deploy apontará para o Supabase de PRODUÇÃO (único que existe).

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

**Pendências desta fase:** conceder `AdminBalu` ao usuário do Michel (falta o UUID — Step 4 da Task 11; em 2026-07-23 foi criado o AdminBalu do Walace em produção — `eufacopublicidade+admin@gmail.com`, via API admin + SQL, senha temporária fora do repo). ⚠️ Gap descoberto: `role_types` **não tem UNIQUE(user_id)** — o insert manual duplicou a linha e o `.maybeSingle()` do layout falharia; duplicata removida, mas vale migration com unique index (candidata a 0043); `docs/reference/db_atual.sql` regenerado nesta sessão (conferir commit); decidir merge da branch após E2E verde.

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
| A — multi-tenant, painel contador, white-label, honorários v2 | ✅ aprovada | ✅ escrito (21 tasks) | ✅ **em main** (0030–0036) |
| E — hardening + LGPD | ✅ aprovada | ✅ escrito (16 tasks) | ✅ **em main** (0037–0042) |
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
