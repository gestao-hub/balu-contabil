# Balu — Conversão Bubble.io → Next.js + Supabase

Esta pasta contém **o app Balu** (gestão fiscal brasileira) sendo convertido de **Bubble.io** para **Next.js 15 + Supabase**, junto com um **pipeline reutilizável** que automatiza grande parte da conversão.

> **TL;DR** — `balu-next/` é o app real, pronto pra rodar (`npm install && npm run dev`). `bubble-to-prd/` é o pipeline que converte o `.bubble` em código. `PRD-Balu.md` é a especificação humano-validada do app, e serve como ponte entre os dois mundos.

---

## 1. Estrutura da pasta

```
balu/
├── README.md                    ← este arquivo
├── excluviapainel.bubble        ← export do app Bubble (JSON, 1.8 MB) — input do pipeline
├── PRD-Balu.md                  ← especificação completa em 17 seções (610 linhas)
├── STAGE-2-PLAN.md              ← plano arquitetural do processo de conversão
│
├── bubble-to-prd/               ← PIPELINE de conversão (Python + skills LLM)
│   ├── extract.py               ← fatia o .bubble em 11 slices semânticos
│   ├── validate.py              ← confere cobertura do PRD contra os slices
│   ├── PROMPT.md                ← prompt mestre p/ gerar o PRD via LLM
│   ├── SKILL.md                 ← descrição da skill bubble-to-prd
│   ├── README.md                ← documentação do pipeline
│   ├── slices/                  ← saída do extract.py (gerada)
│   │   ├── 00_meta.json         ← metadados do app
│   │   ├── 01_pages.json        ← pages + elements top-level (187 KB)
│   │   ├── 02_reusables.json    ← reusables (FloatingGroup, Popup, Group)
│   │   ├── 03_user_types.json   ← data types do Bubble
│   │   ├── 04_option_sets.json  ← 26 enums fiscais (TipoNF, CST, CSOSN, CFOP…)
│   │   ├── 05_styles.json       ← estilos nomeados
│   │   ├── 06_design_tokens.json ← cores, fontes, status bar
│   │   ├── 07_api_connector.json ← 81 chamadas REST
│   │   ├── 08_workflows_index.json ← workflows indexados
│   │   ├── 09_issues.json       ← issues que o Bubble detectou
│   │   ├── 10_mobile_views.json ← views mobile
│   │   └── INDEX.md             ← índice resumido
│   └── skills/                  ← geradores Python + skill LLM
│       ├── gen_schema.py        ← gera SQL Postgres + RLS + enums TS + Zod + Database types
│       ├── gen_routes.py        ← gera árvore app/ do Next.js a partir das pages do Bubble
│       ├── gen_clients.py       ← gera clients tipados para APIs externas (Focus/Serpro/n8n)
│       ├── prep_component.py    ← extrai subárvore de 1 reusable do .bubble
│       ├── inventory_reusables.py ← lista todos os reusables com nome + complexidade
│       └── bubble-component/    ← skill LLM para gerar componentes React
│           ├── SKILL.md
│           ├── PROMPT.md
│           └── _packs/          ← packs por reusable (gerado)
│
└── balu-next/                   ← APP NEXT.JS resultante (44 arquivos, compila limpo)
    ├── package.json             ← deps: Next 15, React 19, Tailwind 3, Supabase, Zod, Playwright
    ├── tsconfig.json
    ├── tailwind.config.ts       ← tokens de marca: brand-teal #03B4C6, brand-navy, brand-danger
    ├── postcss.config.js
    ├── next.config.ts
    ├── playwright.config.ts
    ├── verify.sh                ← script: npm i + tsc + next build
    ├── .env.example             ← variáveis necessárias
    ├── .env.local               ← (criar — não commitar)
    ├── supabase/migrations/
    │   └── 0001_init.sql        ← 13 tabelas + RLS + triggers + RPCs + indexes
    ├── tests/
    │   └── smoke.spec.ts        ← Playwright: testes E2E que passam 6/6
    ├── screenshots/             ← screenshots da UI (gerados pelo Playwright)
    └── src/
        ├── app/                 ← App Router
        │   ├── layout.tsx, globals.css, not-found.tsx
        │   ├── (public)/        ← rotas sem auth
        │   │   ├── login/page.tsx + actions.ts
        │   │   ├── cadastro/page.tsx + actions.ts
        │   │   └── reset_pw/page.tsx + actions.ts
        │   ├── (auth)/          ← rotas protegidas (guard via Supabase)
        │   │   ├── layout.tsx   ← redireciona /login se sem sessão, força onboarding
        │   │   ├── page.tsx     ← / (dashboard — stub)
        │   │   ├── clientes/    ← page.tsx + actions.ts (CRUD completo)
        │   │   ├── configuracoes/ page.tsx + actions.ts + DadosEmpresaForm.tsx
        │   │   ├── onboarding/  ← actions.ts (Focus CNPJ + ViaCEP + create company)
        │   │   ├── notas_fiscais/ ← stub (page, [id], emissao)
        │   │   └── impostos/    ← stub (page, novo)
        │   └── api/webhooks/focus/route.ts ← receiver Focus NFe
        ├── components/
        │   ├── MenuLateral.tsx          ← sidebar com troca de empresa e signOut
        │   ├── Toaster.tsx              ← ToastProvider + useToast()
        │   ├── Loading.tsx              ← spinner com label
        │   ├── FilterPeriodo.tsx        ← date range filter
        │   ├── PopupConfirm.tsx         ← <dialog> confirmação
        │   ├── ClienteFormDialog.tsx    ← form criar/editar cliente
        │   ├── ClientesListClient.tsx   ← tabela + busca
        │   └── CreateCompanyDialog.tsx  ← onboarding empresa
        ├── hooks/
        │   └── useReAuthentication.ts
        ├── lib/
        │   ├── supabase/{server,browser}.ts
        │   └── clients/         ← server-only (secrets nunca no client)
        │       ├── focus-nfe.ts         ← emit/cancel/status/download + retry + generateRef
        │       ├── serpro.ts            ← cache de token + buildEnvelope + normalizeCnpj
        │       ├── n8n.ts               ← HMAC SHA-256 nos webhooks
        │       ├── supabase-storage.ts  ← upload .pfx para bucket privado
        │       ├── _endpoints.ts        ← catálogo bruto dos 81 endpoints
        │       └── index.ts
        └── types/
            ├── database.ts      ← tipos das 13 tabelas + Row<T> helper
            ├── enums.ts         ← 26 option sets do Bubble como const arrays
            └── zod.ts           ← schemas de validação (Cliente, Company, Honorario)
```

