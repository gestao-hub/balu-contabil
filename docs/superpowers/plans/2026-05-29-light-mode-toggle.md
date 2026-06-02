# Light Mode Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar um toggle de tema claro/escuro (escuro = padrão) na sidebar do app Balu, com a preferência persistida e sem flash na carga.

**Architecture:** O app já é tokenizado via CSS vars em `:root` (tema escuro). Mantemos o escuro como default no `:root` (anti-flash) e adicionamos um bloco `.light` que sobrescreve as mesmas vars. `next-themes` aplica a classe `.light`/dark no `<html>`, persiste em `localStorage` e injeta o script anti-flash. Um `ThemeToggle` na sidebar chama `setTheme`.

**Tech Stack:** Next.js 15 (App Router), React 19, Tailwind CSS, `next-themes`, `lucide-react`.

**Verificação:** Este trabalho é re-tematização por tokens + estado de UI; não há testes unitários significativos. Cada task verifica com `npm run typecheck` e, ao final, inspeção visual via Playwright. **Não rodar `npm run build` com `next dev` ativo** (corrompe o `.next` compartilhado — usar `typecheck`).

Todos os comandos rodam a partir de `app/`.

---

### Task 1: Instalar next-themes

**Files:**
- Modify: `app/package.json` (via npm)

- [ ] **Step 1: Instalar a dependência**

Run: `npm install next-themes`
Expected: adiciona `next-themes` a `dependencies` no `package.json`; sem erros de peer-dep (compatível com React 19 / Next 15).

- [ ] **Step 2: Confirmar instalação**

Run: `grep next-themes package.json`
Expected: linha `"next-themes": "^0.x.x"`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build(branding): adiciona next-themes para o toggle de tema"
```

---

### Task 2: Paleta clara nas CSS vars + var de border

**Files:**
- Modify: `app/src/app/globals.css`

- [ ] **Step 1: Adicionar `--border` ao `:root` escuro e o bloco `.light`**

No `globals.css`, dentro do `:root` existente, adicionar a linha `--border` ao final da lista de vars (antes do `}`):

```css
  --alert: 220 161 20;         /* #DCA114 */
  --border: 255 255 255;       /* canais; aplicado a 10% no Tailwind */
}
```

Logo após o fechamento do `:root`, adicionar o bloco do tema claro:

```css
/* Tema claro — derivado da marca (off-white frio, texto navy, primary azul mantido).
 * next-themes aplica .light no <html>; estas vars sobrescrevem o :root escuro. */
.light {
  --background: 246 248 250;      /* #F6F8FA */
  --surface: 255 255 255;          /* #FFFFFF */
  --surface-2: 237 241 245;        /* #EDF1F5 */
  --surface-3: 224 230 236;        /* #E0E6EC */
  --foreground: 14 34 51;          /* #0E2233 navy profundo */
  --muted-foreground: 90 107 120;  /* #5A6B78 slate */
  --muted-foreground-2: 56 80 95;  /* #38505F */
  --primary: 24 130 200;           /* #1882C8 */
  --primary-light: 74 174 224;     /* #4AAEE0 */
  --navy: 13 53 88;                /* #0D3558 */
  --success: 31 168 115;           /* #1FA873 */
  --destructive: 208 64 64;        /* #D04040 */
  --alert: 176 124 8;              /* #B07C08 */
  --border: 13 53 88;              /* #0D3558 → aplicado a 10% */
}
```

- [ ] **Step 2: Verificar typecheck (CSS não quebra TS, mas garante baseline)**

Run: `npm run typecheck`
Expected: PASS (sem novos erros).

- [ ] **Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "feat(branding): paleta do tema claro + var --border em globals.css"
```

---

### Task 3: Tailwind — darkMode class + border via var

**Files:**
- Modify: `app/tailwind.config.ts`

- [ ] **Step 1: Adicionar `darkMode: 'class'` e trocar `border` para usar a var**

Em `tailwind.config.ts`, adicionar `darkMode: 'class'` no nível do config (antes de `theme`):

```ts
export default {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
```

E trocar a linha do `border` (hoje hardcoded) por:

```ts
        border:               'rgb(var(--border) / 0.1)',
```

- [ ] **Step 2: Verificar typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tailwind.config.ts
git commit -m "feat(branding): border via --border + darkMode class no Tailwind"
```

---

### Task 4: ThemeProvider

**Files:**
- Create: `app/src/components/ThemeProvider.tsx`

- [ ] **Step 1: Criar o provider**

```tsx
'use client';

// Wrapper sobre next-themes. Aplica a classe no <html> (.light / dark),
// default escuro (padrão da marca), sem opção "sistema" (v1).
import { ThemeProvider as NextThemesProvider } from 'next-themes';

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
```

- [ ] **Step 2: Verificar typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/ThemeProvider.tsx
git commit -m "feat(branding): ThemeProvider (next-themes, default escuro)"
```

---

### Task 5: Plugar o ThemeProvider no layout

**Files:**
- Modify: `app/src/app/layout.tsx`

- [ ] **Step 1: Importar o provider, adicionar `suppressHydrationWarning` e envolver o corpo**

No `layout.tsx`:

Adicionar o import junto aos demais:

```tsx
import ThemeProvider from '@/components/ThemeProvider';
```

Adicionar `suppressHydrationWarning` ao `<html>` (exigência do next-themes ao trocar classe no html):

