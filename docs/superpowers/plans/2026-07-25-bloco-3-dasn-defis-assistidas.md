# Bloco 3 — DASN-SIMEI assistida + DEFIS — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar as duas declarações anuais do Simples Nacional de forma assistida — o app calcula a sugestão a partir das notas, valida, alerta divergência e limite, guarda o comprovante e cala o alarme quando a obrigação é cumprida.

**Architecture:** Dois módulos irmãos (`lib/fiscal/dasn/` e `lib/fiscal/defis/`) sobre uma costura mínima (`lib/fiscal/declaracoes-anuais/`) que concentra registro de comprovante, cálculo de divergência e tipos. Nenhuma tabela nova: `declaracoes_fiscais` ganha cinco colunas na migration `0048`, e a `0049` acrescenta o bloco `defis_pendente` à RPC `materializar_obrigacoes`. A lógica delicada (bordas do ano-calendário, split comércio/serviço, limite do MEI, soma dos sócios) mora em funções puras cobertas por teste; o que toca banco é fino e coberto por smoke.

**Tech Stack:** Next.js App Router (Server Components + Server Actions), Supabase (Postgres + RLS + Storage), Zod, vitest, TypeScript.

**Spec:** `docs/superpowers/specs/2026-07-25-bloco-3-dasn-defis-assistidas-design.md`
**Branch:** `bloco-3-dasn-defis` (já criada)
**Diretório de trabalho:** todos os comandos assumem `D:\balu-app-v2\balu\app` salvo indicação contrária.

---

## Convenções deste plano

**Rodar teste único:** `npx vitest run src/lib/fiscal/<arquivo>.test.ts`
**Rodar tudo:** `npm test -- --run`
**Typecheck:** `npm run typecheck`
**Aplicar migration:** a partir de `D:\balu-app-v2\balu` → `node app/scratchpad/apply-migration.mjs app/supabase/migrations/<arquivo>.sql`

O vitest só coleta `src/**/*.test.ts` (ver `vitest.config.ts`) — **testes de componente `.tsx` não rodam**, por isso não há nenhum neste plano. O alias `@` aponta para `src/`, e `server-only` é neutralizado por um stub.

**Nomenclatura:** todas as chaves de campo, tanto em `grupos.ts` quanto nos schemas Zod quanto no jsonb gravado, são **camelCase**. Não misturar com snake_case (que é a convenção só das colunas do Postgres).

---

## Estrutura de arquivos

| arquivo | responsabilidade |
|---|---|
| `supabase/migrations/0048_declaracoes_anuais.sql` | colunas novas em `declaracoes_fiscais` + bucket |
| `supabase/migrations/0049_defis_pendente.sql` | bloco `defis_pendente` na RPC |
| `src/lib/fiscal/declaracoes-anuais/tipos.ts` | tipos compartilhados pelos dois módulos |
| `src/lib/fiscal/declaracoes-anuais/divergencia.ts` | declarado × apurado (puro) |
| `src/lib/fiscal/declaracoes-anuais/comprovante.ts` | validação de arquivo + path no storage (puro) |
| `src/lib/fiscal/declaracoes-anuais/registrar.ts` | upload + upsert + auditoria + supressão de aviso (toca banco) |
| `src/lib/fiscal/receitas-source.ts` | **modificar** — `lerNotasAnoCalendario` |
| `src/lib/fiscal/dasn/resumo.ts` | agregação do ano + limite de R$ 81.000 (puro) |
| `src/lib/fiscal/dasn/campos.ts` | schema Zod dos três campos |
| `src/lib/fiscal/defis/grupos.ts` | os seis grupos do art. 72 como dados |
| `src/lib/fiscal/defis/campos.ts` | schema Zod derivado dos grupos |
| `src/app/(auth)/(gated)/impostos/actions.ts` | **modificar** — action do empresário |
| `src/lib/contador/carteira.ts` | guarda anti-IDOR de carteira (fora do módulo `'use server'`) |
| `src/app/(auth)/(gated)/contador/clientes/actions.ts` | **criar** — action do contador |
| `src/app/(auth)/(gated)/impostos/DeclaracaoAnualShell.tsx` | casca visual comum |
| `src/app/(auth)/(gated)/impostos/RegistrarComprovanteDialog.tsx` | dialog de registro (DASN e DEFIS) |
| `src/app/(auth)/(gated)/impostos/DasnAssistidaForm.tsx` | formulário dos três campos |
| `src/app/(auth)/(gated)/impostos/DeclaracoesMeiSection.tsx` | **modificar** — vira seção assistida |
| `src/app/(auth)/(gated)/impostos/DefisForm.tsx` | formulário dirigido por `grupos.ts` |
| `src/app/(auth)/(gated)/impostos/DeclaracoesDefisSection.tsx` | seção do DEFIS |
| `src/app/(auth)/(gated)/impostos/page.tsx` | **modificar** — busca o resumo e monta as seções |
| `src/app/(auth)/(gated)/contador/clientes/[companyId]/VisaoCliente.tsx` | **modificar** — card "Declarações anuais" |
| `scratchpad/seed-empresa-mei.mjs` | seed de empresa MEI para teste (cria / `restore`) |

---

## Task 1: Migration 0048 — colunas e bucket

**Files:**
- Create: `app/supabase/migrations/0048_declaracoes_anuais.sql`

- [ ] **Step 1: Escrever a migration**

```sql
-- 0048_declaracoes_anuais.sql — Bloco 3: DASN-SIMEI assistida + DEFIS.
-- Aditiva e idempotente, no espírito da 0025. Nenhuma tabela nova: as duas
-- declarações anuais moram em declaracoes_fiscais com competencia_referencia =
-- '<ano>' e tipo em ('DASN-SIMEI','DEFIS'). A UNIQUE (company_id,
-- competencia_referencia, tipo) da 0025 já dá idempotência: reenviar o
-- comprovante é upsert, não duplica.
--
-- RLS: NADA muda aqui. declaracoes_fiscais_owner (0025) já deixa o empresário
-- escrever o que é dele; declaracoes_select_contador (0033) é SELECT-only e
-- continua assim — o contador escreve pela Server Action com service role.

ALTER TABLE public.declaracoes_fiscais
  ADD COLUMN IF NOT EXISTS dados               jsonb,
  ADD COLUMN IF NOT EXISTS comprovante_path    text,
  ADD COLUMN IF NOT EXISTS origem              text,
  ADD COLUMN IF NOT EXISTS registrado_por      uuid,
  ADD COLUMN IF NOT EXISTS divergencia_receita numeric;

DO $$ BEGIN
  ALTER TABLE public.declaracoes_fiscais
    ADD CONSTRAINT declaracoes_fiscais_origem_chk
    CHECK (origem IS NULL OR origem IN ('serpro','manual'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.declaracoes_fiscais.dados IS
  'Payload declarado. DASN: {receitaComercio, receitaServico, possuiEmpregado}. DEFIS: campos do art. 72 (camelCase).';
COMMENT ON COLUMN public.declaracoes_fiscais.divergencia_receita IS
  'declarado - apurado pelas notas. NULL = nao aplicavel; 0 = confere.';

-- Bucket privado dos comprovantes. Acesso SO pela service role (upload na action,
-- leitura por signed URL), como abertura-documentos: nenhum cliente toca direto,
-- entao nao ha policy em storage.objects.
INSERT INTO storage.buckets (id, name, public)
VALUES ('declaracoes-comprovantes', 'declaracoes-comprovantes', false)
ON CONFLICT (id) DO NOTHING;
```

- [ ] **Step 2: Aplicar**

A partir de `D:\balu-app-v2\balu`:

```bash
node app/scratchpad/apply-migration.mjs app/supabase/migrations/0048_declaracoes_anuais.sql
```

Esperado: `OK: ...0048_declaracoes_anuais.sql aplicada via conexão direta.`

- [ ] **Step 3: Verificar no banco**

Criar `app/scratchpad/_verify-0048.mjs`:

```js
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(join(appDir, '.env.local'), 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => {
    const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
  }),
);
const ref = env.NEXT_PUBLIC_SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\./)[1];
const c = new pg.Client({ host: `db.${ref}.supabase.co`, port: 5432, user: 'postgres', password: env.SUPABASE_PASSWORD, database: 'postgres', ssl: { rejectUnauthorized: false } });
await c.connect();
const cols = await c.query(`SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='declaracoes_fiscais'
    AND column_name IN ('dados','comprovante_path','origem','registrado_por','divergencia_receita')
  ORDER BY column_name`);
console.log('colunas:', cols.rows.map((r) => r.column_name).join(', '));
const b = await c.query(`SELECT id, public FROM storage.buckets WHERE id='declaracoes-comprovantes'`);
console.log('bucket:', b.rows[0] ?? '(ausente)');
await c.end();
```

Rodar a partir de `D:\balu-app-v2\balu`: `node app/scratchpad/_verify-0048.mjs`

Esperado:
```
colunas: comprovante_path, dados, divergencia_receita, origem, registrado_por
bucket: { id: 'declaracoes-comprovantes', public: false }
```

- [ ] **Step 4: Commit**

```bash
git add app/supabase/migrations/0048_declaracoes_anuais.sql
git commit -m "feat(bloco-3): migration 0048 — colunas de declaracao anual + bucket de comprovantes"
```

> `_verify-0048.mjs` fica em `scratchpad/`, que não é versionado. Não adicionar ao commit.

---

## Task 2: Tipos compartilhados

**Files:**
- Create: `app/src/lib/fiscal/declaracoes-anuais/tipos.ts`

Sem teste próprio: é só declaração de tipos, e os testes das tasks seguintes os exercitam. Existe para que as tasks 3–9 não divirjam de nomes.

- [ ] **Step 1: Escrever os tipos**

```ts
// src/lib/fiscal/declaracoes-anuais/tipos.ts
// Tipos compartilhados pelas duas declarações anuais (DASN-SIMEI e DEFIS).
// Convenção: toda chave de campo é camelCase — inclusive dentro do jsonb `dados`.

export type DeclaracaoAnualTipo = 'DASN-SIMEI' | 'DEFIS';

/** Nota lida do banco, já normalizada. */
export type NotaReceita = {
  dataEmissao: string;                        // ISO
  valor: number;
  tipoDocumento: 'NFSe' | 'NFe' | 'NFCe';
};

/** Receita agregada de um ano-calendário. */
export type ResumoReceitas = {
  comercio: number;
  servico: number;
  total: number;
  qtdNotas: number;
};

export type ComprovanteInput = {
  nome: string;
  mime: string;
  bytes: Buffer;
};

export type RegistroInput = {
  companyId: string;
  ownerUserId: string;
  tipo: DeclaracaoAnualTipo;
  ano: number;
  dados: Record<string, unknown>;
  /** null (ou ausente) = rascunho: NÃO cala o aviso do sino. */
  dataTransmissao?: string | null;            // 'YYYY-MM-DD'
  numeroDeclaracao?: string | null;
  divergenciaReceita?: number | null;
  origem: 'serpro' | 'manual';
  registradoPor: string;
  comprovante?: ComprovanteInput | null;
};

export type ResultadoRegistro = { ok: true; id: string } | { ok: false; error: string };

/** Prefixo da chave de notificação que este tipo de declaração silencia. */
export const TIPO_AVISO: Record<DeclaracaoAnualTipo, string> = {
  'DASN-SIMEI': 'dasn_pendente',
  DEFIS: 'defis_pendente',
};
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/fiscal/declaracoes-anuais/tipos.ts
git commit -m "feat(bloco-3): tipos compartilhados das declaracoes anuais"
```

---

## Task 3: Divergência entre declarado e apurado

**Files:**
- Create: `app/src/lib/fiscal/declaracoes-anuais/divergencia.ts`
- Test: `app/src/lib/fiscal/declaracoes-anuais/divergencia.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// src/lib/fiscal/declaracoes-anuais/divergencia.test.ts
import { describe, it, expect } from 'vitest';
import { calcularDivergencia } from './divergencia';

describe('calcularDivergencia', () => {
  it('acusa quando o declarado é maior que o apurado', () => {
    const d = calcularDivergencia(90000, 62000);
    expect(d.diferenca).toBe(28000);
    expect(d.ha).toBe(true);
    expect(d.sentido).toBe('acima');
  });

  it('acusa quando o declarado é menor que o apurado', () => {
    const d = calcularDivergencia(50000, 62000);
    expect(d.diferenca).toBe(-12000);
    expect(d.ha).toBe(true);
    expect(d.sentido).toBe('abaixo');
  });

  it('não acusa quando confere', () => {
    const d = calcularDivergencia(62000, 62000);
    expect(d.diferenca).toBe(0);
    expect(d.ha).toBe(false);
    expect(d.sentido).toBe('confere');
  });

  // Somatório de notas em float rende resíduo de centavo; um centavo não é divergência.
  it('tolera diferença de até um centavo', () => {
    expect(calcularDivergencia(62000.004, 62000).ha).toBe(false);
  });

  // Empresa sem nota nenhuma no ano: declarar qualquer coisa É divergência,
  // e é justamente o caso em que o alerta mais importa.
  it('acusa quando o apurado é zero e o declarado não', () => {
    const d = calcularDivergencia(15000, 0);
    expect(d.ha).toBe(true);
    expect(d.sentido).toBe('acima');
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npx vitest run src/lib/fiscal/declaracoes-anuais/divergencia.test.ts`
Expected: FAIL — `Failed to resolve import "./divergencia"`

- [ ] **Step 3: Implementar**

```ts
// src/lib/fiscal/declaracoes-anuais/divergencia.ts
// Compara o valor DECLARADO pelo usuário com o APURADO a partir das notas.
// Nunca bloqueia: o resultado vira alerta na UI (spec §5.2, premissa 5).

export type Divergencia = {
  /** declarado − apurado. Positivo = declarou mais do que as notas mostram. */
  diferenca: number;
  ha: boolean;
  sentido: 'acima' | 'abaixo' | 'confere';
};

/** Tolerância de 1 centavo: resíduo de soma em float não é divergência. */
const TOLERANCIA = 0.01;

export function calcularDivergencia(declarado: number, apurado: number): Divergencia {
  const diferenca = declarado - apurado;
  if (Math.abs(diferenca) <= TOLERANCIA) return { diferenca: 0, ha: false, sentido: 'confere' };
  return { diferenca, ha: true, sentido: diferenca > 0 ? 'acima' : 'abaixo' };
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `npx vitest run src/lib/fiscal/declaracoes-anuais/divergencia.test.ts`
Expected: PASS — 5 passed

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/fiscal/declaracoes-anuais/divergencia.ts app/src/lib/fiscal/declaracoes-anuais/divergencia.test.ts
git commit -m "feat(bloco-3): helper de divergencia declarado x apurado"
```

