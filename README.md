# Balu

Plataforma de **gestão fiscal e contábil** para contadores e empresas brasileiras — emissão de notas fiscais (NFe/NFC-e/NFS-e), apuração de impostos (Simples Nacional / MEI), guias e declarações via SERPRO, gestão de clientes, honorários, cobrança e abertura/alteração de empresas.

Next.js 15 + Supabase, em produção na Vercel. Originalmente um app Bubble.io, reconstruído como aplicação web nativa.

---

> ## 📍 O estado do projeto vive no [`CHECKPOINT.md`](CHECKPOINT.md)
>
> **Este README é a porta de entrada: o que é o projeto, como rodar, como fazer deploy.**
> Ele guarda só o que muda devagar.
>
> **O que está feito, o que está quebrado, o que vem a seguir e quais bloqueios
> operacionais existem agora** ficam no `CHECKPOINT.md`, atualizado ao fim de
> cada sessão de trabalho. É lá que se retoma o contexto.
>
> A divisão é deliberada. A versão anterior deste arquivo misturava as duas
> coisas e envelheceu mal: anunciava "16 migrations" quando já eram 85, "317
> testes" quando eram 1658, e pedia para "confirmar se a RLS está ativa" anos
> depois de ela estar ativa nas 44 tabelas. Fato perecível em README é fato que
> ninguém revisa — então ele não mora mais aqui.

---

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | Next.js 15 (App Router), React 19, Tailwind 3, lucide-react, next-themes |
| Backend | Server Actions + Route Handlers, Supabase (Postgres + Auth + Storage) |
| Fiscal | Focus NFe (emissão), SERPRO Integra Contador (DAS/PGDAS-D/DASN-SIMEI) |
| Cobrança | Asaas (assinaturas, split, subcontas) |
| Atendimento | WhatsApp via UAZAPI + IA via OpenRouter |
| Dados públicos | BrasilAPI (CNPJ), ViaCEP, IBGE |
| Validação | Zod (client + server) |
| Cripto | node-forge (certificados A1 `.pfx`) |
| Testes | Vitest (unitários), Playwright (E2E) |
| Deploy | Vercel (plano Hobby) |

---

## Estrutura do repositório

```
balu/                          ← raiz do git (rode as ferramentas daqui — ver Convenções)
├── app/                       ← APP Next.js (Root Directory na Vercel)
│   ├── src/
│   │   ├── app/
│   │   │   ├── (public)/      ← login, cadastro, reset_pw, convite
│   │   │   ├── (onboarding)/  ← onboarding e abertura de empresa
│   │   │   ├── (auth)/(gated)/← app logado: dashboard, clientes, notas_fiscais,
│   │   │   │                    impostos, honorarios, cobrancas, configuracoes,
│   │   │   │                    conta, contador/*, admin/*
│   │   │   └── api/           ← crons e webhooks (ver Deploy)
│   │   ├── components/        ← UI compartilhada
│   │   ├── lib/               ← billing, clients, conciliacao, crypto, fiscal,
│   │   │                        format, security, supabase, validators
│   │   └── types/
│   ├── supabase/migrations/   ← 0001–0084 (schema, RLS, RPCs, storage)
│   ├── tests/                 ← Playwright E2E (smoke, walkthrough, RLS, responsivo)
│   └── scratchpad/            ← utilitários operacionais (aplicar migration, Trello…)
│
├── docs/                      ← documentação e tooling
│   ├── product/               ← PRD, V1/V2-FUNCIONALIDADES
│   ├── planning/              ← STATUS, planos
│   ├── investigations/        ← SERPRO, DASN-SIMEI, PGDAS-D, comparativos
│   ├── reference/             ← db_atual.sql, resultados de teste
│   ├── legal/                 ← termos, política de privacidade
│   ├── superpowers/           ← specs + plans (brainstorm → design → implementação)
│   └── bubble-to-prd/         ← pipeline de conversão Bubble→código
│
├── CHECKPOINT.md              ← ESTADO VIVO (leia primeiro ao retomar)
└── README.md                  ← este arquivo
```

---

## Setup local

