# Balu

Plataforma de **gestão fiscal e contábil** para contadores e empresas brasileiras — emissão de notas fiscais (NFe/NFCe/NFS-e), apuração de impostos (Simples Nacional / MEI), gestão de clientes, honorários e abertura/alteração de empresas.

Construído em **Next.js 15 + Supabase**. Originalmente um app Bubble.io, reconstruído como aplicação web nativa (o pipeline de conversão vive em [`docs/bubble-to-prd/`](docs/bubble-to-prd/) e a história do processo em [`docs/`](docs/)).

---

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | Next.js 15 (App Router), React 19, Tailwind 3, lucide-react, next-themes |
| Backend | Server Actions + Route Handlers (Next.js), Supabase (Postgres + Auth + Storage) |
| Integrações | Focus NFe (emissão), Serpro Integra Contador (DAS/PGDAS-D), ViaCEP |
| Validação | Zod (client + server) |
| Cripto | node-forge (certificados A1 `.pfx`) |
| Testes | Vitest (unitários), Playwright (E2E) |
| Deploy | Vercel |

> **Legado:** o "motor fiscal" externo (segundo projeto Supabase `SUPABASE_MOTOR_*` + webhooks n8n / envia.click) foi descontinuado — a apuração migrou para dentro do Next. As variáveis e o client `lib/clients/n8n.ts` ainda existem mas não têm chamador ativo; candidatos a remoção.

---

## Estrutura do repositório

```
balu/                          ← raiz do git (rode o Claude daqui — ver Convenções)
├── app/                       ← APP Next.js (deployável; Root Directory na Vercel)
│   ├── src/
│   │   ├── app/
│   │   │   ├── (public)/      ← login, cadastro, reset_pw
│   │   │   ├── (auth)/        ← clientes, configuracoes, conta, honorarios,
│   │   │   │                    impostos, notas_fiscais, onboarding, dashboard
│   │   │   └── api/           ← webhooks/focus, cron/sync-municipios
│   │   ├── components/        ← UI compartilhada
│   │   ├── hooks/
│   │   ├── lib/               ← abertura, clients (Focus/Serpro/n8n), crypto,
│   │   │                        dashboard, fiscal, format, supabase, validators
│   │   └── types/
│   ├── supabase/migrations/   ← 0001–0016 (schema, RLS, FKs, motor fiscal)
│   ├── tests/                 ← Playwright E2E (smoke, walkthrough, rls-isolation)
│   └── package.json           ← pacote npm "balu-app"
│
├── docs/                      ← TODA a documentação e tooling
│   ├── product/               ← PRD, V1/V2-FUNCIONALIDADES
│   ├── planning/              ← STATUS, PLANO-4-DIAS, STAGE-2
│   ├── investigations/        ← SERPRO, ANALISE-CONTABILIZEI, DB-DIVERGENCIA
│   ├── reference/             ← db_atual.sql, resultados de teste, READMEs legados
│   ├── assets/                ← imagens, PDFs (+ assets/branding: PNGs de marca)
│   ├── branding/              ← manual de marca (.html)
│   ├── bubble-to-prd/         ← pipeline de conversão Bubble→código (Python + skills)
│   ├── superpowers/           ← specs + plans (brainstorm → design → implementação)
│   └── n8n/                   ← exports do motor fiscal (gitignored — contém segredos)
│
└── README.md                  ← este arquivo

# Arquivado FORA do repo, em ../balu-history/:
#   balu-history.bundle      ← histórico git completo (376 commits)
#   excluviapainel.bubble    ← export original do Bubble (input do pipeline)
```

---

## Setup local

Pré-requisitos: **Node 20+** e acesso aos dois projetos Supabase.

```bash
cd app
npm install
cp .env.example .env.local     # preencher as chaves (ver abaixo)
npm run dev                     # http://localhost:3000
```

### Variáveis de ambiente (`app/.env.local`)

