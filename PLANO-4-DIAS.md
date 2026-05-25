# Plano de 4 Dias — Balu v1

> **Para que serve**: roteiro executável dia-a-dia para um dev humano (guiando uma LLM) entregar a v1 do Balu em 4 dias úteis. Stack assumida: **Next.js 15 + Supabase + Tailwind**. Se quiser trocar de stack, leia o §"Apêndice A — Troca de stack" no fim.
>
> **Como usar este doc**:
> 1. Comece o dia lendo a seção do dia
> 2. Para cada feature listada, abra `STATUS-IMPLEMENTACAO.md` pra ver o que reusar
> 3. Abra `V1-FUNCIONALIDADES.md` na seção correspondente para detalhe da feature
> 4. Rode `./verify.sh` no fim de cada dia
> 5. Mova cards no kanban (`balu-next/.kanban/board.json` → ver instruções no README §6.5)
>
> **Convenções**:
> - "PR sugerido" = 1 unidade lógica que pode virar 1 pull request (mesmo trabalhando em main)
> - "DoD" = Definition of Done — o que precisa ser verdade para considerar pronto
> - Cada arquivo novo deve ter header `// @custom — <razão>` no topo

---

## Visão geral dos 4 dias

| Dia | Foco | Rotas tocadas | Outputs |
|---|---|---|---|
| **Day 1** | Dashboard + Notas (listagem/detalhe) | `app/(auth)/page.tsx`, `notas_fiscais/page.tsx`, `notas_fiscais/[id]/page.tsx` | Dashboard utilizável + listar + abrir + cancelar nota |
| **Day 2** | Emissão NFS-e | `app/(auth)/notas_fiscais/emissao/page.tsx` + actions | Emitir NFS-e real no sandbox Focus + ver chave + DANFE |
| **Day 3** | Apuração + DAS | `app/(auth)/impostos/page.tsx`, `impostos/novo/page.tsx`, cron | Apuração consolidada + geração DAS sandbox + cron mensal |
| **Day 4** | Polish + handoff | Playwright, README, zip | Testes E2E cobrindo fluxo completo + entrega final |

**Total**: 5 rotas a implementar (todas hoje stubs com `// @generated`), 6+ server actions, 4+ componentes novos, 1 cron, 1 webhook ampliado.

**Não estão na v1** (vão pra v2 — `V2-FUNCIONALIDADES.md`): WhatsApp, IA conversacional, busca semântica, conciliação bancária, domínio personalizado, IA tradutor leigo.

---

## Day 1 — Dashboard + Notas (listagem/detalhe)

### Objetivo
Usuário logado vê um **dashboard útil** ao entrar (não mais stub vazio) e consegue **listar** suas notas, **abrir o detalhe** de qualquer uma e **cancelar** se necessário.

### PRs sugeridos

#### PR 1.1 — Dashboard home (`/`)
**Spec**: `V1-FUNCIONALIDADES.md` §5.1 + §5.2

Arquivos a criar/editar:
- `app/(auth)/page.tsx` — substituir stub. Server component que carrega 4 queries em paralelo:
  - Receita mês atual (`notas_fiscais` agregado por `data_emissao` mês atual, `status='ativa'`)
  - Próxima guia vencendo (`guias_fiscais` ordenada por `data_vencimento`, `status != 'paga'`, limit 1)
  - Última nota emitida (`notas_fiscais` ordenada por `data_emissao desc`, limit 1)
  - Lista de pendências (notas em erro, guias vencendo em 7d, certificado A1 vencendo em 30d)
- `components/DashboardCard.tsx` — card reusável (props: `title, icon, value, subtitle, action?`)
- `components/PendingActionsList.tsx` — lista de ações pendentes com CTA
- `lib/dashboard/queries.ts` — funções server-side `getDashboardMetrics(companyId)`, `getPendingActions(userId, companyId)`

Reusa: `<MenuLateral>`, `useToast()`, padrão de `app/(auth)/clientes/page.tsx`.

**DoD**:
- [ ] `/` mostra 4 cards reais (não placeholder)
- [ ] Card "Próxima guia" tem botão "Pagar" que abre `<PagarGuiaModal>` (stub OK por hoje — implementar real no Day 3)
- [ ] Lista de pendências carrega de dados reais
- [ ] `tsc --noEmit` zero erros

#### PR 1.2 — Listagem de notas (`/notas_fiscais`)
**Spec**: `V1-FUNCIONALIDADES.md` §3.2

