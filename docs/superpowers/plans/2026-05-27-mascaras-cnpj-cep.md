# Máscaras de CNPJ/CEP + ViaCEP na edição — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar máscara visual de CNPJ e CEP nos forms de cadastro e edição de empresa, e o botão "Buscar" (ViaCEP) também na edição, persistindo só dígitos.

**Architecture:** Formatadores puros novos (`src/lib/format/masks.ts`: `formatCnpj`/`formatCep`) consumidos pelos dois forms client. Sem biblioteca de máscara. O estado dos campos editáveis guarda a string mascarada; no submit, CNPJ e CEP são reduzidos a dígitos antes do `safeParse` (CNPJ do cadastro já normaliza). Na edição o CNPJ é read-only e só o display é formatado. Sem migration.

**Tech Stack:** Next.js 15 (client components), React, Zod, Vitest. ViaCEP via `lookupCepAction` (já existe).

**Spec:** `docs/superpowers/specs/2026-05-27-mascaras-cnpj-cep-design.md`

---

### Task 1: Formatadores puros `masks.ts` (TDD)

**Files:**
- Create: `balu-next/src/lib/format/masks.ts`
- Test: `balu-next/src/lib/format/masks.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Criar `balu-next/src/lib/format/masks.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { formatCnpj, formatCep } from './masks';

describe('formatCnpj', () => {
  it('formata CNPJ completo', () => {
    expect(formatCnpj('11222333000181')).toBe('11.222.333/0001-81');
  });
  it('formata parcial progressivamente', () => {
    expect(formatCnpj('11')).toBe('11');
    expect(formatCnpj('112')).toBe('11.2');
    expect(formatCnpj('11222333')).toBe('11.222.333');
    expect(formatCnpj('112223330001')).toBe('11.222.333/0001');
  });
  it('trunca acima de 14 dígitos', () => {
    expect(formatCnpj('112223330001819999')).toBe('11.222.333/0001-81');
  });
  it('limpa símbolos e é idempotente', () => {
    expect(formatCnpj('11.222.333/0001-81')).toBe('11.222.333/0001-81');
    expect(formatCnpj('abc11def222')).toBe('11.222');
  });
});

