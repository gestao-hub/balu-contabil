# Plano de 4 Dias — Balu v1

Roteiro executável para entregar a v1 do Balu em 4 dias úteis. Stack: **Next.js 15 + Supabase + Tailwind**. Cada PR sugerido = 1 unidade lógica que vira 1 pull request. Cadência de review: pausar para aprovação a cada PR.

Fonte detalhada: `PLANO-4-DIAS.md`. Specs por feature: `V1-FUNCIONALIDADES.md`. O que reusar: `STATUS-IMPLEMENTACAO.md`.

## Resumo do épico

- **Day 1**: Dashboard + Notas (listagem/detalhe/cancelamento)
- **Day 2**: Emissão de NFS-e (sandbox Focus)
- **Day 3**: Apuração de impostos + geração de DAS (sandbox Serpro) + cron mensal
- **Day 4**: Testes E2E + polish de UX + handoff

Total: 5 rotas, 6+ server actions, 4+ componentes, 1 cron, 1 webhook ampliado.

## Out of scope (vão pra v2)

WhatsApp, IA conversacional, busca semântica, conciliação bancária, domínio personalizado, IA tradutor leigo. Detalhe em `V2-FUNCIONALIDADES.md`.

## CARD 0 — Revisão Balu

- **Status:** To Do
- **Priority:** Alta
- **Estimate:** M (4-6h)
- **Labels:** revisão, qa, prioridade-máxima
- **Dependencies:** PR 1.1, PR 1.2

**Prioridade máxima.** Antes de retomar o desenvolvimento, fazer um passe de QA de **tudo que já existe** no app. Boa parte foi verificada só em `tsc`/`next build` — falta a verificação de **runtime com Supabase real** (criar `.env.local`). Referência do que está pronto: `STATUS-IMPLEMENTACAO.md` §2 e §3.

Auth:
- [ ] Login com credenciais válidas entra no dashboard
- [ ] Cadastro cria usuário + profile (trigger `handle_new_user`)
- [ ] Reset de senha: request + update via `?code=`
- [ ] Rotas protegidas redirecionam para `/login` sem sessão

Empresa / onboarding:
- [ ] Criar empresa no onboarding (lookup CNPJ Focus + CEP ViaCEP)
- [ ] Troca de empresa ativa no `<MenuLateral>`
- [ ] Editar dados da empresa em `/configuracoes`

Clientes:
- [ ] Criar cliente (dedup CPF/CNPJ rejeita duplicado)
- [ ] Editar cliente
- [ ] Excluir (soft delete) cliente
- [ ] Listagem com busca/filtros

Dashboard (PR 1.1):
- [ ] 4 cards mostram dados reais (não placeholder)
- [ ] Lista "O que você precisa fazer" carrega de dados reais
- [ ] Botão "Pagar" abre `<PagarGuiaModal>` (stub)

Listagem de notas (PR 1.2):
- [ ] Lista ordenada por `data_emissao desc`
- [ ] 4 filtros combináveis funcionam
- [ ] Export CSV baixa arquivo válido
- [ ] Linha clicável navega para `/notas_fiscais/<id>`

Qualidade / infra:
- [ ] `tsc --noEmit` zero erros
- [ ] `next build` sucesso
- [ ] Playwright smoke + walkthrough passando
- [ ] Runtime validado contra Supabase real (`.env.local` configurado)

## CARD 1 — PR 1.1: Dashboard home (`/`)

- **Status:** Done
- **Priority:** Alta
- **Estimate:** M (4-6h)
- **Labels:** day1, dashboard
- **Dependencies:**

✅ FEITO (commit `9d0461f`, código; runtime pendente Supabase). Spec: `V1-FUNCIONALIDADES.md` §5.1 + §5.2.

Server component com 4 queries em paralelo: receita do mês atual, próxima guia vencendo, última nota emitida, lista de pendências (notas em erro, guias vencendo em 7d, certificado A1 vencendo em 30d).