Arquivos:
- `app/(auth)/notas_fiscais/page.tsx` — substituir stub
- `app/(auth)/notas_fiscais/NotasFiscaisList.tsx` — client component (similar a `ClientesListClient`)
- `app/(auth)/notas_fiscais/actions.ts` — `exportNotasCsvAction(filtros)` retorna `Response` text/csv

Reusa: `<FilterPeriodo>`, `<Toaster>`, padrão de `ClientesListClient.tsx`.

Filtros: período (FilterPeriodo), tipo (TipoNF dropdown), status (Status_nfs), texto livre.

**DoD**:
- [ ] Lista 1 página (50 notas) ordenadas por `data_emissao desc`
- [ ] 4 filtros funcionam (combináveis)
- [ ] Export CSV baixa arquivo válido
- [ ] Linha clicável navega para `/notas_fiscais/<id>`

#### PR 1.3 — Detalhe + cancelamento (`/notas_fiscais/[id]`)
**Spec**: `V1-FUNCIONALIDADES.md` §3.5 + PRD §10.1

Arquivos:
- `app/(auth)/notas_fiscais/[id]/page.tsx` — substituir stub
- `app/(auth)/notas_fiscais/[id]/CancelarButton.tsx` — client component que abre `<PopupConfirm>`
- `app/(auth)/notas_fiscais/actions.ts` — adicionar `cancelarNotaAction(id, justificativa)`

Server action `cancelarNotaAction`:
1. Validar `justificativa.length >= 15` (regra SEFAZ; cliente Focus já valida também)
2. Chamar `focus.cancelarNfe(nota.ref, justificativa, env)` baseado em `nota.tipo_nf`
3. PATCH em `notas_fiscais` setando `status='cancelada'`, `cancelled_at=now()`, `cancellation_reason=justificativa`
4. `revalidatePath('/notas_fiscais')`

Reusa: `<PopupConfirm variant='destructive' busy>`, `focus.baixarDanfe`, `focus.baixarXmlNfe`, `focus.cancelarNfe`.

**DoD**:
- [ ] Header mostra chave de acesso, protocolo, status
- [ ] Botões "Baixar XML" e "Baixar DANFE" funcionam (fetch via server action que chama Focus + devolve binário)
- [ ] Botão "Cancelar" só aparece se `status='ativa'` e (para NFS-e) `cancelamento_so_portal=false`
- [ ] Cancelamento exige justificativa ≥ 15 chars; rejeita se menor
- [ ] Cancelamento bem-sucedido atualiza `status` na lista (revalidate)

### Verificação Day 1
```bash
cd balu-next
npx tsc --noEmit     # zero erros
npm run dev          # subir
# manual: login (criar user de teste) → criar empresa → ver dashboard
# manual: /notas_fiscais → ver vazio (banco zerado) ou notas se houver
```

### Riscos Day 1
- 🔴 **Dados zerados**: como Supabase está vazio, dashboard mostra "0 R$" em tudo. **Mitigação**: criar seed `supabase/seed.sql` com 1 empresa + 3 clientes + 5 notas demo. Não bloqueia.
- 🟡 **Detalhe da nota sem chave_acesso**: notas inseridas manualmente no banco podem não ter todos os campos. Tratar com fallback `'(pendente)'`.

---

## Day 2 — Emissão de NFS-e

### Objetivo
Usuário consegue **emitir uma NFS-e de verdade** contra o sandbox da Focus NFe e ver a nota voltar autorizada (ou ler o erro de forma compreensível se falhou).

### PRs sugeridos

#### PR 2.1 — Form de emissão NFS-e
**Spec**: `V1-FUNCIONALIDADES.md` §3.1 + PRD §10.2 (variante NFS-e)

Arquivos:
- `app/(auth)/notas_fiscais/emissao/page.tsx` — substituir stub. Server component que carrega: clientes (select dropdown), `empresas_fiscais` da empresa atual.
- `app/(auth)/notas_fiscais/emissao/EmissaoForm.tsx` — client component, form Zod-validado
- `app/(auth)/notas_fiscais/actions.ts` — adicionar `emitirNotaAction(payload)`

Form mínimo viável (NFS-e prestação de serviço — fluxo MEI/Simples):
- Cliente (autocomplete de `clientes`, ou "consumidor não identificado")
- Descrição do serviço (textarea)
- Valor do serviço (R$ input com máscara)
- Código de tributação ISS (dropdown estático LC 116 — top 20 mais comuns + opção "Outro" com input livre)

