# Spec — Mobile: PWA + responsivo das telas-chave

> **Data:** 2026-06-15
> **Branch:** `feat/pwa`
> **Origem:** usuário perguntou "qual o caminho correto para deixar esse web app em mobile também"
> na stack atual (Next 15 + Supabase). Decidiu-se PWA-first; depois pediu o pente-fino de responsivo.
> **PR/checklist:** [`docs/planning/PR-MOBILE.md`](../../planning/PR-MOBILE.md)

## Problema / objetivo

O app é web puro (Next 15 App Router, React 19, `@supabase/ssr` com auth por cookie, Tailwind),
sem PWA nem wrapper nativo. Queremos uso mobile **sem manter um segundo frontend**.

## Decisão de arquitetura

**Responsivo → PWA → (só se loja for requisito) Capacitor com URL remota.**

| Caminho | Reuso | Loja | Esforço | Decisão |
|---|:---:|:---:|:---:|---|
| **PWA** | 100% | ❌ | Baixo | ✅ **escolhido** (Etapa 2) |
| Capacitor (URL remota) | 100% | ✅ | Médio | adiado — só se App/Play Store virar requisito |
| Capacitor (export estático) | ~70% | ✅ | Alto | ❌ rejeitado — quebra SSR/Server Components |
| React Native / Expo | ~20% | ✅ | Muito alto | ❌ rejeitado — segundo codebase |

Razão: PWA preserva integralmente SSR, Server Components, route handlers e auth por cookie.
Para um SaaS fiscal (emitir nota, ver obrigações, consultar imposto), PWA cobre o uso mobile real.

## O que foi implementado (as-built)

### PWA
- `src/app/manifest.ts` — rota nativa do Next 15, serve `/manifest.webmanifest`. `name`/`short_name`,
  `display: standalone`, `background_color: #090909`, `theme_color: #0D3558`, ícones (svg + png 192/512 + maskable).
- `src/app/sw.ts` — service worker via `@serwist/next` (`defaultCache` + precache). **Excluído do tsconfig**
  (compilado pelo Serwist com lib WebWorker); o `tsc --noEmit` do app não o vê.
- `next.config.ts` — `withSerwistInit({ swSrc, swDest: 'public/sw.js', disable: NODE_ENV==='development' })`.
  Em dev o SW **não** é gerado nem registrado (hot-reload intacto). Auto-registro confirmado nos chunks
  (`/sw.js`) — `@serwist/next` v9.5.11 injeta o registro client-side (não aparece no HTML inicial).
- `src/app/layout.tsx` — `metadata.appleWebApp` + `metadata.icons.apple` + `viewport.themeColor`.
- `public/icons/` — PNGs gerados do `src/app/icon.svg` via `sharp`; maskable usa safe-zone (logo a 62% centralizado).
- `.gitignore` — ignora artefatos gerados (`public/sw.js*`, `swe-worker-*`).

### Responsivo
- **Drawer mobile** (`MenuLateral`): em `< md` é off-canvas (`fixed inset-y-0 -translate-x-full`, vira
  `translate-x-0` quando aberto) + topbar fixa (`md:hidden`, hambúrguer) + overlay + botão fechar; fecha
  ao clicar item. Em `md+` continua inline com toggle recolher (`md:w-60`/`md:w-16`). O toggle recolher é
  `hidden md:grid`. `(auth)/layout` ganhou `pt-14 md:pt-0` para o conteúdo não ficar sob a topbar.
- **Forms 1 coluna**: `grid-cols-2` → `grid-cols-1 sm:grid-cols-2` em `EmissaoForm`, `NfceForm`, `NfeForm`,
  `ItensField`, `RegimeTributarioForm`, `DadosEmpresaForm`, `NfseForm`.
- **Coluna fantasma** (gotcha): `col-span-2` → `sm:col-span-2`. Um filho com `col-span-2` dentro de uma
  grid `grid-cols-1` cria uma **2ª coluna implícita** no mobile (medido: `grid-template-columns: "101px 229px"`
  a 390px). Com o span responsivo a grid vira 1 coluna real (`"342px"`). Afeta `DadosEmpresaForm`,
  `RegimeTributarioForm`, `NfseForm`, `ItensField`, `CreateCompanyDialog`.
- **Dialogs**: `AddEmpresaDialog` e `CreateCompanyDialog` em `grid-cols-1 sm:grid-cols-2`. `ClienteFormDialog`
  e `AberturaWizard` já eram responsivos (`md:grid-cols-2` / `sm:grid-cols-2` + spans responsivos).

### Já estava OK (sem mudança)
Viewport `width=device-width`; tabelas com `overflow-x-auto`; modais `w-[min(720px,95vw)] max-h-[90vh]`;
dashboard e filtros com breakpoints.

## Validação

Playwright headless (`@playwright/test`, device `iPhone 13`, login real) — **não há Playwright MCP neste
ambiente**, então script `.cjs` rodado com `NODE_PATH=app/node_modules node ...`; cliques via
`locator.click()` (eventos reais). Confirmado: hambúrguer visível, drawer abre/overlay/fecha-ao-navegar,
forms e dialogs em 1 coluna (medição de `grid-template-columns`), modal de emissão full-width, manifest +
`sw.js` + ícones HTTP 200, SW gerado no build (44 KB, precache).

## Gotchas registrados
- **Build contamina o `.next` do dev**: rodar `npm run build` deixa render obsoleto no `next dev` seguinte
  (servia 2 colunas mesmo com a fonte corrigida). Recuperar com `rm -rf .next` + restart. (ver memória
  `balu-build-corrompe-dev-next`).
- **`col-span` numa grid de 1 coluna** cria coluna implícita — sempre tornar o span responsivo junto da grid.

## Pendências
Ver checklist em [`PR-MOBILE.md`](../../planning/PR-MOBILE.md): abrir GitHub PR (precisa remote), verificar SW
em produção, tabelas→cards (opcional), estratégia de cache offline, push (iOS 16.4+), mover `@serwist/next`
p/ devDeps, Etapa 3 (Capacitor) se loja virar requisito.