---

## 2. O processo, em 4 etapas

### Etapa 1 — Fatiar o `.bubble`
O export do Bubble.io é um JSON de 1.8 MB com estrutura recursiva profunda. **Não cabe eficientemente no contexto de um LLM** e mistura semântica de páginas, dados, estilos, workflows e APIs.

```bash
cd bubble-to-prd
python3 extract.py ../excluviapainel.bubble --out slices
```

Produz 11 slices semânticos em `slices/` (~410 KB total) — cada slice tem uma responsabilidade única e mapeia 1:1 com seções do PRD.

### Etapa 2 — Gerar o PRD (humano-validado)
O `PRD-Balu.md` foi escrito a partir dos slices (com revisão humana). É a **fonte da verdade** do que o app faz. Possui 17 seções: visão, navegação, dados, enums, design system, reusables, auth, fluxos por página, catálogo de endpoints, regras de negócio, NFRs e roadmap.

> Para um app novo, esta etapa usa o `PROMPT.md` em `bubble-to-prd/` carregado num LLM com os 11 slices como contexto.

### Etapa 3 — Gerar o scaffold Next.js (mecânico)
Três scripts Python convertem slices em código deterministicamente:

```bash
cd bubble-to-prd/skills
python3 gen_schema.py ../slices ../../balu-next   # SQL + enums + types
python3 gen_routes.py ../slices ../../balu-next   # rotas Next.js
python3 gen_clients.py ../slices ../../balu-next  # clients API
```

O scaffold sai com a estrutura, mas as páginas internas começam como stubs.

### Etapa 4 — Behaviors via LLM (subagents paralelos)
Cada behavior (login, CRUD de cliente, onboarding…) foi implementado por um subagente especializado, lendo o PRD + slices + scaffold. Resultado: **44 arquivos TS/TSX, zero erros de TypeScript, 6/6 testes Playwright passando, 12 rotas Next.js compilando**.

---

## 3. Como rodar o app

### Pré-requisitos
- Node.js 20+
- Conta Supabase (gratuita)
- Credenciais Focus NFe (opcional — só para emissão real)
- Credenciais Serpro Integra Contador (opcional — só para PGDAS-D/DAS reais)
- n8n rodando (opcional — só para motor fiscal automatizado)

### Passos

**1. Instalar e configurar variáveis**
```bash
cd balu-next
npm install
cp .env.example .env.local
# Editar .env.local e preencher pelo menos:
#   NEXT_PUBLIC_SUPABASE_URL
#   NEXT_PUBLIC_SUPABASE_ANON_KEY
#   SUPABASE_SERVICE_ROLE_KEY
```