Arquivos: `app/(auth)/page.tsx`, `components/DashboardCard.tsx`, `components/PendingActionsList.tsx`, `lib/dashboard/queries.ts`. Reusa `<MenuLateral>`, `useToast()`, padrão de `clientes/page.tsx`.

DoD:
- [ ] `/` mostra 4 cards reais (não placeholder)
- [ ] Card "Próxima guia" tem botão "Pagar" que abre `<PagarGuiaModal>` (stub OK por hoje)
- [ ] Lista de pendências carrega de dados reais
- [ ] `tsc --noEmit` zero erros

## CARD 2 — PR 1.2: Listagem de notas (`/notas_fiscais`)

- **Status:** Done
- **Priority:** Alta
- **Estimate:** M (4-6h)
- **Labels:** day1, notas
- **Dependencies:**

✅ FEITO (commit `4fe1e80`, código; runtime pendente Supabase). Spec: `V1-FUNCIONALIDADES.md` §3.2.

Arquivos: `app/(auth)/notas_fiscais/page.tsx`, `notas_fiscais/NotasFiscaisList.tsx` (client), `notas_fiscais/actions.ts` (`exportNotasCsvAction`). Reusa `<FilterPeriodo>`, `<Toaster>`, padrão de `ClientesListClient.tsx`. Filtros: período, tipo (TipoNF), status, texto livre.

DoD:
- [ ] Lista 1 página (50 notas) ordenadas por `data_emissao desc`
- [ ] 4 filtros funcionam (combináveis)
- [ ] Export CSV baixa arquivo válido
- [ ] Linha clicável navega para `/notas_fiscais/<id>`

## CARD 3 — PR 1.3: Detalhe + cancelamento (`/notas_fiscais/[id]`)

- **Status:** To Do
- **Priority:** Alta
- **Estimate:** M (4-6h)
- **Labels:** day1, notas
- **Dependencies:** PR 1.2

🆕 PRÓXIMO. Spec: `V1-FUNCIONALIDADES.md` §3.5 + PRD §10.1.

Arquivos: `app/(auth)/notas_fiscais/[id]/page.tsx`, `[id]/CancelarButton.tsx` (client → `<PopupConfirm>`), `notas_fiscais/actions.ts` (`cancelarNotaAction(id, justificativa)`).

`cancelarNotaAction`: valida `justificativa.length >= 15` (regra SEFAZ) → `focus.cancelarNfe(nota.ref, justificativa, env)` por `nota.tipo_nf` → PATCH `status='cancelada'`, `cancelled_at`, `cancellation_reason` → `revalidatePath('/notas_fiscais')`. Reusa `<PopupConfirm variant='destructive' busy>`, `focus.baixarDanfe`, `focus.baixarXmlNfe`, `focus.cancelarNfe`.

DoD:
- [ ] Header mostra chave de acesso, protocolo, status
- [ ] Botões "Baixar XML" e "Baixar DANFE" funcionam (server action → Focus → binário)
- [ ] Botão "Cancelar" só aparece se `status='ativa'` e (NFS-e) `cancelamento_so_portal=false`
- [ ] Cancelamento exige justificativa ≥ 15 chars; rejeita se menor
- [ ] Cancelamento bem-sucedido atualiza `status` na lista (revalidate)

## CARD 4 — PR 2.1: Form de emissão NFS-e

- **Status:** To Do
- **Priority:** Alta
- **Estimate:** L (6-8h)
- **Labels:** day2, emissao
- **Dependencies:** PR 1.2

Spec: `V1-FUNCIONALIDADES.md` §3.1 + PRD §10.2 (variante NFS-e).

Arquivos: `app/(auth)/notas_fiscais/emissao/page.tsx` (server: carrega clientes + `empresas_fiscais`), `emissao/EmissaoForm.tsx` (client, Zod), `notas_fiscais/actions.ts` (`emitirNotaAction`). Form: cliente (autocomplete ou consumidor não identificado), descrição, valor (R$ máscara), código ISS (LC 116 top-20 + "Outro"). Restante puxado de `empresas_fiscais`.

