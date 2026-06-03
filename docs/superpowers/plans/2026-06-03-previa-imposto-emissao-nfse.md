# Prévia de imposto (DAS/Simples) na emissão de NFS-e — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Mostrar uma estimativa do DAS/Simples no form de emissão de NFS-e, atualizando conforme o valor é digitado (MEI → nota fixa; Regime Normal → nada).

**Architecture:** Reaproveita `calcularApuracao` (já devolve `aliquotaEfetiva`). Server calcula a alíquota efetiva da competência atual e passa pro form; o cliente faz `valor × alíquota` ao vivo.

**Tech Stack:** Next.js 15 App Router, React client island, Supabase, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-03-previa-imposto-emissao-nfse-design.md`

**Comandos** (de `/home/allan/Projetos/claude/balu/app`): `npx tsc --noEmit`; `npx vitest run <arquivo>`; `npx vitest run`.

---

## Task 1: Tipo `PreviewImposto` + módulo `preview-imposto.ts`

**Files:**
- Modify: `app/src/lib/fiscal/apuracao-types.ts`
- Create: `app/src/lib/fiscal/preview-imposto.ts`
- Test: `app/src/lib/fiscal/preview-imposto.test.ts`

- [ ] **Step 1: Adicionar o tipo `PreviewImposto`**

Em `app/src/lib/fiscal/apuracao-types.ts`, adicione ao final do arquivo (é client-safe, sem `server-only`):
```ts
export type PreviewImposto =
  | { tipo: 'simples'; aliquota: number }   // alíquota efetiva 0..1
  | { tipo: 'mei'; valorFixo: number }       // DAS fixo mensal
  | { tipo: 'indisponivel' };                // Regime Normal / sem anexo / sem regime
```

- [ ] **Step 2: Escrever o teste que falha (`montarPreview`)**

Create `app/src/lib/fiscal/preview-imposto.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { montarPreview } from './preview-imposto';
import type { ReceitaApuracao } from './apuracao-types';

