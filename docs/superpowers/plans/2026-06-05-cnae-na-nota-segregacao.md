# CNAE na nota + apuração segregada — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Capturar o CNAE/atividade em cada NFS-e e fazer a apuração segregar a receita por anexo (Fator R da empresa decide III/V).

**Architecture:** Coluna `notas_fiscais.cnae` capturada num dropdown (de `company_cnaes`) na emissão. A apuração resolve o anexo de cada nota (impuro, `segregacao.ts`) e o núcleo puro `calcularApuracao` agrupa a receita do mês por anexo, somando as fatias. Param `anexo` vira fallback → atividade única idêntica ao de hoje.

**Tech Stack:** Next.js App Router, Supabase, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-05-cnae-na-nota-segregacao-design.md`

---

## FASE 1 — Capturar o CNAE na nota

### Task 1: Migração `notas_fiscais.cnae` + tipo

**Files:**
- Create: `app/supabase/migrations/0024_notas_fiscais_cnae.sql`
- Modify: `app/src/types/database.ts`

- [ ] **Step 1: Migration**

Create `app/supabase/migrations/0024_notas_fiscais_cnae.sql`:

```sql
-- @custom — CNAE/atividade por nota (segregação de receita por anexo no Simples).
-- Ver docs/superpowers/specs/2026-06-05-cnae-na-nota-segregacao-design.md.
-- Aditiva e idempotente. Aplicada manualmente. NULL = sem tag → apuração usa o anexo do principal.
ALTER TABLE public.notas_fiscais ADD COLUMN IF NOT EXISTS cnae TEXT;
COMMENT ON COLUMN public.notas_fiscais.cnae IS 'CNAE (7 dígitos) da atividade da nota; resolve o anexo na apuração. NULL → fallback no principal.';
```

- [ ] **Step 2: Tipo em `database.ts`**

READ o bloco de `notas_fiscais` em `app/src/types/database.ts` e adicionar `cnae: string | null;` no Row, `cnae?: string | null;` no Insert e no Update, no estilo das colunas vizinhas (ex.: perto de `cliente_id`).

- [ ] **Step 3: tsc**

Run: `cd app && npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 4: Commit**

```bash
git add app/supabase/migrations/0024_notas_fiscais_cnae.sql app/src/types/database.ts
git commit -m "feat(notas): coluna notas_fiscais.cnae (segregação por anexo)"
```

> **NOTA AO EXECUTOR:** migration aplicada manualmente pelo usuário — não rodar db push.

---

### Task 2: Dropdown de CNAE na emissão de NFS-e

**Files:**
- Modify: `app/src/app/(auth)/notas_fiscais/actions.ts`
- Modify: `app/src/app/(auth)/notas_fiscais/emissao/EmissaoForm.tsx`
- Modify: `app/src/app/(auth)/notas_fiscais/emissao/nfse/page.tsx`

- [ ] **Step 1: `listarCnaesEmpresaAction` + `cnae` no input/insert**

Em `app/src/app/(auth)/notas_fiscais/actions.ts`:

(a) Adicionar `cnae?: string | null;` ao type `EmitirNotaInput` (após `aliquotaIssPercentual`).

(b) No insert de `emitirNotaAction` (o `.from('notas_fiscais').insert({...})` do `tipo_documento: 'NFSe'`), adicionar após `cliente_id: cliente.id,`:
```ts
      cnae: input.cnae ? String(input.cnae).replace(/\D+/g, '') || null : null,
```

(c) No `emitirNotaFormAction`, adicionar ao objeto `input`:
```ts
    cnae: String(formData.get('cnae') ?? '') || null,
```