**2. Aplicar o schema no Supabase**
- Abra o Dashboard do Supabase → SQL Editor
- Cole o conteúdo de `supabase/migrations/0001_init.sql`
- Execute

Ou via CLI:
```bash
npx supabase link --project-ref <seu-ref>
npx supabase db push
```

**3. (Opcional) Criar bucket de certificados**
- Dashboard → Storage → New bucket
- Nome: `company-certificates`
- Marque como **privado**

**4. Subir o app**
```bash
npm run dev
# abrir http://localhost:3000/login
```

**5. Validar build / typecheck**
```bash
./verify.sh
# OU
npx tsc --noEmit && npx next build
```

**6. Rodar testes**
```bash
npx playwright install chromium  # uma vez
npx playwright test
```

---

## 4. O que está pronto e o que falta

### Funcionando end-to-end ✅
| Área | Estado |
|---|---|
| Autenticação (login/cadastro/reset) | server actions Supabase, validação client |
| Onboarding (criar empresa) | popup forçado se sem `current_company`; busca CNPJ na Focus + CEP no ViaCEP |
| CRUD de clientes | listagem, busca, criar com dedup CPF/CNPJ, editar, soft delete |
| Configurações | aba "Dados da empresa" com edição completa |
| Menu lateral | troca de empresa, signOut, item ativo |
| Toaster, Loading, PopupConfirm, FilterPeriodo | componentes prontos e tipados |
| Schema Postgres | 13 tabelas, RLS multi-tenant, triggers, RPCs, dedup index |
| Clients APIs externas | Focus (status/download/retry), Serpro (cache token), n8n (HMAC) |
| Webhook receiver Focus NFe | route handler em `/api/webhooks/focus` |

### Próximas iterações 🔜
Já implementadas nesta rodada (código pronto, `tsc`/`build` OK, **runtime pendente de Supabase**):

- **`/`** — ✅ dashboard home (PR 1.1 — 4 cards + lista de pendências)
- **`/notas_fiscais`** — ✅ listagem com filtros + export CSV (PR 1.2)

Páginas que ainda têm o template stub (cabeçalho `// @generated`):

- **`/notas_fiscais/[id]`** — detalhe + cancelamento (PRD §10.1)
- **`/notas_fiscais/emissao`** — form NFe/NFCe/NFSe (PRD §10.2 — fluxo mais complexo)
- **`/impostos`** — dashboard de declarações e guias (PRD §11.1)
- **`/impostos/novo`** — fluxo PGDAS-D em 6 etapas (PRD §11.2)
- **`/configuracoes`** — abas "Regime tributário", "NFS-e", "Certificado A1" (PRD §8)
- **`/honorarios`** — visão de contador (PRD §12)
- **Abertura de empresa** — form em 5 etapas (PRD §13)

Cada um pode ser implementado da mesma forma: subagente lê PRD §X + slices + componentes existentes e escreve `page.tsx` + `actions.ts`.

---

## 5. Convenções importantes

### Marker `@custom` vs `@generated`
- `// @generated by …` no topo: gerado por script, será **sobrescrito** no próximo run dos geradores.
- `// @custom — …` no topo: editado à mão, **será preservado** (skills checam antes de sobrescrever).

Se você editar um arquivo gerado, troque o marker para `@custom` antes — caso contrário sua edição se perde no próximo `gen:*`.

### Princípios (do `STAGE-2-PLAN.md`)
- **Thin client, fat server**: nenhum secret no frontend. Clients de APIs externas têm `import 'server-only'` e só são chamados de server actions ou route handlers.
- **1 behavior por pasta**: cada comportamento isolado em `src/app/<page>/<behavior>/`.
- **Test-first**: testes Playwright junto com a implementação, não depois.
- **Spec é source of truth**: divergências entre código e PRD → corrigir o código.

### Idempotência dos geradores
Rodar `gen_schema.py` / `gen_routes.py` / `gen_clients.py` várias vezes é seguro:
- Arquivos `@custom` não são tocados
- Arquivos `@generated` são sobrescritos com a saída atualizada do `.bubble`

### Database type é `any`
A inferência de `.select('a, b')` do supabase-js exige machinery gerada pelo CLI `supabase gen types`. Como compensação, exportamos `Tables` nominalmente em `src/types/database.ts` e usamos cast explícito (`as Cliente[]`). Para type-safety real:
```bash
npx supabase gen types typescript --linked > src/types/database.ts
```

---

## 6. Como continuar (recomendado)

