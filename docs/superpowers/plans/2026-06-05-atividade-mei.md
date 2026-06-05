# `atividade_mei` — DAS-MEI com valor certo na estimativa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Capturar a atividade do MEI e usá-la na estimativa de DAS-MEI (apuração + prévia da NFS-e), em vez de cravar sempre R$ 80,90.

**Architecture:** Nova coluna `empresas_fiscais.atividade_mei`, capturada num select que só aparece p/ MEI no `RegimeTributarioForm`, lida por `iniciarApuracaoAction` e `obterPreviewImposto` e repassada ao `calcularApuracao`/`montarPreview` (que já aceitam `atividadeMei`). O SERPRO (DAS real) não muda.

**Tech Stack:** Next.js App Router, Supabase, TypeScript, Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-05-atividade-mei-design.md`

---

### Task 1: Domínio + dados (`atividade_mei`)

**Files:**
- Create: `app/supabase/migrations/0023_empresas_fiscais_atividade_mei.sql`
- Modify: `app/src/types/database.ts`, `app/src/types/zod.ts`, `app/src/lib/fiscal/regime.ts`
- Test: `app/src/lib/fiscal/regime.test.ts`

- [ ] **Step 1: Migration**

Create `app/supabase/migrations/0023_empresas_fiscais_atividade_mei.sql`:

```sql
-- @custom — P0.4: atividade do MEI (Comércio/Indústria, Serviços, ambos) para a estimativa
-- de DAS-MEI (valorDasMei). Aditiva e idempotente. Aplicada manualmente (db_atual.sql é a verdade).
-- Valores esperados (contrato com das-mei.ts): 'Comercio ou Industria' | 'Prestacao de Servicos'
-- | 'Comercio e Servicos'. NULL = não informado → estimativa cai em Serviços (default).
ALTER TABLE public.empresas_fiscais ADD COLUMN IF NOT EXISTS atividade_mei TEXT;
COMMENT ON COLUMN public.empresas_fiscais.atividade_mei IS 'Atividade do MEI p/ estimativa de DAS-MEI. NULL → Serviços (default).';
```

- [ ] **Step 2: Tipo em `database.ts`**

Em `app/src/types/database.ts`, no tipo de `empresas_fiscais`, adicionar `atividade_mei: string | null;` nas três seções (Row, Insert opcional `atividade_mei?: string | null;`, Update opcional `atividade_mei?: string | null;`). Primeiro READ o trecho de `empresas_fiscais` para encaixar com a indentação/estilo das outras colunas (ex.: ao lado de `cnae_principal`).

- [ ] **Step 3: Domínio em `regime.ts` — adicionar tipo + opções**

Em `app/src/lib/fiscal/regime.ts`, logo após `FAIXA_OPTIONS` (linha ~21), adicionar:

```ts
export type AtividadeMei = 'Comercio ou Industria' | 'Prestacao de Servicos' | 'Comercio e Servicos';

// value bate EXATAMENTE com as chaves de DAS_MEI_2026 (das-mei.ts) — é o contrato da estimativa.
export const ATIVIDADE_MEI_OPTIONS: ReadonlyArray<{ value: AtividadeMei; label: string }> = [
  { value: 'Comercio ou Industria', label: 'Comércio ou Indústria' },
  { value: 'Prestacao de Servicos', label: 'Prestação de Serviços' },
  { value: 'Comercio e Servicos', label: 'Comércio e Serviços' },
];
```

- [ ] **Step 4: `RegimePatch` + `normalizeRegimePatch` ganham `atividade_mei`**

No type `RegimePatch` (linha ~43), adicionar o campo:

```ts
  cnae_principal?: string | null;
  atividade_mei?: string | null;
```

Em `normalizeRegimePatch`, dentro do bloco `if (out.Code_regime_tributario === '4') { ... }` NÃO mexer; mas garantir que p/ não-MEI a atividade é nula. Substituir o bloco de normalização por:

```ts
  if (out.Code_regime_tributario === '4') {
    out.anexo_simples = null;
    out.usa_fator_r = false;
  } else {
    if (out.anexo_simples != null && !fatorRAplicavel(out.anexo_simples)) {
      out.usa_fator_r = false;
    }
    // Atividade do MEI só faz sentido p/ MEI; fora dele, zera.
    if (out.Code_regime_tributario != null) out.atividade_mei = null;
  }