(d) Adicionar a nova action ao final do arquivo:
```ts
export type CnaeOption = { codigo: string; descricao: string | null; anexoLabel: string | null };

/** CNAEs da empresa ativa (principal + secundários) com o rótulo do anexo, p/ o select da emissão. */
export async function listarCnaesEmpresaAction(): Promise<CnaeOption[]> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data: profile } = await supabase
    .from('profiles').select('current_company').eq('user_id', user.id).single();
  const companyId = (profile?.current_company ?? null) as string | null;
  if (!companyId) return [];

  const { data: cnaes } = await supabase
    .from('company_cnaes')
    .select('codigo, descricao, tipo')
    .eq('company_id', companyId).is('deleted_at', null)
    .order('tipo', { ascending: true }); // 'principal' antes de 'secundario'
  if (!cnaes || cnaes.length === 0) return [];

  const codigos = cnaes.map((c) => c.codigo as string);
  const { data: refs } = await supabase
    .from('cnae_anexo').select('codigo, anexo_base, fator_r').in('codigo', codigos);
  const refMap = new Map<string, { anexo_base: string | null; fator_r: boolean }>();
  for (const r of refs ?? []) {
    refMap.set(r.codigo as string, { anexo_base: (r.anexo_base as string | null) ?? null, fator_r: r.fator_r === true });
  }

  return cnaes.map((c) => {
    const ref = refMap.get(c.codigo as string);
    const anexoLabel = ref ? (ref.fator_r ? 'Anexo III/V — Fator R' : ref.anexo_base) : null;
    return { codigo: c.codigo as string, descricao: (c.descricao as string | null) ?? null, anexoLabel };
  });
}
```

- [ ] **Step 2: Passar os CNAEs no `nfse/page.tsx`**

Em `app/src/app/(auth)/notas_fiscais/emissao/nfse/page.tsx`:

(a) No import das actions, importar `listarCnaesEmpresaAction` (o arquivo já não importa de `../actions`; adicionar):
```ts
import { listarCnaesEmpresaAction } from '../../actions';
```

(b) Carregar os CNAEs junto do preview (após o `obterPreviewImposto`):
```ts
  const cnaes = await listarCnaesEmpresaAction();
```

(c) Passar ao `EmissaoForm`:
```tsx
      <EmissaoForm
        clientes={(clientes ?? []).map((c) => ({
          id: c.id as string,
          razao_social: (c.razao_social as string | null) ?? '—',
          document: (c.document as string | null) ?? '',
          person_type: (c.person_type as string | null) ?? 'PJ',
        }))}
        previewImposto={previewImposto}
        cnaes={cnaes}
      />
```

- [ ] **Step 3: Select no `EmissaoForm.tsx`**

Em `app/src/app/(auth)/notas_fiscais/emissao/EmissaoForm.tsx`:

(a) Importar o tipo:
```ts
import { emitirNotaFormAction, type CnaeOption } from '../actions';
```
(substitui o import atual `import { emitirNotaFormAction } from '../actions';`).

(b) Estender as props e adicionar estado:
```tsx
export default function EmissaoForm({
  clientes,
  previewImposto,
  cnaes,
}: {
  clientes: ClienteOption[];
  previewImposto: PreviewImposto;
  cnaes: CnaeOption[];
}) {
  const [clienteId, setClienteId] = useState<string>('');
  const [cnae, setCnae] = useState<string>(cnaes.length === 1 ? cnaes[0]!.codigo : '');
```
(mantém os demais `useState` como estão.)

(c) Validação no `handleSubmit` — logo no início, antes do `Schema.safeParse`:
```ts
    if (cnaes.length > 1 && !cnae) {
      e.preventDefault();
      setClientErr('Selecione a atividade (CNAE) da nota.');
      return;
    }
```

(d) Render do bloco — inserir logo APÓS o `<div>` do "Código de tributação" e antes do de "Descrição":
```tsx
      {cnaes.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-muted-foreground-2 mb-1">Atividade (CNAE)</label>
          {cnaes.length === 1 ? (
            <div className="w-full rounded-lg border border-border bg-surface-2 text-foreground px-3 py-2 text-sm">
              {cnaes[0]!.codigo}{cnaes[0]!.descricao ? ` · ${cnaes[0]!.descricao}` : ''}
              {cnaes[0]!.anexoLabel ? ` (${cnaes[0]!.anexoLabel})` : ''}
            </div>
          ) : (
            <select
              value={cnae}
              onChange={(e) => setCnae(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface-2 text-foreground px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">Selecione…</option>
              {cnaes.map((c) => (
                <option key={c.codigo} value={c.codigo}>
                  {c.codigo}{c.descricao ? ` · ${c.descricao}` : ''}{c.anexoLabel ? ` (${c.anexoLabel})` : ''}
                </option>
              ))}
            </select>
          )}
          <input type="hidden" name="cnae" value={cnae} />
        </div>
      )}
```

- [ ] **Step 4: tsc + lint**

