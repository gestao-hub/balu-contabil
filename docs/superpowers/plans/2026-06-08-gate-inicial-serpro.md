# Gate Inicial SERPRO — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a Simples empresa has never synced with SERPRO, replace the entire /impostos page content with a focused card ("Traga seu histórico de declarações agora" + "Atualizar") instead of showing empty sections. After the first sync, mark `sincronizacao_inicial_serpro_at` in `empresas_fiscais` and reveal the normal page.

**Architecture:** A `timestamptz` flag column in `empresas_fiscais` controls visibility. `page.tsx` reads the flag and renders either `GateInicialSerpro` (new client component) or the normal sections. The gate component calls the existing `consultarDeclaracoesAction`, then a new minimal `marcarSincronizacaoInicialAction`, then `router.refresh()`.

**Tech Stack:** Next.js 14 server components + server actions, Supabase, TypeScript, Tailwind + shadcn tokens already in use throughout the page.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `app/supabase/migrations/0026_gate_inicial_serpro.sql` | Create | Add `sincronizacao_inicial_serpro_at timestamptz` to `empresas_fiscais` |
| `app/src/app/(auth)/impostos/actions.ts` | Modify | Add `marcarSincronizacaoInicialAction` |
| `app/src/app/(auth)/impostos/GateInicialSerpro.tsx` | Create | Client island — message + "Atualizar" button |
| `app/src/app/(auth)/impostos/page.tsx` | Modify | Read new column from `empresas_fiscais`, branch to gate when needed |

---

## Task 1: Migration — add `sincronizacao_inicial_serpro_at`

**Files:**
- Create: `app/supabase/migrations/0026_gate_inicial_serpro.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- @custom — Gate inicial SERPRO: rastreia quando a empresa Simples fez o primeiro sync.
-- NULL = nunca sincronizou → exibe GateInicialSerpro na página /impostos.
-- NOT NULL = já sincronizou → exibe a página normal.
-- Sem default intencional: empresas existentes ficam NULL, ativando o gate na próxima visita.
ALTER TABLE public.empresas_fiscais
  ADD COLUMN IF NOT EXISTS sincronizacao_inicial_serpro_at TIMESTAMPTZ;
```

- [ ] **Step 2: Apply the migration**

```bash
cd app && npx supabase db push
```

Expected: migration applied without errors. Se o Supabase CLI não estiver configurado localmente, aplique via MCP (`apply_migration`) ou pelo painel SQL.

- [ ] **Step 3: Verify column exists**

```bash
cd app && npx supabase db diff
```

Expected: diff limpo (a coluna foi aplicada). Alternativamente, confirme via:
```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'empresas_fiscais'
  AND column_name = 'sincronizacao_inicial_serpro_at';
```

- [ ] **Step 4: Commit**

```bash
git add app/supabase/migrations/0026_gate_inicial_serpro.sql
git commit -m "feat(migration): sincronizacao_inicial_serpro_at em empresas_fiscais"
```

---

## Task 2: Server action `marcarSincronizacaoInicialAction`

**Files:**
- Modify: `app/src/app/(auth)/impostos/actions.ts` (append after `consultarDeclaracoesAction`)

- [ ] **Step 1: Append the action to `actions.ts`**

Add at the end of `app/src/app/(auth)/impostos/actions.ts`:

```ts
export type MarcarSincronizacaoResult = { ok: true } | { ok: false; error: string };

/**
 * Marca a primeira sincronização com a SERPRO.
 * Separada da consultarDeclaracoesAction para não acoplar o conceito
 * "primeira vez" ao fluxo de consulta recorrente.
 * Idempotente: uma segunda chamada apenas atualiza o timestamp.
 */
export async function marcarSincronizacaoInicialAction(): Promise<MarcarSincronizacaoResult> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  const { data: profile } = await supabase
    .from('profiles')
    .select('current_company')
    .eq('user_id', user.id)
    .single();
  const companyId = (profile?.current_company ?? null) as string | null;
  if (!companyId) return { ok: false, error: 'Nenhuma empresa selecionada.' };

  const { error } = await supabase
    .from('empresas_fiscais')
    .update({ sincronizacao_inicial_serpro_at: new Date().toISOString() })
    .eq('empresa_id', companyId)
    .is('deleted_at', null);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
```