`emitirNotaAction`: valida Zod → exige `empresa_fiscal_ativada=true` → `ref = focus.generateRef` → insere `notas_fiscais` `status='pendente'` → monta payload NFS-e → `focus.emitirNfse(ref, payload, env)` (`env` de `emitir_nota_homol_antes_producao`) → sucesso: `status='ativa'` + chave/protocolo/links; erro: `status='erro'` + resposta Focus → `revalidatePath` + redirect detalhe. Usar `useActionState` (React 19).

DoD:
- [ ] Form valida client-side (Zod) — obrigatórios marcados
- [ ] Botão "Emitir" desabilitado se empresa não ativada
- [ ] Submit chama Focus sandbox; nota aparece com status `ativa` ou `erro`
- [ ] Erro: toast vermelho com mensagem traduzida (não `rejection_code: 401`)
- [ ] Webhook `app/api/webhooks/focus/route.ts` recebe callback e atualiza nota (testar via curl)

## CARD 5 — PR 2.2: Botão "Emitir nova" na listagem

- **Status:** To Do
- **Priority:** Média
- **Estimate:** S (<1h)
- **Labels:** day2, emissao
- **Dependencies:** PR 1.2, PR 2.1

Arquivos: `app/(auth)/notas_fiscais/page.tsx` — adicionar `<Link href="/notas_fiscais/emissao">Emitir nova</Link>` no topo.

DoD:
- [ ] Botão visível e linka corretamente

## CARD 6 — PR 3.1: Dashboard de impostos (`/impostos`)

- **Status:** To Do
- **Priority:** Alta
- **Estimate:** M (4-6h)
- **Labels:** day3, impostos
- **Dependencies:**

Spec: `V1-FUNCIONALIDADES.md` §4 + PRD §11.1.

Arquivos: `app/(auth)/impostos/page.tsx`, `impostos/ImpostosLayout.tsx` (client, 3 seções: competência atual, histórico de guias, declarações). Queries por `competencia = ${YYYY}${MM}`. `<GuiaCard>`: valor, vencimento, status (badge), botões "Baixar PDF", "Pagar via Pix" (linha digitável + QR), "Marcar como paga". `marcarGuiaPagaAction(id)` → PATCH `status='paga'`, `data_pagamento`.

DoD:
- [ ] Página carrega sem erro mesmo sem dados (empty state)
- [ ] Card "competência atual" mostra apuração + declaração + guia (ou "não calculado" com CTA)
- [ ] Histórico paginado / scrollable
- [ ] Toggle guia paga funciona

## CARD 7 — PR 3.2: Cálculo manual — wizard (`/impostos/novo`)

- **Status:** To Do
- **Priority:** Alta
- **Estimate:** L (6-8h)
- **Labels:** day3, impostos, wizard
- **Dependencies:** PR 3.1

Spec: `V1-FUNCIONALIDADES.md` §4.1 + §4.2 + PRD §11.2.

Arquivos: `app/(auth)/impostos/novo/page.tsx`, `novo/ApuracaoWizard.tsx` (client, 4 etapas), `impostos/actions.ts` (`iniciarApuracaoAction`, `gerarGuiaAction`). Etapas: (1) competência (default mês anterior), (2) consolidar receitas via `n8n.consolidarReceitas` (aguarda webhook/polling), (3) calcular RBT12 + alíquota via `n8n.calcularRbt12` (breakdown), (4) gerar DAS via `serpro.emitirDas`.

`gerarGuiaAction`: busca `empresas_fiscais` + `apuracoes_fiscais` → `serpro.buildEnvelope({...idServico: GERAR_DAS, dados:{pa, valorTotalPago}})` → `serpro.emitirDas(env, envelope)` → persiste `guias_fiscais` com PDF + status `gerada`. Reusa `<Loading>`, padrão `<CreateCompanyDialog>`.

DoD:
- [ ] Wizard completo das 4 etapas roda no sandbox Serpro
- [ ] Guia aparece em `/impostos` ao final
- [ ] Erros em qualquer etapa mostram toast + permitem retry