---

## Task 4: Resumo de receitas do ano-calendário (puro)

Esta é a função com a lógica mais escorregadia do bloco: a borda do ano em BRT. O app inteiro trata competência em BRT (`competenciaReferenciaBrt`, `guia.ts:28`) porque `data_emissao` vem em UTC — uma nota de 31/12 às 22h em Brasília é 01/01 em UTC e cairia no ano errado.

**Files:**
- Create: `app/src/lib/fiscal/dasn/resumo.ts`
- Test: `app/src/lib/fiscal/dasn/resumo.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// src/lib/fiscal/dasn/resumo.test.ts
import { describe, it, expect } from 'vitest';
import { resumirReceitasAno, avaliarLimiteMei, LIMITE_MEI_ANUAL } from './resumo';
import type { NotaReceita } from '../declaracoes-anuais/tipos';

const nota = (dataEmissao: string, valor: number, tipoDocumento: NotaReceita['tipoDocumento']): NotaReceita =>
  ({ dataEmissao, valor, tipoDocumento });

describe('resumirReceitasAno', () => {
  it('separa NFSe como serviço e NFe/NFCe como comércio', () => {
    const r = resumirReceitasAno([
      nota('2025-03-10T12:00:00-03:00', 1000, 'NFSe'),
      nota('2025-04-10T12:00:00-03:00', 500, 'NFe'),
      nota('2025-05-10T12:00:00-03:00', 250, 'NFCe'),
    ], 2025);
    expect(r.servico).toBe(1000);
    expect(r.comercio).toBe(750);
    expect(r.total).toBe(1750);
    expect(r.qtdNotas).toBe(3);
  });

  it('inclui a nota de 31/12 23:59 BRT no ano dela', () => {
    const r = resumirReceitasAno([nota('2025-12-31T23:59:00-03:00', 100, 'NFe')], 2025);
    expect(r.total).toBe(100);
    expect(r.qtdNotas).toBe(1);
  });

  it('exclui a nota de 01/01 00:01 BRT do ano anterior', () => {
    const r = resumirReceitasAno([nota('2026-01-01T00:01:00-03:00', 100, 'NFe')], 2025);
    expect(r.total).toBe(0);
    expect(r.qtdNotas).toBe(0);
  });

  // A armadilha: 31/12/2025 22:00 BRT é 01/01/2026 01:00 UTC. Se filtrarmos
  // pelo ano em UTC, essa receita some do ano-calendário certo.
  it('conta pelo fuso de Brasília, não por UTC', () => {
    const r = resumirReceitasAno([nota('2026-01-01T01:00:00Z', 100, 'NFe')], 2025);
    expect(r.total).toBe(100);
  });

  it('devolve zeros quando não há nota nenhuma', () => {
    const r = resumirReceitasAno([], 2025);
    expect(r).toEqual({ comercio: 0, servico: 0, total: 0, qtdNotas: 0 });
  });
});

describe('avaliarLimiteMei', () => {
  it('não excede abaixo do limite', () => {
    const a = avaliarLimiteMei(80000);
    expect(a.excede).toBe(false);
    expect(a.excedeEm20Pct).toBe(false);
    expect(a.excedente).toBe(0);
  });

  it('não excede exatamente no limite', () => {
    expect(avaliarLimiteMei(LIMITE_MEI_ANUAL).excede).toBe(false);
  });

  it('excede um real acima do limite', () => {
    const a = avaliarLimiteMei(81001);
    expect(a.excede).toBe(true);
    expect(a.excedeEm20Pct).toBe(false);
    expect(a.excedente).toBe(1);
  });

  // Acima de 20% (R$ 97.200) o desenquadramento é retroativo ao início do ano.
  it('marca o excesso acima de 20%', () => {
    const a = avaliarLimiteMei(97201);
    expect(a.excede).toBe(true);
    expect(a.excedeEm20Pct).toBe(true);
  });

  it('20% exatos ainda não é excesso retroativo', () => {
    expect(avaliarLimiteMei(97200).excedeEm20Pct).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npx vitest run src/lib/fiscal/dasn/resumo.test.ts`
Expected: FAIL — `Failed to resolve import "./resumo"`

- [ ] **Step 3: Implementar**

```ts
// src/lib/fiscal/dasn/resumo.ts
// Agregação pura do ano-calendário + teste do limite do MEI.
// Puro de propósito: a borda do ano em BRT é a parte fácil de errar, e aqui ela
// é testável sem banco. A leitura das notas fica em receitas-source.ts.
import type { NotaReceita, ResumoReceitas } from '../declaracoes-anuais/tipos';

/** Ano-calendário de uma data, no fuso de Brasília (BRT, UTC−3). */
function anoBrt(iso: string): number {
  const brt = new Date(new Date(iso).getTime() - 3 * 60 * 60 * 1000);
  return brt.getUTCFullYear();
}

/**
 * Soma as notas do ano-calendário, separando por natureza da receita.
 * NFSe → serviço (inclui locação); NFe e NFCe → comércio (inclui indústria).
 * Ver premissa 4 da spec: a separação é por tipo de documento, não por CNAE.
 */
export function resumirReceitasAno(notas: NotaReceita[], ano: number): ResumoReceitas {
  const doAno = notas.filter((n) => anoBrt(n.dataEmissao) === ano);
  let comercio = 0;
  let servico = 0;
  for (const n of doAno) {
    if (n.tipoDocumento === 'NFSe') servico += n.valor;
    else comercio += n.valor;
  }
  return {
    comercio: arredondar(comercio),
    servico: arredondar(servico),
    total: arredondar(comercio + servico),
    qtdNotas: doAno.length,
  };
}

function arredondar(n: number): number {
  return Math.round(n * 100) / 100;
}

/** LC 123/2006, art. 18-A, §1º. */
export const LIMITE_MEI_ANUAL = 81000;
const LIMITE_COM_TOLERANCIA = LIMITE_MEI_ANUAL * 1.2;

export type AvaliacaoLimite = {
  total: number;
  excede: boolean;
  /** Acima de 20% do limite: o desenquadramento retroage ao início do ano. */
  excedeEm20Pct: boolean;
  excedente: number;
};

export function avaliarLimiteMei(total: number): AvaliacaoLimite {
  const excede = total > LIMITE_MEI_ANUAL;
  return {
    total,
    excede,
    excedeEm20Pct: total > LIMITE_COM_TOLERANCIA,
    excedente: excede ? arredondar(total - LIMITE_MEI_ANUAL) : 0,
  };
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `npx vitest run src/lib/fiscal/dasn/resumo.test.ts`
Expected: PASS — 10 passed

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/fiscal/dasn/resumo.ts app/src/lib/fiscal/dasn/resumo.test.ts
git commit -m "feat(bloco-3): resumo de receitas do ano-calendario + limite do MEI"
```

---

## Task 5: Leitura das notas do ano-calendário

`lerReceitasParaApuracao` (`receitas-source.ts:12`) tem janela de 13 meses terminando numa competência — não serve para ano-calendário. A função nova vai no **mesmo arquivo**, para manter de pé a regra do docblock: toda leitura de receita passa por ali.

**Files:**
- Modify: `app/src/lib/fiscal/receitas-source.ts`

Sem teste unitário: é uma query fina, sem lógica. A lógica (filtro exato de ano, split) está na Task 4, já testada; a query é coberta pelo smoke da Task 13.

- [ ] **Step 1: Acrescentar a função ao fim do arquivo**

```ts
/**
 * Lê as notas de um ano-calendário para montar a declaração anual (DASN/DEFIS).
 *
 * A janela SQL é generosa de propósito (±1 dia nas pontas, em UTC): o recorte
 * exato do ano em BRT é feito por `resumirReceitasAno` (dasn/resumo.ts), que é
 * puro e testado. Filtrar por ano direto no SQL erraria a nota de 31/12 à noite.
 */
export async function lerNotasAnoCalendario(
  supabase: SupabaseClient,
  companyId: string,
  ano: number,
): Promise<NotaReceita[]> {
  const inicio = `${ano - 1}-12-31T00:00:00Z`;
  const fim = `${ano + 1}-01-02T00:00:00Z`;

  const { data, error } = await supabase
    .from('notas_fiscais')
    .select('data_emissao, valor_total, tipo_documento')
    .eq('company_id', companyId)
    .in('status', ['ativa', 'lancada'])
    .in('tipo_documento', ['NFSe', 'NFe', 'NFCe'])
    .gte('data_emissao', inicio)
    .lt('data_emissao', fim);

  if (error) throw new Error(`Falha ao ler notas do ano ${ano}: ${error.message}`);

  return (data ?? [])
    .filter((n) => n.data_emissao != null && n.valor_total != null)
    .map((n) => ({
      dataEmissao: n.data_emissao as string,
      valor: Number(n.valor_total),
      tipoDocumento: n.tipo_documento as NotaReceita['tipoDocumento'],
    }));
}
```

- [ ] **Step 2: Acrescentar o import no topo do arquivo**

Na linha 2, ao lado do import de `ReceitaApuracao`:

```ts
import type { NotaReceita } from './declaracoes-anuais/tipos';
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: sem erros.

- [ ] **Step 4: Garantir que nada quebrou**

Run: `npm test -- --run`
Expected: PASS — a suíte inteira, incluindo as tasks 3 e 4.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/fiscal/receitas-source.ts
git commit -m "feat(bloco-3): lerNotasAnoCalendario para as declaracoes anuais"
```

---

## Task 6: Schema Zod da DASN + elo com o payload SERPRO

`montarDasnSimei` (`dasn-simei.ts:13`) tem teste e **nenhum caller** desde que foi escrito. Esta task fecha o elo.

**Files:**
- Create: `app/src/lib/fiscal/dasn/campos.ts`
- Test: `app/src/lib/fiscal/dasn/campos.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// src/lib/fiscal/dasn/campos.test.ts
import { describe, it, expect } from 'vitest';
import { DasnCamposSchema, sugerirCampos, paraPayloadSerpro } from './campos';

describe('DasnCamposSchema', () => {
  it('aceita os três campos válidos', () => {
    const r = DasnCamposSchema.safeParse({ receitaComercio: 1000, receitaServico: 500, possuiEmpregado: false });
    expect(r.success).toBe(true);
  });

  it('rejeita receita negativa', () => {
    const r = DasnCamposSchema.safeParse({ receitaComercio: -1, receitaServico: 0, possuiEmpregado: false });
    expect(r.success).toBe(false);
  });

  it('rejeita campo faltando', () => {
    const r = DasnCamposSchema.safeParse({ receitaComercio: 10, receitaServico: 0 });
    expect(r.success).toBe(false);
  });
});

describe('sugerirCampos', () => {
  it('pré-preenche a partir do resumo das notas', () => {
    const c = sugerirCampos({ comercio: 750, servico: 1000, total: 1750, qtdNotas: 3 });
    expect(c).toEqual({ receitaComercio: 750, receitaServico: 1000, possuiEmpregado: false });
  });
});

describe('paraPayloadSerpro', () => {
  it('entrega o payload no formato do montarDasnSimei', () => {
    const p = paraPayloadSerpro(
      { receitaComercio: 750, receitaServico: 1000, possuiEmpregado: true },
      '12.345.678/0001-95',
      2025,
    ) as { cnpjCompleto: string; anoCalendario: string; declaracao: Record<string, unknown> };
    expect(p.cnpjCompleto).toBe('12345678000195');
    expect(p.anoCalendario).toBe('2025');
    expect(p.declaracao).toEqual({
      valorReceitaComercio: 750,
      valorReceitaServico: 1000,
      indicadorEmpregado: true,
    });
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npx vitest run src/lib/fiscal/dasn/campos.test.ts`
Expected: FAIL — `Failed to resolve import "./campos"`

- [ ] **Step 3: Implementar**

```ts
// src/lib/fiscal/dasn/campos.ts
// Os três campos da DASN-SIMEI: validação, sugestão a partir das notas e a
// ponte para o builder de payload SERPRO que já existia sem caller.
import { z } from 'zod';
import { montarDasnSimei } from '../dasn-simei';
import type { ResumoReceitas } from '../declaracoes-anuais/tipos';

export const DasnCamposSchema = z.object({
  receitaComercio: z.number().min(0, 'A receita de comércio não pode ser negativa.'),
  receitaServico: z.number().min(0, 'A receita de serviço não pode ser negativa.'),
  possuiEmpregado: z.boolean(),
});

export type DasnCampos = z.infer<typeof DasnCamposSchema>;

/**
 * Sugestão pré-preenchida. O usuário PODE corrigir para o valor que de fato vai
 * declarar — a diferença vira alerta de divergência, nunca bloqueio (spec §5.2).
 * `possuiEmpregado` começa false: o app não tem folha para inferir isso.
 */
export function sugerirCampos(resumo: ResumoReceitas): DasnCampos {
  return {
    receitaComercio: resumo.comercio,
    receitaServico: resumo.servico,
    possuiEmpregado: false,
  };
}

/** Payload do TRANSDECLARACAO151 — usado hoje só para conferência/consulta. */
export function paraPayloadSerpro(campos: DasnCampos, cnpj: string, ano: number): Record<string, unknown> {
  return montarDasnSimei({
    cnpj,
    anoCalendario: ano,
    valorReceitaComercio: campos.receitaComercio,
    valorReceitaServico: campos.receitaServico,
    indicadorEmpregado: campos.possuiEmpregado,
  });
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `npx vitest run src/lib/fiscal/dasn/campos.test.ts`
Expected: PASS — 5 passed

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/fiscal/dasn/campos.ts app/src/lib/fiscal/dasn/campos.test.ts
git commit -m "feat(bloco-3): schema da DASN e ponte com montarDasnSimei"
```

---

## Task 7: Os grupos do art. 72 (DEFIS)

> ⚠️ **Esta é a PREMISSA 1 da spec.** A lista abaixo precisa da confirmação do Michel. Se ele acrescentar ou remover campos, o ajuste é neste arquivo e o teste da Step 1 avisa se `campos.ts` sair de sincronia.