Run: `cd app && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add "app/src/app/(auth)/notas_fiscais/actions.ts" "app/src/app/(auth)/notas_fiscais/emissao/EmissaoForm.tsx" "app/src/app/(auth)/notas_fiscais/emissao/nfse/page.tsx"
git commit -m "feat(emissao): dropdown de CNAE/atividade na NFS-e"
```

---

## FASE 2 — Apuração segregada por anexo

### Task 3: `ReceitaApuracao.anexo` + `calcularApuracao` segregado (TDD)

**Files:**
- Modify: `app/src/lib/fiscal/apuracao-types.ts`
- Modify: `app/src/lib/fiscal/apuracao.ts`
- Test: `app/src/lib/fiscal/apuracao.test.ts`

- [ ] **Step 1: Estender `ReceitaApuracao`**

Em `app/src/lib/fiscal/apuracao-types.ts`, no type `ReceitaApuracao`, adicionar os campos opcionais (precisa importar `AnexoSimples`):

```ts
import type { AnexoSimples } from './regime';

/** Uma receita já normalizada para apuração. competencia em YYYYMM. */
export type ReceitaApuracao = {
  competencia: string; // "YYYYMM"
  valor: number;       // R$ (receita bruta do documento)
  cnae?: string | null;          // CNAE da nota (rastreio/segregação)
  anexo?: AnexoSimples | null;   // anexo já resolvido da nota (override do fallback)
};
```

- [ ] **Step 2: Teste (falhando) em `apuracao.test.ts`**

READ `app/src/lib/fiscal/apuracao.test.ts` p/ ver os imports/estilo. Adicionar este `describe` (não duplicar imports já presentes — precisa de `calcularApuracao` e `ReceitaApuracao`):

