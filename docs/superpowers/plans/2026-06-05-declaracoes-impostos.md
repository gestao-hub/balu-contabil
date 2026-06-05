# Seção "Declarações" no /impostos + reconciliação de migrations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Exibir uma seção "Declarações" (PGDAS-D) no `/impostos`, persistindo as declarações numa tabela própria, e reconciliar a divergência de migrations da `declaracoes_fiscais`.

**Architecture:** Tabela `declaracoes_fiscais` (convenção real, não a da 0001). `consultarDeclaracoesAction` passa a popular as duas tabelas (declaração → `declaracoes_fiscais`, DAS → `guias_fiscais`). O `/impostos` carrega e renderiza a nova seção (Simples).

**Tech Stack:** Next.js App Router, Supabase (Postgres + RLS), TypeScript.

**Spec:** `docs/superpowers/specs/2026-06-05-declaracoes-impostos-design.md`

---

## FASE 1 — Migration + reconciliação

### Task 1: `declaracoes_fiscais` + tipo + reconciliação

**Files:**
- Create: `app/supabase/migrations/0025_declaracoes_fiscais.sql`
- Modify: `app/src/types/database.ts`, `app/supabase/migrations/0001_init.sql`, `docs/investigations/DB-DIVERGENCIA.md`

- [ ] **Step 1: Migration 0025**

Create `app/supabase/migrations/0025_declaracoes_fiscais.sql`:

```sql
-- @custom — Cria declaracoes_fiscais (P1.1: seção "Declarações" no /impostos).
-- Ver docs/superpowers/specs/2026-06-05-declaracoes-impostos-design.md.
--
-- CONTEXTO: declaracoes_fiscais está na 0001_init.sql num schema idealizado NUNCA aplicado,
-- com a convenção VELHA (empresa_id + competencia char6). O banco real usa company_id +
-- competencia_referencia + owner_user_id (ver DB-DIVERGENCIA.md). Esta migration cria a tabela
-- na convenção REAL (corrige a divergência), de forma aditiva/idempotente. Mesmo espírito da 0013
-- (aux_produtos), mas corrigindo a convenção em vez de copiar a 0001.
-- Aplicada manualmente (db_atual.sql é a fonte da verdade).
-- Sem deleted_at de propósito: declaração se re-consulta/corrige, não se apaga → UNIQUE real
-- (não parcial) → upsert onConflict direto, sem o erro 42P10.

-- Função de suporte (idempotente; o banco pode não ter — ver 0013).
CREATE OR REPLACE FUNCTION public.tg_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN new.updated_at := now(); RETURN new; END; $$;

CREATE TABLE IF NOT EXISTS public.declaracoes_fiscais (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  owner_user_id          UUID NOT NULL,
  competencia_referencia TEXT NOT NULL,
  tipo                   TEXT NOT NULL DEFAULT 'PGDAS-D',
  numero_declaracao      TEXT,
  data_transmissao       TIMESTAMPTZ,
  status                 TEXT,
  guia_fiscal_id         UUID REFERENCES public.guias_fiscais(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT declaracoes_fiscais_company_comp_tipo_uniq UNIQUE (company_id, competencia_referencia, tipo)
);
COMMENT ON TABLE public.declaracoes_fiscais IS 'Declarações fiscais (PGDAS-D etc.) por competência. Convenção real (company_id/competencia_referencia); corrige a 0001.';

CREATE INDEX IF NOT EXISTS declaracoes_fiscais_company_idx ON public.declaracoes_fiscais (company_id);

ALTER TABLE public.declaracoes_fiscais ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY declaracoes_fiscais_owner ON public.declaracoes_fiscais
    FOR ALL TO authenticated
    USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER tg_declaracoes_fiscais_updated_at BEFORE UPDATE ON public.declaracoes_fiscais
    FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
EXCEPTION WHEN undefined_function THEN NULL; WHEN duplicate_object THEN NULL; END $$;
```

- [ ] **Step 2: Tipo em `database.ts`**