**Files:**
- Create: `app/src/lib/fiscal/defis/grupos.ts`
- Test: `app/src/lib/fiscal/defis/grupos.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// src/lib/fiscal/defis/grupos.test.ts
import { describe, it, expect } from 'vitest';
import { GRUPOS_DEFIS, camposPlanos, contarPreenchidos } from './grupos';

describe('GRUPOS_DEFIS', () => {
  // Guarda contra alguém remover um grupo: sem isto, o bloco some da tela em
  // silêncio e a declaração fica incompleta sem ninguém perceber.
  it('tem os seis grupos do art. 72', () => {
    expect(GRUPOS_DEFIS.map((g) => g.id)).toEqual([
      'identificacao', 'empregados', 'receitas', 'despesas', 'aquisicoes', 'socios',
    ]);
  });

  it('só o grupo de sócios é repetível', () => {
    expect(GRUPOS_DEFIS.filter((g) => g.repetivel).map((g) => g.id)).toEqual(['socios']);
  });

  it('não tem chave de campo duplicada', () => {
    const chaves = GRUPOS_DEFIS.flatMap((g) => g.campos.map((c) => `${g.id}.${c.chave}`));
    expect(new Set(chaves).size).toBe(chaves.length);
  });

  it('usa camelCase em toda chave', () => {
    for (const g of GRUPOS_DEFIS) {
      for (const c of g.campos) expect(c.chave).toMatch(/^[a-z][a-zA-Z0-9]*$/);
    }
  });
});

describe('camposPlanos', () => {
  it('lista os campos não repetíveis', () => {
    const chaves = camposPlanos().map((c) => c.chave);
    expect(chaves).toContain('receitaBrutaTotal');
    expect(chaves).toContain('estoqueFinal');
    expect(chaves).not.toContain('proLabore'); // é do grupo repetível
  });
});

describe('contarPreenchidos', () => {
  it('conta campos com valor, ignorando vazio e nulo', () => {
    const r = contarPreenchidos({ receitaBrutaTotal: 1000, totalDespesas: 0, estoqueInicial: null, eventoTipo: '' });
    expect(r.preenchidos).toBe(2); // 1000 e 0 contam; null e '' não
    expect(r.total).toBe(camposPlanos().length);
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npx vitest run src/lib/fiscal/defis/grupos.test.ts`
Expected: FAIL — `Failed to resolve import "./grupos"`

- [ ] **Step 3: Implementar**

```ts
// src/lib/fiscal/defis/grupos.ts
// Os blocos do DEFIS declarados como DADOS, não como JSX: a UI se desenha a
// partir daqui e o schema Zod (campos.ts) é derivado daqui. Confirmar a lista
// com o Michel — é a PREMISSA 1 da spec (Res. CGSN 140/2018, art. 72).
//
// Realidade que precisa estar dita: quase tudo aqui é digitação manual. O app
// não tem folha, contas a pagar nem estoque. Só receitaBrutaTotal e
// receitaMercadoInterno saem pré-preenchidos das notas.

export type TipoCampoDefis = 'moeda' | 'inteiro' | 'booleano' | 'data' | 'texto' | 'percentual' | 'cpf';

export type CampoDefis = {
  chave: string;
  label: string;
  tipo: TipoCampoDefis;
  obrigatorio: boolean;
  ajuda?: string;
};

export type GrupoDefis = {
  id: 'identificacao' | 'empregados' | 'receitas' | 'despesas' | 'aquisicoes' | 'socios';
  titulo: string;
  norma: string;
  repetivel?: boolean;
  campos: CampoDefis[];
};

export const GRUPOS_DEFIS: GrupoDefis[] = [
  {
    id: 'identificacao',
    titulo: 'Identificação e evento',
    norma: 'Res. CGSN 140/2018, art. 72',
    campos: [
      { chave: 'houveEvento', label: 'Houve cisão, fusão, incorporação ou extinção?', tipo: 'booleano', obrigatorio: true },
      { chave: 'eventoTipo', label: 'Tipo do evento', tipo: 'texto', obrigatorio: false, ajuda: 'Preencher só se houve evento.' },
      { chave: 'eventoData', label: 'Data do evento', tipo: 'data', obrigatorio: false },
      { chave: 'ganhosCapital', label: 'Ganhos de capital no ano', tipo: 'moeda', obrigatorio: true },
      { chave: 'doacoesCampanhaEleitoral', label: 'Doações a campanha eleitoral', tipo: 'moeda', obrigatorio: true },
    ],
  },
  {
    id: 'empregados',
    titulo: 'Empregados',
    norma: 'Res. CGSN 140/2018, art. 72',
    campos: [
      { chave: 'empregadosInicio', label: 'Empregados no início do ano', tipo: 'inteiro', obrigatorio: true },
      { chave: 'empregadosFim', label: 'Empregados no fim do ano', tipo: 'inteiro', obrigatorio: true },
    ],
  },
  {
    id: 'receitas',
    titulo: 'Receitas',
    norma: 'Res. CGSN 140/2018, art. 72',
    campos: [
      { chave: 'receitaMercadoInterno', label: 'Receita do mercado interno', tipo: 'moeda', obrigatorio: true },
      { chave: 'receitaMercadoExterno', label: 'Receita do mercado externo', tipo: 'moeda', obrigatorio: true },
      { chave: 'receitaBrutaTotal', label: 'Receita bruta total do ano', tipo: 'moeda', obrigatorio: true, ajuda: 'Sugerido a partir das suas notas.' },
    ],
  },
  {
    id: 'despesas',
    titulo: 'Despesas e resultado',
    norma: 'Res. CGSN 140/2018, art. 72',
    campos: [
      { chave: 'totalDespesas', label: 'Total de despesas no ano', tipo: 'moeda', obrigatorio: true },
      { chave: 'estoqueInicial', label: 'Estoque no início do ano', tipo: 'moeda', obrigatorio: true },
      { chave: 'estoqueFinal', label: 'Estoque no fim do ano', tipo: 'moeda', obrigatorio: true },
      { chave: 'saldoCaixaInicio', label: 'Saldo em caixa/banco no início', tipo: 'moeda', obrigatorio: true },
      { chave: 'saldoCaixaFim', label: 'Saldo em caixa/banco no fim', tipo: 'moeda', obrigatorio: true },
    ],
  },
  {
    id: 'aquisicoes',
    titulo: 'Aquisições e créditos',
    norma: 'Res. CGSN 140/2018, art. 72',
    campos: [
      { chave: 'aquisicoesMercadoInterno', label: 'Aquisições no mercado interno', tipo: 'moeda', obrigatorio: true },
      { chave: 'aquisicoesMercadoExterno', label: 'Aquisições no mercado externo', tipo: 'moeda', obrigatorio: true },
      { chave: 'creditosIcmsIssRetido', label: 'Créditos de ICMS/ISS retido', tipo: 'moeda', obrigatorio: true },
    ],
  },
  {
    id: 'socios',
    titulo: 'Sócios',
    norma: 'Res. CGSN 140/2018, art. 72',
    repetivel: true,
    campos: [
      { chave: 'cpf', label: 'CPF', tipo: 'cpf', obrigatorio: true },
      { chave: 'nome', label: 'Nome', tipo: 'texto', obrigatorio: true },
      { chave: 'participacaoPct', label: 'Participação (%)', tipo: 'percentual', obrigatorio: true },
      { chave: 'proLabore', label: 'Pró-labore no ano', tipo: 'moeda', obrigatorio: true },
      { chave: 'lucroDistribuido', label: 'Lucro distribuído no ano', tipo: 'moeda', obrigatorio: true },
      { chave: 'impostoRetido', label: 'Imposto retido na fonte', tipo: 'moeda', obrigatorio: true },
    ],
  },
];

/** Campos de valor único (tudo menos o grupo repetível de sócios). */
export function camposPlanos(): CampoDefis[] {
  return GRUPOS_DEFIS.filter((g) => !g.repetivel).flatMap((g) => g.campos);
}

/** Progresso do formulário. Zero e false CONTAM como preenchidos; '' e null não. */
export function contarPreenchidos(valores: Record<string, unknown>): { preenchidos: number; total: number } {
  const campos = camposPlanos();
  const preenchidos = campos.filter((c) => {
    const v = valores[c.chave];
    return v !== undefined && v !== null && v !== '';
  }).length;
  return { preenchidos, total: campos.length };
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `npx vitest run src/lib/fiscal/defis/grupos.test.ts`
Expected: PASS — 6 passed

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/fiscal/defis/grupos.ts app/src/lib/fiscal/defis/grupos.test.ts
git commit -m "feat(bloco-3): grupos do art. 72 (DEFIS) como dados"
```

---

## Task 8: Schema Zod do DEFIS

**Files:**
- Create: `app/src/lib/fiscal/defis/campos.ts`
- Test: `app/src/lib/fiscal/defis/campos.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// src/lib/fiscal/defis/campos.test.ts
import { describe, it, expect } from 'vitest';
import { DefisCamposSchema, SocioDefisSchema, defisVazio } from './campos';
import { camposPlanos } from './grupos';

const socio = (over: Partial<Record<string, unknown>> = {}) => ({
  cpf: '12345678901', nome: 'Maria Souza', participacaoPct: 100,
  proLabore: 0, lucroDistribuido: 0, impostoRetido: 0, ...over,
});

const base = () => ({
  ...defisVazio(),
  houveEvento: false,
  ganhosCapital: 0,
  doacoesCampanhaEleitoral: 0,
  empregadosInicio: 0,
  empregadosFim: 0,
  receitaMercadoInterno: 100000,
  receitaMercadoExterno: 0,
  receitaBrutaTotal: 100000,
  totalDespesas: 40000,
  estoqueInicial: 0,
  estoqueFinal: 0,
  saldoCaixaInicio: 0,
  saldoCaixaFim: 10000,
  aquisicoesMercadoInterno: 0,
  aquisicoesMercadoExterno: 0,
  creditosIcmsIssRetido: 0,
  socios: [socio()],
});

describe('SocioDefisSchema', () => {
  it('aceita um sócio válido', () => {
    expect(SocioDefisSchema.safeParse(socio()).success).toBe(true);
  });

  it('rejeita CPF fora de 11 dígitos', () => {
    expect(SocioDefisSchema.safeParse(socio({ cpf: '123' })).success).toBe(false);
  });

  it('rejeita participação acima de 100', () => {
    expect(SocioDefisSchema.safeParse(socio({ participacaoPct: 101 })).success).toBe(false);
  });
});

describe('DefisCamposSchema', () => {
  it('aceita um DEFIS completo com um sócio de 100%', () => {
    const r = DefisCamposSchema.safeParse(base());
    expect(r.success).toBe(true);
  });

  it('aceita dois sócios que somam 100%', () => {
    const r = DefisCamposSchema.safeParse({
      ...base(),
      socios: [socio({ participacaoPct: 60 }), socio({ cpf: '98765432100', participacaoPct: 40 })],
    });
    expect(r.success).toBe(true);
  });

  it('rejeita sócios que somam 99,99%', () => {
    const r = DefisCamposSchema.safeParse({
      ...base(),
      socios: [socio({ participacaoPct: 59.99 }), socio({ cpf: '98765432100', participacaoPct: 40 })],
    });
    expect(r.success).toBe(false);
  });

  it('rejeita lista de sócios vazia', () => {
    expect(DefisCamposSchema.safeParse({ ...base(), socios: [] }).success).toBe(false);
  });

  it('rejeita valor monetário negativo', () => {
    expect(DefisCamposSchema.safeParse({ ...base(), totalDespesas: -1 }).success).toBe(false);
  });

  it('rejeita número de empregados fracionário', () => {
    expect(DefisCamposSchema.safeParse({ ...base(), empregadosFim: 1.5 }).success).toBe(false);
  });

  // Guarda contra drift: todo campo de grupos.ts precisa existir no schema.
  it('cobre todo campo plano declarado em grupos.ts', () => {
    const shape = DefisCamposSchema.innerType().shape as Record<string, unknown>;
    for (const c of camposPlanos()) expect(Object.keys(shape)).toContain(c.chave);
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npx vitest run src/lib/fiscal/defis/campos.test.ts`
Expected: FAIL — `Failed to resolve import "./campos"`

- [ ] **Step 3: Implementar**

```ts
// src/lib/fiscal/defis/campos.ts
// Schema do DEFIS. Espelha grupos.ts campo a campo — o último teste de
// campos.test.ts falha se os dois saírem de sincronia.
import { z } from 'zod';
import { camposPlanos } from './grupos';

const moeda = z.number().min(0, 'Valor não pode ser negativo.');
const inteiro = z.number().int('Informe um número inteiro.').min(0);

export const SocioDefisSchema = z.object({
  cpf: z.string().regex(/^\d{11}$/, 'CPF deve ter 11 dígitos, sem máscara.'),
  nome: z.string().trim().min(3, 'Informe o nome do sócio.'),
  participacaoPct: z.number().min(0).max(100, 'Participação não pode passar de 100%.'),
  proLabore: moeda,
  lucroDistribuido: moeda,
  impostoRetido: moeda,
});

export type SocioDefis = z.infer<typeof SocioDefisSchema>;

const objeto = z.object({
  // identificação
  houveEvento: z.boolean(),
  eventoTipo: z.string().trim().nullable().default(null),
  eventoData: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.').nullable().default(null),
  ganhosCapital: moeda,
  doacoesCampanhaEleitoral: moeda,
  // empregados
  empregadosInicio: inteiro,
  empregadosFim: inteiro,
  // receitas
  receitaMercadoInterno: moeda,
  receitaMercadoExterno: moeda,
  receitaBrutaTotal: moeda,
  // despesas e resultado
  totalDespesas: moeda,
  estoqueInicial: moeda,
  estoqueFinal: moeda,
  saldoCaixaInicio: moeda,
  saldoCaixaFim: moeda,
  // aquisições
  aquisicoesMercadoInterno: moeda,
  aquisicoesMercadoExterno: moeda,
  creditosIcmsIssRetido: moeda,
  // sócios (grupo repetível)
  socios: z.array(SocioDefisSchema).min(1, 'Informe ao menos um sócio.'),
});

/** Tolerância de 1 centésimo de ponto percentual na soma das participações. */
export const DefisCamposSchema = objeto.refine(
  (v) => Math.abs(v.socios.reduce((s, x) => s + x.participacaoPct, 0) - 100) <= 0.01,
  { message: 'A participação dos sócios precisa somar 100%.', path: ['socios'] },
);

export type DefisCampos = z.infer<typeof DefisCamposSchema>;

/** Formulário em branco: todo campo plano como undefined, sócios vazio. */
export function defisVazio(): Record<string, unknown> {
  const vazio: Record<string, unknown> = {};
  for (const c of camposPlanos()) vazio[c.chave] = undefined;
  vazio.socios = [];
  return vazio;
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `npx vitest run src/lib/fiscal/defis/campos.test.ts`
Expected: PASS — 11 passed

> Se `innerType()` não existir na versão de Zod do projeto (é a API para desembrulhar um `ZodEffects` criado por `.refine`), trocar a última asserção por `Object.keys(objeto.shape)` exportando `objeto` como `DefisObjetoSchema`. Confirmar a versão em `package.json` antes de improvisar.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/fiscal/defis/campos.ts app/src/lib/fiscal/defis/campos.test.ts
git commit -m "feat(bloco-3): schema Zod do DEFIS derivado dos grupos"
```