| Variável | Para quê |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | URL canônica (links de email). Em prod, a URL real — nunca derivar de headers. |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase principal (auth + cadastros) |
| `SUPABASE_SERVICE_ROLE_KEY` | Operações privilegiadas server-side (bypassa RLS) |
| `FOCUS_NFE_TOKEN` | Emissão/consulta de notas na Focus NFe |
| `SERPRO_CONSUMER_KEY` / `SERPRO_CONSUMER_SECRET` | Serpro Integra Contador (DAS/PGDAS-D) |

> O `.env.example` ainda lista `SUPABASE_MOTOR_*` e `N8N_WEBHOOK_*` (motor fiscal legado) — não são necessários para rodar o app.

### Migrations do banco

As 16 migrations ficam em `app/supabase/migrations/`. Aplicar via Supabase CLI:

```bash
cd app
npx supabase link --project-ref <ref-do-projeto>
npx supabase db push
```

Ou colar os arquivos no SQL Editor do Dashboard, em ordem (`0001` → `0016`).

---

## Testes

```bash
cd app
npm run typecheck       # tsc --noEmit
npx vitest run          # unitários (317 testes)
npm run test:e2e        # Playwright E2E (roda contra o BUILD de produção)
```

> Os testes E2E exigem "zero erro no console" e por isso rodam contra `npm run build && npm run start`, não o `next dev`. Ver `app/playwright.config.ts`.

---

## Deploy (Vercel)

1. **Root Directory = `app`** nas configurações do projeto na Vercel (o repo é monorepo; o app fica em `app/`).
2. Configurar todas as variáveis de ambiente da tabela acima como Environment Variables de produção.
3. Build command padrão (`next build`) e output padrão.

> ⚠️ **Antes de ir a produção**, ver a seção de hardening abaixo — há itens de segurança em aberto.

---

## Pendências de pré-produção (hardening)

Itens conhecidos que devem ser tratados antes do deploy público:

- **RLS multi-tenant**: políticas existem (`0010_rls_policies.sql`), mas a RLS foi desabilitada em `0009_disable_rls.sql` — **confirmar que está ativa e aplicada** em produção.
- **IDOR em `clientes`**: `update`/`softDelete` precisam de scoping por `company_id`/`owner_user_id` (não só por `id`).
- **SSRF no download de notas**: `notas_fiscais/[id]/download` faz `fetch` de URL salva sem allowlist de host.
- **Webhook Focus sem autenticação forte**: `api/webhooks/focus` confia em segredo na URL + IP allowlist; falta HMAC.
- **Credenciais NFS-e em plaintext**: `nfse_senha_login`/`nfse_token_api` armazenadas sem cifra.

Detalhes e contexto em `docs/investigations/` e nos specs de `docs/superpowers/`.

---

## Convenções

- **Rodar o Claude/ferramentas a partir da raiz** (`balu/`), nunca de dentro de `app/`. Os skills de planejamento gravam em `docs/` relativo ao diretório atual; rodar de outro lugar cria árvores de doc divergentes.
- **Thin client, fat server**: nenhum secret no frontend. Clients de APIs externas (`src/lib/clients/`) têm `import 'server-only'` e só são chamados de server actions / route handlers.
- **Markers `@generated` vs `@custom`**: arquivos gerados pelos scripts de `docs/bubble-to-prd/` trazem `// @generated` e são sobrescritos no próximo run; troque para `// @custom` ao editar à mão para preservar.
- **Spec é fonte da verdade**: divergência entre código e PRD/specs → ajustar o código. Specs e planos ficam em `docs/superpowers/`.

---

## Documentação

Toda a documentação vive em [`docs/`](docs/). Pontos de partida:

- **Produto / o que construir** → `docs/product/` (PRD, V1/V2-FUNCIONALIDADES)
- **Status e planejamento** → `docs/planning/` (STATUS-IMPLEMENTACAO, PLANO-4-DIAS)
- **Investigações técnicas** → `docs/investigations/` (Serpro, divergências de DB)
- **Specs e planos de implementação** → `docs/superpowers/specs/` e `docs/superpowers/plans/`