```

> Nota: só zera `atividade_mei` quando há um Code definido e ele não é '4' — preserva o comportamento de "patch parcial sem Code não fabrica campos".

- [ ] **Step 5: Teste em `regime.test.ts`**

Adicionar ao `app/src/lib/fiscal/regime.test.ts` (dentro do describe de `normalizeRegimePatch`, ou criar um novo bloco):

```ts
import { normalizeRegimePatch } from './regime'; // já importado no arquivo — não duplicar

describe('normalizeRegimePatch — atividade_mei', () => {
  it('mantém atividade_mei quando MEI (code 4)', () => {
    const out = normalizeRegimePatch({ Code_regime_tributario: '4', atividade_mei: 'Comercio ou Industria' });
    expect(out.atividade_mei).toBe('Comercio ou Industria');
  });

  it('zera atividade_mei quando não-MEI (code definido)', () => {
    const out = normalizeRegimePatch({ Code_regime_tributario: '1', atividade_mei: 'Comercio ou Industria' });
    expect(out.atividade_mei).toBeNull();
  });

  it('não fabrica atividade_mei em patch sem Code', () => {
    const out = normalizeRegimePatch({ atividade_mei: 'Prestacao de Servicos' });
    expect(out.atividade_mei).toBe('Prestacao de Servicos');
  });
});
```

(Se o arquivo já importa `normalizeRegimePatch` e `describe/it/expect`, não duplicar imports — só adicionar o bloco `describe`.)

- [ ] **Step 6: `EmpresaFiscalSchema` (zod)**

Em `app/src/types/zod.ts`, no `EmpresaFiscalSchema` (após `cnae_principal`, linha ~89), adicionar:

```ts
  atividade_mei: z.enum(['Comercio ou Industria', 'Prestacao de Servicos', 'Comercio e Servicos']).nullable().optional(),
```

- [ ] **Step 7: Rodar testes + tsc**

Run: `cd app && npx vitest run src/lib/fiscal/regime.test.ts && npx tsc --noEmit`
Expected: testes do regime passam; tsc sem erros novos.

- [ ] **Step 8: Commit**

```bash
git add app/supabase/migrations/0023_empresas_fiscais_atividade_mei.sql app/src/types/database.ts app/src/types/zod.ts app/src/lib/fiscal/regime.ts app/src/lib/fiscal/regime.test.ts
git commit -m "feat(fiscal): coluna/domínio atividade_mei (estimativa DAS-MEI)"
```

> **NOTA AO EXECUTOR:** migration aplicada manualmente pelo usuário — não rodar db push.

---

### Task 2: Select "Atividade do MEI" no `RegimeTributarioForm`

**Files:**
- Modify: `app/src/app/(auth)/configuracoes/RegimeTributarioForm.tsx`

- [ ] **Step 1: Importar as opções e estender `Initial`**

No import de `@/lib/fiscal/regime`, adicionar `ATIVIDADE_MEI_OPTIONS`:

```ts
import {
  REGIME_OPTIONS, FAIXA_OPTIONS, ATIVIDADE_MEI_OPTIONS,
  isMei, anexoFromFaixa, faixaFromAnexo, fatorRAplicavel, type RegimeCode,
} from '@/lib/fiscal/regime';
```

No type `Initial`, adicionar:

```ts
  cnae_principal?: string | null;
  atividade_mei?: string | null;
```

- [ ] **Step 2: Estado + reset**

Após `const [cnae, setCnae] = useState<string>(initial?.cnae_principal ?? '');`, adicionar:

```ts
  const [atividadeMei, setAtividadeMei] = useState<string>(initial?.atividade_mei ?? '');
```

Em `resetFromInitial`, adicionar:

```ts
    setAtividadeMei(initial?.atividade_mei ?? '');
```

- [ ] **Step 3: Incluir no payload do `handleSubmit`**

No objeto passado a `upsertEmpresaFiscalAction`, adicionar:

```ts
        cnae_principal: cnae.trim() || null,
        atividade_mei: mei ? (atividadeMei || null) : null,