```ts
describe('calcularApuracao — segregação por anexo', () => {
  // rbt12 = 120000 (faixa 1 em todos os anexos): uma receita no mês anterior.
  const prior = { competencia: '202605', valor: 120000 };

  it('atividade única (sem anexo por nota) = comportamento de hoje', () => {
    const r = calcularApuracao({
      regimeCode: '1', anexo: 'Anexo I', competencia: '202606',
      receitas: [prior, { competencia: '202606', valor: 10000 }],
    });
    expect(r.tipoApuracao).toBe('Simples Nacional');
    expect(r.valorImposto).toBeCloseTo(400, 2); // 10000 * 4% (Anexo I faixa 1)
    expect((r.breakdown as { segregado: boolean }).segregado).toBe(false);
  });

  it('dois anexos: soma as fatias com alíquotas distintas', () => {
    const r = calcularApuracao({
      regimeCode: '1', anexo: 'Anexo I', competencia: '202606',
      receitas: [
        prior,
        { competencia: '202606', valor: 10000, anexo: 'Anexo I' },   // 4% → 400
        { competencia: '202606', valor: 5000, anexo: 'Anexo III' },  // 6% → 300
      ],
    });
    expect(r.valorImposto).toBeCloseTo(700, 2);
    const bd = r.breakdown as { segregado: boolean; porAnexo: Array<{ anexo: string; valor: number }> };
    expect(bd.segregado).toBe(true);
    expect(bd.porAnexo).toHaveLength(2);
    expect(bd.porAnexo.find((p) => p.anexo === 'Anexo III')!.valor).toBeCloseTo(300, 2);
  });

  it('nota sem anexo usa o fallback; mistura com nota anexada', () => {
    const r = calcularApuracao({
      regimeCode: '1', anexo: 'Anexo I', competencia: '202606',
      receitas: [
        prior,
        { competencia: '202606', valor: 10000 },                     // fallback Anexo I → 400
        { competencia: '202606', valor: 5000, anexo: 'Anexo III' },  // 6% → 300
      ],
    });
    expect(r.valorImposto).toBeCloseTo(700, 2);
    expect((r.breakdown as { segregado: boolean }).segregado).toBe(true);
  });

  it('receita zero no mês → imposto zero', () => {
    const r = calcularApuracao({
      regimeCode: '1', anexo: 'Anexo I', competencia: '202606',
      receitas: [prior],
    });
    expect(r.valorImposto).toBe(0);
    expect((r.breakdown as { segregado: boolean }).segregado).toBe(false);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `cd app && npx vitest run src/lib/fiscal/apuracao.test.ts`
Expected: FAIL (campo `segregado`/`porAnexo` não existe ainda).

- [ ] **Step 4: Implementar a segregação em `apuracao.ts`**

Substituir o bloco `if (regimeCode === '1' || regimeCode === '2') { ... }` inteiro por:

```ts
  if (regimeCode === '1' || regimeCode === '2') {
    if (!anexo) throw new Error('Anexo do Simples não informado para apuração.');
    const { rbt12, mesesConsiderados, anualizado } = calcularRbt12(
      receitas, competencia, input.dataInicioAtividade,
    );

    // Agrupa a receita da própria competência por anexo (r.anexo ?? fallback `anexo`).
    const doMes = receitas.filter((r) => r.competencia === competencia);
    const buckets = new Map<AnexoSimples, number>();
    for (const r of doMes) {
      const a = (r.anexo ?? anexo) as AnexoSimples;
      buckets.set(a, (buckets.get(a) ?? 0) + r.valor);
    }

    const porAnexo: Array<{ anexo: AnexoSimples; receita: number; aliquotaEfetiva: number; valor: number; faixa: number }> = [];
    let valorImposto = 0;
    for (const [a, receitaBruta] of buckets) {
      const receita = Number(receitaBruta.toFixed(2));
      const faixa = identificarFaixa(rbt12, a, competencia);
      const aliq = aliquotaEfetiva(rbt12, faixa);
      const valor = Number((receita * aliq).toFixed(2));
      valorImposto += valor;
      porAnexo.push({ anexo: a, receita, aliquotaEfetiva: Number(aliq.toFixed(4)), valor, faixa: faixa.faixa });
    }
    valorImposto = Number(valorImposto.toFixed(2));

    // Alíquota "manchete": ponderada quando há receita; senão a marginal do anexo fallback
    // (preserva a prévia útil mesmo com mês ainda sem notas).
    const faixaFallback = identificarFaixa(rbt12, anexo, competencia);
    const aliquotaFallback = aliquotaEfetiva(rbt12, faixaFallback);
    const aliquotaGeral = receitaMes > 0 ? valorImposto / receitaMes : aliquotaFallback;
    const segregado = buckets.size > 1;

    return {
      tipoApuracao: 'Simples Nacional',
      competencia,
      receitaMes,
      rbt12,
      aliquotaEfetiva: Number(aliquotaGeral.toFixed(4)),
      valorImposto,
      breakdown: {
        tipo: 'Simples Nacional', anexo, rbt12, mesesConsiderados, anualizado,
        faixa: faixaFallback.faixa, aliquotaNominal: faixaFallback.nominal, parcelaDeduzir: faixaFallback.deduzir,
        segregado, porAnexo,
        aliquotaEfetiva: Number(aliquotaGeral.toFixed(4)), receitaMes, valorImposto,
      },
    };
  }
```

(Os imports `identificarFaixa`, `aliquotaEfetiva`, `calcularRbt12`, `AnexoSimples` já existem no topo do arquivo.)

- [ ] **Step 5: Rodar e ver passar**

Run: `cd app && npx vitest run src/lib/fiscal/apuracao.test.ts`
Expected: PASS (todos, incluindo os 4 novos).

- [ ] **Step 6: tsc**

Run: `cd app && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/fiscal/apuracao-types.ts app/src/lib/fiscal/apuracao.ts app/src/lib/fiscal/apuracao.test.ts
git commit -m "feat(fiscal): calcularApuracao segrega receita por anexo"
```

---

### Task 4: Resolver anexos das notas + wiring

**Files:**
- Create: `app/src/lib/fiscal/segregacao.ts`
- Modify: `app/src/lib/fiscal/receitas-source.ts`
- Modify: `app/src/app/(auth)/impostos/actions.ts`
- Modify: `app/src/lib/fiscal/preview-imposto.ts`

- [ ] **Step 1: `receitas-source.ts` lê o `cnae`**

Em `app/src/lib/fiscal/receitas-source.ts`, no `.select(...)` adicionar `cnae`:
```ts
    .select('data_emissao, valor_total, status, tipo_documento, cnae')
```
e no `.map(...)` final, incluir o cnae no objeto retornado:
```ts
      return { competencia, valor: Number(n.valor_total), cnae: (n.cnae as string | null) ?? null };