describe('montarPreview', () => {
  it('Simples com anexo → {tipo:simples, aliquota>0}', () => {
    const receitas: ReceitaApuracao[] = [
      { competencia: '202605', valor: 100000 }, // mês anterior → alimenta RBT12
      { competencia: '202606', valor: 5000 },
    ];
    const r = montarPreview({
      regimeCode: '1', anexo: 'Anexo I', receitas, competencia: '202606',
    });
    expect(r.tipo).toBe('simples');
    if (r.tipo === 'simples') {
      expect(r.aliquota).toBeGreaterThan(0);
      expect(r.aliquota).toBeLessThan(1);
    }
  });

  it('MEI → {tipo:mei, valorFixo>0}', () => {
    const r = montarPreview({ regimeCode: '4', anexo: null, receitas: [], competencia: '202606' });
    expect(r.tipo).toBe('mei');
    if (r.tipo === 'mei') expect(r.valorFixo).toBeGreaterThan(0);
  });

  it('Regime Normal (3) → indisponivel', () => {
    const r = montarPreview({ regimeCode: '3', anexo: null, receitas: [], competencia: '202606' });
    expect(r).toEqual({ tipo: 'indisponivel' });
  });

  it('Simples sem anexo → indisponivel', () => {
    const r = montarPreview({ regimeCode: '1', anexo: null, receitas: [], competencia: '202606' });
    expect(r).toEqual({ tipo: 'indisponivel' });
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `cd /home/allan/Projetos/claude/balu/app && npx vitest run src/lib/fiscal/preview-imposto.test.ts`
Expected: FAIL — `Failed to resolve import "./preview-imposto"`.

- [ ] **Step 4: Implementar `preview-imposto.ts`**

Create `app/src/lib/fiscal/preview-imposto.ts`:
```ts
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AnexoSimples } from './regime';
import type { ReceitaApuracao, PreviewImposto } from './apuracao-types';
import { calcularApuracao } from './apuracao';
import { lerReceitasParaApuracao } from './receitas-source';
import { competenciaReferenciaBrt } from './guia';

// Mapeia o resultado da apuração para a prévia. Puro (sem Supabase) → testável.
// Regime Normal lança RegimeNaoSuportadoError; Simples sem anexo lança Error —
// ambos viram 'indisponivel' (sem prévia, sem quebrar a emissão).
export function montarPreview(input: {
  regimeCode: string;
  anexo: AnexoSimples | null;
  receitas: ReceitaApuracao[];
  competencia: string;
  atividadeMei?: string | null;
}): PreviewImposto {
  try {
    const r = calcularApuracao({
      regimeCode: input.regimeCode,
      anexo: input.anexo,
      receitas: input.receitas,
      competencia: input.competencia,
      atividadeMei: input.atividadeMei ?? null,
    });
    if (r.tipoApuracao === 'DAS-MEI') return { tipo: 'mei', valorFixo: r.valorImposto };
    return { tipo: 'simples', aliquota: r.aliquotaEfetiva ?? 0 };
  } catch {
    return { tipo: 'indisponivel' };
  }
}

// Busca regime/anexo + receitas e monta a prévia da competência atual.
export async function obterPreviewImposto(
  supabase: SupabaseClient,
  companyId: string,
): Promise<PreviewImposto> {
  const { data: fiscal } = await supabase
    .from('empresas_fiscais')
    .select('Code_regime_tributario, anexo_simples')
    .eq('empresa_id', companyId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!fiscal?.Code_regime_tributario) return { tipo: 'indisponivel' };

  const competencia = competenciaReferenciaBrt();
  const receitas = await lerReceitasParaApuracao(supabase, companyId, competencia);
  return montarPreview({
    regimeCode: fiscal.Code_regime_tributario as string,
    anexo: (fiscal.anexo_simples as AnexoSimples | null) ?? null,
    receitas,
    competencia,
    atividadeMei: null, // empresas_fiscais não guarda atividade MEI → valorDasMei usa o padrão
  });
}
```
(Se o import de `SupabaseClient` reclamar, confira como `receitas-source.ts` o importa e use o mesmo path.)

- [ ] **Step 5: Rodar e ver passar**

Run: `cd /home/allan/Projetos/claude/balu/app && npx vitest run src/lib/fiscal/preview-imposto.test.ts`
Expected: PASS (4 casos).

- [ ] **Step 6: Typecheck + suíte**

Run: `cd /home/allan/Projetos/claude/balu/app && npx tsc --noEmit && npx vitest run`
Expected: `No errors found` + suíte verde.

- [ ] **Step 7: Commit**

```bash
cd /home/allan/Projetos/claude/balu
git add app/src/lib/fiscal/apuracao-types.ts app/src/lib/fiscal/preview-imposto.ts app/src/lib/fiscal/preview-imposto.test.ts
git commit -m "feat(imposto): preview-imposto (montarPreview puro + obterPreviewImposto)"
```

---

## Task 2: Fiação no form de NFS-e

**Files:**
- Modify: `app/src/app/(auth)/notas_fiscais/emissao/nfse/page.tsx`
- Modify: `app/src/app/(auth)/notas_fiscais/emissao/EmissaoForm.tsx`

> **Antes de editar, leia os dois arquivos** para casar com o código real (o `page.tsx` resolve `companyId` e carrega flags `focus_habilita_*`; o `EmissaoForm` recebe `clientes` e tem `valorTexto`/`parseDecimal`).

- [ ] **Step 1: `nfse/page.tsx` — computar e passar `previewImposto`**

No topo, adicione o import:
```tsx
import { obterPreviewImposto } from '@/lib/fiscal/preview-imposto';
import type { PreviewImposto } from '@/lib/fiscal/apuracao-types';
```
Onde o `companyId` é resolvido, calcule a prévia (degrada p/ `indisponivel` sem empresa). Adicione, após obter `companyId`:
```tsx
  const previewImposto: PreviewImposto = companyId
    ? await obterPreviewImposto(supabase, companyId)
    : { tipo: 'indisponivel' };
```
E na renderização do form, passe a prop:
```tsx
      <EmissaoForm clientes={clientes} previewImposto={previewImposto} />
```
(Adapte ao nome real da variável de clientes/JSX existente — leia o arquivo.)

- [ ] **Step 2: `EmissaoForm.tsx` — receber a prop e importar tipos**

Adicione o import do tipo + um formatador BRL no topo (perto dos outros imports):
```tsx
import type { PreviewImposto } from '@/lib/fiscal/apuracao-types';
```
Mude a assinatura do componente de:
```tsx
export default function EmissaoForm({ clientes }: { clientes: ClienteOption[] }) {
```
para:
```tsx
export default function EmissaoForm({
  clientes,
  previewImposto,
}: {
  clientes: ClienteOption[];
  previewImposto: PreviewImposto;
}) {
```

- [ ] **Step 3: `EmissaoForm.tsx` — renderizar a prévia abaixo do grid Valor/Alíquota**

O grid de Valor + Alíquota ISS termina na `</div>` da linha ~144 (logo antes do bloco `{clientErr && ...}`). Adicione, entre o fim desse grid e o `{clientErr && ...}`:
```tsx
      {previewImposto.tipo === 'simples' && (() => {
        const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
        const valor = parseDecimal(valorTexto) || 0;
        const imposto = valor * previewImposto.aliquota;
        return (
          <p className="text-sm text-muted-foreground bg-surface-2 border border-border rounded-md px-3 py-2">
            Imposto estimado (DAS): <span className="font-medium text-foreground">{brl.format(imposto)}</span>
            {' '}— ≈{(previewImposto.aliquota * 100).toFixed(2)}% · estimativa
          </p>
        );
      })()}
      {previewImposto.tipo === 'mei' && (() => {
        const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
        return (
          <p className="text-sm text-muted-foreground bg-surface-2 border border-border rounded-md px-3 py-2">
            MEI: DAS fixo de <span className="font-medium text-foreground">{brl.format(previewImposto.valorFixo)}</span>/mês — não varia por nota.
          </p>
        );
      })()}
```
(`previewImposto.tipo === 'indisponivel'` não renderiza nada.)

- [ ] **Step 4: Typecheck + suíte**

Run: `cd /home/allan/Projetos/claude/balu/app && npx tsc --noEmit && npx vitest run`
Expected: `No errors found` + suíte verde.

- [ ] **Step 5: Commit**

```bash
cd /home/allan/Projetos/claude/balu
git add "app/src/app/(auth)/notas_fiscais/emissao/nfse/page.tsx" "app/src/app/(auth)/notas_fiscais/emissao/EmissaoForm.tsx"
git commit -m "feat(emissao): prévia de DAS/Simples ao vivo no form de NFS-e"
```

**Smoke manual:** emitir NFS-e numa empresa Simples → ao digitar o valor, a estimativa de DAS aparece e muda; numa empresa MEI → nota de DAS fixo; Regime Normal → sem prévia.

---

## Notas
- `server-only` em `preview-imposto.ts` não atrapalha o teste (Vitest roda em Node). O client (`EmissaoForm`) importa só o **tipo** `PreviewImposto` de `apuracao-types.ts` (client-safe).
- Verificação final: `cd app && npx tsc --noEmit && npx vitest run` verde.