describe('formatCep', () => {
  it('formata CEP completo', () => {
    expect(formatCep('80010000')).toBe('80010-000');
  });
  it('formata parcial', () => {
    expect(formatCep('800')).toBe('800');
    expect(formatCep('80010')).toBe('80010');
    expect(formatCep('800100')).toBe('80010-0');
  });
  it('trunca acima de 8 dígitos e é idempotente', () => {
    expect(formatCep('800100009999')).toBe('80010-000');
    expect(formatCep('80010-000')).toBe('80010-000');
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `cd balu-next && npx vitest run src/lib/format/masks.test.ts`
Expected: FAIL — `Failed to resolve import "./masks"` (módulo ainda não existe).

- [ ] **Step 3: Implementar `masks.ts`**

Criar `balu-next/src/lib/format/masks.ts`:
```ts
// @custom — formatadores de máscara para inputs (CNPJ/CEP). Puros, sem deps.
// O valor cru (dígitos) é o que persiste; estas funções só formatam para exibição.

/** "11222333000181" → "11.222.333/0001-81". Tolera entrada parcial ou já mascarada. */
export function formatCnpj(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 14);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/** "80010000" → "80010-000". Tolera entrada parcial ou já mascarada. */
export function formatCep(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `cd balu-next && npx vitest run src/lib/format/masks.test.ts`
Expected: PASS (2 describes, todos os casos verdes).

- [ ] **Step 5: Commit**

```bash
git add balu-next/src/lib/format/masks.ts balu-next/src/lib/format/masks.test.ts
git commit -m "feat(format): formatadores puros de máscara CNPJ/CEP (formatCnpj/formatCep)"
```

---

### Task 2: Máscara no cadastro (`CreateCompanyDialog`)

**Files:**
- Modify: `balu-next/src/components/CreateCompanyDialog.tsx`

- [ ] **Step 1: Importar os formatadores**

Logo após o import de `createCompanyAction` (linhas 10-13), adicionar:
```tsx
import { formatCnpj, formatCep } from '@/lib/format/masks';
```

- [ ] **Step 2: Aplicar máscara no input de CNPJ**

Trocar (linhas ~142-150):
```tsx
          <input
            type="text"
            inputMode="numeric"
            placeholder="00.000.000/0000-00"
            value={form.cnpj}
            onChange={(e) => set('cnpj', e.target.value)}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
            required
          />
```
por:
```tsx
          <input
            type="text"
            inputMode="numeric"
            placeholder="00.000.000/0000-00"
            value={form.cnpj}
            onChange={(e) => set('cnpj', formatCnpj(e.target.value))}
            maxLength={18}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
            required
          />
```

- [ ] **Step 3: Aplicar máscara no input de CEP**

Trocar (linhas ~157-164):
```tsx
            <input
              type="text"
              inputMode="numeric"
              placeholder="00000-000"
              value={form.cep ?? ''}
              onChange={(e) => set('cep', e.target.value)}
              className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm"
            />
```
por:
```tsx
            <input
              type="text"
              inputMode="numeric"
              placeholder="00000-000"
              value={form.cep ?? ''}
              onChange={(e) => set('cep', formatCep(e.target.value))}
              maxLength={9}
              className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm"
            />
```

- [ ] **Step 4: Normalizar CEP para dígitos no submit**

Trocar (linhas ~85-90):
```tsx
    const parsed = CompanyCreateSchema.safeParse({
      ...form,
      cnpj: form.cnpj.replace(/\D+/g, '').padStart(14, '0').slice(-14),
      email: form.email || undefined,
      uf: form.uf ? form.uf.toUpperCase() : undefined,
    });
```
por:
```tsx
    const parsed = CompanyCreateSchema.safeParse({
      ...form,
      cnpj: form.cnpj.replace(/\D+/g, '').padStart(14, '0').slice(-14),
      cep: form.cep ? form.cep.replace(/\D+/g, '') : undefined,
      email: form.email || undefined,
      uf: form.uf ? form.uf.toUpperCase() : undefined,
    });
```

- [ ] **Step 5: `tsc`**

Run: `cd balu-next && npx tsc --noEmit`
Expected: zero erros.

- [ ] **Step 6: Commit**

```bash
git add balu-next/src/components/CreateCompanyDialog.tsx
git commit -m "feat(cadastro): máscara de CNPJ/CEP no CreateCompanyDialog; CEP grava só dígitos"
```

---

### Task 3: Máscara + ViaCEP na edição (`DadosEmpresaForm`)

**Files:**
- Modify: `balu-next/src/app/(auth)/configuracoes/DadosEmpresaForm.tsx`

- [ ] **Step 1: Atualizar imports (ícone MapPin, formatadores, lookupCepAction)**

Trocar (linhas 6-10):
```tsx
import { useState } from 'react';
import { Loader2, Save, Pencil } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { CompanySchema, type CompanyInput } from '@/types/zod';
import { updateCompanyAction } from './actions';
```
por:
```tsx
import { useState } from 'react';
import { Loader2, Save, Pencil, MapPin } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { CompanySchema, type CompanyInput } from '@/types/zod';
import { formatCnpj, formatCep } from '@/lib/format/masks';
import { lookupCepAction } from '@/app/(auth)/onboarding/actions';
import { updateCompanyAction } from './actions';
```

- [ ] **Step 2: Adicionar state `busyCep`**

Trocar (linhas ~18-21):
```tsx
  const toast = useToast();
  const [form, setForm] = useState<Partial<CompanyInput>>(initial);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
```
por:
```tsx
  const toast = useToast();
  const [form, setForm] = useState<Partial<CompanyInput>>(initial);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyCep, setBusyCep] = useState(false);
```

- [ ] **Step 3: Adicionar a função `handleLookupCep`**

Logo após `handleCancel` (depois da linha ~32, antes de `handleSubmit`), inserir:
```tsx
  async function handleLookupCep() {
    const digits = (form.cep ?? '').replace(/\D+/g, '');
    if (digits.length !== 8) {
      toast('warning', 'Informe um CEP com 8 dígitos.');
      return;
    }
    setBusyCep(true);
    try {
      const r = await lookupCepAction(digits);
      if (!r.ok) { toast('error', r.error); return; }
      setForm((prev) => ({
        ...prev,
        logradouro: r.data.logradouro ?? prev.logradouro,
        bairro: r.data.bairro ?? prev.bairro,
        municipio: r.data.municipio ?? prev.municipio,
        uf: r.data.uf ?? prev.uf,
      }));
      toast('success', 'Endereço preenchido.');
    } finally {
      setBusyCep(false);
    }
  }
```

- [ ] **Step 4: Normalizar CEP para dígitos no submit**

Trocar (linhas ~37-41):
```tsx
    const parsed = CompanySchema.safeParse({
      ...form,
      email: form.email || undefined,
      uf: form.uf ? form.uf.toUpperCase() : undefined,
    });
```
por:
```tsx
    const parsed = CompanySchema.safeParse({
      ...form,
      cep: form.cep ? form.cep.replace(/\D+/g, '') : undefined,
      email: form.email || undefined,
      uf: form.uf ? form.uf.toUpperCase() : undefined,
    });
```

- [ ] **Step 5: Formatar o CNPJ read-only**

Trocar (linha ~61):
```tsx
      <Field label="CNPJ" value={form.cnpj ?? ''} onChange={(v) => set('cnpj', v)} disabled />
```
por:
```tsx
      <Field label="CNPJ" value={formatCnpj(form.cnpj ?? '')} onChange={(v) => set('cnpj', v)} disabled />
```

- [ ] **Step 6: Substituir o campo CEP por input mascarado + botão "Buscar"**

Trocar (linha ~65):
```tsx
      <Field label="CEP" value={form.cep ?? ''} onChange={(v) => set('cep', v)} disabled={locked} />
```
por:
```tsx
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs font-medium text-zinc-600">CEP</span>
        <div className="flex gap-2">
          <input
            type="text"
            inputMode="numeric"
            value={formatCep(form.cep ?? '')}
            onChange={(e) => set('cep', formatCep(e.target.value))}
            disabled={locked}
            maxLength={9}
            className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm disabled:bg-zinc-50 disabled:text-zinc-500"
          />
          <button
            type="button"
            onClick={handleLookupCep}
            disabled={locked || busyCep}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            {busyCep ? <Loader2 className="size-4 animate-spin" /> : <MapPin className="size-4" />}
            Buscar
          </button>
        </div>
      </label>
```

- [ ] **Step 7: `tsc` + `vitest`**

Run: `cd balu-next && npx tsc --noEmit && npx vitest run`
Expected: tsc zero erros; vitest verde (suíte total + os novos testes de `masks.test.ts`).

- [ ] **Step 8: Commit**

```bash
git add "balu-next/src/app/(auth)/configuracoes/DadosEmpresaForm.tsx"
git commit -m "feat(edição): máscara de CNPJ/CEP + botão Buscar (ViaCEP) no DadosEmpresaForm"
```

---

## Verificação final (controlador, ao vivo)

Dev server em `:3000`, empresa de teste Curitiba (`db2b742d-dcd6-4322-b91e-7a776fd921f9`).

1. **Edição** (`/configuracoes?tab=dados`): CNPJ aparece formatado `11.222.333/0001-81` (read-only). Clicar **Editar** → digitar um CEP (ex.: `80010000`) e ver virar `80010-000`; clicar **Buscar** → logradouro/bairro/município/UF preenchem; **Salvar** → toast de sucesso.
2. **Query pós-save**: confirmar que `companies.cep` ficou com **8 dígitos sem símbolos** (ex.: `80010000`) e `companies.cnpj` segue `11222333000181`.
3. **Cadastro** (verificação visual da máscara): abrir "Nova empresa" e digitar CNPJ/CEP — máscaras aparecem progressivamente. (Não é preciso criar empresa nova; o objetivo é confirmar a máscara e o ViaCEP, já cobertos pela action existente.)

> Nota: o submit reduz CNPJ/CEP a dígitos antes do `safeParse`; a máscara nunca chega ao banco.