Tudo restante (CNAE, IM, alíquota ISS, regime simples nacional) é puxado de `empresas_fiscais`.

Server action `emitirNotaAction`:
1. Validar Zod
2. Validar `empresa_fiscal_ativada=true` — senão throw "Configure a empresa fiscal antes"
3. `ref = focus.generateRef(empresaId)`
4. Inserir `notas_fiscais` com `status='pendente'`, `ref`, payload bruto
5. Montar payload NFS-e (ver Focus docs — prestador da `current_company`, tomador do cliente selecionado, serviço dos campos do form, tributação derivada)
6. Chamar `focus.emitirNfse(ref, payload, env)` onde `env` vem de `empresas_fiscais.emitir_nota_homol_antes_producao ? 'hom' : 'prod'`
7. Se sucesso → update `notas_fiscais` com `status='ativa'`, chave, protocolo, links XML/PDF
8. Se erro → update `status='erro'`, salva resposta Focus, mostra mensagem
9. `revalidatePath('/notas_fiscais')` + redirect para `/notas_fiscais/<id>`

Reusa: `<Toaster>`, `<Loading fullscreen>`, padrão `<ClienteFormDialog>`. **Importante**: usar `useFormState` (React 19 = `useActionState` from `react`).

**DoD**:
- [ ] Form valida client-side (Zod) — campos obrigatórios marcados
- [ ] Botão "Emitir" desabilitado se empresa não ativada
- [ ] Submit chama Focus sandbox; nota aparece em `/notas_fiscais` com status `ativa` ou `erro`
- [ ] Caso de erro: toast vermelho mostra mensagem traduzida ("CNPJ do tomador inválido" em vez de "rejection_code: 401")
- [ ] Webhook `app/api/webhooks/focus/route.ts` recebe callback e atualiza nota (já existe — testar manualmente com curl)

#### PR 2.2 — Botão "Emitir nova" + integração com listagem
Arquivos:
- `app/(auth)/notas_fiscais/page.tsx` — adicionar botão `<Link href="/notas_fiscais/emissao">Emitir nova</Link>` no topo (após PR 1.2)

**DoD**:
- [ ] Botão visível e linka corretamente

### Verificação Day 2
```bash
# Sandbox Focus: usar CNPJ de teste 00000000000100
cd balu-next
npm run dev
# manual: /notas_fiscais → "Emitir nova" → preencher → submit
# verificar: nota aparece em /notas_fiscais com status='ativa' (autorizada pelo sandbox)
# verificar: clicar na linha abre detalhe com chave de acesso real
# manual: testar erro — preencher com CNPJ inválido, ver mensagem amigável
```

### Riscos Day 2
- 🔴 **Credenciais Focus de sandbox**: o dev precisa ter `FOCUS_NFE_TOKEN` válido em `.env.local`. **Mitigação**: docs em `.env.example` + nota no README.
- 🔴 **Município não suportado**: NFS-e só funciona se o `codigo_municipio` da empresa estiver em `municipios_nfse` AND `requer_certificado=false` OR cert já enviado. **Mitigação**: para a v1, restringir teste a municípios sem cert (ex: Curitiba, Porto Alegre).
- 🟡 **Webhook não testável local sem ngrok**: o callback Focus precisa de URL pública. Para v1, aceitar polling manual (cliente Focus tem `consultarStatusNfe`).

---

## Day 3 — Apuração de Impostos + Geração de DAS

### Objetivo
Sistema **calcula automaticamente** a apuração do mês corrente e **gera a guia DAS** via Serpro. Cron mensal opera mensalmente sem intervenção.

### PRs sugeridos

#### PR 3.1 — Dashboard de impostos (`/impostos`)
**Spec**: `V1-FUNCIONALIDADES.md` §4 + PRD §11.1

Arquivos:
- `app/(auth)/impostos/page.tsx` — substituir stub
- `app/(auth)/impostos/ImpostosLayout.tsx` — client component com 3 seções: "Competência atual", "Histórico de guias", "Declarações"

Queries:
- Competência atual: `apuracoes_fiscais` + `declaracoes_fiscais` + `guias_fiscais` para `competencia = ${YYYY}${MM atual}`
- Histórico guias: `guias_fiscais` ordenado por `competencia desc`
- Histórico declarações: `declaracoes_fiscais` ordenado por `competencia desc`

