# Botão "Nova empresa" no menu (dev-only) (design)

**Data:** 2026-05-27
**Status:** aprovado (brainstorming) — pronto para writing-plans
**Branch:** `feat/menu-nova-empresa-dev`
**Fontes:** `MenuLateral.tsx`, `CreateCompanyDialog.tsx`, `app/(auth)/layout.tsx`, `onboarding/actions.ts` (`createCompanyAction`).

## Contexto

Hoje o `CreateCompanyDialog` (popup de cadastro de empresa) só é renderizado no `layout.tsx`, em modo `forceCreate` (sem botão fechar), e apenas quando o usuário **não tem** empresa atual (onboarding). Para testar o fluxo de cadastro repetidamente, é preciso apagar as empresas para o popup reaparecer.

O usuário quer um botão no menu que abra esse popup sob demanda. Decisão: **disponível só em desenvolvimento** por ora (`NODE_ENV !== 'production'`); regras de produção (limite de empresas por usuário, etc.) ficam para depois.

### Verificado
- `createCompanyAction` insere em `companies`, **define a nova empresa como `current_company`** (update/insert em `profiles`) e faz `revalidatePath('/')`. Ou seja, criar pelo menu já troca a empresa atual.
- `CreateCompanyDialog` é controlado por `open`; em modo normal (`forceCreate` ausente/false) tem botão X e "Cancelar", e chama `onCreated?.(id)` + `onClose?.()` no sucesso.
- `MenuLateral` é client component; recebe `companies` e `currentCompanyId` como props do `layout.tsx` (server) e já tem `router` (`useRouter`).
- `process.env.NODE_ENV` é inlinado pelo Next no bundle client → um bloco atrás de `isDev` é eliminado (tree-shaken) no build de produção.

## Decisões aprovadas

1. **O `MenuLateral` renderiza sua própria instância do `CreateCompanyDialog`** (modo normal, com fechar), controlada por estado local — sem provider/contexto e sem rota nova.
2. **Gate por desenvolvimento:** botão e dialog só existem quando `process.env.NODE_ENV !== 'production'`.
3. **Sem mudança** em `layout.tsx` (onboarding `forceCreate` permanece), em `CreateCompanyDialog`, nem em actions/schema.
4. Após criar, `router.refresh()` recarrega o layout → `MenuLateral` recebe lista de empresas e empresa atual atualizadas (a nova já vem como atual).

## Escopo

- `src/components/MenuLateral.tsx`:
  - Importar `CreateCompanyDialog` (default de `@/components/CreateCompanyDialog`) e o ícone `Plus` (lucide-react).
  - `const isDev = process.env.NODE_ENV !== 'production';` (no corpo do componente).
  - Novo state `const [addOpen, setAddOpen] = useState(false);`.
  - Quando o menu está expandido (`open`) **e** `isDev`: renderizar um botão **"+ Nova empresa"** logo abaixo do bloco do seletor de empresa (dentro do `<div className="border-b ...">`, após o bloco do dropdown de empresas).
  - No final do `<aside>` (ou junto ao botão), quando `isDev`: renderizar `<CreateCompanyDialog open={addOpen} onClose={() => setAddOpen(false)} onCreated={() => { setAddOpen(false); router.refresh(); }} />`.

### Fora de escopo
- Regras de produção (limite de empresas, papel do usuário) — ficam para um ajuste futuro quando for liberar em produção.
- Botão no estado recolhido do menu (`open === false`) — não é necessário; o botão aparece só com o menu expandido, como o seletor de empresa.
- Mudanças no onboarding (`forceCreate`) e no `CreateCompanyDialog`.

## Arquitetura

### `MenuLateral.tsx`

Adições (sem remover nada do existente):

```tsx
// imports
import { /* ...existentes..., */ Plus } from 'lucide-react';
import CreateCompanyDialog from '@/components/CreateCompanyDialog';

// no corpo do componente, junto aos outros hooks/const:
const isDev = process.env.NODE_ENV !== 'production';
const [addOpen, setAddOpen] = useState(false);
```

Botão (dentro do bloco `open ? (...)` do cabeçalho, logo após o `</div>` que fecha o bloco do dropdown de empresas):
```tsx
{isDev && (
  <button
    type="button"
    onClick={() => setAddOpen(true)}
    className="mt-2 flex w-full items-center gap-1.5 rounded-md border border-dashed border-zinc-300 px-2 py-1.5 text-xs text-zinc-600 hover:border-primary hover:text-primary"
  >
    <Plus className="size-3.5 shrink-0" />
    Nova empresa
  </button>
)}
```

Dialog (antes do fechamento do `</aside>`):
```tsx
{isDev && (
  <CreateCompanyDialog
    open={addOpen}
    onClose={() => setAddOpen(false)}
    onCreated={() => { setAddOpen(false); router.refresh(); }}
  />
)}
```

## Fluxo de dados

Clique em "+ Nova empresa" → `setAddOpen(true)` → `CreateCompanyDialog` abre (modo normal, X/Cancelar) → usuário preenche → `createCompanyAction` (insere, seta `current_company` = nova, `revalidatePath('/')`) → no sucesso o dialog chama `onCreated` → `setAddOpen(false)` + `router.refresh()` → `layout.tsx` re-renderiza no server e passa `companies`/`currentCompanyId` atualizados ao `MenuLateral` → o seletor mostra a nova empresa como atual.

## Tratamento de erro

Nenhuma lógica nova. O `CreateCompanyDialog` já valida (`CompanyCreateSchema` + `isValidCnpj`) e mostra erros via toast; `createCompanyAction` retorna `{ ok:false, error }` tratado lá dentro.

## Verificação

- `tsc --noEmit` zero erros.
- `vitest run` segue verde (nenhum teste cobre `MenuLateral`; nada de helper mudou).
- UI/manual (dev, `npm run dev`): o botão "+ Nova empresa" aparece abaixo do seletor; clicar abre o popup com X/Cancelar; criar uma empresa de teste fecha o popup e o seletor passa a mostrá-la como empresa atual (e ela aparece na lista do dropdown).
- Confirmar o gate: o botão e o dialog estão atrás de `isDev` (`process.env.NODE_ENV !== 'production'`), eliminado no build de produção.

## Premissas / fora de escopo

- "Dev-only" via `process.env.NODE_ENV` — em produção o bloco some (tree-shaking do Next). Sem flag de runtime adicional.
- A nova empresa vira a atual ao ser criada (comportamento existente do `createCompanyAction`) — adequado para o uso de teste.
- Liberar em produção (com limite de empresas/role) é um trabalho futuro, fora desta spec.