- [ ] **Step 2: Type-check**

```bash
cd app && npx tsc --noEmit 2>&1 | head -30
```

Expected: sem erros relacionados ao novo código. (Erros pré-existentes não são bloqueantes.)

- [ ] **Step 3: Commit**

```bash
git add app/src/app/\(auth\)/impostos/actions.ts
git commit -m "feat(impostos): marcarSincronizacaoInicialAction"
```

---

## Task 3: Componente `GateInicialSerpro`

**Files:**
- Create: `app/src/app/(auth)/impostos/GateInicialSerpro.tsx`

Este é um client island. Segue o mesmo padrão de `ConsultarSerproButton.tsx` (useTransition + useToast + useRouter), mas envolve dois passos sequenciais: `consultarDeclaracoesAction` → `marcarSincronizacaoInicialAction`.

- [ ] **Step 1: Create the component**

```tsx
'use client';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Download } from 'lucide-react';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { consultarDeclaracoesAction } from './actions';
import { marcarSincronizacaoInicialAction } from './actions';

export default function GateInicialSerpro() {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  function handle() {
    if (pending) return;
    startTransition(async () => {
      const r = await consultarDeclaracoesAction();
      if (!r.ok) {
        toast('error', r.error);
        return;
      }
      const m = await marcarSincronizacaoInicialAction();
      if (!m.ok) {
        // Dados foram salvos; o gate reaparecerá mas o usuário pode tentar de novo.
        toast('warning', 'Histórico importado, mas não foi possível salvar o marco de sincronização.');
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-center justify-center gap-6 rounded-xl border border-border bg-surface p-10 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-primary/10">
        {pending ? (
          <Loader2 className="size-7 text-primary animate-spin" />
        ) : (
          <Download className="size-7 text-primary" />
        )}
      </div>
      <div className="space-y-2">
        <h2 className="text-lg font-semibold text-foreground">
          Traga seu histórico de declarações agora
        </h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          Sincronize com a SERPRO para ver suas guias e declarações anteriores.
        </p>
      </div>
      <button
        type="button"
        onClick={handle}
        disabled={pending}
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {pending ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Sincronizando…
          </>
        ) : (
          'Atualizar'
        )}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd app && npx tsc --noEmit 2>&1 | head -30
```

Expected: sem erros no novo arquivo.

- [ ] **Step 3: Commit**

```bash
git add app/src/app/\(auth\)/impostos/GateInicialSerpro.tsx
git commit -m "feat(impostos): componente GateInicialSerpro"
```

---

## Task 4: Fiação em `page.tsx`

**Files:**
- Modify: `app/src/app/(auth)/impostos/page.tsx`

Três mudanças:
1. Importar `GateInicialSerpro`
2. Adicionar `sincronizacao_inicial_serpro_at` ao select de `empresas_fiscais`
3. Renderizar o gate quando `isSimples && !fiscal.sincronizacao_inicial_serpro_at`

- [ ] **Step 1: Add import**

No topo de `page.tsx`, após a linha que importa `DeclaracoesMeiSection`:

```ts
import GateInicialSerpro from './GateInicialSerpro';
```

- [ ] **Step 2: Expand the `empresas_fiscais` select**

Localize (linha ~55):
```ts
    supabase.from('empresas_fiscais')
      .select('Code_regime_tributario, anexo_simples')
      .eq('empresa_id', companyId).is('deleted_at', null).maybeSingle(),
```

Substitua por:
```ts
    supabase.from('empresas_fiscais')
      .select('Code_regime_tributario, anexo_simples, sincronizacao_inicial_serpro_at')
      .eq('empresa_id', companyId).is('deleted_at', null).maybeSingle(),
```

- [ ] **Step 3: Derive the gate condition**

Localize (após a linha que define `isSimples`, ~linha 98):
```ts
  const isSimples = tipoFromCode((fiscal?.Code_regime_tributario ?? '') as string) === 'simples';
```

