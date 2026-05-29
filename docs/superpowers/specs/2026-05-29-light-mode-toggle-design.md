# Light mode toggle — design

**Data:** 2026-05-29
**Contexto:** continuação do rebranding (tema escuro da marca Balu, commits `a18e214`→`2143a4c`). Hoje o app é dark-only; este trabalho adiciona um modo claro com toggle na sidebar.

## Objetivo

Permitir alternar entre tema **claro** e **escuro** (escuro = padrão da marca), com a preferência persistida e sem *flash* na carga. O modo "seguir o sistema" foi descartado para v1.

## Estado atual (o que já existe)

- `src/app/globals.css` — tokens da marca em `:root` (canais RGB), aplicados no `body` e na scrollbar.
- `tailwind.config.ts` — cores semânticas mapeiam para as CSS vars via `rgb(var(--x) / <alpha-value>)`. **Exceção:** `border` está hardcoded como `rgb(255 255 255 / 0.08)`.
- `src/app/layout.tsx` — `<html>`/`<body>`; envolve `ToastProvider`. Sem provider de tema, sem `next-themes`, sem `darkMode` no Tailwind.
- `src/components/MenuLateral.tsx` — sidebar (`'use client'`), com rodapé "Sair" onde o toggle vai entrar.
- App **bem tokenizado**: 41 arquivos usam tokens semânticos. ~33 usos de `text-white`/`bg-black` são seguros nos dois modos (texto branco sobre `bg-primary`, backdrops `bg-black/40`). `<Logo/>` na sidebar usa `tone="gradient"` (azul) → funciona nos dois modos; `text-white` só aparece com `tone="white"` explícito.

## Decisões

| Decisão | Escolha |
|---|---|
| Modos | Claro + Escuro (escuro padrão). Sem "sistema". |
| Mecanismo | `next-themes` (anti-flash SSR, localStorage, sync entre abas). |
| Estratégia de tema | classe no `<html>` (`attribute="class"`), `defaultTheme="dark"`. |
| Local do toggle | Rodapé da sidebar (`MenuLateral`), junto do "Sair". |
| Paleta clara | Derivada da marca (tabela abaixo), aprovada. |

## Arquitetura

### 1. CSS vars por tema (`globals.css`)

`:root` continua com os valores **escuros** (default, evita flash mesmo antes do JS). Adiciona-se um bloco `.light` (classe que `next-themes` aplica no `<html>`) sobrescrevendo as mesmas vars com a paleta clara.

`border` deixa de ser hardcoded: vira a var `--border` (canais RGB) aplicada com opacidade fixa no Tailwind (`rgb(var(--border) / 0.1)`), permitindo flip por tema.

```
:root { /* escuro — valores atuais + --border: 255 255 255 */ }
.light {
  --background: 246 248 250;      /* #F6F8FA off-white frio */
  --surface: 255 255 255;          /* #FFFFFF */
  --surface-2: 237 241 245;        /* #EDF1F5 */
  --surface-3: 224 230 236;        /* #E0E6EC */
  --foreground: 14 34 51;          /* #0E2233 navy profundo */
  --muted-foreground: 90 107 120;  /* #5A6B78 slate */
  --muted-foreground-2: 56 80 95;  /* #38505F */
  --primary: 24 130 200;           /* #1882C8 mantém */
  --primary-light: 74 174 224;     /* mantém */
  --navy: 13 53 88;                /* mantém */
  --success: 31 168 115;           /* #1FA873 levemente escurecido p/ contraste */
  --destructive: 208 64 64;        /* #D04040 */
  --alert: 176 124 8;              /* #B07C08 */
  --border: 13 53 88;              /* navy → usado a 10% */
}
```

`--border` é adicionada também ao `:root` escuro como `255 255 255`. A scrollbar (`*::-webkit-scrollbar-thumb`) usa `--surface-3`, então acompanha o tema automaticamente.

### 2. Tailwind (`tailwind.config.ts`)