```

- [ ] **Step 2: Criar `segregacao.ts`**

Create `app/src/lib/fiscal/segregacao.ts`:

```ts
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReceitaApuracao } from './apuracao-types';
import type { AnexoSimples } from './regime';
import { calcularRbt12 } from './rbt12';
import { somarFolha12 } from './folha';
import { calcularFatorR } from './fator-r';
import { lerFolhaParaApuracao } from './folha-source';

/**
 * Anota cada receita da competência com o anexo resolvido do seu CNAE, p/ a apuração segregar.
 * - sem cnae / cnae não mapeado → fallbackAnexo;
 * - cnae sujeito a Fator R → III/V da empresa (uma conta só) ou fallback se insuficiente;
 * - senão → anexo_base do catálogo (ou fallback).
 * Fast path: se nenhuma receita do mês tem cnae, devolve inalterado (cálculo usa o fallback).
 * Best-effort: nunca lança; em erro devolve as receitas como vieram.
 */
export async function anexarAnexosDasReceitas(
  supabase: SupabaseClient,
  companyId: string,
  competencia: string,
  receitas: ReceitaApuracao[],
  fallbackAnexo: AnexoSimples | null,
): Promise<ReceitaApuracao[]> {
  try {
    const doMes = receitas.filter((r) => r.competencia === competencia);
    const cnaes = Array.from(new Set(doMes.map((r) => r.cnae).filter((c): c is string => !!c)));
    if (cnaes.length === 0) return receitas;

    const { data: refs } = await supabase
      .from('cnae_anexo').select('codigo, anexo_base, fator_r').in('codigo', cnaes);
    const refMap = new Map<string, { anexo_base: AnexoSimples | null; fator_r: boolean }>();
    for (const r of refs ?? []) {
      refMap.set(r.codigo as string, {
        anexo_base: (r.anexo_base as AnexoSimples | null) ?? null,
        fator_r: r.fator_r === true,
      });
    }

    // Fator R da empresa (uma vez): folha 12m ÷ RBT12 total.
    const folhas = await lerFolhaParaApuracao(supabase, companyId, competencia);
    const { folha12m } = somarFolha12(folhas, competencia);
    const { rbt12 } = calcularRbt12(receitas, competencia);
    const fatorR = calcularFatorR({ folha12m, rbt12 });

    const resolver = (cnae: string | null | undefined): AnexoSimples | null => {
      if (!cnae) return fallbackAnexo;
      const ref = refMap.get(cnae);
      if (!ref) return fallbackAnexo;
      if (ref.fator_r) return fatorR.suficiente && fatorR.anexoDecidido ? fatorR.anexoDecidido : fallbackAnexo;
      return ref.anexo_base ?? fallbackAnexo;
    };

    return receitas.map((r) =>
      r.competencia === competencia ? { ...r, anexo: resolver(r.cnae) } : r,
    );
  } catch (e) {
    console.warn('[anexarAnexosDasReceitas]', e instanceof Error ? e.message : String(e));
    return receitas;
  }
}
```

- [ ] **Step 3: Wiring em `iniciarApuracaoAction`**

Em `app/src/app/(auth)/impostos/actions.ts`, importar:
```ts
import { anexarAnexosDasReceitas } from '@/lib/fiscal/segregacao';
```
e, dentro do `try` de `iniciarApuracaoAction`, entre o `lerReceitasParaApuracao` e o `calcularApuracao`, anotar as receitas:
```ts
    const receitas = await lerReceitasParaApuracao(supabase, companyId, competencia);
    const receitasAnexadas = await anexarAnexosDasReceitas(supabase, companyId, competencia, receitas, anexo);
    resultado = calcularApuracao({
      regimeCode,
      anexo,
      receitas: receitasAnexadas,
      competencia,
      atividadeMei: (fiscal.atividade_mei ?? null) as string | null,
    });
```
(remova o `receitas` antigo da chamada; passe `receitasAnexadas`.)

- [ ] **Step 4: Wiring em `obterPreviewImposto`**

Em `app/src/lib/fiscal/preview-imposto.ts`, importar:
```ts
import { anexarAnexosDasReceitas } from './segregacao';
```
e na função `obterPreviewImposto`, anotar antes do `montarPreview`:
```ts
  const competencia = competenciaReferenciaBrt();
  const receitas = await lerReceitasParaApuracao(supabase, companyId, competencia);
  const fallbackAnexo = (fiscal.anexo_simples as AnexoSimples | null) ?? null;
  const receitasAnexadas = await anexarAnexosDasReceitas(supabase, companyId, competencia, receitas, fallbackAnexo);
  return montarPreview({
    regimeCode: fiscal.Code_regime_tributario as string,
    anexo: fallbackAnexo,
    receitas: receitasAnexadas,
    competencia,
    atividadeMei: (fiscal.atividade_mei as string | null) ?? null,
  });