Componente `<GuiaCard>`:
- Mostra valor, vencimento, status (badge colorido por `status_guias_impostos`)
- Botões: "Baixar PDF", "Pagar via Pix" (mostra linha digitável + QR code), "Marcar como paga"

Server action `marcarGuiaPagaAction(id)` — PATCH `status='paga'`, `data_pagamento=now()`.

**DoD**:
- [ ] Página carrega sem erro mesmo se não houver dados (empty state)
- [ ] Card "competência atual" mostra apuração + declaração + guia (ou "não calculado ainda" com botão de ação)
- [ ] Histórico paginado / scrollable
- [ ] Toggle guia paga funciona

#### PR 3.2 — Cálculo manual (`/impostos/novo`)
**Spec**: `V1-FUNCIONALIDADES.md` §4.1 + §4.2 + PRD §11.2

Arquivos:
- `app/(auth)/impostos/novo/page.tsx` — substituir stub. Server component.
- `app/(auth)/impostos/novo/ApuracaoWizard.tsx` — client wizard de 4 etapas
- `app/(auth)/impostos/actions.ts` — `iniciarApuracaoAction(competencia)`, `gerarGuiaAction(apuracaoId)`

Wizard:
1. Escolher competência (mês/ano) — default mês anterior
2. "Consolidar receitas" — chama `n8n.consolidarReceitas({empresa_id, competencia})`. Aguarda webhook de volta (polling ou Supabase Realtime). Mostra spinner.
3. "Calcular RBT12 + alíquota" — chama `n8n.calcularRbt12({empresa_id, competencia})`. Mostra breakdown.
4. "Gerar guia DAS" — chama server action que invoca `serpro.emitirDas('prod' OR 'trial', envelope)`. Salva `guias_fiscais` com PDF URL.

Server action `gerarGuiaAction`:
1. Buscar `empresas_fiscais` da empresa
2. Buscar `apuracoes_fiscais` da competência
3. Montar envelope via `serpro.buildEnvelope({cnpjContratante: empresa.cnpj, cnpjContribuinte: empresa.cnpj, idServico: SERPRO_SERVICES.GERAR_DAS, dados: { pa: competenciaInt, valorTotalPago: apuracao.total } })`
4. Chamar `serpro.emitirDas(env, envelope)`
5. Persistir `guias_fiscais` com link PDF + status `gerada`

Reusa: `<Loading>`, padrão wizard de `<CreateCompanyDialog>`.

**DoD**:
- [ ] Wizard completo das 4 etapas roda no sandbox Serpro
- [ ] Guia aparece em `/impostos` ao final
- [ ] Erros em qualquer etapa mostram toast + ficam parados, permitindo retry

#### PR 3.3 — Cron mensal (Vercel Cron)
**Spec**: `V1-FUNCIONALIDADES.md` §4.1 (automação)

Arquivos:
- `app/api/cron/apuracao-mensal/route.ts` — route handler GET, protegido por header `Authorization: Bearer ${CRON_SECRET}`
- `vercel.json` — `crons: [{ path: '/api/cron/apuracao-mensal', schedule: '0 6 1 * *' }]` (dia 1 de cada mês, 06:00 UTC = 03:00 BR)

Handler:
1. Validar header
2. Listar `empresas_fiscais` com `empresa_fiscal_ativada=true`
3. Para cada: invocar `n8n.consolidarReceitas` (fire-and-forget — n8n é assíncrono)
4. Log estruturado

**DoD**:
- [ ] Rota protegida (sem header → 401)
- [ ] Dispara N webhooks n8n em paralelo
- [ ] Log mostra resultado de cada disparo

### Verificação Day 3
```bash
# Sandbox Serpro: usar CNPJ 00000000000100 sempre
# Sandbox Focus: dados de notas já criadas no Day 2 alimentam apuração

cd balu-next
npm run dev
# manual: /impostos → ver dashboard
# manual: /impostos/novo → escolher competência atual → wizard até gerar DAS sandbox
# manual: curl Authorization: Bearer ... http://localhost:3000/api/cron/apuracao-mensal → deve retornar 200 com log
```

### Riscos Day 3
- 🔴 **Credenciais Serpro**: `SERPRO_CONSUMER_KEY` + `_SECRET` precisam ser válidas (trial OK). Sem isso, wizard etapa 4 falha.
- 🔴 **n8n offline**: se `https://webhooks.envia.click` estiver fora, etapas 2-3 do wizard falham. **Mitigação**: criar fallback mock que devolve apuração zerada para dev local.
- 🟡 **Cron Vercel exige deploy**: localmente, simular com `curl`. Documentar.