READ o bloco de `guias_fiscais`/`apuracoes_fiscais` em `app/src/types/database.ts` p/ o estilo. Adicionar (perto deles) o tipo `declaracoes_fiscais` no mesmo formato flat usado no arquivo:

```ts
      declaracoes_fiscais: {
        Row: {
          id: string;
          company_id: string;
          owner_user_id: string;
          competencia_referencia: string;
          tipo: string;
          numero_declaracao: string | null;
          data_transmissao: string | null;
          status: string | null;
          guia_fiscal_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          owner_user_id: string;
          competencia_referencia: string;
          tipo?: string;
          numero_declaracao?: string | null;
          data_transmissao?: string | null;
          status?: string | null;
          guia_fiscal_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string;
          owner_user_id?: string;
          competencia_referencia?: string;
          tipo?: string;
          numero_declaracao?: string | null;
          data_transmissao?: string | null;
          status?: string | null;
          guia_fiscal_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
```

> Se o `database.ts` usar shape flat (uma só forma por tabela, sem Row/Insert/Update separados — como notou-se no `folha_mensal`/`notas_fiscais`), siga o padrão REAL do arquivo: leia primeiro e espelhe a forma das tabelas vizinhas (provavelmente uma interface única por tabela). O conjunto de colunas é o de cima.

- [ ] **Step 3: Anotar a 0001**

Em `app/supabase/migrations/0001_init.sql`, na linha imediatamente ANTES de `create table if not exists public.declaracoes_fiscais (` (~linha 183), inserir o comentário:

```sql
-- ⚠️ SCHEMA IDEALIZADO NÃO APLICADO (convenção velha empresa_id/char6). A tabela real é criada
-- pela 0025_declaracoes_fiscais.sql na convenção correta (company_id/competencia_referencia).
-- Ver DB-DIVERGENCIA.md. Mantido aqui só por histórico — não é a fonte da verdade.
```

(Não remover nada; só inserir o comentário.)

- [ ] **Step 4: Atualizar `DB-DIVERGENCIA.md`**

READ `docs/investigations/DB-DIVERGENCIA.md`. Fazer dois ajustes:

(a) Na tabela da seção **A** (linha "Só nos migrants"), tirar `declaracoes_fiscais` da célula "**Só nos migrations** (não existem no banco)" e adicionar uma nota. A linha atual é:
```
| **Só nos migrations** (não existem no banco) | `aux_produtos`, `declaracoes_fiscais` |
```
Trocar por:
```
| **Só nos migrations** (não existem no banco) | ~~`aux_produtos`~~ (criada pela 0013), ~~`declaracoes_fiscais`~~ (criada pela 0025 na convenção real) |
```

(b) Na seção **F**, no **Passo 3**, onde diz "Decidir `declaracoes_fiscais`: criar mínima (aditivo) ou cortar da v1.", trocar por:
```
**Decisão (2026-06-05): RESOLVIDO** — `declaracoes_fiscais` criada de forma aditiva pela `0025` na convenção real (`company_id`/`competencia_referencia`/`owner_user_id`), NÃO na convenção idealizada da 0001. Ver spec `2026-06-05-declaracoes-impostos-design.md`.
```

- [ ] **Step 5: tsc**