## CARD 8 — PR 3.3: Cron mensal (Vercel Cron)

- **Status:** To Do
- **Priority:** Média
- **Estimate:** S (1-2h)
- **Labels:** day3, cron
- **Dependencies:** PR 3.2

Spec: `V1-FUNCIONALIDADES.md` §4.1 (automação).

Arquivos: `app/api/cron/apuracao-mensal/route.ts` (GET, protegido por `Authorization: Bearer ${CRON_SECRET}`), `vercel.json` (`crons: [{ path, schedule: '0 6 1 * *' }]` = dia 1, 06:00 UTC). Handler: valida header → lista `empresas_fiscais` ativas → invoca `n8n.consolidarReceitas` (fire-and-forget) → log estruturado.

DoD:
- [ ] Rota protegida (sem header → 401)
- [ ] Dispara N webhooks n8n em paralelo
- [ ] Log mostra resultado de cada disparo

## CARD 9 — PR 4.1: Testes E2E do fluxo principal

- **Status:** To Do
- **Priority:** Alta
- **Estimate:** L (6-8h)
- **Labels:** day4, tests, e2e
- **Dependencies:** PR 1.3, PR 2.1, PR 3.2

Arquivos: `tests/e2e-fluxo-completo.spec.ts` (novo). Cenário: cadastrar usuário (fixture `service_role`) → login → criar empresa (CNPJ sandbox + ViaCEP) → cadastrar cliente → emitir NFS-e (Focus sandbox) → ver nota → abrir detalhe (chave + DANFE) → wizard `/impostos/novo` até gerar DAS → marcar guia paga → dashboard com receita atualizada. Reusa `tests/smoke.spec.ts` e `walkthrough.spec.ts` como templates.

DoD:
- [ ] Spec roda do início ao fim sem flakiness
- [ ] Screenshots salvos em `screenshots/e2e/`
- [ ] CI-ready (sem interação manual)

## CARD 10 — PR 4.2: Refinar UX

- **Status:** To Do
- **Priority:** Média
- **Estimate:** M (3-5h)
- **Labels:** day4, ux, polish
- **Dependencies:** PR 1.3, PR 3.1

Empty states em todas as listas (com CTA), mensagens de erro traduzidas (Focus/Serpro → pt-BR humano), loading states (`<Loading fullscreen>`) em server actions longas, sidebar mobile (hamburguer + drawer).

DoD:
- [ ] Nenhuma página mostra dados crus ("undefined", "[object Object]")
- [ ] Mobile (390×844) usa todas as rotas sem overflow horizontal

## CARD 11 — PR 4.3: Atualizar `README.md`

- **Status:** To Do
- **Priority:** Baixa
- **Estimate:** S (1-2h)
- **Labels:** day4, docs
- **Dependencies:** PR 4.1

Marcar v1 como "completa" na §4. Adicionar §10 "Como subir em produção": aplicar migration no Supabase prod, criar bucket `company-certificates` privado, configurar Vercel env vars (todas do `.env.example`), configurar Vercel Cron, apontar domínio, smoke manual de cada rota. Bonus: `ARCHITECTURE.md` com diagrama mermaid `flowchart TD` (browser → Next → Supabase + Focus + Serpro + n8n).

DoD:
- [ ] §4 marca v1 como completa
- [ ] §10 deploy prod com checklist escrito
- [ ] (bonus) ARCHITECTURE.md com diagrama

## CARD 12 — PR 4.4: Regerar zip de entrega

- **Status:** To Do
- **Priority:** Baixa
- **Estimate:** S (<1h)
- **Labels:** day4, handoff
- **Dependencies:** PR 4.1, PR 4.2, PR 4.3

Regerar `balu.zip` excluindo `node_modules`, `.next`, `.env.local`, `playwright-report`, `test-results`, `*.DS_Store`. Conferir conteúdo com `unzip -l`.

DoD:
- [ ] Zip gerado sem artefatos pesados/secretos
- [ ] `unzip -l` confere conteúdo esperado