---

## Day 4 — Polish + Tests + Handoff

### Objetivo
**Cobertura E2E** do fluxo principal, **screenshots** para review visual, **README final** e **zip de entrega**.

### PRs sugeridos

#### PR 4.1 — Testes E2E do fluxo principal
Arquivos:
- `tests/e2e-fluxo-completo.spec.ts` (novo)

Cenário:
1. Cadastrar usuário (via fixture com `service_role` direto no Supabase)
2. Login
3. Criar empresa (preencher CNPJ sandbox + ViaCEP)
4. Cadastrar 1 cliente
5. Emitir 1 NFS-e contra Focus sandbox
6. Ver nota em `/notas_fiscais`
7. Abrir detalhe, validar chave + DANFE
8. Ir em `/impostos/novo`, rodar wizard até gerar DAS sandbox
9. Marcar guia como paga
10. Voltar ao dashboard, validar que receita atualizou

Reusa: `tests/smoke.spec.ts` e `walkthrough.spec.ts` como templates.

**DoD**:
- [ ] Spec roda do início ao fim sem flakiness
- [ ] Screenshots salvos em `screenshots/e2e/`
- [ ] CI-ready (não exige interação manual)

#### PR 4.2 — Refinar UX
- Empty states em todas as listas (com CTA pra primeira ação)
- Mensagens de erro traduzidas (mapeamento Focus/Serpro → pt-BR humano)
- Loading states em todas as server actions longas (`<Loading fullscreen>`)
- Sidebar mobile (hamburguer + drawer) — hoje só desktop

Arquivos: vários componentes existentes — pequenos ajustes.

**DoD**:
- [ ] Nenhuma página mostra dados crus ("undefined", "[object Object]")
- [ ] Mobile (390×844) usa todas as rotas sem overflow horizontal

#### PR 4.3 — Atualizar `README.md`
- Marcar v1 como "completa" na §4
- Adicionar seção §10 "Como subir em produção" com checklist:
  - Aplicar migration no Supabase prod
  - Criar bucket `company-certificates` privado
  - Configurar Vercel env vars (todas as do `.env.example`)
  - Configurar Vercel Cron
  - Apontar domínio
  - Smoke manual de cada rota
- Bonus: ARCHITECTURE.md curto com diagrama mermaid (`flowchart TD`) cobrindo browser → Next → Supabase + Focus + Serpro + n8n

#### PR 4.4 — Regerar zip
```bash
cd "/home/luanbonadie/Documentos/Lab/Apps Bubble"
rm -f balu.zip
zip -r balu.zip balu/ \
  -x "balu/balu-next/node_modules/*" \
  -x "balu/balu-next/.next/*" \
  -x "balu/balu-next/.env.local" \
  -x "balu/balu-next/playwright-report/*" \
  -x "balu/balu-next/test-results/*" \
  -x "*.DS_Store"
```

### Verificação Day 4
```bash
cd balu-next
./verify.sh                    # build + tsc
npx playwright test            # 12+ smoke + 10+ e2e
# manual: percorrer cada rota do walkthrough no browser
unzip -l ../balu.zip | tail   # conferir conteúdo do zip
```

### Riscos Day 4
- 🟡 **Flakiness do E2E contra sandbox**: se Focus/Serpro ficarem instáveis, testes falham. **Mitigação**: mock no nível do `lib/clients/` quando `process.env.PLAYWRIGHT_MOCK=true`.

---

## Apêndice A — Troca de stack

Se você (dev humano) decidiu **não** usar Next.js + Supabase, leia isto antes de jogar tudo fora.

### O que **continua valendo** mesmo trocando stack

| Asset | Por que continua |
|---|---|
| `V1-FUNCIONALIDADES.md` | Spec stack-agnóstica do que construir |
| `V2-FUNCIONALIDADES.md` | Idem para v2 |
| `PRD-Balu.md` | Referência do comportamento do Bubble original |
| `bubble-to-prd/slices/` | JSON estruturado do app Bubble (pages, enums, endpoints, reusables) — input pra qualquer stack |
| `bubble-to-prd/skills/gen_schema.py` | Gera SQL Postgres — funciona em qualquer ORM/cliente |
| `supabase/migrations/0001_init.sql` | Schema 100% Postgres ANSI-compatível — usar com Prisma, TypeORM, Drizzle, Eloquent, Doctrine, SQLAlchemy, etc. |
| `bubble-to-prd/slices/04_option_sets.json` | 26 enums fiscais brasileiros (SEFAZ/Receita) — transcrição literal |
| `bubble-to-prd/slices/07_api_connector.json` | Catálogo dos 81 endpoints originais |
| `ANALISE-CONTABILIZEI.md` | Insights de UX/produto |