```
(O `select` de `empresas_fiscais` aqui já inclui `atividade_mei` da P0.4; se não incluir, adicione `atividade_mei` ao `.select(...)`.)

- [ ] **Step 5: tsc + testes**

Run: `cd app && npx tsc --noEmit && npx vitest run src/lib/fiscal/apuracao.test.ts src/lib/fiscal/preview-imposto.test.ts`
Expected: tsc limpo; testes passam.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/fiscal/segregacao.ts app/src/lib/fiscal/receitas-source.ts "app/src/app/(auth)/impostos/actions.ts" app/src/lib/fiscal/preview-imposto.ts
git commit -m "feat(impostos): apuração resolve anexo por CNAE da nota (segregação)"
```

---

### Task 5: Breakdown por anexo no `/impostos`

**Files:**
- Modify: `app/src/app/(auth)/impostos/CompetenciaAtualCard.tsx`

- [ ] **Step 1: Mostrar o breakdown segregado**

READ `app/src/app/(auth)/impostos/CompetenciaAtualCard.tsx` para entender como o resultado/`breakdown` (payload) é exibido hoje. O `payload_calculo`/`breakdown` agora pode ter:
```ts
{ segregado: boolean; porAnexo: Array<{ anexo: string; receita: number; aliquotaEfetiva: number; valor: number; faixa: number }> }
```

Adicionar, no card, uma seção condicional que só aparece quando `breakdown.segregado === true`: uma listinha por anexo com **anexo · receita · alíquota% · valor**. Quando não segregado (ou `porAnexo` ausente, p/ apurações antigas), nada muda. Use o formatador de moeda já presente no arquivo (ou `Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' })`). Exemplo de bloco (adaptar ao layout real):

```tsx
{Array.isArray(porAnexo) && segregado && (
  <div className="mt-3 rounded-md border border-border divide-y divide-border text-sm">
    {porAnexo.map((p) => (
      <div key={p.anexo} className="flex items-center justify-between px-3 py-2">
        <span className="text-muted-foreground-2">{p.anexo}</span>
        <span className="tabular-nums">
          {brl(p.receita)} · {(p.aliquotaEfetiva * 100).toFixed(2)}% · <strong>{brl(p.valor)}</strong>
        </span>
      </div>
    ))}
  </div>
)}
```

> **NOTA AO EXECUTOR:** leia o card antes; pegue `segregado`/`porAnexo` de onde o breakdown/payload já é lido (preview do resultado ou `payload_calculo`). Não invente a estrutura — encaixe no que existe. Se o card hoje não lê o `breakdown` detalhado, extraia do objeto de resultado já disponível.

- [ ] **Step 2: tsc + lint**

Run: `cd app && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add "app/src/app/(auth)/impostos/CompetenciaAtualCard.tsx"
git commit -m "feat(impostos): breakdown por anexo quando segregado"
```

---

## Self-Review

- **Spec coverage:** coluna+tipo (T1) ✓; captura na emissão (T2) ✓; núcleo segregado (T3) ✓; resolução por CNAE + wiring apuração/prévia + receitas-source (T4) ✓; exibição (T5) ✓.
- **Type consistency:** `ReceitaApuracao.anexo/cnae` (apuracao-types) consumido por `calcularApuracao` (T3), `anexarAnexosDasReceitas` (T4) e `receitas-source` (T4). `CnaeOption` (notas actions) → `EmissaoForm` props (T2). `breakdown.porAnexo/segregado` (T3) → card (T5). `anexo` param de `calcularApuracao` é o fallback — invariante "sempre não-nulo p/ Simples" mantida (`if (!anexo) throw`).
- **Compatibilidade:** receitas sem `anexo`/`cnae` → 1 bucket = fallback → resultado idêntico ao atual; apurações antigas sem `porAnexo` → card inalterado.
- **Placeholders:** nenhum. T1/Step2, T4 e T5 pedem leitura do trecho real p/ encaixe; snippets completos.