---

## Task 9: Validação do comprovante e path no storage

**Files:**
- Create: `app/src/lib/fiscal/declaracoes-anuais/comprovante.ts`
- Test: `app/src/lib/fiscal/declaracoes-anuais/comprovante.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// src/lib/fiscal/declaracoes-anuais/comprovante.test.ts
import { describe, it, expect } from 'vitest';
import { validarComprovante, caminhoComprovante, MAX_COMPROVANTE_BYTES, BUCKET_COMPROVANTES } from './comprovante';

describe('validarComprovante', () => {
  it('aceita PDF dentro do limite', () => {
    expect(validarComprovante({ mime: 'application/pdf', tamanho: 1024 })).toEqual({ ok: true });
  });

  it('aceita PNG e JPEG', () => {
    expect(validarComprovante({ mime: 'image/png', tamanho: 1024 }).ok).toBe(true);
    expect(validarComprovante({ mime: 'image/jpeg', tamanho: 1024 }).ok).toBe(true);
  });

  it('rejeita tipo não suportado', () => {
    const r = validarComprovante({ mime: 'application/zip', tamanho: 1024 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('PDF');
  });

  it('rejeita arquivo acima do limite', () => {
    const r = validarComprovante({ mime: 'application/pdf', tamanho: MAX_COMPROVANTE_BYTES + 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('5 MB');
  });

  it('rejeita arquivo vazio', () => {
    expect(validarComprovante({ mime: 'application/pdf', tamanho: 0 }).ok).toBe(false);
  });
});

describe('caminhoComprovante', () => {
  it('gera path determinístico por empresa, tipo e ano', () => {
    expect(caminhoComprovante('abc-123', 'DASN-SIMEI', 2025, 'application/pdf'))
      .toBe('abc-123/DASN-SIMEI-2025.pdf');
  });

  it('usa a extensão do tipo enviado', () => {
    expect(caminhoComprovante('abc-123', 'DEFIS', 2025, 'image/png')).toBe('abc-123/DEFIS-2025.png');
  });

  // Path determinístico é o que faz a retificadora substituir o recibo anterior
  // em vez de acumular lixo no bucket.
  it('repete o mesmo path para o mesmo trio', () => {
    const a = caminhoComprovante('x', 'DEFIS', 2024, 'application/pdf');
    const b = caminhoComprovante('x', 'DEFIS', 2024, 'application/pdf');
    expect(a).toBe(b);
  });

  it('rejeita companyId com barra (path traversal)', () => {
    expect(() => caminhoComprovante('../etc', 'DEFIS', 2025, 'application/pdf')).toThrow();
  });
});

describe('BUCKET_COMPROVANTES', () => {
  it('aponta para o bucket criado na 0048', () => {
    expect(BUCKET_COMPROVANTES).toBe('declaracoes-comprovantes');
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npx vitest run src/lib/fiscal/declaracoes-anuais/comprovante.test.ts`
Expected: FAIL — `Failed to resolve import "./comprovante"`

- [ ] **Step 3: Implementar**

```ts
// src/lib/fiscal/declaracoes-anuais/comprovante.ts
// Validação e endereçamento do recibo baixado do portal da Receita. Puro:
// a action chama isto ANTES de tocar no storage (spec §5.5).
import type { DeclaracaoAnualTipo } from './tipos';

export const BUCKET_COMPROVANTES = 'declaracoes-comprovantes';
export const MAX_COMPROVANTE_BYTES = 5 * 1024 * 1024;

const EXTENSAO: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
};

export type ResultadoValidacao = { ok: true } | { ok: false; error: string };

export function validarComprovante(c: { mime: string; tamanho: number }): ResultadoValidacao {
  if (!EXTENSAO[c.mime]) return { ok: false, error: 'O comprovante precisa ser PDF, PNG ou JPEG.' };
  if (c.tamanho <= 0) return { ok: false, error: 'O arquivo está vazio.' };
  if (c.tamanho > MAX_COMPROVANTE_BYTES) return { ok: false, error: 'O comprovante passa de 5 MB.' };
  return { ok: true };
}

/**
 * Path determinístico `${companyId}/${tipo}-${ano}.${ext}`. Com upsert, a
 * retificadora substitui o recibo anterior em vez de acumular lixo no bucket.
 */
export function caminhoComprovante(
  companyId: string,
  tipo: DeclaracaoAnualTipo,
  ano: number,
  mime: string,
): string {
  if (!/^[\w-]+$/.test(companyId)) throw new Error('companyId inválido');
  const ext = EXTENSAO[mime];
  if (!ext) throw new Error('MIME não suportado');
  return `${companyId}/${tipo}-${ano}.${ext}`;
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `npx vitest run src/lib/fiscal/declaracoes-anuais/comprovante.test.ts`
Expected: PASS — 9 passed

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/fiscal/declaracoes-anuais/comprovante.ts app/src/lib/fiscal/declaracoes-anuais/comprovante.test.ts
git commit -m "feat(bloco-3): validacao e path do comprovante de declaracao"
```

---

## Task 10: Núcleo do registro

O passo que a Step 3 tem de acertar e é fácil esquecer: **marcar as notificações já criadas como lidas**. A RPC só deixa de *criar* o aviso; sem esta linha o usuário entrega a declaração e o sino continua tocando (spec §5.4).

**Files:**
- Create: `app/src/lib/fiscal/declaracoes-anuais/registrar.ts`

Sem teste unitário — é orquestração sobre Supabase. A cobertura é o smoke da Task 13, que verifica o efeito observável (a RPC parar de gerar aviso).

- [ ] **Step 1: Implementar**

```ts
// src/lib/fiscal/declaracoes-anuais/registrar.ts
// Núcleo compartilhado do registro de declaração anual. Os dois callers
// (empresário e contador) provam a permissão ANTES de chegar aqui — ver spec §5.1.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { registrarAuditoria } from '@/lib/security/audit';
import { BUCKET_COMPROVANTES, caminhoComprovante, validarComprovante } from './comprovante';
import { TIPO_AVISO, type RegistroInput, type ResultadoRegistro } from './tipos';

export async function registrarDeclaracaoAnual(
  client: SupabaseClient,
  input: RegistroInput,
  contabilidadeId: string | null = null,
): Promise<ResultadoRegistro> {
  let comprovantePath: string | null = null;

  if (input.comprovante) {
    const v = validarComprovante({ mime: input.comprovante.mime, tamanho: input.comprovante.bytes.byteLength });
    if (!v.ok) return { ok: false, error: v.error };

    comprovantePath = caminhoComprovante(input.companyId, input.tipo, input.ano, input.comprovante.mime);
    const up = await client.storage
      .from(BUCKET_COMPROVANTES)
      .upload(comprovantePath, input.comprovante.bytes, { contentType: input.comprovante.mime, upsert: true });
    if (up.error) return { ok: false, error: `Falha ao subir o comprovante: ${up.error.message}` };
  }

  // Estado anterior, para a auditoria da retificadora (spec §5.5).
  const { data: anterior } = await client
    .from('declaracoes_fiscais')
    .select('id, dados, numero_declaracao, data_transmissao')
    .eq('company_id', input.companyId)
    .eq('competencia_referencia', String(input.ano))
    .eq('tipo', input.tipo)
    .maybeSingle();

  const linha: Record<string, unknown> = {
    company_id: input.companyId,
    owner_user_id: input.ownerUserId,
    competencia_referencia: String(input.ano),
    tipo: input.tipo,
    dados: input.dados,
    numero_declaracao: input.numeroDeclaracao ?? null,
    data_transmissao: input.dataTransmissao ?? null,
    status: input.dataTransmissao ? 'Transmitida' : 'Rascunho',
    divergencia_receita: input.divergenciaReceita ?? null,
    origem: input.origem,
    registrado_por: input.registradoPor,
  };
  if (comprovantePath) linha.comprovante_path = comprovantePath;

  const { data, error } = await client
    .from('declaracoes_fiscais')
    .upsert(linha, { onConflict: 'company_id,competencia_referencia,tipo' })
    .select('id')
    .single();

  if (error) return { ok: false, error: error.message };
  const id = (data as { id: string }).id;

  // Só a entrega cala o alarme. Rascunho não silencia nada (spec §5.3).
  if (input.dataTransmissao) {
    const prefixo = `${TIPO_AVISO[input.tipo]}:${input.companyId}:${input.ano}:`;
    await client
      .from('notifications')
      .update({ lida_em: new Date().toISOString() })
      .eq('owner_user_id', input.ownerUserId)
      .like('chave', `${prefixo}%`)
      .is('lida_em', null);
  }

  await registrarAuditoria({
    actorUserId: input.registradoPor,
    acao: anterior ? 'declaracao.retificar' : 'declaracao.registrar',
    alvoTipo: 'declaracao_fiscal',
    alvoId: id,
    contabilidadeId,
    meta: {
      tipo: input.tipo,
      ano: input.ano,
      entregue: Boolean(input.dataTransmissao),
      divergenciaReceita: input.divergenciaReceita ?? null,
      anterior: anterior ?? null,
    },
  });

  return { ok: true, id };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/fiscal/declaracoes-anuais/registrar.ts
git commit -m "feat(bloco-3): nucleo de registro de declaracao anual"
```

---

## Task 11: Server Action do empresário

**Files:**
- Modify: `app/src/app/(auth)/(gated)/impostos/actions.ts`

- [ ] **Step 1: Acrescentar os imports no topo do arquivo**

```ts
import { registrarDeclaracaoAnual } from '@/lib/fiscal/declaracoes-anuais/registrar';
import { calcularDivergencia } from '@/lib/fiscal/declaracoes-anuais/divergencia';
import { lerNotasAnoCalendario } from '@/lib/fiscal/receitas-source';
import { resumirReceitasAno } from '@/lib/fiscal/dasn/resumo';
import { DasnCamposSchema } from '@/lib/fiscal/dasn/campos';
import { DefisCamposSchema } from '@/lib/fiscal/defis/campos';
import type { DeclaracaoAnualTipo } from '@/lib/fiscal/declaracoes-anuais/tipos';
```

- [ ] **Step 2: Acrescentar a action ao fim do arquivo**

```ts
export type RegistrarDeclaracaoResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * Registra (ou retifica) a declaração anual da empresa atual do usuário.
 * `dataTransmissao` ausente = rascunho: grava, mas NÃO cala o aviso do sino.
 * Roda com a sessão do usuário — a policy declaracoes_fiscais_owner cobre a escrita.
 */
export async function registrarDeclaracaoAnualAction(input: {
  tipo: DeclaracaoAnualTipo;
  ano: number;
  dados: Record<string, unknown>;
  numeroDeclaracao?: string | null;
  dataTransmissao?: string | null;
  comprovante?: { nome: string; mime: string; base64: string } | null;
}): Promise<RegistrarDeclaracaoResult> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão inválida.' };

  const { data: profile } = await supabase
    .from('profiles').select('current_company').eq('user_id', user.id).single();
  const companyId = (profile?.current_company ?? null) as string | null;
  if (!companyId) return { ok: false, error: 'Nenhuma empresa selecionada.' };

  const parsed = input.tipo === 'DASN-SIMEI'
    ? DasnCamposSchema.safeParse(input.dados)
    : DefisCamposSchema.safeParse(input.dados);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };
  }

  // Divergência: compara o total declarado com o apurado pelas notas do ano.
  const notas = await lerNotasAnoCalendario(supabase, companyId, input.ano);
  const resumo = resumirReceitasAno(notas, input.ano);
  const d = parsed.data as { receitaComercio?: number; receitaServico?: number; receitaBrutaTotal?: number };
  const declarado = input.tipo === 'DASN-SIMEI'
    ? (d.receitaComercio ?? 0) + (d.receitaServico ?? 0)
    : (d.receitaBrutaTotal ?? 0);
  const divergencia = calcularDivergencia(declarado, resumo.total);

  return registrarDeclaracaoAnual(supabase, {
    companyId,
    ownerUserId: user.id,
    tipo: input.tipo,
    ano: input.ano,
    dados: parsed.data as Record<string, unknown>,
    numeroDeclaracao: input.numeroDeclaracao ?? null,
    dataTransmissao: input.dataTransmissao ?? null,
    divergenciaReceita: divergencia.diferenca,
    origem: 'manual',
    registradoPor: user.id,
    comprovante: input.comprovante
      ? { nome: input.comprovante.nome, mime: input.comprovante.mime, bytes: Buffer.from(input.comprovante.base64, 'base64') }
      : null,
  }).then((r) => {
    if (r.ok) revalidatePath('/impostos');
    return r;
  });
}
```

- [ ] **Step 3: Conferir os imports que já existem no arquivo**

`createServerClient` e `revalidatePath` já são importados em `impostos/actions.ts`. **Verificar antes de duplicar** — import duplicado quebra o build.

Run: `npm run typecheck`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add "app/src/app/(auth)/(gated)/impostos/actions.ts"
git commit -m "feat(bloco-3): action de registro de declaracao anual (empresario)"
```

---

## Task 12: Server Action do contador

O contador tem RLS **SELECT-only** em `declaracoes_fiscais` (`0033:26`). A escrita é service role, com a permissão provada na aplicação — mesmo padrão de `contador/aberturas/actions.ts`, incluindo o 403 genérico que não revela se a empresa existe.

**Files:**
- Create: `app/src/lib/contador/carteira.ts`
- Create: `app/src/app/(auth)/(gated)/contador/clientes/actions.ts`

- [ ] **Step 1: Escrever a guarda de carteira em módulo próprio**

Ela **não** pode morar no arquivo `'use server'`: todo export de um módulo de Server Actions precisa ser uma action serializável, e esta recebe o client Supabase. Em módulo próprio, o smoke da Task 15 também consegue exercitá-la sem sessão de browser.

```ts
// src/lib/contador/carteira.ts
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