```tsx
    <html lang="pt-BR" suppressHydrationWarning className={`${outfit.variable} ${syne.variable} ${nunito.variable}`}>
```

Envolver o conteúdo do `<body>` com `<ThemeProvider>` (por fora do `ToastProvider`):

```tsx
      <body className="bg-background text-foreground font-sans antialiased">
        <ThemeProvider>
          <ToastProvider>{children}</ToastProvider>
        </ThemeProvider>
      </body>
```

- [ ] **Step 2: Verificar typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/layout.tsx
git commit -m "feat(branding): pluga ThemeProvider no root layout"
```

---

### Task 6: ThemeToggle

**Files:**
- Create: `app/src/components/ThemeToggle.tsx`

- [ ] **Step 1: Criar o toggle**

Estilo espelha o botão "Sair" do `MenuLateral`. Guarda `mounted` evita mismatch de hidratação (o tema só é conhecido no cliente). Recolhido (`open=false`) mostra só o ícone.

```tsx
'use client';

// Toggle claro/escuro na sidebar. useTheme do next-themes; a guarda `mounted`
// evita hydration mismatch (o tema resolvido só existe no cliente).
import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Sun, Moon } from 'lucide-react';

export default function ThemeToggle({ open }: { open: boolean }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === 'dark';
  const label = isDark ? 'Modo claro' : 'Modo escuro';

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm text-muted-foreground-2 hover:bg-surface-2 hover:text-foreground"
    >
      {/* Antes de montar, renderiza um ícone neutro p/ não piscar/mismatch */}
      {!mounted ? (
        <Sun className="size-4 shrink-0 opacity-0" />
      ) : isDark ? (
        <Sun className="size-4 shrink-0" />
      ) : (
        <Moon className="size-4 shrink-0" />
      )}
      {open && <span>{mounted ? label : ''}</span>}
    </button>
  );
}
```

- [ ] **Step 2: Verificar typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/ThemeToggle.tsx
git commit -m "feat(branding): ThemeToggle (sol/lua) para a sidebar"
```

---

### Task 7: Integrar o toggle na sidebar

**Files:**
- Modify: `app/src/components/MenuLateral.tsx`

- [ ] **Step 1: Importar e renderizar o toggle no rodapé**

Adicionar o import junto aos demais componentes:

```tsx
import ThemeToggle from '@/components/ThemeToggle';
```

No bloco do rodapé (`{/* Sair */}`), adicionar o toggle acima do botão "Sair", dentro da mesma `div`:

```tsx
      {/* Sair */}
      <div className="border-t border-border p-2">
        <ThemeToggle open={open} />
        <button
          type="button"
          onClick={signOut}
          className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm text-muted-foreground-2 hover:bg-surface-2 hover:text-foreground"
        >
          <LogOut className="size-4 shrink-0" />
          {open && <span>Sair</span>}
        </button>
      </div>
```

- [ ] **Step 2: Verificar typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/MenuLateral.tsx
git commit -m "feat(branding): toggle de tema no rodapé da sidebar"
```

---

### Task 8: Verificação visual e auditoria de contraste

**Files:**
- (sem mudança de código, salvo correções pontuais que surgirem)

- [ ] **Step 1: Subir o dev server (se ainda não estiver no ar)**

Run: `npm run dev` (background)
Expected: app em `http://localhost:3000`.

- [ ] **Step 2: Verificar toggle, troca de paleta e persistência via Playwright MCP**

Navegar até o app (autenticar se necessário), localizar o toggle no rodapé da sidebar, e:
- clicar → confirmar que o fundo vira off-white claro e o texto vira navy;
- recarregar a página → confirmar que o modo claro persiste (sem flash escuro→claro na carga);
- clicar de novo → volta ao escuro.

Tirar screenshot dos dois modos na tela Início.

- [ ] **Step 3: Auditar pontos de contraste/legibilidade no modo claro**

Inspecionar visualmente nas telas Início, Clientes e em um modal (ex.: `ClienteFormDialog`):
- texto principal e secundário legíveis (foreground navy, muted slate);
- botões `bg-primary` com `text-white` continuam legíveis (azul + branco, ok);
- bordas visíveis (navy/10%);
- nenhum texto-corpo branco caindo sobre surface clara (auditar usos de `text-white` que NÃO estejam sobre `bg-primary`/backdrop).

Se algum texto branco aparecer ilegível sobre fundo claro, trocar por `text-foreground`/`text-primary-foreground` conforme o caso e commitar a correção:

```bash
git add -A
git commit -m "fix(branding): corrige contraste de <X> no modo claro"
```

- [ ] **Step 4: Confirmar typecheck final**

Run: `npm run typecheck`
Expected: PASS.

---

## Resumo de arquivos

| Arquivo | Task | Mudança |
|---|---|---|
| `package.json` | 1 | +`next-themes` |
| `src/app/globals.css` | 2 | bloco `.light` + `--border` |
| `tailwind.config.ts` | 3 | `darkMode: 'class'`; `border` via var |
| `src/components/ThemeProvider.tsx` | 4 | novo |
| `src/app/layout.tsx` | 5 | provider + `suppressHydrationWarning` |
| `src/components/ThemeToggle.tsx` | 6 | novo |
| `src/components/MenuLateral.tsx` | 7 | render do toggle |
| (visual) | 8 | verificação + correções pontuais |