### O que vai **pro lixo**

- Tudo em `balu-next/src/app/`, `balu-next/src/components/` — código Next.js específico
- Tudo em `balu-next/src/lib/supabase/` — wrappers do `@supabase/ssr`
- `balu-next/playwright.config.ts`, `tailwind.config.ts`, `tsconfig.json` — config TS

### O que precisa ser **reescrito por equivalência**

| Camada | Next.js (atual) | PHP/Laravel | Python/FastAPI | Rust/Axum |
|---|---|---|---|---|
| Auth | `@supabase/ssr` | Sanctum + Supabase JWT | `supabase-py` + cookies | `axum-extra` + JWT validation |
| Server actions | `'use server'` | Controllers RESTful | Path operations | Handlers |
| Form validation | Zod | Form Request | Pydantic | Serde + validator |
| API clients (Focus/Serpro/n8n) | `server-only` modules | Service classes | Clients em `services/` | Crates |
| Background cron | Vercel Cron | Laravel Scheduler | Celery / APScheduler | Tokio + chrono |
| Webhook receivers | Route handlers | Controllers | Path ops | Handlers |
| RLS no Postgres | igual | igual | igual | igual |

### Roteiro de troca de stack (≥ +3 dias além dos 4)

1. **Day 0** (mais 1 dia): aplicar `0001_init.sql` no novo Postgres (Supabase, Neon, RDS) — funciona idêntico. Validar RLS com seu mecanismo de auth.
2. **Day 1-N**: reimplementar 5 fluxos do plano nesta stack: auth, CRUD cliente, criar empresa, emitir nota, gerar guia DAS. Use os clientes `focus-nfe.ts`, `serpro.ts`, `n8n.ts` como **referência de comportamento** (portar para sua linguagem).
3. **Day N+1**: cron + webhook receiver + tests.

**Estimativa honesta**: trocar de stack adiciona **~3-5 dias** ao escopo. Justifica se você tem alta proficiência na outra stack e desconforto com Next.js. Senão, fique com Next.js (já compila, já tem 5 rotas reais, já passou Playwright 12/12).

---

## Apêndice B — Checklist de DoD da v1 inteira

No fim do Day 4:

- [ ] Todas as features 🆕/🚧 do `STATUS-IMPLEMENTACAO.md` ficaram ✅
- [ ] `tsc --noEmit` zero erros
- [ ] `next build` sucesso, sem warnings críticos
- [ ] Playwright: ≥ 20 testes passando (smoke + walkthrough + e2e)
- [ ] Manual smoke em ≥ 1 browser (Chrome desktop + Chrome mobile DevTools)
- [ ] Schema aplicado em Supabase prod (não só local)
- [ ] Cron mensal configurado e testável
- [ ] Webhook receiver Focus testado (curl simulando callback)
- [ ] `.env.example` cobre 100% das variáveis necessárias
- [ ] README §10 (deploy prod) escrito
- [ ] Zip final regenerado
- [ ] Kanban com ≥ 80% das cards na coluna Done

---

## Apêndice C — Quando pedir ajuda

| Sintoma | Ação |
|---|---|
| Tsc erra em coisa de Supabase types | Lembrar: `Database = any` por design (ver README §5). Usar `as Cliente[]` casts. |
| Focus retorna 401 | `FOCUS_NFE_TOKEN` errado ou expirou. Pedir token novo. |
| Serpro retorna 401 mesmo com token recém-gerado | Cache de token quebrou. Chamar `_resetSerproTokenCache()` ou reiniciar processo. |
| n8n webhook timeout | n8n offline. Mock local conforme §Day 3 riscos. |
| RLS bloqueando query que devia funcionar | Conferir se `current_company` está setado no perfil; usar Supabase Studio para ver as policies ativas. |
| Build falha em prod mas passa local | Vercel env vars ausentes. Conferir contra `.env.example`. |
| Cron Vercel não dispara | Verificar `vercel.json` no commit, `Cron Jobs` no dashboard Vercel, e o header `Authorization`. |

---

**Bom trabalho. Em caso de dúvida sobre o que reusar, sempre abra `STATUS-IMPLEMENTACAO.md` antes de criar arquivo novo.**