Adicione imediatamente abaixo:
```ts
  const mostrarGate = isSimples && !(fiscal?.sincronizacao_inicial_serpro_at);
```

- [ ] **Step 4: Render the gate**

Dentro do bloco `{fiscal && (...)}`, substitua todo o conteúdo atual (que hoje começa com `<section className="mb-8">` e vai até o final do bloco `</>`) por:

```tsx
      {fiscal && (
        <>
          {mostrarGate ? (
            <GateInicialSerpro />
          ) : (
            <>
              <section className="mb-8">
                <h2 className="text-xs uppercase tracking-wide text-muted-foreground mb-3">Competência atual</h2>
                <CompetenciaAtualCard
                  apuracao={apuracaoAtual ? toApuracaoRow(apuracaoAtual) : null}
                  guia={guiaAtual ? toGuiaRow(guiaAtual) : null}
                  competencia={competenciaAtual}
                  isMei={isMei}
                  isSimples={isSimples}
                />
              </section>

              {isSimples && (
                <section className="mb-8">
                  <h2 className="text-xs uppercase tracking-wide text-muted-foreground mb-3">Declarações (PGDAS-D)</h2>
                  <DeclaracoesSection declaracoes={declaracoesRows} />
                </section>
              )}
              {isMei && (
                <section className="mb-8">
                  <h2 className="text-xs uppercase tracking-wide text-muted-foreground mb-3">Declarações</h2>
                  <DeclaracoesMeiSection
                    declaracoes={declaracoesRows.filter((d) => d.tipo === 'DASN-SIMEI')}
                    anoCalendario={Number(competenciaAtual.slice(0, 4)) - 1}
                  />
                </section>
              )}

              <section>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Histórico de guias</h2>
                  {isSimples && <ConsultarSerproButton />}
                </div>
                <HistoricoGuias initial={historico} isSimples={isSimples} />
              </section>
            </>
          )}
        </>
      )}
```

- [ ] **Step 5: Type-check**

```bash
cd app && npx tsc --noEmit 2>&1 | head -30
```

Expected: sem erros.

- [ ] **Step 6: Start dev server and test manually**

```bash
cd app && npm run dev
```

Cenário A — empresa Simples que nunca sincronizou (`sincronizacao_inicial_serpro_at = NULL`):
1. Acesse `/impostos`
2. Expected: exibe somente o card GateInicialSerpro (sem seções de competência/declarações/histórico)
3. Clique "Atualizar"
4. Expected: botão mostra spinner + texto "Sincronizando…" durante a chamada
5. Expected: após sucesso → página recarrega mostrando as seções normais com dados da SERPRO

Cenário B — empresa Simples que já sincronizou (`sincronizacao_inicial_serpro_at NOT NULL`):
- Expected: página normal (como estava antes dessa feature)

Cenário C — empresa MEI:
- Expected: página normal inalterada (gate não aparece para MEI)

Para testar o Cenário A sem empresa real: execute no SQL do Supabase:
```sql
UPDATE empresas_fiscais SET sincronizacao_inicial_serpro_at = NULL WHERE empresa_id = '<seu-company-id>';
```

- [ ] **Step 7: Commit**

```bash
git add app/src/app/\(auth\)/impostos/page.tsx
git commit -m "feat(impostos): gate inicial SERPRO — exibe card de sync p/ Simples sem histórico"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** Migration (Task 1) ✓ · `marcarSincronizacaoInicialAction` (Task 2) ✓ · `GateInicialSerpro` component (Task 3) ✓ · `page.tsx` branch (Task 4) ✓
- [x] **Placeholders:** Nenhum "TBD" ou "TODO" — todos os passos têm código completo
- [x] **Type consistency:** `MarcarSincronizacaoResult` definido em Task 2, importado em Task 3; `mostrarGate` derivado em Task 4 step 3 antes de ser usado em step 4
- [x] **MEI inalterado:** `mostrarGate = isSimples && !fiscal.sincronizacao_inicial_serpro_at` — MEI nunca passa no `isSimples`, portanto nunca vê o gate
- [x] **Toast de warning sem erro bloqueante:** `marcarSincronizacaoInicialAction` falhar não impede `router.refresh()` — dados já foram salvos