export type AlvoCarteira = { companyId: string; ownerUserId: string };

/**
 * Guard anti-IDOR: a empresa precisa estar na carteira do escritório.
 * Devolve null tanto para "não existe" quanto para "existe mas é de outro
 * escritório" — o caller responde 403 genérico, sem revelar a diferença.
 */
export async function companyDaCarteira(
  admin: SupabaseClient,
  contabilidadeId: string,
  companyId: string,
): Promise<AlvoCarteira | null> {
  const { data } = await admin
    .from('companies').select('id, user_id, contabilidade_id').eq('id', companyId).maybeSingle();
  const c = data as { id: string; user_id: string | null; contabilidade_id: string | null } | null;
  if (!c || c.contabilidade_id !== contabilidadeId || !c.user_id) return null;
  return { companyId: c.id, ownerUserId: c.user_id };
}
```

- [ ] **Step 2: Implementar a action**

```ts
// src/app/(auth)/(gated)/contador/clientes/actions.ts
'use server';
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { getContabilidadeCtx } from '@/lib/contador/guards';
import { companyDaCarteira } from '@/lib/contador/carteira';
import { registrarDeclaracaoAnual } from '@/lib/fiscal/declaracoes-anuais/registrar';
import { calcularDivergencia } from '@/lib/fiscal/declaracoes-anuais/divergencia';
import { lerNotasAnoCalendario } from '@/lib/fiscal/receitas-source';
import { resumirReceitasAno } from '@/lib/fiscal/dasn/resumo';
import { DasnCamposSchema } from '@/lib/fiscal/dasn/campos';
import { DefisCamposSchema } from '@/lib/fiscal/defis/campos';
import type { DeclaracaoAnualTipo } from '@/lib/fiscal/declaracoes-anuais/tipos';

export type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

// Anotação explícita do retorno: sem ela o TS infere cada ramo com as chaves do
// outro como `?: undefined` e `'error' in e` deixa de estreitar o tipo.
async function requireEscritorio(): Promise<{ error: string } | { userId: string; contabilidadeId: string }> {
  const g = await getContabilidadeCtx();
  if ('error' in g) return { error: g.error };
  if (!g.contabilidade || g.contabilidade.status !== 'aprovada') return { error: 'Escritório não aprovado.' };
  return { userId: g.userId, contabilidadeId: g.contabilidade.id };
}

export async function registrarDeclaracaoAnualContadorAction(input: {
  companyId: string;
  tipo: DeclaracaoAnualTipo;
  ano: number;
  dados: Record<string, unknown>;
  numeroDeclaracao?: string | null;
  dataTransmissao?: string | null;
  comprovante?: { nome: string; mime: string; base64: string } | null;
}): Promise<ActionResult<{ id: string }>> {
  const e = await requireEscritorio();
  if ('error' in e) return { ok: false, error: e.error };

  const admin = createAdminClient();
  const alvo = await companyDaCarteira(admin, e.contabilidadeId, input.companyId);
  if (!alvo) return { ok: false, error: 'Empresa fora da sua carteira.' };

  const parsed = input.tipo === 'DASN-SIMEI'
    ? DasnCamposSchema.safeParse(input.dados)
    : DefisCamposSchema.safeParse(input.dados);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };
  }

  const notas = await lerNotasAnoCalendario(admin, alvo.companyId, input.ano);
  const resumo = resumirReceitasAno(notas, input.ano);
  const d = parsed.data as { receitaComercio?: number; receitaServico?: number; receitaBrutaTotal?: number };
  const declarado = input.tipo === 'DASN-SIMEI'
    ? (d.receitaComercio ?? 0) + (d.receitaServico ?? 0)
    : (d.receitaBrutaTotal ?? 0);
  const divergencia = calcularDivergencia(declarado, resumo.total);

  const r = await registrarDeclaracaoAnual(admin, {
    companyId: alvo.companyId,
    ownerUserId: alvo.ownerUserId,
    tipo: input.tipo,
    ano: input.ano,
    dados: parsed.data as Record<string, unknown>,
    numeroDeclaracao: input.numeroDeclaracao ?? null,
    dataTransmissao: input.dataTransmissao ?? null,
    divergenciaReceita: divergencia.diferenca,
    origem: 'manual',
    registradoPor: e.userId,
    comprovante: input.comprovante
      ? { nome: input.comprovante.nome, mime: input.comprovante.mime, bytes: Buffer.from(input.comprovante.base64, 'base64') }
      : null,
  }, e.contabilidadeId);

  if (!r.ok) return { ok: false, error: r.error };
  revalidatePath(`/contador/clientes/${alvo.companyId}`);
  return { ok: true, data: { id: r.id } };
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add app/src/lib/contador/carteira.ts "app/src/app/(auth)/(gated)/contador/clientes/actions.ts"
git commit -m "feat(bloco-3): action de registro de declaracao anual (contador)"
```

---

## Task 13: Migration 0049 — aviso `defis_pendente`

`CREATE OR REPLACE FUNCTION` exige o corpo inteiro. A migration reproduz a função da `0047` e acrescenta um bloco — mesmo procedimento e mesmo cuidado da `0047`.

**Files:**
- Create: `app/supabase/migrations/0049_defis_pendente.sql`

- [ ] **Step 1: Copiar a 0047 como base**

A partir de `D:\balu-app-v2\balu`:

```bash
cp app/supabase/migrations/0047_dasn_janela_janeiro.sql app/supabase/migrations/0049_defis_pendente.sql
```

- [ ] **Step 2: Trocar o cabeçalho de comentário**

Substituir todo o bloco de comentários do topo (linhas 1–11 da 0047) por:

```sql
-- 0049_defis_pendente.sql — acrescenta o aviso defis_pendente ao motor de obrigacoes.
--
-- MOTIVO: a RPC ja avisa DASN-SIMEI (MEI) desde a 0045b/0047, mas o DEFIS das
-- ME/EPP do Simples nunca teve bloco — o CHECK de notifications.tipo (0045:11)
-- ja previa 'defis_pendente' e o valor nunca foi usado.
--
-- MUDANCA: um bloco novo apos o da DASN. O restante do corpo e identico a 0047
-- (CREATE OR REPLACE exige a funcao inteira).
--
-- PREMISSAS (spec Bloco 3, itens 2 e 3 — confirmar com o Michel):
--   publico: Code_regime_tributario IN ('1','2'); '3' e Regime Normal, '4' e MEI
--   janela : janeiro a abril; danger a partir de marco; prazo 31/03 (art. 72)
```

- [ ] **Step 3: Inserir o bloco novo**

Localizar o fim do bloco da DASN — a linha `SELECT count(*) INTO v_n FROM ins;  v_total := v_total + v_n;` que vem logo depois do `RETURNING 1` do `dasn_pendente` — e **inserir imediatamente abaixo dela**:

```sql
  -- ── DEFIS (ME/EPP do Simples: codes 1 e 2) do ano anterior nao entregue (jan-abr) ─
  WITH base AS (
    SELECT c.user_id AS owner_user_id, c.id AS company_id, ef."Code_regime_tributario" AS code,
           (extract(year FROM p_hoje)::int - 1) AS ano
    FROM public.companies c
    JOIN public.empresas_fiscais ef ON ef.empresa_id = c.id AND ef.deleted_at IS NULL
    WHERE c.deleted_at IS NULL AND c.user_id IS NOT NULL
  ),
  pend AS (
    SELECT owner_user_id, company_id, ano FROM base b
    WHERE b.code IN ('1','2') AND extract(month FROM p_hoje) BETWEEN 1 AND 4  -- code e varchar
      AND NOT EXISTS (SELECT 1 FROM public.declaracoes_fiscais d
        WHERE d.company_id = b.company_id AND d.tipo = 'DEFIS'
          AND d.data_transmissao IS NOT NULL AND d.competencia_referencia = b.ano::text)
  ),
  ins AS (
    INSERT INTO public.notifications
      (owner_user_id, company_id, tipo, severidade, titulo, corpo, norma, action_href, chave, agendada_para)
    SELECT owner_user_id, company_id, 'defis_pendente',
      CASE WHEN extract(month FROM p_hoje) >= 3 THEN 'danger' ELSE 'warning' END,
      'Declaracao anual do Simples (DEFIS) pendente',
      'A DEFIS de ' || ano || ' ainda nao foi entregue. O prazo e 31/03.',
      'Res. CGSN 140/2018, art. 72', '/impostos',
      'defis_pendente:' || company_id::text || ':' || ano::text || ':' ||
        (CASE WHEN extract(month FROM p_hoje) >= 3 THEN 'V' ELSE 'M' || extract(month FROM p_hoje)::text END),
      make_date(extract(year FROM p_hoje)::int, 3, 31)
    FROM pend
    ON CONFLICT (owner_user_id, chave) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM ins;  v_total := v_total + v_n;
```

> O formato da `chave` importa: `registrar.ts` (Task 10) marca as notificações como lidas por `LIKE 'defis_pendente:<companyId>:<ano>:%'`. Mudar o formato aqui quebra a supressão do aviso lá.

- [ ] **Step 4: Conferir que o ACL do fim do arquivo veio junto**

O arquivo tem de terminar com (herdado da 0047):

```sql
REVOKE ALL ON FUNCTION public.materializar_obrigacoes(date) FROM public;
GRANT EXECUTE ON FUNCTION public.materializar_obrigacoes(date) TO service_role;
```

Se a cópia perdeu essas linhas, acrescentar. Sem elas a função fica executável por qualquer role autenticada.

- [ ] **Step 5: Aplicar**

A partir de `D:\balu-app-v2\balu`:

```bash
node app/scratchpad/apply-migration.mjs app/supabase/migrations/0049_defis_pendente.sql
```

Expected: `OK: ...0049_defis_pendente.sql aplicada via conexão direta.`

- [ ] **Step 6: Commit**

```bash
git add app/supabase/migrations/0049_defis_pendente.sql
git commit -m "feat(bloco-3): migration 0049 — aviso defis_pendente no motor de obrigacoes"
```

---

## Task 14: Seed de empresa MEI

**Não existe nenhuma empresa MEI na base** — as quatro linhas de `empresas_fiscais` têm `Code_regime_tributario = '1'`. Sem isto, a DASN não tem como ser testada ponta a ponta.

**Files:**
- Create: `app/scratchpad/seed-empresa-mei.mjs`

- [ ] **Step 1: Escrever o seed**

Modelado em `app/scratchpad/seed-abertura-bloco2.mjs` (mesmo formato de env, mesma dupla `seed` / `restore`).

```js
// Seed de empresa MEI para testar o Bloco 3 (DASN-SIMEI). Cria uma company com
// user_id do cliente de teste, empresas_fiscais code '4', e 3 notas no ano anterior.
//
// Uso (a partir de balu/):
//   node app/scratchpad/seed-empresa-mei.mjs           -> cria/recria (idempotente)
//   node app/scratchpad/seed-empresa-mei.mjs restore   -> apaga tudo o que criou
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const CLIENTE_EMAIL = 'walacesssantos@gmail.com';
const SENTINEL_RAZAO = 'SEED BLOCO3 MEI LTDA';
const ANO = new Date().getFullYear() - 1;

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODE = (process.argv[2] || 'seed').toLowerCase();

const env = Object.fromEntries(
  readFileSync(join(appDir, '.env.local'), 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => {
    const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
  }),
);
const ref = (env.NEXT_PUBLIC_SUPABASE_URL || '').match(/https:\/\/([a-z0-9]+)\./)?.[1];
if (!ref || !env.SUPABASE_PASSWORD) { console.error('Faltou NEXT_PUBLIC_SUPABASE_URL / SUPABASE_PASSWORD em app/.env.local'); process.exit(1); }

const client = new pg.Client({ host: `db.${ref}.supabase.co`, port: 5432, user: 'postgres', password: env.SUPABASE_PASSWORD, database: 'postgres', ssl: { rejectUnauthorized: false } });

async function limpar() {
  const { rows } = await client.query('SELECT id FROM public.companies WHERE razao_social = $1', [SENTINEL_RAZAO]);
  const ids = rows.map((r) => r.id);
  if (!ids.length) return 0;
  await client.query('DELETE FROM public.declaracoes_fiscais WHERE company_id = ANY($1::uuid[])', [ids]);
  await client.query('DELETE FROM public.notas_fiscais WHERE company_id = ANY($1::uuid[])', [ids]);
  await client.query('DELETE FROM public.notifications WHERE company_id = ANY($1::uuid[])', [ids]);
  await client.query('DELETE FROM public.empresas_fiscais WHERE empresa_id = ANY($1::uuid[])', [ids]);
  await client.query('UPDATE public.profiles SET current_company = NULL WHERE current_company = ANY($1::uuid[])', [ids]);
  await client.query('DELETE FROM public.companies WHERE id = ANY($1::uuid[])', [ids]);
  return ids.length;
}

async function seed() {
  await client.connect();
  const { rows: u } = await client.query('SELECT id FROM auth.users WHERE lower(email) = lower($1) LIMIT 1', [CLIENTE_EMAIL]);
  const userId = u[0]?.id;
  if (!userId) throw new Error(`Usuário não encontrado: ${CLIENTE_EMAIL}`);

  await limpar();

  const { rows: c } = await client.query(
    `INSERT INTO public.companies (user_id, status, nome, razao_social, cnpj)
     VALUES ($1, 'ativa', $2, $2, '12345678000195') RETURNING id`,
    [userId, SENTINEL_RAZAO],
  );
  const companyId = c[0].id;

  await client.query(
    `INSERT INTO public.empresas_fiscais (empresa_id, owner_user_id, cnpj, "Code_regime_tributario", regime_tributario)
     VALUES ($1, $2, '12345678000195', '4', 'mei')`,
    [companyId, userId],
  );

  // 3 notas no ano anterior: 2 de comércio (NFe/NFCe) e 1 de serviço (NFSe).
  // A de 31/12 23:30 BRT é a que prova o recorte de ano em resumirReceitasAno.
  const notas = [
    [`${ANO}-03-10T12:00:00-03:00`, 1500, 'NFe'],
    [`${ANO}-07-22T15:30:00-03:00`, 800, 'NFCe'],
    [`${ANO}-12-31T23:30:00-03:00`, 2200, 'NFSe'],
  ];
  for (const [data, valor, tipo] of notas) {
    await client.query(
      `INSERT INTO public.notas_fiscais (company_id, owner_user_id, data_emissao, valor_total, status, tipo_documento)
       VALUES ($1, $2, $3, $4, 'ativa', $5)`,
      [companyId, userId, data, valor, tipo],
    );
  }

  await client.query('UPDATE public.profiles SET current_company = $1, updated_at = now() WHERE user_id = $2', [companyId, userId]);
  await client.end();

  console.log('\n✅ SEED MEI criado.');
  console.log('  company_id:', companyId);
  console.log('  ano-calendário:', ANO, '| comércio 2300, serviço 2200, total 4500');
  console.log('  Restaurar:  node app/scratchpad/seed-empresa-mei.mjs restore\n');
}

async function restore() {
  await client.connect();
  const n = await limpar();
  await client.end();
  console.log(`\n♻️  RESTORE ok — ${n} empresa(s) de seed removida(s).\n`);
}

(MODE === 'restore' ? restore() : seed()).catch(async (e) => {
  try { await client.end(); } catch { /* noop */ }
  console.error('ERRO:', e.message);
  process.exit(1);
});
```

- [ ] **Step 2: Rodar e conferir**

A partir de `D:\balu-app-v2\balu`:

```bash
node app/scratchpad/seed-empresa-mei.mjs
```

Expected: imprime `company_id` e `comércio 2300, serviço 2200, total 4500`.

> Se falhar por coluna NOT NULL faltando em `companies`, `empresas_fiscais` ou `notas_fiscais`, acrescentar a coluna ao INSERT — o schema real manda, não este plano. Foi assim que `titular_cpf` apareceu no seed do Bloco 2.

- [ ] **Step 3: Não commitar**

`app/scratchpad/` não é versionado (aparece como `??` no `git status` e assim deve ficar). Nada a commitar nesta task.

---

## Task 15: Smoke — a entrega cala o aviso, o rascunho não

Este é o par de testes que prova a regra central do bloco (spec §5.3 e §5.4).

**Files:**
- Create: `app/src/lib/fiscal/declaracoes-anuais/registrar.smoke.test.ts`

- [ ] **Step 1: Escrever o smoke**

```ts
// src/lib/fiscal/declaracoes-anuais/registrar.smoke.test.ts
// Smoke contra o banco REAL. Exige a empresa do seed (scratchpad/seed-empresa-mei.mjs).
// Faz snapshot antes e restaura depois — e VERIFICA a restauração por query.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { companyDaCarteira } from '@/lib/contador/carteira';

const env = Object.fromEntries(
  readFileSync(new URL('../../../../.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/).filter((l) => l.includes('=')).map((l) => {
      const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    }),
);

const RAZAO_SEED = 'SEED BLOCO3 MEI LTDA';
const ANO = new Date().getFullYear() - 1;

let admin: SupabaseClient;
let companyId: string;
let ownerUserId: string;

beforeAll(async () => {
  admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data } = await admin.from('companies').select('id, user_id').eq('razao_social', RAZAO_SEED).maybeSingle();
  if (!data) throw new Error('Rode antes: node app/scratchpad/seed-empresa-mei.mjs');
  companyId = data.id as string;
  ownerUserId = data.user_id as string;
});

