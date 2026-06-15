# PR — Mobile (PWA + Responsivo)

> **Branch:** `feat/pwa` · **Base:** `main` · **Status:** pronto para revisão (sem remote ainda → PR vira GitHub PR quando o repo de produção nascer).
> **Objetivo:** deixar o web app (Next 15 + Supabase) usável e instalável no celular **sem segundo codebase** — PWA primeiro, responsivo das telas-chave.
> **Spec/as-built:** [`docs/superpowers/specs/2026-06-15-mobile-pwa-responsivo-design.md`](../superpowers/specs/2026-06-15-mobile-pwa-responsivo-design.md)

## Resumo

Etapa 2 do caminho mobile (ver "Estratégia" abaixo): transformar a PWA + acertar o responsivo. Reaproveita 100% da stack atual (Server Components, auth por cookie do `@supabase/ssr`, Tailwind). Nada de React Native / export estático.

## Commits

| Commit | Escopo |
|---|---|
| `e4c41e3` | feat(pwa): manifest + service worker (instalável) |
| `e4d7dcb` | fix(responsive): drawer mobile no menu lateral + forms em 1 coluna |
| `5f39ca0` | fix(responsive): `col-span-2` → `sm:col-span-2` (coluna fantasma) |
| `78e7546` | fix(responsive): dialogs de empresa em 1 coluna |

## ✅ Feito

- [x] **PWA instalável** — `src/app/manifest.ts` (rota nativa Next 15, `/manifest.webmanifest`) com cores da marca (navy `#0D3558`, bg `#090909`), `display: standalone`, ícones.
- [x] **Service worker** via `@serwist/next` — `src/app/sw.ts`; `withSerwist` gera `public/sw.js` no build; **desativado em dev** (não atrapalha hot-reload); auto-registro confirmado nos chunks (`/sw.js`).
- [x] **Ícones** — PNG 192/512, maskable 512 (safe-zone), apple-touch 180, gerados do `icon.svg` da marca (via `sharp`). `apple-touch-icon` + `theme-color` no `layout.tsx`.
- [x] **Drawer mobile** (`MenuLateral`) — em `< md` vira off-canvas (topbar fixa com hambúrguer + overlay + fechar), desliza com `translate-x`, fecha ao navegar. Em `md+` mantém sidebar inline com toggle recolher. `(auth)/layout` ganhou `pt-14 md:pt-0`.
- [x] **Forms em 1 coluna no mobile** — `grid-cols-2` → `grid-cols-1 sm:grid-cols-2` em emissão (Emissao/Nfce/Nfe/Itens) e configurações (RegimeTributario/DadosEmpresa/Nfse).
- [x] **Coluna fantasma corrigida** — `col-span-2` → `sm:col-span-2` (um filho `col-span-2` numa grid `grid-cols-1` cria 2ª coluna implícita no mobile). Forms + `CreateCompanyDialog`.
- [x] **Dialogs em 1 coluna** — `AddEmpresaDialog`, `CreateCompanyDialog`. (`ClienteFormDialog` e `AberturaWizard` já eram responsivos.)
- [x] **Validação real** — Playwright headless (iPhone 13, login real), screenshots + medição de `grid-template-columns` (`342px`/`157px` = 1 coluna confirmada).

### Já estavam OK (sem mudança)
- Viewport `width=device-width` (default Next).
- Tabelas (notas, clientes, honorários, declarações, folha) com `overflow-x-auto`.
- Modais com `w-[min(720px,95vw)] max-h-[90vh] overflow-y-auto`.
- Dashboard e barras de filtro com breakpoints.

## ⬜ A fazer

- [ ] **Abrir o GitHub PR** quando o repo de produção tiver remote (hoje só commits locais).
- [ ] **Verificar SW em produção** com `next dev` parado: `npm run build && npm start` → DevTools → Application (instalável + SW ativo). *Nota: build compartilha `.next` com o dev; rodar só com dev desligado e `rm -rf .next` depois.*
- [ ] **Tabelas → cards no mobile** (opcional) — hoje fazem scroll horizontal (aceitável); padrão card melhora a leitura em telas estreitas (notas, clientes, honorários).
- [ ] **Offline/cache strategy** — hoje usa `defaultCache` do Serwist; definir o que faz sentido cachear para uso offline real (ex.: shell + assets, não dados fiscais).
- [ ] **Push notifications** (se desejado) — iOS exige 16.4+; avaliar valor vs. esforço.
- [ ] **Mover `@serwist/next` para `devDependencies`** (só roda em build) — limpeza menor.
- [ ] **Etapa 3 (Capacitor)** — só se presença em App Store/Play Store virar requisito; usar Capacitor com **URL remota** (preserva SSR), não export estático.

## Estratégia mobile (contexto da decisão)

Recomendação adotada: **Responsivo → PWA → (só se loja for requisito) Capacitor com URL remota.** Evitar export estático (quebra SSR/Server Components) e React Native (segundo codebase). Detalhe e tabela comparativa no spec.

## Como testar (manual)

1. `npm run build && npm start` com `next dev` desligado.
2. Chrome DevTools → device toolbar (390px) → conferir drawer (hambúrguer/overlay/fechar), forms em 1 coluna, tabelas com scroll.
3. Application → Manifest/Service Workers → "Instalar / Adicionar à tela inicial".
4. Depois: `rm -rf .next` antes de voltar ao `next dev` (evita render obsoleto).