### Curto prazo: terminar as páginas stub
Para cada stub:
1. Ler `PRD-Balu.md` §N correspondente
2. Spawnar subagent: "implemente `src/app/(auth)/<rota>/page.tsx` + `actions.ts` seguindo PRD §N e usando componentes existentes em `src/components/` e clients em `src/lib/clients/`. Substituir header `@generated` por `@custom — bubble-behavior`."
3. Rodar `npx tsc --noEmit` para validar.
4. Adicionar teste Playwright em `tests/`.

### Médio prazo: validar com Supabase real
- Aplicar a migração no Supabase real
- Preencher `.env.local` com credenciais reais
- Criar usuário de teste pelo Dashboard
- Navegar pelo app com `npm run dev`

### Longo prazo: generalizar o pipeline para qualquer `.bubble`
O pipeline já é em sua maior parte portável:
- `extract.py`, `gen_routes.py`, `gen_clients.py`, `prep_component.py`, `inventory_reusables.py` → **100% portáveis** (não há literals de Balu)
- `gen_schema.py` → tem `KNOWN_TABLES` com colunas inferidas. Para outro app, esta parte precisa ser substituída por uma skill LLM `bubble-schema` que lê o novo PRD §3.
- `gen_clients.py` → detecta automaticamente os hosts das APIs externas; mas os métodos públicos dos clients (Focus/Serpro/n8n) são hardcoded. Para outro app, virariam templates LLM por API detectada.

Veja `STAGE-2-PLAN.md` para o roadmap completo de generalização.

---

## 6.5. Handoff para dev humano (plano de 4 dias) ⭐

> **Leia primeiro se você é o dev que vai terminar a v1.**

A v1 do Balu (5 das 11 rotas implementadas + toda a infra: schema, RLS, clientes API, componentes) pode ser **concluída em 4 dias** seguindo este roteiro:

### 6.5.1 Hierarquia de docs (qual abrir quando)

| Doc | Quando usar |
|---|---|
| **[`PLANO-4-DIAS.md`](./PLANO-4-DIAS.md)** | Toda manhã. Diz o que pegar no dia, em qual ordem, com DoD. |
| **[`STATUS-IMPLEMENTACAO.md`](./STATUS-IMPLEMENTACAO.md)** | Antes de criar qualquer arquivo. Matriz feature × estado mostra o que reusar. |
| **[`V1-FUNCIONALIDADES.md`](./V1-FUNCIONALIDADES.md)** | Source of truth do **QUE construir** (stack-agnóstico). Aprofundar cada feature. |
| **[`V2-FUNCIONALIDADES.md`](./V2-FUNCIONALIDADES.md)** | Não tocar nesta janela. Backlog v2 (WhatsApp + IA). |
| **[`PRD-Balu.md`](./PRD-Balu.md)** | Referência histórica. Consulta quando precisar entender como o Bubble fazia algo. |
| **[`ANALISE-CONTABILIZEI.md`](./ANALISE-CONTABILIZEI.md)** | Inspiração de UX/produto (engenharia reversa da Contabilizei). |
| Este README | Setup técnico + convenções (`@custom` vs `@generated`). |

### 6.5.2 Kanban visual (Superpowers Kanban)

Recomendado para acompanhar progresso visualmente. Server local em `http://127.0.0.1:7421`.

**Instalação** (uma vez):

```bash
git clone https://github.com/LLBonadie/superpowers-kanban.git
cd superpowers-kanban
# seguir instruções de instalação do README do repo
```

**Subir**:

```bash
# de qualquer terminal
local-kanban
# servidor roda em http://127.0.0.1:7421
```

**Board pré-populado**: `balu-next/.kanban/board.json` já vem com:
- 4 colunas (`Backlog`, `Em andamento`, `Bloqueado`, `Done`)
- Cards organizados por dia (`label: day-1`, `day-2`, `day-3`, `day-4`)
- Features já implementadas vão pra coluna `Done` com label `done-pre-handoff`
- Cada card linka pra seção correspondente em `V1-FUNCIONALIDADES.md`

Na primeira execução do servidor, ele auto-registra o projeto e lê o board.

### 6.5.3 Fluxo de trabalho recomendado

```
manhã   ─►  abrir PLANO-4-DIAS.md §"Day N"
            ler PRs sugeridos + DoD
            mover cards para "Em andamento" no kanban

durante ─►  pra cada PR:
              1. abrir STATUS-IMPLEMENTACAO.md → ver o que reusar
              2. abrir V1-FUNCIONALIDADES.md §X.Y → entender a feature
              3. opcionalmente PRD-Balu.md §N → ver como o Bubble fazia
              4. implementar
              5. tsc + smoke manual
              6. mover card para "Done"

fim     ─►  ./verify.sh (build + tsc)
            npx playwright test
            commit
```