afterAll(async () => {
  // Limpa o que o teste criou e CONFIRMA que limpou.
  await admin.from('declaracoes_fiscais').delete().eq('company_id', companyId);
  await admin.from('notifications').delete().eq('company_id', companyId);
  const { count } = await admin.from('declaracoes_fiscais')
    .select('id', { count: 'exact', head: true }).eq('company_id', companyId);
  expect(count).toBe(0);
});

/** Roda a RPC numa data dentro da janela e devolve quantos avisos do tipo existem. */
async function avisosApos(hoje: string, tipo: string): Promise<number> {
  await admin.rpc('materializar_obrigacoes', { p_hoje: hoje });
  const { count } = await admin.from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId).eq('tipo', tipo);
  return count ?? 0;
}

describe('supressão do aviso de declaração anual', () => {
  it('sem declaração nenhuma, a RPC gera dasn_pendente', async () => {
    await admin.from('declaracoes_fiscais').delete().eq('company_id', companyId);
    await admin.from('notifications').delete().eq('company_id', companyId);
    expect(await avisosApos(`${ANO + 1}-02-15`, 'dasn_pendente')).toBeGreaterThan(0);
  });

  it('rascunho NÃO impede o aviso', async () => {
    await admin.from('notifications').delete().eq('company_id', companyId);
    await admin.from('declaracoes_fiscais').upsert({
      company_id: companyId, owner_user_id: ownerUserId, competencia_referencia: String(ANO),
      tipo: 'DASN-SIMEI', dados: { receitaComercio: 2300, receitaServico: 2200, possuiEmpregado: false },
      data_transmissao: null, status: 'Rascunho', origem: 'manual',
    }, { onConflict: 'company_id,competencia_referencia,tipo' });

    expect(await avisosApos(`${ANO + 1}-02-15`, 'dasn_pendente')).toBeGreaterThan(0);
  });

  it('entrega (data_transmissao preenchida) impede o aviso', async () => {
    await admin.from('notifications').delete().eq('company_id', companyId);
    await admin.from('declaracoes_fiscais').upsert({
      company_id: companyId, owner_user_id: ownerUserId, competencia_referencia: String(ANO),
      tipo: 'DASN-SIMEI', dados: { receitaComercio: 2300, receitaServico: 2200, possuiEmpregado: false },
      data_transmissao: `${ANO + 1}-05-20`, numero_declaracao: '123456789', status: 'Transmitida', origem: 'manual',
    }, { onConflict: 'company_id,competencia_referencia,tipo' });

    expect(await avisosApos(`${ANO + 1}-02-15`, 'dasn_pendente')).toBe(0);
  });
});

describe('guarda de carteira do contador (anti-IDOR)', () => {
  it('recusa a empresa quando a contabilidade não bate', async () => {
    const alvo = await companyDaCarteira(admin, '00000000-0000-0000-0000-000000000000', companyId);
    expect(alvo).toBeNull();
  });

  it('recusa companyId inexistente com o mesmo null (não vaza existência)', async () => {
    const alvo = await companyDaCarteira(admin, '00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111');
    expect(alvo).toBeNull();
  });

  // Controle discriminante: se a guarda recusasse TUDO, os dois testes acima
  // passariam por acidente. Este prova que ela aceita o caso legítimo.
  it('aceita a empresa quando a contabilidade bate', async () => {
    const { data } = await admin.from('companies').select('contabilidade_id').eq('id', companyId).single();
    const contabilidadeId = data?.contabilidade_id as string | null;
    if (!contabilidadeId) {
      // O seed cria a empresa sem contabilidade; vincula temporariamente só para este teste.
      const { data: qualquer } = await admin.from('contabilidades').select('id').limit(1).single();
      await admin.from('companies').update({ contabilidade_id: qualquer!.id }).eq('id', companyId);
      const alvo = await companyDaCarteira(admin, qualquer!.id as string, companyId);
      expect(alvo).not.toBeNull();
      expect(alvo!.ownerUserId).toBe(ownerUserId);
      await admin.from('companies').update({ contabilidade_id: null }).eq('id', companyId);
      return;
    }
    const alvo = await companyDaCarteira(admin, contabilidadeId, companyId);
    expect(alvo).not.toBeNull();
  });
});
```

- [ ] **Step 2: Rodar o smoke**

Pré-requisito: seed criado (Task 14).

Run: `npx vitest run src/lib/fiscal/declaracoes-anuais/registrar.smoke.test.ts`
Expected: PASS — 6 passed

> A RPC materializa para **todas** as empresas, não só a do seed. O `afterAll` só apaga as notificações da empresa do seed; avisos gerados para outras empresas na mesma chamada permanecem. Se isso incomodar, apagar por `chave LIKE '%:<ano>:%'` restrito às companies de teste — nunca um `DELETE` amplo em `notifications`.

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/fiscal/declaracoes-anuais/registrar.smoke.test.ts
git commit -m "test(bloco-3): smoke da supressao do aviso de declaracao anual"
```

---

## Task 16: Casca visual e dialog de comprovante

**Files:**
- Create: `app/src/app/(auth)/(gated)/impostos/DeclaracaoAnualShell.tsx`
- Create: `app/src/app/(auth)/(gated)/impostos/RegistrarComprovanteDialog.tsx`

- [ ] **Step 1: Escrever a casca**

```tsx
// src/app/(auth)/(gated)/impostos/DeclaracaoAnualShell.tsx
// Casca comum das duas declarações anuais. DASN e DEFIS diferem só pelo children.
import { CalendarClock } from 'lucide-react';

export type EstadoDeclaracao = 'rascunho' | 'entregue' | 'em_atraso';

const BADGE: Record<EstadoDeclaracao, { label: string; cls: string }> = {
  rascunho:  { label: 'Rascunho',  cls: 'bg-surface-3 text-muted-foreground' },
  entregue:  { label: 'Entregue',  cls: 'bg-green-500/10 text-green-600' },
  em_atraso: { label: 'Em atraso', cls: 'bg-destructive/10 text-destructive' },
};

export default function DeclaracaoAnualShell({
  titulo, anoCalendario, prazo, norma, estado, children, rodape,
}: {
  titulo: string;
  anoCalendario: number;
  prazo: string;
  norma: string;
  estado: EstadoDeclaracao;
  children: React.ReactNode;
  rodape?: React.ReactNode;
}) {
  const badge = BADGE[estado];
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-start gap-3">
        <CalendarClock className="size-5 text-primary mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">
              {titulo} — ano-calendário {anoCalendario}
            </h3>
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badge.cls}`}>
              {badge.label}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Entregue até <strong>{prazo}</strong>. <span className="text-muted-foreground-2">{norma}</span>
          </p>
          <div className="mt-4">{children}</div>
          {rodape && <div className="mt-4 flex flex-wrap items-center gap-2">{rodape}</div>}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Escrever o dialog**

```tsx
// src/app/(auth)/(gated)/impostos/RegistrarComprovanteDialog.tsx
// Registro do recibo baixado do portal. Serve DASN e DEFIS: recebe a função de
// submit já ligada à action certa (empresário ou contador).
'use client';
import { useState } from 'react';
import { Upload } from 'lucide-react';

export type SubmitComprovante = (input: {
  numeroDeclaracao: string;
  dataTransmissao: string;
  comprovante: { nome: string; mime: string; base64: string } | null;
}) => Promise<{ ok: boolean; error?: string }>;

export default function RegistrarComprovanteDialog({ onSubmit, disabled }: {
  onSubmit: SubmitComprovante;
  disabled?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [numero, setNumero] = useState('');
  const [data, setData] = useState('');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar() {
    setErro(null);
    if (!data) { setErro('Informe a data de transmissão.'); return; }
    setEnviando(true);
    try {
      let comprovante = null;
      if (arquivo) {
        const buf = await arquivo.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
        comprovante = { nome: arquivo.name, mime: arquivo.type, base64 };
      }
      const r = await onSubmit({ numeroDeclaracao: numero.trim(), dataTransmissao: data, comprovante });
      if (!r.ok) { setErro(r.error ?? 'Falha ao registrar.'); return; }
      setAberto(false);
    } finally {
      setEnviando(false);
    }
  }

  if (!aberto) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setAberto(true)}
        className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface-2 disabled:opacity-50"
      >
        <Upload className="size-4" />
        Registrar comprovante
      </button>
    );
  }

  return (
    <div className="w-full rounded-md border border-border bg-surface-2 p-3 space-y-3">
      <label className="block text-sm">
        <span className="text-muted-foreground">Nº da declaração</span>
        <input value={numero} onChange={(e) => setNumero(e.target.value)}
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm" />
      </label>
      <label className="block text-sm">
        <span className="text-muted-foreground">Data de transmissão *</span>
        <input type="date" value={data} onChange={(e) => setData(e.target.value)}
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm" />
      </label>
      <label className="block text-sm">
        <span className="text-muted-foreground">Comprovante (PDF, PNG ou JPEG, até 5 MB)</span>
        <input type="file" accept="application/pdf,image/png,image/jpeg"
          onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
          className="mt-1 w-full text-sm" />
      </label>
      {erro && <p className="text-sm text-destructive">{erro}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={enviar} disabled={enviando}
          className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
          {enviando ? 'Registrando…' : 'Registrar'}
        </button>
        <button type="button" onClick={() => setAberto(false)}
          className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-surface-3">
          Cancelar
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add "app/src/app/(auth)/(gated)/impostos/DeclaracaoAnualShell.tsx" "app/src/app/(auth)/(gated)/impostos/RegistrarComprovanteDialog.tsx"
git commit -m "feat(bloco-3): casca das declaracoes anuais e dialog de comprovante"
```

---

## Task 17: Formulário da DASN

**Files:**
- Create: `app/src/app/(auth)/(gated)/impostos/DasnAssistidaForm.tsx`

- [ ] **Step 1: Implementar**