```

- [ ] **Step 4: Render do select (só p/ MEI)**

Logo após o bloco `{!mei && ( ... faixa ... )}` (e antes do bloco `{mostraFatorR && ...}`), inserir:

```tsx
      {mei && (
        <label className="col-span-2 flex flex-col gap-1 text-sm">
          <span className="text-xs font-medium text-muted-foreground-2">Atividade do MEI</span>
          <select
            value={atividadeMei}
            onChange={(e) => setAtividadeMei(e.target.value)}
            disabled={locked}
            className="rounded-md border border-border bg-surface-2 text-foreground px-3 py-2 text-sm disabled:bg-surface-2 disabled:text-muted-foreground"
          >
            <option value="">Selecione…</option>
            {ATIVIDADE_MEI_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground">Define o valor estimado do DAS-MEI (ICMS e/ou ISS).</span>
        </label>
      )}
```

- [ ] **Step 5: tsc + lint**

Run: `cd app && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add "app/src/app/(auth)/configuracoes/RegimeTributarioForm.tsx"
git commit -m "feat(configuracoes): select Atividade do MEI (regime)"
```

---

### Task 3: Usar `atividade_mei` na estimativa (apuração + prévia)

**Files:**
- Modify: `app/src/app/(auth)/impostos/actions.ts`
- Modify: `app/src/lib/fiscal/preview-imposto.ts`

- [ ] **Step 1: `iniciarApuracaoAction` — ler e passar a atividade**

Em `app/src/app/(auth)/impostos/actions.ts`, no `iniciarApuracaoAction`, alterar o select de `empresas_fiscais` para incluir `atividade_mei`:

```ts
  const { data: fiscal } = await supabase
    .from('empresas_fiscais')
    .select('Code_regime_tributario, anexo_simples, atividade_mei')
    .eq('empresa_id', companyId)
    .is('deleted_at', null)
    .maybeSingle();
```

E na chamada de `calcularApuracao`, trocar a linha do TODO:

```ts
      atividadeMei: (fiscal.atividade_mei ?? null) as string | null,
```

(remover o comentário TODO antigo dessa linha.)

- [ ] **Step 2: `obterPreviewImposto` — ler e passar a atividade**

Em `app/src/lib/fiscal/preview-imposto.ts`, alterar o select e a chamada:

```ts
  const { data: fiscal } = await supabase
    .from('empresas_fiscais')
    .select('Code_regime_tributario, anexo_simples, atividade_mei')
    .eq('empresa_id', companyId)
    .is('deleted_at', null)
    .maybeSingle();
```

e

```ts
  return montarPreview({
    regimeCode: fiscal.Code_regime_tributario as string,
    anexo: (fiscal.anexo_simples as AnexoSimples | null) ?? null,
    receitas,
    competencia,
    atividadeMei: (fiscal.atividade_mei as string | null) ?? null,
  });
```

- [ ] **Step 3: tsc + testes do preview/apuração (se houver)**

Run: `cd app && npx tsc --noEmit && npx vitest run src/lib/fiscal/preview-imposto 2>&1 | tail -15`
Expected: tsc limpo; testes existentes (se houver) passam.

- [ ] **Step 4: Commit**

```bash
git add "app/src/app/(auth)/impostos/actions.ts" app/src/lib/fiscal/preview-imposto.ts
git commit -m "feat(impostos): estimativa DAS-MEI usa atividade_mei (apuração + prévia)"
```

---

## Self-Review

- **Spec coverage:** migration+tipo+zod+domínio (T1) ✓; select MEI no form (T2) ✓; wiring apuração+prévia (T3) ✓.
- **Type consistency:** `ATIVIDADE_MEI_OPTIONS[].value` (regime.ts) = chaves de `DAS_MEI_2026` (das-mei.ts) = enum do zod = valores passados pelo form. `atividade_mei` string em database.ts/zod/Initial/RegimePatch consistentes. `calcularApuracao`/`montarPreview` já têm o param `atividadeMei?: string | null` (sem mudança de contrato).
- **Placeholders:** nenhum — todo passo tem código real. T1/Step 2 e T3 pedem leitura do trecho real p/ encaixe, mas os snippets são completos.