Run: `cd app && npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 6: Commit**

```bash
git add app/supabase/migrations/0025_declaracoes_fiscais.sql app/supabase/migrations/0001_init.sql app/src/types/database.ts docs/investigations/DB-DIVERGENCIA.md
git commit -m "feat(impostos): tabela declaracoes_fiscais + reconcilia migrations (0001/0025)"
```

> **NOTA AO EXECUTOR:** migration aplicada manualmente pelo usuário — não rodar db push.

---

## FASE 2 — Action persiste declarações

### Task 2: `consultarDeclaracoesAction` popula `declaracoes_fiscais`

**Files:**
- Modify: `app/src/app/(auth)/impostos/actions.ts`

- [ ] **Step 1: Upsert das declarações**

READ `consultarDeclaracoesAction` em `app/src/app/(auth)/impostos/actions.ts`. Hoje, depois de `const r = await consultarDeclaracoesSimples(...)`, ele monta `rows` e faz upsert em `guias_fiscais`. Adicionar, logo APÓS o upsert de `guias_fiscais` (antes do `revalidatePath('/impostos')`), o upsert das declarações:

```ts
  // Declarações (numeroDeclaracao/dataTransmissao) vão p/ a tabela própria — separadas do DAS.
  const decls = r.situacoes.map((s) => ({
    company_id: companyId,
    owner_user_id: user.id,
    competencia_referencia: s.competencia,
    tipo: 'PGDAS-D',
    numero_declaracao: s.numeroDeclaracao,
    data_transmissao: s.dataTransmissao,
    status: s.numeroDeclaracao ? 'transmitida' : 'pendente',
    updated_at: new Date().toISOString(),
  }));
  if (decls.length > 0) {
    const { error: decErr } = await supabase
      .from('declaracoes_fiscais')
      .upsert(decls, { onConflict: 'company_id,competencia_referencia,tipo' });
    if (decErr) return { ok: false, error: `Falha ao salvar as declarações: ${decErr.message}` };
  }
```

(O `user` e `companyId` já estão no escopo da função. Mantém o upsert de `guias_fiscais` intacto.)

- [ ] **Step 2: tsc**

Run: `cd app && npx tsc --noEmit`
Expected: sem erros (o tipo `declaracoes_fiscais` foi adicionado na Task 1).

- [ ] **Step 3: Commit**

```bash
git add "app/src/app/(auth)/impostos/actions.ts"
git commit -m "feat(impostos): consultarDeclaracoesAction popula declaracoes_fiscais"
```

---

## FASE 3 — UI: seção "Declarações"

### Task 3: Carregar + renderizar a seção

**Files:**
- Create: `app/src/app/(auth)/impostos/DeclaracoesSection.tsx`
- Modify: `app/src/app/(auth)/impostos/page.tsx`

- [ ] **Step 1: Componente `DeclaracoesSection.tsx`**

Create `app/src/app/(auth)/impostos/DeclaracoesSection.tsx`:

```tsx
import { competenciaLabel, dataBR } from '@/lib/fiscal/guia';

export type DeclaracaoRow = {
  id: string;
  competencia: string;            // YYYYMM
  tipo: string;                   // 'PGDAS-D'
  numeroDeclaracao: string | null;
  dataTransmissao: string | null; // ISO
  status: string | null;          // 'transmitida' | 'pendente'
};

function badge(status: string | null) {
  const transmitida = status === 'transmitida';
  return transmitida
    ? 'bg-green-500/10 text-green-600'
    : 'bg-amber-500/10 text-amber-600';
}