### 6.5.4 Quer trocar de stack?

Leia o **Apêndice A** de `PLANO-4-DIAS.md`. Resumo:
- `V1-FUNCIONALIDADES.md`, `PRD-Balu.md`, `bubble-to-prd/slices/`, `supabase/migrations/0001_init.sql` continuam valendo em **qualquer stack**
- Tudo em `balu-next/src/` é descartável
- Trocar de stack adiciona ~3-5 dias ao escopo de 4 dias

### 6.5.5 Estado real hoje (snapshot)

- ✅ **Build limpo**: `tsc --noEmit` e `next build` zero erros
- ✅ **Playwright**: 12/12 testes passando (smoke + walkthrough desktop + mobile)
- ✅ **Rotas reais** (5): `/login`, `/cadastro`, `/reset_pw`, `/clientes`, `/configuracoes`
- 🟡 **Implementadas, runtime pendente** (2): `/` (PR 1.1) e `/notas_fiscais` (PR 1.2) — código pronto + `tsc`/`build` OK; falta logar com Supabase real
- ⚠️ **Rotas stub** (4): `/notas_fiscais/[id]`, `/notas_fiscais/emissao`, `/impostos`, `/impostos/novo` — **escopo restante**
- ✅ **Schema**: 13 tabelas + RLS + triggers + RPCs aplicáveis em Supabase
- ✅ **Clientes API endurecidos**: Focus (retry, status, download), Serpro (cache token, envelope helper), n8n (HMAC)
- ✅ **Webhook receiver**: `app/api/webhooks/focus/route.ts`

---

## 7. Comandos úteis

```bash
# ─── Re-rodar o pipeline inteiro ───
cd bubble-to-prd
python3 extract.py ../excluviapainel.bubble --out slices
cd skills
python3 gen_schema.py ../slices ../../balu-next
python3 gen_routes.py ../slices ../../balu-next
python3 gen_clients.py ../slices ../../balu-next

# ─── Inventário rápido dos reusables ───
python3 bubble-to-prd/skills/inventory_reusables.py excluviapainel.bubble

# ─── Verificar cobertura do PRD ───
python3 bubble-to-prd/validate.py bubble-to-prd/slices PRD-Balu.md

# ─── Trabalhar no app ───
cd balu-next
npm install
npm run dev                 # dev server em http://localhost:3000
npm run build               # build de produção
npx tsc --noEmit            # type check
npx playwright test         # E2E
./verify.sh                 # tudo de uma vez
```

---

## 8. Limitações conhecidas

1. **Workflows do Bubble extraídos pela casca**: `prep_component.py` captura `trigger` e `action.type`, mas perde `conditions` ("Only when X"), referências cruzadas (`Result of step N`) e custom states. Behaviors complexos exigem leitura do PRD + revisão humana.
2. **`Database = any`**: deliberado (ver §5). Type-safety vem dos schemas Zod e tipos nominais.
3. **Validação de assinatura no webhook Focus**: marcada como TODO — Focus não documenta header HMAC publicamente. Em produção, bloquear por IP allowlist ou segredo na URL.
4. **Cache de token Serpro é por instância**: em serverless multi-instância, haverá N requests de token simultâneos. Aceitável (Serpro permite tokens múltiplos vivos).
5. **`TRIBUTO_CODIGOS` em `serpro.ts`**: valores baseados em convenção Receita/Serpro. Conferir contra PRD §11.2 antes de produção.
6. **Migração de dados do Supabase atual**: não implementada. Se houver dados em produção, criar um `gen_migration.py` que faz `ALTER TABLE` + `INSERT … SELECT` preservando `bubble_id`.

---

## 9. Stack

- **Frontend**: Next.js 15 App Router, React 19, Tailwind v3, lucide-react
- **Backend**: Supabase (Postgres + Auth + Storage + RLS), n8n (motor fiscal), Edge Functions (não usadas ainda)
- **Integrações**: Focus NFe (emissão), Serpro Integra Contador (PGDAS-D/DAS), ViaCEP
- **Validação**: Zod (client + server), Playwright (E2E)
- **Tipos**: TypeScript estrito

---

**Última atualização** (2026-05-25): Day 1 em andamento — PR 1.1 (dashboard `/`) e PR 1.2 (listagem `/notas_fiscais` + filtros + CSV) implementados e commitados na branch `feat/day1-dashboard`. `tsc --noEmit` e `next build` limpos (13 rotas). Verificação de runtime pendente de credenciais Supabase. Próximo: PR 1.3 (detalhe + cancelamento da nota). Ver `STATUS-IMPLEMENTACAO.md` §0.