Pré-requisito: **Node 20+**.

```bash
cd app
npm install
cp .env.example .env.local     # preencher as chaves
npm run dev                     # http://localhost:3000
```

### Variáveis de ambiente (`app/.env.local`)

**Obrigatórias para o app subir:**

| Variável | Para quê |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | URL canônica (links de e-mail). Em produção, a URL real — nunca derivar de headers. |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase (auth + dados) |
| `SUPABASE_SERVICE_ROLE_KEY` | Operações privilegiadas server-side (bypassa RLS) |
| `CERT_ENC_KEY` | Cifra os certificados A1 guardados no banco |
| `CRON_SECRET` | Autentica as rotas `/api/cron/*` |

**Por integração** (a ausência degrada a funcionalidade, não derruba o app):

| Variável | Para quê |
|---|---|
| `FOCUS_NFE_TOKEN` / `FOCUS_NFE_ENV` | Emissão e consulta de notas |
| `FOCUS_WEBHOOK_SECRET` | Autentica o callback da Focus |
| `SERPRO_CONSUMER_KEY` / `SERPRO_CONSUMER_SECRET` | SERPRO Integra Contador |
| `TOKEN_ASAAS_PRODUCAO` / `TOKEN_ASAAS_SANDBOX` | Cobrança (ver aviso abaixo) |
| `UAZAPI_BASE_URL` / `UAZAPI_TOKEN` / `UAZAPI_WEBHOOK_SECRET` | WhatsApp — **`UAZAPI_TOKEN`**, o da instância, é o que o app lê |
| `RESEND_API_KEY` / `EMAIL_FROM` | E-mails transacionais |
| `SUPABASE_PASSWORD` | Só para o runner de migrations (não é lida pelo app) |
| `UAZAPI_ADMIN_TOKEN` | Só para provisionar instância pelos scripts (não é lida pelo app) |

> **A chave da IA não é variável de ambiente.** Ela fica cifrada em `config_ia`
> e se configura em `/admin/configuracoes/ia`. Procurar por `TOKEN_OPENROUTER`
> no `.env` manda o operador ao lugar errado enquanto a IA segue desligada.

> ⚠️ **Asaas:** as chaves de **produção** ficam em `app/.env.local` e são
> habilitadas deliberadamente. Não troque o ambiente sem combinar — cobrança
> mal ligada gera lançamento real no cartão de cliente.

---

## Banco de dados

As migrations ficam em `app/supabase/migrations/`, numeradas e aplicadas **em ordem**.

```bash
cd app                                          # obrigatório: o runner resolve caminhos a partir daqui
node scratchpad/apply-migration.mjs supabase/migrations/0084_comprovante_pagamento_guia.sql
```

O runner lê `SUPABASE_PASSWORD` e `NEXT_PUBLIC_SUPABASE_URL` do `.env.local`,
tenta a conexão direta e cai para o pooler `sa-east-1` se ela falhar.

> **Atenção ao MCP do Supabase:** a conta conectada via MCP aponta para
> **outro produto**, não para o Balu. Um `apply_migration` por ali acerta o
> banco errado. Use sempre o runner acima.

Convenções de migration em uso no projeto: `IF NOT EXISTS` sempre que possível;
`SECURITY DEFINER` apenas quando a função precisa ultrapassar a RLS de
propósito (e nunca quando recebe como parâmetro o alvo que deveria autorizar);
buckets privados sem policy em `storage.objects` (escrita pela service role,
leitura por signed URL).

---

## Testes

```bash
cd app
npm run typecheck          # tsc --noEmit
npx vitest run             # unitários (145 arquivos)
npm run test:e2e           # Playwright E2E — roda contra o BUILD de produção
```

Os E2E exigem "zero erro no console" e por isso rodam contra
`npm run build && npm run start`, não o `next dev` (que emite ruído de Fast
Refresh e gera falso negativo). Ver `app/playwright.config.ts`.

Os specs que batem no Supabase real precisam do ambiente carregado:

```bash
cd app
set -a; . ./.env.local; set +a
npx playwright test responsivo        # varre 390×844 e falha se a página rolar de lado
npx playwright test rls-all-tables    # prova o isolamento multi-tenant
```