```tsx
// src/app/(auth)/(gated)/impostos/DasnAssistidaForm.tsx
'use client';
import { useState } from 'react';
import { brl } from '@/lib/fiscal/guia';
import { avaliarLimiteMei, LIMITE_MEI_ANUAL } from '@/lib/fiscal/dasn/resumo';
import { calcularDivergencia } from '@/lib/fiscal/declaracoes-anuais/divergencia';
import type { ResumoReceitas } from '@/lib/fiscal/declaracoes-anuais/tipos';

export type SalvarDasn = (dados: {
  receitaComercio: number; receitaServico: number; possuiEmpregado: boolean;
}) => Promise<{ ok: boolean; error?: string }>;

export default function DasnAssistidaForm({ resumo, inicial, onSalvar }: {
  resumo: ResumoReceitas;
  inicial: { receitaComercio: number; receitaServico: number; possuiEmpregado: boolean };
  onSalvar: SalvarDasn;
}) {
  const [comercio, setComercio] = useState(inicial.receitaComercio);
  const [servico, setServico] = useState(inicial.receitaServico);
  const [empregado, setEmpregado] = useState(inicial.possuiEmpregado);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const declarado = comercio + servico;
  const divergencia = calcularDivergencia(declarado, resumo.total);
  const limite = avaliarLimiteMei(declarado);

  async function salvar() {
    setErro(null);
    setSalvando(true);
    try {
      const r = await onSalvar({ receitaComercio: comercio, receitaServico: servico, possuiEmpregado: empregado });
      if (!r.ok) setErro(r.error ?? 'Falha ao salvar.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Suas notas de {resumo.qtdNotas === 1 ? '1 nota' : `${resumo.qtdNotas} notas`} somam{' '}
        <strong>{brl(resumo.total)}</strong> — comércio {brl(resumo.comercio)}, serviço {brl(resumo.servico)}.
        Corrija abaixo se for declarar outro valor.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Campo label="Receita de comércio e indústria" valor={comercio} onChange={setComercio} />
        <Campo label="Receita de serviços" valor={servico} onChange={setServico} />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={empregado} onChange={(e) => setEmpregado(e.target.checked)} />
        <span>Teve empregado no ano</span>
      </label>

      <p className="text-sm">Total a declarar: <strong>{brl(declarado)}</strong></p>

      {divergencia.ha && (
        <Alerta tom="warning">
          Você declarou {brl(declarado)}, mas as notas do ano somam {brl(resumo.total)}
          {' '}({divergencia.sentido === 'acima' ? 'a mais' : 'a menos'} de {brl(Math.abs(divergencia.diferenca))}).
          Confirme antes de entregar — o valor declarado é o que vale.
        </Alerta>
      )}

      {limite.excede && (
        <Alerta tom="danger">
          O total passa do limite do MEI de {brl(LIMITE_MEI_ANUAL)} em {brl(limite.excedente)}.
          {limite.excedeEm20Pct
            ? ' Como o excesso passa de 20%, o desenquadramento retroage ao início do ano.'
            : ' O desenquadramento vale a partir de janeiro do ano seguinte.'}
          {' '}LC 123/2006, art. 18-A.
        </Alerta>
      )}

      {erro && <p className="text-sm text-destructive">{erro}</p>}

      <button type="button" onClick={salvar} disabled={salvando}
        className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface-2 disabled:opacity-50">
        {salvando ? 'Salvando…' : 'Salvar rascunho'}
      </button>
    </div>
  );
}

function Campo({ label, valor, onChange }: { label: string; valor: number; onChange: (n: number) => void }) {
  return (
    <label className="block text-sm">
      <span className="text-muted-foreground">{label}</span>
      <input
        type="number" min={0} step="0.01" value={Number.isFinite(valor) ? valor : 0}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm tabular-nums"
      />
    </label>
  );
}

function Alerta({ tom, children }: { tom: 'warning' | 'danger'; children: React.ReactNode }) {
  const cls = tom === 'danger'
    ? 'border-destructive/30 bg-destructive/5 text-destructive'
    : 'border-alert/30 bg-alert/5 text-alert';
  return <p className={`rounded-md border px-3 py-2 text-sm ${cls}`}>{children}</p>;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add "app/src/app/(auth)/(gated)/impostos/DasnAssistidaForm.tsx"
git commit -m "feat(bloco-3): formulario assistido da DASN-SIMEI"
```

---

## Task 18: Seção da DASN + correção do texto

A correção de texto **não é cosmética**: a frase atual promete transmissão automática, que o Integra Contador não faz e não vai fazer (spec §1.1). Manter a frase é prometer ao cliente algo que o produto não entrega.

**Files:**
- Modify: `app/src/app/(auth)/(gated)/impostos/DeclaracoesMeiSection.tsx`

- [ ] **Step 1: Reescrever o componente**