- `darkMode: 'class'` (mantém compatibilidade conceitual; a base é escura, `.light` sobrescreve).
- `border` deixa de ser hardcoded: `border: 'rgb(var(--border) / 0.1)'`. Dark a 0.1 branco ≈ 0.08 atual (diferença imperceptível); claro a 0.1 navy = sutil.

### 3. ThemeProvider (`src/components/ThemeProvider.tsx`)

Wrapper `'use client'` sobre `ThemeProvider` do `next-themes`:
`attribute="class"`, `defaultTheme="dark"`, `enableSystem={false}`, `disableTransitionOnChange`.

### 4. Layout (`src/app/layout.tsx`)

- `<html>` ganha `suppressHydrationWarning` (exigência do `next-themes`).
- `<body>` envolto por `<ThemeProvider>` (por fora do `ToastProvider`).
- Sem mudança nas fontes/metadata.

### 5. Toggle (`src/components/ThemeToggle.tsx`)

- `'use client'`, usa `useTheme()` do `next-themes`.
- Botão sol/lua (lucide `Sun`/`Moon`), alterna `light`⇄`dark`.
- Guarda anti-hydration: só renderiza o ícone após `mounted` (padrão `next-themes`), evitando mismatch SSR.
- Estilo idêntico ao botão "Sair": `flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm ...`. Quando a sidebar está recolhida (`open=false`), mostra só o ícone (espelha o comportamento do "Sair").

### 6. Integração na sidebar (`MenuLateral.tsx`)

`<ThemeToggle open={open} />` entra no bloco do rodapé (`border-t`), acima ou ao lado do "Sair". `open` é passado para alinhar o label com o estado expandido/recolhido.

## Fluxo

1. SSR renderiza com `:root` escuro (sem flash, é o default).
2. Script bloqueante do `next-themes` lê `localStorage` antes da pintura e aplica `.light` no `<html>` se for o caso.
3. Toggle chama `setTheme('light' | 'dark')` → classe no `<html>` troca → CSS vars re-tematizam o app inteiro.
4. Preferência persistida em `localStorage` (chave `theme`), sincronizada entre abas pelo `next-themes`.

## Tratamento de erros / edge cases

- **Flash (FOUC):** resolvido pelo default escuro no `:root` + script bloqueante do `next-themes`.
- **Hydration mismatch:** `suppressHydrationWarning` no `<html>` + guarda `mounted` no `ThemeToggle`.
- **Contraste no claro:** `success`/`destructive`/`alert` escurecidos; validar AA (≥4.5:1 para texto) nos chips e botões durante a implementação.
- **`text-white` sobre fundo claro:** auditar os ~33 usos; manter os que estão sobre `bg-primary`/backdrops; corrigir qualquer texto-corpo branco que caia sobre surface clara. `<Logo/>` da sidebar usa gradient → ok.

## Testes / verificação

- **Manual (Playwright disponível):** carregar app, alternar toggle, confirmar troca de paleta e ausência de flash no reload em modo claro; verificar persistência após reload.
- **Visual:** conferir telas-chave (login, início, clientes, modais) nos dois modos — modais (`CreateCompanyDialog`, `ClienteFormDialog`, `PopupConfirm`) usam `bg-surface`/`text-foreground`, devem acompanhar.
- **Sem testes unitários novos** — é re-tematização via tokens + estado de UI; cobertura por inspeção visual.

## Fora de escopo (YAGNI)

- Modo "seguir o sistema".
- Temas adicionais além de claro/escuro.
- Animação/transição custom na troca de tema (`disableTransitionOnChange` evita transições estranhas).
- Refatorar os `text-white` que já são seguros.

## Arquivos afetados

| Arquivo | Mudança |
|---|---|
| `package.json` | +`next-themes` |
| `src/app/globals.css` | bloco `.light` + `--border` no `:root` |
| `tailwind.config.ts` | `darkMode: 'class'`; `border` via `--border` |
| `src/app/layout.tsx` | `suppressHydrationWarning` + `<ThemeProvider>` |
| `src/components/ThemeProvider.tsx` | **novo** |
| `src/components/ThemeToggle.tsx` | **novo** |
| `src/components/MenuLateral.tsx` | render do `<ThemeToggle>` no rodapé |