---

## Deploy (Vercel)

1. **Root Directory = `app`** nas configurações do projeto (o repo é monorepo).
2. Configurar as variáveis da tabela acima como Environment Variables de produção.
3. Build e output padrão (`next build`).

### Crons — o limite que restringe o desenho

O plano **Hobby da Vercel permite exatamente 2 cron jobs**, e os dois estão ocupados (`app/vercel.json`):

| Rota | Quando | O que faz |
|---|---|---|
| `/api/cron/honorarios-recorrentes` | `0 9 1 * *` | gera os honorários do mês |
| `/api/cron/obrigacoes` | `0 11 * * *` | materializa obrigações, marca guias vencidas, alerta parâmetro fiscal defasado, cobra, e apura o mês |

Existem outras rotas de cron no código (`/api/cron/billing`,
`/api/cron/sync-municipios`) **que não estão agendadas** — são acionadas
manualmente ou pegam carona.

Consequência prática: **tarefa nova não ganha cron próprio, ela pega carona no
`/api/cron/obrigacoes`.** Quem pegar carona precisa respeitar duas regras, e
elas não são estilo:

- **Ordem**: o trabalho novo entra **depois** do que já existia. O
  `maxDuration` é 60 s e o estouro de tempo de parede **não é capturável por
  `try/catch`** — a função é morta. Quem entra por último é quem se perde se o
  tempo acabar.
- **Orçamento próprio**: a tarefa mede o tempo gasto e para **antes** do
  limite, em vez de confiar num timeout. Ver `lib/fiscal/apuracao-cron.ts`.

### Webhooks

`/api/webhooks/focus` (emissão), `/api/webhooks/asaas` (cobrança) e
`/api/webhooks/uazapi` (WhatsApp). Cada um valida o segredo do seu provedor —
ao trocar uma chave, trocar **nos dois lados**.

### Depois de mudar de domínio

`NEXT_PUBLIC_SITE_URL` **e** as Redirect URLs do Supabase Auth precisam apontar
para o domínio novo. Esquecer a segunda quebra confirmação de e-mail e reset de
senha — silenciosamente, porque o app continua subindo.

---

## Convenções

- **Determinístico decide, IA explica.** Nada com efeito fiscal sai de um
  modelo de linguagem. A IA redige a explicação de um número que o código já
  calculou.
- **Fail-closed é fallback, nunca zero.** Se um parâmetro fiscal não puder ser
  lido do banco, o código usa o fallback versionado em `lib/fiscal/` — jamais
  segue com zero, que viraria imposto errado com cara de imposto certo.
- **Thin client, fat server.** Nenhum segredo no frontend. Clients de APIs
  externas (`src/lib/clients/`) têm `import 'server-only'` e só são chamados de
  server actions e route handlers. Módulos puros ficam separados justamente
  para poderem ser testados sem banco.
- **Rodar as ferramentas da raiz** (`balu/`), nunca de dentro de `app/` —
  exceto o runner de migrations, que exige `app/`.
- **Markers `@generated` vs `@custom`**: arquivos gerados por
  `docs/bubble-to-prd/` trazem `// @generated` e são sobrescritos no próximo
  run; troque para `// @custom` ao editar à mão.
- **Erro de integração não vai cru para a tela.** Focus passa por
  `lib/fiscal/focus-erro.ts` e SERPRO por `lib/fiscal/serpro-erro.ts`. Código
  fiscal sem significado documentado mostra o texto oficial do órgão, não uma
  tradução inventada.

---

## Documentação

- **Estado atual, bloqueios e próximos passos** → [`CHECKPOINT.md`](CHECKPOINT.md)
- **Produto / o que construir** → `docs/product/` (PRD, V1/V2-FUNCIONALIDADES)
- **Investigações técnicas** → `docs/investigations/` (SERPRO, DASN-SIMEI, PGDAS-D)
- **Specs e planos** → `docs/superpowers/specs/` e `docs/superpowers/plans/`
- **Jurídico** → `docs/legal/`