```tsx
// @custom — Seção "Declarações" do MEI (DASN-SIMEI), assistida.
// O SERPRO Integra Contador CONSULTA declarações; não transmite DASN. O fluxo é
// assistido por definição: o app calcula, confere com as notas, guarda o
// comprovante — a entrega é feita no portal da Receita. Ver spec do Bloco 3, §1.1.
'use client';
import { ExternalLink, Copy } from 'lucide-react';
import { useState } from 'react';
import { dataBR, brl } from '@/lib/fiscal/guia';
import ConsultarDasnSimeiButton from './ConsultarDasnSimeiButton';
import DeclaracaoAnualShell, { type EstadoDeclaracao } from './DeclaracaoAnualShell';
import DasnAssistidaForm from './DasnAssistidaForm';
import RegistrarComprovanteDialog from './RegistrarComprovanteDialog';
import { registrarDeclaracaoAnualAction } from './actions';
import type { DeclaracaoRow } from './DeclaracoesSection';
import type { ResumoReceitas } from '@/lib/fiscal/declaracoes-anuais/tipos';

const PORTAL_DASNSIMEI = 'https://www8.receita.fazenda.gov.br/SimplesNacional/Aplicacoes/ATSPO/dasnsimei.app/';

export default function DeclaracoesMeiSection({
  declaracoes, anoCalendario, resumo, rascunho,
}: {
  declaracoes: DeclaracaoRow[];
  anoCalendario: number;
  resumo: ResumoReceitas;
  rascunho: { receitaComercio: number; receitaServico: number; possuiEmpregado: boolean } | null;
}) {
  const [msg, setMsg] = useState<string | null>(null);

  const entregue = declaracoes.find((d) => d.competencia === String(anoCalendario) && d.dataTransmissao);
  const estado: EstadoDeclaracao = entregue
    ? 'entregue'
    : (new Date() > new Date(`${anoCalendario + 1}-05-31T23:59:59-03:00`) ? 'em_atraso' : 'rascunho');

  const inicial = rascunho ?? {
    receitaComercio: resumo.comercio,
    receitaServico: resumo.servico,
    possuiEmpregado: false,
  };

  async function copiarResumo() {
    const txt = [
      `DASN-SIMEI ${anoCalendario}`,
      `Receita de comércio e indústria: ${brl(inicial.receitaComercio)}`,
      `Receita de serviços: ${brl(inicial.receitaServico)}`,
      `Teve empregado: ${inicial.possuiEmpregado ? 'sim' : 'não'}`,
    ].join('\n');
    await navigator.clipboard.writeText(txt);
    setMsg('Resumo copiado.');
  }

  return (
    <div className="space-y-4">
      <DeclaracaoAnualShell
        titulo="Declaração anual do MEI (DASN-SIMEI)"
        anoCalendario={anoCalendario}
        prazo={`31/05/${anoCalendario + 1}`}
        norma="Res. CGSN 140/2018, art. 109 · multa mínima de R$ 25 pelo art. 111"
        estado={estado}
        rodape={
          <>
            <a href={PORTAL_DASNSIMEI} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">
              <ExternalLink className="size-4" />
              Declarar no portal da Receita
            </a>
            <button type="button" onClick={copiarResumo}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-surface-2">
              <Copy className="size-4" />
              Copiar resumo
            </button>
            <ConsultarDasnSimeiButton />
            <RegistrarComprovanteDialog
              onSubmit={async ({ numeroDeclaracao, dataTransmissao, comprovante }) =>
                registrarDeclaracaoAnualAction({
                  tipo: 'DASN-SIMEI', ano: anoCalendario, dados: inicial,
                  numeroDeclaracao, dataTransmissao, comprovante,
                })}
            />
          </>
        }
      >
        <p className="text-sm text-muted-foreground mb-3">
          É obrigatória mesmo sem faturamento. A Balu monta a declaração, confere com suas notas e
          guarda o comprovante — a entrega é feita no portal da Receita.
        </p>
        <DasnAssistidaForm
          resumo={resumo}
          inicial={inicial}
          onSalvar={async (dados) => {
            const r = await registrarDeclaracaoAnualAction({ tipo: 'DASN-SIMEI', ano: anoCalendario, dados });
            if (r.ok) setMsg('Rascunho salvo. O aviso só some quando você registrar o comprovante.');
            return r;
          }}
        />
        {msg && <p className="mt-2 text-sm text-muted-foreground">{msg}</p>}
      </DeclaracaoAnualShell>

      {declaracoes.length === 0 ? (
        <p className="text-sm text-muted-foreground rounded-md border border-border bg-surface px-4 py-3">
          Nenhuma declaração registrada ainda.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Ano-calendário</th>
                <th className="px-3 py-2 font-medium">Tipo</th>
                <th className="px-3 py-2 font-medium">Situação</th>
                <th className="px-3 py-2 font-medium">Origem</th>
                <th className="px-3 py-2 font-medium">Nº declaração</th>
                <th className="px-3 py-2 font-medium">Transmitida em</th>
              </tr>
            </thead>
            <tbody>
              {declaracoes.map((d) => (
                <tr key={d.id} className="border-t border-border">
                  <td className="px-3 py-2 tabular-nums">{d.competencia}</td>
                  <td className="px-3 py-2">{d.tipo}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      d.dataTransmissao ? 'bg-green-500/10 text-green-600' : 'bg-surface-3 text-muted-foreground'}`}>
                      {d.dataTransmissao ? 'Transmitida' : 'Rascunho'}
                    </span>
                  </td>
                  <td className="px-3 py-2">{d.origem ?? '—'}</td>
                  <td className="px-3 py-2 tabular-nums">{d.numeroDeclaracao ?? '—'}</td>
                  <td className="px-3 py-2 tabular-nums">{d.dataTransmissao ? dataBR(d.dataTransmissao) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Acrescentar `origem` ao tipo `DeclaracaoRow`**

Em `app/src/app/(auth)/(gated)/impostos/DeclaracoesSection.tsx`, no tipo `DeclaracaoRow`, acrescentar:

```ts
  origem?: string | null;
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: erro esperado em `page.tsx` — `DeclaracoesMeiSection` agora exige `resumo` e `rascunho`. É a Task 20 que resolve. Se quiser typecheck limpo antes, fazer a Task 20 na sequência e commitar as duas juntas.

- [ ] **Step 4: Commit**

```bash
git add "app/src/app/(auth)/(gated)/impostos/DeclaracoesMeiSection.tsx" "app/src/app/(auth)/(gated)/impostos/DeclaracoesSection.tsx"
git commit -m "feat(bloco-3): secao assistida da DASN e correcao do texto sobre transmissao"
```

---

## Task 19: Formulário e seção do DEFIS

**Files:**
- Create: `app/src/app/(auth)/(gated)/impostos/DefisForm.tsx`
- Create: `app/src/app/(auth)/(gated)/impostos/DeclaracoesDefisSection.tsx`

- [ ] **Step 1: Implementar o formulário**

```tsx
// src/app/(auth)/(gated)/impostos/DefisForm.tsx
// Formulário dirigido por dados: cada grupo do art. 72 vira um accordion, e o
// grupo repetível de sócios ganha adicionar/remover. Mudar grupos.ts muda a tela.
'use client';
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { GRUPOS_DEFIS, contarPreenchidos, type CampoDefis } from '@/lib/fiscal/defis/grupos';

type Valores = Record<string, unknown>;
type Socio = Record<string, unknown>;

export default function DefisForm({ inicial, onSalvar }: {
  inicial: Valores;
  onSalvar: (dados: Valores) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [valores, setValores] = useState<Valores>(inicial);
  const [socios, setSocios] = useState<Socio[]>((inicial.socios as Socio[]) ?? []);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const progresso = contarPreenchidos(valores);
  const gruposPlanos = GRUPOS_DEFIS.filter((g) => !g.repetivel);
  const grupoSocios = GRUPOS_DEFIS.find((g) => g.repetivel)!;

  function set(chave: string, v: unknown) {
    setValores((prev) => ({ ...prev, [chave]: v }));
  }

  async function salvar() {
    setErro(null);
    setSalvando(true);
    try {
      const r = await onSalvar({ ...valores, socios });
      if (!r.ok) setErro(r.error ?? 'Falha ao salvar.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {progresso.preenchidos} de {progresso.total} campos preenchidos.
        {' '}A maioria destes dados não está no app — é preciso digitá-los.
      </p>

      {gruposPlanos.map((g) => (
        <details key={g.id} className="rounded-md border border-border bg-surface-2 p-3" open={g.id === 'receitas'}>
          <summary className="cursor-pointer text-sm font-medium">{g.titulo}</summary>
          <p className="mt-1 text-xs text-muted-foreground-2">{g.norma}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {g.campos.map((c) => (
              <CampoInput key={c.chave} campo={c} valor={valores[c.chave]} onChange={(v) => set(c.chave, v)} />
            ))}
          </div>
        </details>
      ))}

      <details className="rounded-md border border-border bg-surface-2 p-3">
        <summary className="cursor-pointer text-sm font-medium">
          {grupoSocios.titulo} ({socios.length})
        </summary>
        <p className="mt-1 text-xs text-muted-foreground-2">
          {grupoSocios.norma} · a participação precisa somar 100%.
        </p>
        <div className="mt-3 space-y-3">
          {socios.map((s, i) => (
            <div key={i} className="rounded-md border border-border bg-surface p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Sócio {i + 1}</span>
                <button type="button" onClick={() => setSocios(socios.filter((_, j) => j !== i))}
                  className="inline-flex items-center gap-1 text-xs text-destructive hover:underline">
                  <Trash2 className="size-3" /> Remover
                </button>
              </div>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {grupoSocios.campos.map((c) => (
                  <CampoInput
                    key={c.chave} campo={c} valor={s[c.chave]}
                    onChange={(v) => setSocios(socios.map((x, j) => (j === i ? { ...x, [c.chave]: v } : x)))}
                  />
                ))}
              </div>
            </div>
          ))}
          <button type="button" onClick={() => setSocios([...socios, {}])}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-surface-3">
            <Plus className="size-4" /> Adicionar sócio
          </button>
        </div>
      </details>

      {erro && <p className="text-sm text-destructive">{erro}</p>}

      <button type="button" onClick={salvar} disabled={salvando}
        className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface-2 disabled:opacity-50">
        {salvando ? 'Salvando…' : 'Salvar rascunho'}
      </button>
    </div>
  );
}

function CampoInput({ campo, valor, onChange }: {
  campo: CampoDefis; valor: unknown; onChange: (v: unknown) => void;
}) {
  if (campo.tipo === 'booleano') {
    return (
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={valor === true} onChange={(e) => onChange(e.target.checked)} />
        <span>{campo.label}</span>
      </label>
    );
  }

  const numerico = campo.tipo === 'moeda' || campo.tipo === 'inteiro' || campo.tipo === 'percentual';
  const htmlType = campo.tipo === 'data' ? 'date' : numerico ? 'number' : 'text';

  return (
    <label className="block text-sm">
      <span className="text-muted-foreground">
        {campo.label}{campo.obrigatorio && <span className="text-destructive"> *</span>}
      </span>
      <input
        type={htmlType}
        inputMode={campo.tipo === 'cpf' ? 'numeric' : undefined}
        step={campo.tipo === 'inteiro' ? 1 : campo.tipo === 'texto' ? undefined : '0.01'}
        min={numerico ? 0 : undefined}
        value={(valor as string | number | undefined) ?? ''}
        onChange={(e) => onChange(numerico ? (e.target.value === '' ? undefined : Number(e.target.value)) : e.target.value)}
        className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
      />
      {campo.ajuda && <span className="mt-1 block text-xs text-muted-foreground-2">{campo.ajuda}</span>}
    </label>
  );
}
```

- [ ] **Step 2: Implementar a seção**

```tsx
// src/app/(auth)/(gated)/impostos/DeclaracoesDefisSection.tsx
// DEFIS das ME/EPP do Simples. Não há consulta SERPRO para o DEFIS — o fluxo é
// integralmente assistido (spec §5.2).
'use client';
import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import DeclaracaoAnualShell, { type EstadoDeclaracao } from './DeclaracaoAnualShell';
import DefisForm from './DefisForm';
import RegistrarComprovanteDialog from './RegistrarComprovanteDialog';
import { registrarDeclaracaoAnualAction } from './actions';
import type { DeclaracaoRow } from './DeclaracoesSection';

const PORTAL_DEFIS = 'https://www8.receita.fazenda.gov.br/SimplesNacional/Aplicacoes/ATBHE/defis.app/';

export default function DeclaracoesDefisSection({ declaracoes, anoCalendario, inicial }: {
  declaracoes: DeclaracaoRow[];
  anoCalendario: number;
  inicial: Record<string, unknown>;
}) {
  const [dados, setDados] = useState<Record<string, unknown>>(inicial);
  const [msg, setMsg] = useState<string | null>(null);

  const entregue = declaracoes.find((d) => d.competencia === String(anoCalendario) && d.dataTransmissao);
  const estado: EstadoDeclaracao = entregue
    ? 'entregue'
    : (new Date() > new Date(`${anoCalendario + 1}-03-31T23:59:59-03:00`) ? 'em_atraso' : 'rascunho');

  return (
    <DeclaracaoAnualShell
      titulo="Declaração de informações socioeconômicas e fiscais (DEFIS)"
      anoCalendario={anoCalendario}
      prazo={`31/03/${anoCalendario + 1}`}
      norma="Res. CGSN 140/2018, art. 72"
      estado={estado}
      rodape={
        <>
          <a href={PORTAL_DEFIS} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">
            <ExternalLink className="size-4" />
            Declarar no portal do Simples
          </a>
          <RegistrarComprovanteDialog
            onSubmit={async ({ numeroDeclaracao, dataTransmissao, comprovante }) =>
              registrarDeclaracaoAnualAction({
                tipo: 'DEFIS', ano: anoCalendario, dados, numeroDeclaracao, dataTransmissao, comprovante,
              })}
          />
        </>
      }
    >
      <DefisForm
        inicial={inicial}
        onSalvar={async (d) => {
          setDados(d);
          const r = await registrarDeclaracaoAnualAction({ tipo: 'DEFIS', ano: anoCalendario, dados: d });
          if (r.ok) setMsg('Rascunho salvo. O aviso só some quando você registrar o comprovante.');
          return r;
        }}
      />
      {msg && <p className="mt-2 text-sm text-muted-foreground">{msg}</p>}
    </DeclaracaoAnualShell>
  );
}
```

> **Confirmar a URL do portal do DEFIS antes de dar a task por concluída** — abrir `PORTAL_DEFIS` no navegador. A da DASN (`PORTAL_DASNSIMEI`) foi verificada em 2026-06-06 e está no código; esta não foi. Se mudou, corrigir a constante e anotar a data no comentário, como o outro arquivo faz.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: sem erros nestes dois arquivos (o erro pendente de `page.tsx` continua até a Task 20).

- [ ] **Step 4: Commit**

```bash
git add "app/src/app/(auth)/(gated)/impostos/DefisForm.tsx" "app/src/app/(auth)/(gated)/impostos/DeclaracoesDefisSection.tsx"
git commit -m "feat(bloco-3): formulario e secao do DEFIS"
```

---

## Task 20: Ligar as seções na página de impostos

**Files:**
- Modify: `app/src/app/(auth)/(gated)/impostos/page.tsx`

- [ ] **Step 1: Acrescentar os imports**

```ts
import { lerNotasAnoCalendario } from '@/lib/fiscal/receitas-source';
import { resumirReceitasAno } from '@/lib/fiscal/dasn/resumo';
import { defisVazio } from '@/lib/fiscal/defis/campos';
import DeclaracoesDefisSection from './DeclaracoesDefisSection';
```

- [ ] **Step 2: Acrescentar `origem` e `dados` à query de declarações**

Na chamada a `declaracoes_fiscais` (linha 77), trocar o `select` por:

```ts
      .select('id, competencia_referencia, tipo, numero_declaracao, data_transmissao, status, origem, dados')
```

E no `map` que monta `declaracoesRows` (linha 90), acrescentar o campo:

```ts
    origem: (d.origem as string | null) ?? null,
```

- [ ] **Step 3: Calcular o ano e o resumo antes do `return`**

Depois do bloco que calcula `pagasHistorico` (linha ~142), acrescentar:

```ts
  // Declarações anuais (Bloco 3): ano-calendário anterior ao corrente.
  const anoDeclaracao = Number(competenciaAtual.slice(0, 4)) - 1;
  const notasAno = await lerNotasAnoCalendario(supabase, companyId, anoDeclaracao);
  const resumoAno = resumirReceitasAno(notasAno, anoDeclaracao);

  // Rascunho salvo, se houver — repopula o formulário.
  const salvaDoAno = (declaracoes ?? []).find(
    (d) => (d.competencia_referencia as string) === String(anoDeclaracao),
  );
  const dadosSalvos = (salvaDoAno?.dados ?? null) as Record<string, unknown> | null;

  const rascunhoDasn = dadosSalvos && salvaDoAno?.tipo === 'DASN-SIMEI'
    ? {
        receitaComercio: Number(dadosSalvos.receitaComercio ?? 0),
        receitaServico: Number(dadosSalvos.receitaServico ?? 0),
        possuiEmpregado: Boolean(dadosSalvos.possuiEmpregado),
      }
    : null;

  const inicialDefis = dadosSalvos && salvaDoAno?.tipo === 'DEFIS'
    ? dadosSalvos
    : { ...defisVazio(), receitaBrutaTotal: resumoAno.total, receitaMercadoInterno: resumoAno.total };
```

- [ ] **Step 4: Passar as props novas na seção do MEI**

Substituir a chamada a `DeclaracoesMeiSection` (linha ~191) por:

```tsx
              <DeclaracoesMeiSection
                declaracoes={declaracoesRows.filter((d) => d.tipo === 'DASN-SIMEI')}
                anoCalendario={anoDeclaracao}
                resumo={resumoAno}
                rascunho={rascunhoDasn}
              />
```

- [ ] **Step 5: Acrescentar a seção do DEFIS no ramo do Simples**

No ramo `isSimples`, entre a seção "Precisa de atenção" e a de "Histórico", inserir:

```tsx
            {(regimeCode === '1' || regimeCode === '2') && (
              <section className="mb-8">
                <h2 className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">Declaração anual</h2>
                <DeclaracoesDefisSection
                  declaracoes={declaracoesRows.filter((d) => d.tipo === 'DEFIS')}
                  anoCalendario={anoDeclaracao}
                  inicial={inicialDefis}
                />
              </section>
            )}
```

> `regimeCode` já existe na linha 103. O gate por code (e não por `isSimples`) é intencional: `tipoFromCode` mapeia code `'3'` — Regime Normal — como `'simples'`, e Regime Normal **não** entrega DEFIS. É o mesmo cuidado que o comentário da linha 101 já documenta para o gate do SERPRO.

- [ ] **Step 6: Typecheck e build**

Run: `npm run typecheck`
Expected: sem erros.

Run: `npm run build`
Expected: build concluído sem erro.

- [ ] **Step 7: Commit**

```bash
git add "app/src/app/(auth)/(gated)/impostos/page.tsx"
git commit -m "feat(bloco-3): liga as secoes de declaracao anual na pagina de impostos"
```

---

## Task 21: Card no painel do contador

**Files:**
- Modify: `app/src/app/(auth)/(gated)/contador/clientes/[companyId]/VisaoCliente.tsx`

> ⚠️ **Este é o único ponto do bloco que muda um invariante existente.** O docblock do arquivo (linha 4) diz: *"Zero botões de ação — o contador só enxerga, nunca edita, os dados do cliente."* A decisão nº 1 do design abre exatamente uma exceção: registrar declaração anual. A exceção é segura porque a escrita passa pela action com service role + guarda de carteira + auditoria (Task 12), não por RLS afrouxada — `declaracoes_select_contador` continua SELECT-only. **Atualizar o docblock junto com o código**, senão o comentário vira mentira.

- [ ] **Step 1: Atualizar o docblock (linhas 3-4)**

```tsx
// Drill-down do cliente: notas / guias / declarações.
// Somente leitura, com UMA exceção: o registro de declaração anual (DASN/DEFIS),
// que grava pela action com service role + guarda de carteira + auditoria — a RLS
// do contador (declaracoes_select_contador) segue SELECT-only. Ver spec do Bloco 3, §6.5.
```

- [ ] **Step 2: Acrescentar o card ao fim do arquivo**

O componente já recebe a prop `declaracoes` com `tipo`, `competencia_referencia` e `data_transmissao` — a query em `page.tsx:41-43` já traz tudo. **Nenhuma mudança em `page.tsx` é necessária.** O card usa o tipo `DeclaracaoRow` que já existe no arquivo (linha 15).

```tsx
function DeclaracoesAnuaisCard({ declaracoes, anoCalendario }: {
  declaracoes: DeclaracaoRow[];
  anoCalendario: number;
}) {
  const doAno = (tipo: string) =>
    declaracoes.find((d) => d.tipo === tipo && d.competencia_referencia === String(anoCalendario)) ?? null;

  const linhas = [
    { tipo: 'DASN-SIMEI', label: 'DASN-SIMEI', prazo: `31/05/${anoCalendario + 1}` },
    { tipo: 'DEFIS', label: 'DEFIS', prazo: `31/03/${anoCalendario + 1}` },
  ];

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <h3 className="text-sm font-semibold text-foreground">Declarações anuais — {anoCalendario}</h3>
      <ul className="mt-3 space-y-2">
        {linhas.map((l) => {
          const d = doAno(l.tipo);
          const entregue = Boolean(d?.dataTransmissao);
          return (
            <li key={l.tipo} className="flex items-center justify-between gap-3 text-sm">
              <span>{l.label} <span className="text-muted-foreground-2">· prazo {l.prazo}</span></span>
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                entregue ? 'bg-green-500/10 text-green-600'
                  : d ? 'bg-surface-3 text-muted-foreground'
                  : 'bg-alert/10 text-alert'}`}>
                {entregue ? 'Entregue' : d ? 'Rascunho' : 'Pendente'}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Renderizar o card acima da tabela, na aba "declarações"**

Na linha 99, trocar o ramo final do ternário de abas por:

```tsx
      ) : (
        <>
          <DeclaracoesAnuaisCard
            declaracoes={declaracoes}
            anoCalendario={new Date().getFullYear() - 1}
          />
          <div className="mt-6">
            <DeclaracoesTable declaracoes={declaracoes} />
          </div>
        </>
      )}
```

> A leitura passa pela policy `declaracoes_select_contador` — SELECT com a sessão do contador basta. Service role só na escrita (Task 12).

- [ ] **Step 4: Typecheck e build**

Run: `npm run typecheck && npm run build`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add "app/src/app/(auth)/(gated)/contador/clientes/[companyId]/VisaoCliente.tsx"
git commit -m "feat(bloco-3): card de declaracoes anuais no painel do contador"
```

---

## Task 22: Fechamento

**Files:**
- Modify: `D:\balu-app-v2\balu\CHECKPOINT.md`

- [ ] **Step 1: Rodar a suíte inteira**

Run: `npm test -- --run`
Expected: PASS — todos os arquivos, incluindo os 45 pré-existentes de `lib/fiscal`.

> O smoke (`registrar.smoke.test.ts`) só passa com o seed criado. Se o seed foi restaurado, rodar `node app/scratchpad/seed-empresa-mei.mjs` antes, ou rodar a suíte com `--exclude '**/*.smoke.test.ts'`.

- [ ] **Step 2: Lint e build**

Run: `npm run lint && npm run typecheck && npm run build`
Expected: sem erros.

- [ ] **Step 3: Limpar o seed**

A partir de `D:\balu-app-v2\balu`:

```bash
node app/scratchpad/seed-empresa-mei.mjs restore
```

Expected: `♻️ RESTORE ok — 1 empresa(s) de seed removida(s).`

- [ ] **Step 4: Atualizar o CHECKPOINT**

Acrescentar uma seção da sessão registrando: migrations `0048` e `0049` aplicadas; módulos `dasn/`, `defis/` e `declaracoes-anuais/` criados; `montarDasnSimei` finalmente com caller; as sete premissas pendentes de confirmação com o Michel; e a correção do texto sobre transmissão automática.

- [ ] **Step 5: Commit**

```bash
git add CHECKPOINT.md
git commit -m "docs(bloco-3): atualiza CHECKPOINT com o estado do Bloco 3"
```

---

## Pendências que ficam para o Michel

Estas **não bloqueiam** a implementação — o código roda com os valores assumidos. Mas cada uma muda o resultado se estiver errada, e todas estão marcadas no código com comentário.

| # | premissa | arquivo a ajustar |
|---|---|---|
| 1 | Os seis grupos do art. 72 são a lista completa | `defis/grupos.ts` (e o teste avisa se `campos.ts` sair de sincronia) |
| 2 | DEFIS vale para codes `'1'` e `'2'` | `0049_defis_pendente.sql`, `page.tsx` |
| 3 | Aviso de janeiro a abril, `danger` em março, prazo 31/03 | `0049_defis_pendente.sql` |
| 4 | Receita separada por `tipo_documento`, não por CNAE | `dasn/resumo.ts` |
| 5 | Divergência alerta, nunca bloqueia | `DasnAssistidaForm.tsx` |
| 6 | A Balu não transmite declaração anual | `DeclaracoesMeiSection.tsx` (texto já corrigido na Task 18) |
| 7 | Retificadora sobrescreve o mesmo registro | `declaracoes-anuais/registrar.ts` |

Uma coisa mais: a URL do portal do DEFIS (Task 19) precisa ser aberta e conferida antes do merge. A da DASN foi verificada em 2026-06-06; a do DEFIS entrou por analogia.