export default function DeclaracoesSection({ declaracoes }: { declaracoes: DeclaracaoRow[] }) {
  if (declaracoes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground rounded-md border border-border bg-surface px-4 py-3">
        Nenhuma declaração consultada. Use <strong>“Consultar na SERPRO”</strong> acima para buscar as PGDAS-D do ano.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left">
          <tr>
            <th className="px-3 py-2 font-medium">Competência</th>
            <th className="px-3 py-2 font-medium">Tipo</th>
            <th className="px-3 py-2 font-medium">Situação</th>
            <th className="px-3 py-2 font-medium">Nº declaração</th>
            <th className="px-3 py-2 font-medium">Transmitida em</th>
          </tr>
        </thead>
        <tbody>
          {declaracoes.map((d) => (
            <tr key={d.id} className="border-t border-border">
              <td className="px-3 py-2">{competenciaLabel(d.competencia)}</td>
              <td className="px-3 py-2">{d.tipo}</td>
              <td className="px-3 py-2">
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badge(d.status)}`}>
                  {d.status === 'transmitida' ? 'Transmitida' : 'Pendente'}
                </span>
              </td>
              <td className="px-3 py-2 tabular-nums">{d.numeroDeclaracao ?? '—'}</td>
              <td className="px-3 py-2 tabular-nums">{d.dataTransmissao ? dataBR(d.dataTransmissao) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

> Verifique que `dataBR` e `competenciaLabel` são exportados de `@/lib/fiscal/guia` (são usados em `CompetenciaAtualCard`/`page.tsx`). Se `dataBR` não aceitar ISO com offset, use `new Date(x).toLocaleDateString('pt-BR')` como fallback.

- [ ] **Step 2: Carregar + renderizar em `page.tsx`**

Em `app/src/app/(auth)/impostos/page.tsx`:

(a) Import:
```ts
import DeclaracoesSection, { type DeclaracaoRow } from './DeclaracoesSection';
```

(b) Adicionar a leitura ao `Promise.all` (mais um item no array desestruturado e na lista). Acrescente a query após a de `guias_fiscais`:
```ts
    supabase.from('declaracoes_fiscais')
      .select('id, competencia_referencia, tipo, numero_declaracao, data_transmissao, status')
      .eq('company_id', companyId)
      .order('competencia_referencia', { ascending: false })
      .limit(24),
```
e adicione `{ data: declaracoes }` ao destructuring do `Promise.all`.

(c) Mapear p/ `DeclaracaoRow[]` (perto de onde monta `historico`):
```ts
  const declaracoesRows: DeclaracaoRow[] = (declaracoes ?? []).map((d) => ({
    id: d.id as string,
    competencia: (d.competencia_referencia as string) ?? '',
    tipo: (d.tipo as string) ?? 'PGDAS-D',
    numeroDeclaracao: (d.numero_declaracao as string | null) ?? null,
    dataTransmissao: (d.data_transmissao as string | null) ?? null,
    status: (d.status as string | null) ?? null,
  }));
```

(d) Renderizar uma nova `<section>` entre "Competência atual" e "Histórico de guias", só p/ Simples:
```tsx
          {isSimples && (
            <section className="mb-8">
              <h2 className="text-xs uppercase tracking-wide text-muted-foreground mb-3">Declarações (PGDAS-D)</h2>
              <DeclaracoesSection declaracoes={declaracoesRows} />
            </section>
          )}
          {isMei && (
            <section className="mb-8">
              <h2 className="text-xs uppercase tracking-wide text-muted-foreground mb-3">Declarações</h2>
              <p className="text-sm text-muted-foreground rounded-md border border-border bg-surface px-4 py-3">
                DASN-SIMEI (declaração anual do MEI) em breve.
              </p>
            </section>
          )}
```

- [ ] **Step 3: tsc + lint**

Run: `cd app && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add "app/src/app/(auth)/impostos/DeclaracoesSection.tsx" "app/src/app/(auth)/impostos/page.tsx"
git commit -m "feat(impostos): seção Declarações (PGDAS-D) no dashboard"
```

---

## Self-Review

- **Spec coverage:** tabela+tipo+reconciliação (T1) ✓; action persiste declarações (T2) ✓; UI seção (T3) ✓.
- **Type consistency:** `declaracoes_fiscais` (database.ts) usado no upsert (T2) e nas queries (T3); `DeclaracaoRow` (DeclaracoesSection) consumido por `page.tsx` (T3). `SituacaoPeriodo.{numeroDeclaracao,dataTransmissao,competencia}` (serpro-consulta-parse) → upsert (T2). `competenciaLabel`/`dataBR` já existem em `guia.ts`.
- **Convenção:** `company_id`/`competencia_referencia`/`owner_user_id` (real) + `UNIQUE` não-parcial (upsert) — corrige a 0001.
- **Compatibilidade:** upsert de `guias_fiscais` intacto; seção só renderiza p/ Simples; MEI vê aviso.
- **Placeholders:** nenhum. T1/Step2, T1/Step4, T2 e T3 pedem leitura do trecho real p/ encaixe; snippets completos.
