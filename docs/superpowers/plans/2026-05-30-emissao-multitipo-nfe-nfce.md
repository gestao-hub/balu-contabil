# Emissão multi-tipo NF-e / NFC-e — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Habilitar emissão de NF-e (modelo 55) e NFC-e (modelo 65) no painel, ao lado da NFS-e, com envio real à Focus em homologação — meta é receber a resposta da Focus (inclusive o erro de CNAE) para destravar os 2 braços.

**Architecture:** Builders puros por tipo (espelham `nfse-payload.ts`) montam o JSON da Focus; server actions finas orquestram (valida → builder → grava nota `pendente` → `focus.emitirNfe/Nfce` → trata erro no padrão NFS-e). UI: tela de escolha de tipo + formulários NF-e/NFC-e com um `ItensField` compartilhado que cria produtos em `aux_produtos` inline. O cliente Focus e o webhook já suportam os 3 tipos — não se mexe neles.

**Tech Stack:** Next.js 15 (App Router, Server Actions), TypeScript, Supabase (Postgres), Zod, Vitest, Tailwind. Spec: `docs/superpowers/specs/2026-05-30-emissao-multitipo-nfe-nfce-design.md`.

**Convenções do repo (importante):**
- Testes: `npm test` (Vitest). Um teste só: `npx vitest run src/lib/fiscal/nfe-payload.test.ts`.
- Typecheck: `npm run typecheck`.
- ⚠️ NÃO rodar `npm run build` com `next dev` ativo (corrompe o `.next`).
- Trabalhar dentro de `app/`. App vive em `app/`, não na raiz.
- Branch já criada: `feat/emissao-multitipo-nfe-nfce`.

---

## File Structure

**Criar:**
- `supabase/migrations/0012_focus_habilita_nfe_nfce.sql` — flags + enable AL Piscinas
- `src/lib/fiscal/nfe-payload.ts` (+ `.test.ts`) — `buildNfePayload` puro
- `src/lib/fiscal/nfce-payload.ts` (+ `.test.ts`) — `buildNfcePayload` puro
- `src/app/(auth)/notas_fiscais/emissao/_components/ItensField.tsx` — editor de itens compartilhado
- `src/app/(auth)/notas_fiscais/emissao/nfe/page.tsx` + `NfeForm.tsx`
- `src/app/(auth)/notas_fiscais/emissao/nfce/page.tsx` + `NfceForm.tsx`

**Modificar:**
- `src/types/database.ts` — adicionar `aux_produtos` + flags novas em `empresas_fiscais`
- `src/app/(auth)/notas_fiscais/actions.ts` — `+criarProdutoAction`, `+listarProdutosAction`, `+emitirNfeAction`, `+emitirNfceAction`
- `src/app/(auth)/notas_fiscais/emissao/page.tsx` — vira tela de escolha de tipo

**Reaproveitar sem alterar:** `src/lib/clients/focus-nfe.ts`, `src/lib/fiscal/focus-erro.ts`, `src/lib/fiscal/notas-tipo.ts`, `src/app/api/webhooks/focus`, `generateRef` (em `actions.ts`).

---

## Task 1: Migration — flags de habilitação + AL Piscinas

**Files:**
- Create: `supabase/migrations/0012_focus_habilita_nfe_nfce.sql`
- Modify: `src/types/database.ts`

- [ ] **Step 1: Escrever a migration**

Create `supabase/migrations/0012_focus_habilita_nfe_nfce.sql`:

```sql
-- @custom — Emissão multi-tipo: flags de habilitação de NF-e e NFC-e por empresa.
-- NFS-e já tinha flags (focus_habilita_nfse*). NF-e/NFC-e não existiam.
-- Aditiva e idempotente. Habilita os 3 tipos para a AL Piscinas (teste).

ALTER TABLE public.empresas_fiscais
  ADD COLUMN IF NOT EXISTS focus_habilita_nfe  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS focus_habilita_nfce BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.empresas_fiscais.focus_habilita_nfe  IS 'Empresa habilitada a emitir NF-e (modelo 55) no painel.';
COMMENT ON COLUMN public.empresas_fiscais.focus_habilita_nfce IS 'Empresa habilitada a emitir NFC-e (modelo 65) no painel.';

-- Habilita os 3 tipos para a AL Piscinas (match por razão social — evita hardcode de UUID/CNPJ).
UPDATE public.empresas_fiscais ef
   SET focus_habilita_nfe = true,
       focus_habilita_nfce = true
  FROM public.companies c
 WHERE ef.empresa_id = c.id
   AND (c.razao_social ILIKE '%piscina%' OR c.nome ILIKE '%piscina%')
   AND ef.deleted_at IS NULL;
```

- [ ] **Step 2: Aplicar a migration no Supabase hospedado**

Aplique a migration `0012` no banco (mesmo método das migrations anteriores deste repo — psql/painel Supabase). Confirme que rodou sem erro.

Run (verificação, ajuste a connection string conforme o repo já usa):
```bash
psql "$SUPABASE_DB_URL" -c "SELECT focus_habilita_nfe, focus_habilita_nfce FROM empresas_fiscais ef JOIN companies c ON c.id=ef.empresa_id WHERE c.razao_social ILIKE '%piscina%';"
```
Expected: uma linha com `t | t` (AL Piscinas habilitada nos 2 novos tipos).

- [ ] **Step 3: Atualizar `src/types/database.ts`**

Em `empresas_fiscais` (Row/Insert/Update), adicionar as 2 colunas. Localize o bloco `empresas_fiscais` e some, junto das demais `focus_habilita_*`:

```ts
        focus_habilita_nfe: boolean;
        focus_habilita_nfce: boolean;
```
(No `Insert`/`Update`, como opcionais: `focus_habilita_nfe?: boolean;` etc.)

E adicionar a tabela `aux_produtos` que existe no banco mas falta nos types. Dentro de `Tables`, adicione:

```ts
      aux_produtos: {
        Row: {
          id: string;
          company_id: string;
          codigo: string | null;
          descricao: string;
          ncm: string | null;
          cfop: string | null;
          tipo_nf: string | null;
          unidade_comercial: string | null;
          quantidade_comercial: number | null;
          valor_unitario_comercial: number | null;
          finalizado: boolean | null;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          id?: string;
          company_id: string;
          codigo?: string | null;
          descricao: string;
          ncm?: string | null;
          cfop?: string | null;
          tipo_nf?: string | null;
          unidade_comercial?: string | null;
          quantidade_comercial?: number | null;
          valor_unitario_comercial?: number | null;
          finalizado?: boolean | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Update: {
          codigo?: string | null;
          descricao?: string;
          ncm?: string | null;
          cfop?: string | null;
          tipo_nf?: string | null;
          unidade_comercial?: string | null;
          quantidade_comercial?: number | null;
          valor_unitario_comercial?: number | null;
          finalizado?: boolean | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
```

- [ ] **Step 4: Verificar typecheck**

Run: `npm run typecheck`
Expected: zero erros.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0012_focus_habilita_nfe_nfce.sql src/types/database.ts
git commit -m "feat(emissao): migration flags NF-e/NFC-e + aux_produtos nos types"
```

---

## Task 2: Builder puro `buildNfePayload` (modelo 55)

**Files:**
- Create: `src/lib/fiscal/nfe-payload.ts`
- Test: `src/lib/fiscal/nfe-payload.test.ts`

Tipo de item compartilhado (NF-e e NFC-e usam o mesmo). Definido aqui e reusado.

- [ ] **Step 1: Escrever o teste (falha)**

Create `src/lib/fiscal/nfe-payload.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildNfePayload, type NfeEmitente, type NfeDestinatario, type NfeItem } from './nfe-payload';

const NOW = new Date('2026-05-30T15:30:00Z');
const EMITENTE: NfeEmitente = { cnpj: '10358425000120', regime: '1' };
const DEST: NfeDestinatario = { cnpj: '12345678000100', cpf: null, nome: 'Cliente PJ Ltda' };
const ITEM: NfeItem = {
  descricao: 'Piscina fibra 3m', ncm: '39269090', cfop: '5102',
  unidade: 'UN', quantidade: 1, valorUnitario: 5000,
};

describe('buildNfePayload', () => {
  it('monta payload modelo 55 com defaults', () => {
    const p = buildNfePayload(EMITENTE, DEST, [ITEM], 'Venda de mercadoria', NOW);
    expect(p.natureza_operacao).toBe('Venda de mercadoria');
    expect(p.finalidade_emissao).toBe('1');
    expect(p.cnpj_emitente).toBe('10358425000120');
    expect(p.cnpj_destinatario).toBe('12345678000100');
    expect(p.nome_destinatario).toBe('Cliente PJ Ltda');
    expect(p.items).toHaveLength(1);
    expect(p.items[0]).toMatchObject({
      numero_item: 1, descricao: 'Piscina fibra 3m', codigo_ncm: '39269090',
      cfop: '5102', unidade_comercial: 'UN', quantidade_comercial: 1,
      valor_unitario_comercial: 5000, valor_bruto: 5000,
      icms_origem: 0,
    });
  });

  it('aceita destinatário PF (CPF)', () => {
    const p = buildNfePayload(EMITENTE, { cnpj: null, cpf: '12345678901', nome: 'João' }, [ITEM], 'Venda', NOW);
    expect(p.cpf_destinatario).toBe('12345678901');
    expect(p.cnpj_destinatario).toBeUndefined();
  });

  it('calcula valor_bruto = quantidade × valorUnitario', () => {
    const p = buildNfePayload(EMITENTE, DEST, [{ ...ITEM, quantidade: 3, valorUnitario: 100 }], 'Venda', NOW);
    expect(p.items[0].valor_bruto).toBe(300);
  });

  it('rejeita lista de itens vazia', () => {
    expect(() => buildNfePayload(EMITENTE, DEST, [], 'Venda', NOW)).toThrow(/item/i);
  });

  it('rejeita CNPJ emitente inválido', () => {
    expect(() => buildNfePayload({ cnpj: '123', regime: '1' }, DEST, [ITEM], 'Venda', NOW)).toThrow(/14 díg/i);
  });

  it('rejeita destinatário sem CPF e sem CNPJ', () => {
    expect(() => buildNfePayload(EMITENTE, { cnpj: null, cpf: null, nome: 'X' }, [ITEM], 'Venda', NOW)).toThrow(/CPF ou CNPJ/i);
  });

  it('rejeita natureza_operacao vazia', () => {
    expect(() => buildNfePayload(EMITENTE, DEST, [ITEM], '   ', NOW)).toThrow(/natureza/i);
  });
});
```

- [ ] **Step 2: Rodar o teste (deve falhar)**

Run: `npx vitest run src/lib/fiscal/nfe-payload.test.ts`
Expected: FAIL — `Failed to resolve import './nfe-payload'`.

- [ ] **Step 3: Implementar `nfe-payload.ts`**

Create `src/lib/fiscal/nfe-payload.ts`:

```ts
// @custom — Emissão multi-tipo: builder puro do payload NF-e (modelo 55) p/ Focus.
// Sem deps de React/Supabase — testável isoladamente.
// Doc: https://doc.focusnfe.com.br/reference/emitir_nfe
import type { RegimeCode } from './regime';

/** Item de nota de produto. Compartilhado por NF-e e NFC-e. */
export type NfeItem = {
  descricao: string;
  ncm: string;        // 8 dígitos
  cfop: string;       // 4 dígitos
  unidade: string;    // ex: 'UN'
  quantidade: number;
  valorUnitario: number;
};

export type NfeEmitente = {
  cnpj: string;
  regime: RegimeCode | string | null;
};

export type NfeDestinatario = {
  cnpj: string | null;
  cpf: string | null;
  nome: string;
};

export type NfeItemPayload = {
  numero_item: number;
  codigo_produto: string;
  descricao: string;
  codigo_ncm: string;
  cfop: string;
  unidade_comercial: string;
  quantidade_comercial: number;
  valor_unitario_comercial: number;
  valor_bruto: number;
  unidade_tributavel: string;
  quantidade_tributavel: number;
  valor_unitario_tributavel: number;
  // Defaults fiscais fixos (wiring). ICMS Simples Nacional → CSOSN; refinar depois.
  icms_origem: number;             // 0 = nacional
  icms_situacao_tributaria?: string;
  icms_csosn?: string;
};

export type NfePayload = {
  natureza_operacao: string;
  data_emissao: string;
  tipo_documento: number;          // 1 = saída
  finalidade_emissao: string;      // '1' = normal
  consumidor_final: number;        // 0 = não
  cnpj_emitente: string;
  nome_destinatario: string;
  cnpj_destinatario?: string;
  cpf_destinatario?: string;
  indicador_inscricao_estadual_destinatario: number; // 9 = não contribuinte
  modalidade_frete: number;        // 9 = sem frete
  items: NfeItemPayload[];
};

function digits(s: string | null | undefined): string {
  return (s ?? '').replace(/\D+/g, '');
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;
/** ISO no fuso de Brasília (-03:00), 2s no passado (mesma razão do nfse-payload). */
export function toBrasiliaISO(d: Date): string {
  const brt = new Date(d.getTime() - BRT_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${brt.getUTCFullYear()}-${p(brt.getUTCMonth() + 1)}-${p(brt.getUTCDate())}T${p(brt.getUTCHours())}:${p(brt.getUTCMinutes())}:${p(brt.getUTCSeconds())}-03:00`;
}

/** Simples Nacional (regimes 1,2,4) usa CSOSN; regime 3 usa CST. */
function impostoDefaults(regime: RegimeCode | string | null): Pick<NfeItemPayload, 'icms_origem' | 'icms_situacao_tributaria' | 'icms_csosn'> {
  if (regime === '3') return { icms_origem: 0, icms_situacao_tributaria: '00' };
  return { icms_origem: 0, icms_csosn: '102' }; // 102 = sem permissão de crédito
}

function mapItens(itens: NfeItem[], regime: RegimeCode | string | null): NfeItemPayload[] {
  return itens.map((it, i) => {
    const ncm = digits(it.ncm);
    const cfop = digits(it.cfop);
    if (ncm.length !== 8) throw new Error(`Item ${i + 1}: NCM deve ter 8 dígitos.`);
    if (cfop.length !== 4) throw new Error(`Item ${i + 1}: CFOP deve ter 4 dígitos.`);
    if (!it.descricao.trim()) throw new Error(`Item ${i + 1}: descrição obrigatória.`);
    if (!Number.isFinite(it.quantidade) || it.quantidade <= 0) throw new Error(`Item ${i + 1}: quantidade inválida.`);
    if (!Number.isFinite(it.valorUnitario) || it.valorUnitario <= 0) throw new Error(`Item ${i + 1}: valor unitário inválido.`);
    const valorUnit = round2(it.valorUnitario);
    return {
      numero_item: i + 1,
      codigo_produto: String(i + 1),
      descricao: it.descricao.trim(),
      codigo_ncm: ncm,
      cfop,
      unidade_comercial: it.unidade || 'UN',
      quantidade_comercial: it.quantidade,
      valor_unitario_comercial: valorUnit,
      valor_bruto: round2(it.quantidade * valorUnit),
      unidade_tributavel: it.unidade || 'UN',
      quantidade_tributavel: it.quantidade,
      valor_unitario_tributavel: valorUnit,
      ...impostoDefaults(regime),
    };
  });
}

export function buildNfePayload(
  emitente: NfeEmitente,
  destinatario: NfeDestinatario,
  itens: NfeItem[],
  naturezaOperacao: string,
  now: Date = new Date(),
): NfePayload {
  const cnpjEmit = digits(emitente.cnpj);
  if (cnpjEmit.length !== 14) throw new Error('CNPJ do emitente deve ter 14 dígitos.');
  if (!itens.length) throw new Error('A nota precisa de pelo menos 1 item.');
  const natureza = naturezaOperacao.trim();
  if (!natureza) throw new Error('Natureza da operação é obrigatória.');

  const cnpjDest = digits(destinatario.cnpj);
  const cpfDest = digits(destinatario.cpf);
  if (!cnpjDest && !cpfDest) throw new Error('Destinatário precisa de CPF ou CNPJ.');
  const nome = destinatario.nome.trim();
  if (!nome) throw new Error('Nome do destinatário é obrigatório.');

  const payload: NfePayload = {
    natureza_operacao: natureza,
    data_emissao: toBrasiliaISO(new Date(now.getTime() - 2_000)),
    tipo_documento: 1,
    finalidade_emissao: '1',
    consumidor_final: 0,
    cnpj_emitente: cnpjEmit,
    nome_destinatario: nome.slice(0, 60),
    indicador_inscricao_estadual_destinatario: 9,
    modalidade_frete: 9,
    items: mapItens(itens, emitente.regime),
  };
  if (cnpjDest) payload.cnpj_destinatario = cnpjDest;
  else payload.cpf_destinatario = cpfDest;
  return payload;
}
```

- [ ] **Step 4: Rodar o teste (deve passar)**

Run: `npx vitest run src/lib/fiscal/nfe-payload.test.ts`
Expected: PASS (todos os casos).

- [ ] **Step 5: Commit**

```bash
git add src/lib/fiscal/nfe-payload.ts src/lib/fiscal/nfe-payload.test.ts
git commit -m "feat(emissao): builder puro buildNfePayload (modelo 55)"
```

---

## Task 3: Builder puro `buildNfcePayload` (modelo 65)

**Files:**
- Create: `src/lib/fiscal/nfce-payload.ts`
- Test: `src/lib/fiscal/nfce-payload.test.ts`

Reusa `NfeItem` e `toBrasiliaISO` de `nfe-payload.ts` (DRY).

- [ ] **Step 1: Escrever o teste (falha)**

Create `src/lib/fiscal/nfce-payload.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildNfcePayload, type NfceFormaPagamento } from './nfce-payload';
import type { NfeEmitente, NfeItem } from './nfe-payload';

const NOW = new Date('2026-05-30T15:30:00Z');
const EMITENTE: NfeEmitente = { cnpj: '10358425000120', regime: '1' };
const ITEM: NfeItem = { descricao: 'Boia', ncm: '39269090', cfop: '5102', unidade: 'UN', quantidade: 2, valorUnitario: 50 };
const PGTO: NfceFormaPagamento = { forma: '01', valor: 100 };

describe('buildNfcePayload', () => {
  it('monta payload modelo 65 com defaults e pagamento', () => {
    const p = buildNfcePayload(EMITENTE, [ITEM], [PGTO], null, NOW);
    expect(p.cnpj_emitente).toBe('10358425000120');
    expect(p.presenca_comprador).toBe(1);
    expect(p.modalidade_frete).toBe(9);
    expect(p.local_destino).toBe(1);
    expect(p.items[0].valor_bruto).toBe(100);
    expect(p.formas_pagamento).toEqual([{ forma_pagamento: '01', valor_pagamento: 100 }]);
    expect(p.cpf_destinatario).toBeUndefined();
  });

  it('inclui CPF do consumidor quando informado', () => {
    const p = buildNfcePayload(EMITENTE, [ITEM], [PGTO], { cpf: '12345678901', nome: null }, NOW);
    expect(p.cpf_destinatario).toBe('12345678901');
  });

  it('rejeita sem forma de pagamento', () => {
    expect(() => buildNfcePayload(EMITENTE, [ITEM], [], null, NOW)).toThrow(/pagamento/i);
  });

  it('rejeita itens vazios', () => {
    expect(() => buildNfcePayload(EMITENTE, [], [PGTO], null, NOW)).toThrow(/item/i);
  });
});
```

- [ ] **Step 2: Rodar o teste (deve falhar)**

Run: `npx vitest run src/lib/fiscal/nfce-payload.test.ts`
Expected: FAIL — import não resolve.

- [ ] **Step 3: Implementar `nfce-payload.ts`**

Create `src/lib/fiscal/nfce-payload.ts`:

```ts
// @custom — Emissão multi-tipo: builder puro do payload NFC-e (modelo 65) p/ Focus.
// Doc: https://doc.focusnfe.com.br/reference/emitir_nfce
// NFC-e = consumidor final: destinatário opcional, mas formas_pagamento obrigatório.
import {
  toBrasiliaISO,
  type NfeEmitente,
  type NfeItem,
  type NfeItemPayload,
} from './nfe-payload';

export type NfceFormaPagamento = {
  forma: string;   // '01' dinheiro, '03' cartão crédito, etc.
  valor: number;
};

export type NfceConsumidor = {
  cpf: string | null;
  nome: string | null;
};

export type NfcePayload = {
  data_emissao: string;
  presenca_comprador: number;   // 1 = presencial
  modalidade_frete: number;     // 9 = sem frete
  local_destino: number;        // 1 = operação interna
  cnpj_emitente: string;
  cpf_destinatario?: string;
  nome_destinatario?: string;
  items: NfeItemPayload[];
  formas_pagamento: { forma_pagamento: string; valor_pagamento: number }[];
};

function digits(s: string | null | undefined): string {
  return (s ?? '').replace(/\D+/g, '');
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// NFC-e usa exatamente o mesmo mapeamento de itens da NF-e — reusamos a lógica
// montando via buildNfePayload-style inline para não duplicar validação.
function mapItens(itens: NfeItem[], regime: NfeEmitente['regime']): NfeItemPayload[] {
  if (!itens.length) throw new Error('A nota precisa de pelo menos 1 item.');
  return itens.map((it, i) => {
    const ncm = digits(it.ncm);
    const cfop = digits(it.cfop);
    if (ncm.length !== 8) throw new Error(`Item ${i + 1}: NCM deve ter 8 dígitos.`);
    if (cfop.length !== 4) throw new Error(`Item ${i + 1}: CFOP deve ter 4 dígitos.`);
    if (!it.descricao.trim()) throw new Error(`Item ${i + 1}: descrição obrigatória.`);
    if (!Number.isFinite(it.quantidade) || it.quantidade <= 0) throw new Error(`Item ${i + 1}: quantidade inválida.`);
    if (!Number.isFinite(it.valorUnitario) || it.valorUnitario <= 0) throw new Error(`Item ${i + 1}: valor unitário inválido.`);
    const valorUnit = round2(it.valorUnitario);
    const imposto = regime === '3' ? { icms_origem: 0, icms_situacao_tributaria: '00' } : { icms_origem: 0, icms_csosn: '102' };
    return {
      numero_item: i + 1,
      codigo_produto: String(i + 1),
      descricao: it.descricao.trim(),
      codigo_ncm: ncm,
      cfop,
      unidade_comercial: it.unidade || 'UN',
      quantidade_comercial: it.quantidade,
      valor_unitario_comercial: valorUnit,
      valor_bruto: round2(it.quantidade * valorUnit),
      unidade_tributavel: it.unidade || 'UN',
      quantidade_tributavel: it.quantidade,
      valor_unitario_tributavel: valorUnit,
      ...imposto,
    };
  });
}

export function buildNfcePayload(
  emitente: NfeEmitente,
  itens: NfeItem[],
  pagamentos: NfceFormaPagamento[],
  consumidor: NfceConsumidor | null,
  now: Date = new Date(),
): NfcePayload {
  const cnpjEmit = digits(emitente.cnpj);
  if (cnpjEmit.length !== 14) throw new Error('CNPJ do emitente deve ter 14 dígitos.');
  if (!pagamentos.length) throw new Error('Informe ao menos uma forma de pagamento.');

  const items = mapItens(itens, emitente.regime);

  const payload: NfcePayload = {
    data_emissao: toBrasiliaISO(new Date(now.getTime() - 2_000)),
    presenca_comprador: 1,
    modalidade_frete: 9,
    local_destino: 1,
    cnpj_emitente: cnpjEmit,
    items,
    formas_pagamento: pagamentos.map((p) => ({ forma_pagamento: p.forma, valor_pagamento: round2(p.valor) })),
  };
  const cpf = digits(consumidor?.cpf);
  if (cpf) payload.cpf_destinatario = cpf;
  if (consumidor?.nome?.trim()) payload.nome_destinatario = consumidor.nome.trim().slice(0, 60);
  return payload;
}
```

- [ ] **Step 4: Rodar o teste (deve passar)**

Run: `npx vitest run src/lib/fiscal/nfce-payload.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/fiscal/nfce-payload.ts src/lib/fiscal/nfce-payload.test.ts
git commit -m "feat(emissao): builder puro buildNfcePayload (modelo 65)"
```

---

## Task 4: Server actions de produto (`aux_produtos`)

**Files:**
- Modify: `src/app/(auth)/notas_fiscais/actions.ts` (adicionar no fim)

- [ ] **Step 1: Adicionar as actions de produto**

No fim de `src/app/(auth)/notas_fiscais/actions.ts`, adicione:

```ts
// ---------- Produtos (aux_produtos) — catálogo p/ itens de NF-e/NFC-e ----------
export type ProdutoOption = {
  id: string;
  descricao: string;
  ncm: string | null;
  cfop: string | null;
  unidade: string | null;
  valorUnitario: number | null;
};

/** Lista produtos da empresa ativa (tipo_nf nfe+nfce compartilhados). */
export async function listarProdutosAction(): Promise<ProdutoOption[]> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data: profile } = await supabase
    .from('profiles').select('current_company').eq('user_id', user.id).single();
  const companyId = (profile?.current_company ?? null) as string | null;
  if (!companyId) return [];
  const { data } = await supabase
    .from('aux_produtos')
    .select('id, descricao, ncm, cfop, unidade_comercial, valor_unitario_comercial, tipo_nf')
    .eq('company_id', companyId)
    .or('tipo_nf.eq.nfe,tipo_nf.eq.nfce,tipo_nf.is.null')
    .order('descricao', { ascending: true })
    .limit(500);
  return (data ?? []).map((p) => ({
    id: p.id as string,
    descricao: p.descricao as string,
    ncm: (p.ncm as string | null) ?? null,
    cfop: (p.cfop as string | null) ?? null,
    unidade: (p.unidade_comercial as string | null) ?? null,
    valorUnitario: (p.valor_unitario_comercial as number | null) ?? null,
  }));
}

export type CriarProdutoInput = {
  descricao: string;
  ncm: string;
  cfop: string;
  unidade: string;
  valorUnitario: number;
  tipoNf: 'nfe' | 'nfce';
};
export type CriarProdutoResult = { ok: true; produto: ProdutoOption } | { ok: false; error: string };

/** Cria um produto inline durante a emissão. Sem exclusão nesta entrega. */
export async function criarProdutoAction(input: CriarProdutoInput): Promise<CriarProdutoResult> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };
  const { data: profile } = await supabase
    .from('profiles').select('current_company').eq('user_id', user.id).single();
  const companyId = (profile?.current_company ?? null) as string | null;
  if (!companyId) return { ok: false, error: 'Nenhuma empresa selecionada.' };

  const descricao = input.descricao.trim();
  const ncm = input.ncm.replace(/\D+/g, '');
  const cfop = input.cfop.replace(/\D+/g, '');
  if (!descricao) return { ok: false, error: 'Descrição obrigatória.' };
  if (ncm.length !== 8) return { ok: false, error: 'NCM deve ter 8 dígitos.' };
  if (cfop.length !== 4) return { ok: false, error: 'CFOP deve ter 4 dígitos.' };
  if (!Number.isFinite(input.valorUnitario) || input.valorUnitario <= 0) {
    return { ok: false, error: 'Valor unitário deve ser positivo.' };
  }

  const { data, error } = await supabase
    .from('aux_produtos')
    .insert({
      company_id: companyId,
      descricao,
      ncm,
      cfop,
      unidade_comercial: input.unidade || 'UN',
      valor_unitario_comercial: input.valorUnitario,
      tipo_nf: input.tipoNf,
      finalizado: true,
    })
    .select('id, descricao, ncm, cfop, unidade_comercial, valor_unitario_comercial')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Falha ao criar produto.' };
  return {
    ok: true,
    produto: {
      id: data.id as string,
      descricao: data.descricao as string,
      ncm: (data.ncm as string | null) ?? null,
      cfop: (data.cfop as string | null) ?? null,
      unidade: (data.unidade_comercial as string | null) ?? null,
      valorUnitario: (data.valor_unitario_comercial as number | null) ?? null,
    },
  };
}
```

- [ ] **Step 2: Verificar typecheck**

Run: `npm run typecheck`
Expected: zero erros (usa `aux_produtos` adicionado na Task 1).

- [ ] **Step 3: Commit**

```bash
git add src/app/(auth)/notas_fiscais/actions.ts
git commit -m "feat(emissao): actions criar/listar produto (aux_produtos)"
```

---

## Task 5: Server actions de emissão NF-e e NFC-e

**Files:**
- Modify: `src/app/(auth)/notas_fiscais/actions.ts`

Reusa o padrão de `emitirNotaAction` (guards, `generateRef`, insert `pendente`, `focus-erro`).
Verifique no topo do arquivo se `focus`, `traduzirErroFocus`/`focus-erro` e `generateRef` já estão importados (estão, usados por `emitirNotaAction`). Adicione os imports dos builders.

- [ ] **Step 1: Adicionar imports dos builders no topo do arquivo**

Junto aos imports existentes de `@/lib/fiscal/*`:

```ts
import { buildNfePayload, type NfeItem } from '@/lib/fiscal/nfe-payload';
import { buildNfcePayload, type NfceFormaPagamento } from '@/lib/fiscal/nfce-payload';
```

- [ ] **Step 2: Adicionar `emitirNfeAction`**

No fim de `actions.ts`:

```ts
// ---------- Emissão NF-e (modelo 55) ----------
export type EmitirNfeInput = {
  clienteId: string;
  naturezaOperacao: string;
  itens: NfeItem[];
};
export type EmitirNotaTipadoResult = { ok: true; notaId: string } | { ok: false; error: string };

export async function emitirNfeAction(input: EmitirNfeInput): Promise<EmitirNotaTipadoResult> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  const { data: profile } = await supabase
    .from('profiles').select('current_company').eq('user_id', user.id).single();
  const companyId = (profile?.current_company ?? null) as string | null;
  if (!companyId) return { ok: false, error: 'Nenhuma empresa selecionada.' };

  const { data: company } = await supabase
    .from('companies').select('cnpj, razao_social, focus_token').eq('id', companyId).single();
  if (!company) return { ok: false, error: 'Empresa não encontrada.' };
  if (!company.focus_token) return { ok: false, error: 'Empresa não está cadastrada na Focus. Sincronize no Diagnóstico.' };

  const { data: fiscal } = await supabase
    .from('empresas_fiscais')
    .select('Code_regime_tributario, empresa_fiscal_ativada, focus_habilita_nfe')
    .eq('empresa_id', companyId).is('deleted_at', null).maybeSingle();
  if (!fiscal) return { ok: false, error: 'Configure o regime tributário antes de emitir.' };
  if (fiscal.empresa_fiscal_ativada !== true) return { ok: false, error: 'Ative a empresa fiscal antes de emitir.' };
  if (fiscal.focus_habilita_nfe !== true) return { ok: false, error: 'Empresa não habilitada para emitir NF-e.' };

  const { data: cliente } = await supabase
    .from('clientes').select('id, razao_social, document, person_type')
    .eq('id', input.clienteId).eq('company_id', companyId).is('deleted_at', null).maybeSingle();
  if (!cliente) return { ok: false, error: 'Cliente não encontrado.' };
  const personType = String(cliente.person_type ?? '').toUpperCase();
  const doc = String(cliente.document ?? '').replace(/\D+/g, '');

  let payload;
  try {
    payload = buildNfePayload(
      { cnpj: company.cnpj as string, regime: (fiscal.Code_regime_tributario as string | null) ?? null },
      { cnpj: personType === 'PJ' ? doc : null, cpf: personType === 'PF' ? doc : null, nome: (cliente.razao_social as string | null) ?? '—' },
      input.itens,
      input.naturezaOperacao,
    );
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erro ao montar a nota.' };
  }

  const ref = generateRef(companyId);
  const total = payload.items.reduce((s, it) => s + it.valor_bruto, 0);
  const { data: nota, error: insertErr } = await supabase
    .from('notas_fiscais')
    .insert({
      company_id: companyId,
      tipo_documento: 'NFe',
      referencia: ref,
      data_emissao: new Date().toISOString(),
      status: 'pendente',
      valor_total: Math.round(total * 100) / 100,
      payload_focusnfe: payload as unknown as Record<string, unknown>,
      cliente_id: cliente.id,
    })
    .select('id').single();
  if (insertErr || !nota) return { ok: false, error: insertErr?.message ?? 'Falha ao registrar a nota.' };
  const notaId = nota.id as string;

  try {
    const resp = await focus.emitirNfe(ref, payload, company.focus_token as string, 'hom');
    await supabase.from('notas_fiscais')
      .update({ payload_focusnfe: { request: payload, response: resp } })
      .eq('id', notaId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Falha ao emitir na Focus.';
    await supabase.from('notas_fiscais')
      .update({ status: 'erro', payload_focusnfe: { request: payload, error: msg } })
      .eq('id', notaId);
    return { ok: false, error: msg };
  }
  revalidatePath('/notas_fiscais');
  return { ok: true, notaId };
}
```

- [ ] **Step 3: Adicionar `emitirNfceAction`**

```ts
// ---------- Emissão NFC-e (modelo 65) ----------
export type EmitirNfceInput = {
  itens: NfeItem[];
  pagamentos: NfceFormaPagamento[];
  consumidorCpf?: string | null;
};

export async function emitirNfceAction(input: EmitirNfceInput): Promise<EmitirNotaTipadoResult> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  const { data: profile } = await supabase
    .from('profiles').select('current_company').eq('user_id', user.id).single();
  const companyId = (profile?.current_company ?? null) as string | null;
  if (!companyId) return { ok: false, error: 'Nenhuma empresa selecionada.' };

  const { data: company } = await supabase
    .from('companies').select('cnpj, focus_token').eq('id', companyId).single();
  if (!company) return { ok: false, error: 'Empresa não encontrada.' };
  if (!company.focus_token) return { ok: false, error: 'Empresa não está cadastrada na Focus. Sincronize no Diagnóstico.' };

  const { data: fiscal } = await supabase
    .from('empresas_fiscais')
    .select('Code_regime_tributario, empresa_fiscal_ativada, focus_habilita_nfce')
    .eq('empresa_id', companyId).is('deleted_at', null).maybeSingle();
  if (!fiscal) return { ok: false, error: 'Configure o regime tributário antes de emitir.' };
  if (fiscal.empresa_fiscal_ativada !== true) return { ok: false, error: 'Ative a empresa fiscal antes de emitir.' };
  if (fiscal.focus_habilita_nfce !== true) return { ok: false, error: 'Empresa não habilitada para emitir NFC-e.' };

  let payload;
  try {
    payload = buildNfcePayload(
      { cnpj: company.cnpj as string, regime: (fiscal.Code_regime_tributario as string | null) ?? null },
      input.itens,
      input.pagamentos,
      input.consumidorCpf ? { cpf: input.consumidorCpf, nome: null } : null,
    );
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erro ao montar a nota.' };
  }

  const ref = generateRef(companyId);
  const total = payload.items.reduce((s, it) => s + it.valor_bruto, 0);
  const { data: nota, error: insertErr } = await supabase
    .from('notas_fiscais')
    .insert({
      company_id: companyId,
      tipo_documento: 'NFCe',
      referencia: ref,
      data_emissao: new Date().toISOString(),
      status: 'pendente',
      valor_total: Math.round(total * 100) / 100,
      payload_focusnfe: payload as unknown as Record<string, unknown>,
    })
    .select('id').single();
  if (insertErr || !nota) return { ok: false, error: insertErr?.message ?? 'Falha ao registrar a nota.' };
  const notaId = nota.id as string;

  try {
    const resp = await focus.emitirNfce(ref, payload, company.focus_token as string, 'hom');
    await supabase.from('notas_fiscais')
      .update({ payload_focusnfe: { request: payload, response: resp } })
      .eq('id', notaId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Falha ao emitir na Focus.';
    await supabase.from('notas_fiscais')
      .update({ status: 'erro', payload_focusnfe: { request: payload, error: msg } })
      .eq('id', notaId);
    return { ok: false, error: msg };
  }
  revalidatePath('/notas_fiscais');
  return { ok: true, notaId };
}
```

- [ ] **Step 4: Verificar typecheck**

Run: `npm run typecheck`
Expected: zero erros.

- [ ] **Step 5: Commit**

```bash
git add src/app/(auth)/notas_fiscais/actions.ts
git commit -m "feat(emissao): emitirNfeAction + emitirNfceAction (guards + Focus hom)"
```

---

## Task 6: Componente `ItensField` (editor de itens compartilhado)

**Files:**
- Create: `src/app/(auth)/notas_fiscais/emissao/_components/ItensField.tsx`

Client component. Estado de itens (array), dropdown de produtos, criação inline.
Tipo de item exibido espelha `NfeItem` + um `id` local para a key da linha.

- [ ] **Step 1: Implementar o componente**

Create `src/app/(auth)/notas_fiscais/emissao/_components/ItensField.tsx`:

```tsx
'use client';
// @custom — Emissão multi-tipo: editor de itens compartilhado por NF-e e NFC-e.
// Itens vêm de aux_produtos (dropdown) ou são criados inline (criarProdutoAction).
// [×] remove o item DA NOTA (não exclui o produto).
import { useState } from 'react';
import { Trash2, Plus } from 'lucide-react';
import {
  criarProdutoAction,
  type ProdutoOption,
} from '../../actions';
import type { NfeItem } from '@/lib/fiscal/nfe-payload';

export type LinhaItem = NfeItem & { _key: string };

export default function ItensField({
  produtosIniciais,
  tipoNf,
  itens,
  onChange,
}: {
  produtosIniciais: ProdutoOption[];
  tipoNf: 'nfe' | 'nfce';
  itens: LinhaItem[];
  onChange: (itens: LinhaItem[]) => void;
}) {
  const [produtos, setProdutos] = useState<ProdutoOption[]>(produtosIniciais);
  const [selecao, setSelecao] = useState<string>('');
  const [novo, setNovo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  // campos do form inline
  const [d, setD] = useState(''); const [ncm, setNcm] = useState(''); const [cfop, setCfop] = useState('');
  const [un, setUn] = useState('UN'); const [qtd, setQtd] = useState('1'); const [vlr, setVlr] = useState('');

  function addDoDropdown() {
    const p = produtos.find((x) => x.id === selecao);
    if (!p) return;
    onChange([...itens, {
      _key: `${p.id}-${itens.length}`,
      descricao: p.descricao,
      ncm: p.ncm ?? '',
      cfop: p.cfop ?? '',
      unidade: p.unidade ?? 'UN',
      quantidade: 1,
      valorUnitario: p.valorUnitario ?? 0,
    }]);
    setSelecao('');
  }

  async function criarEAdicionar() {
    setErro(null); setSalvando(true);
    const r = await criarProdutoAction({
      descricao: d, ncm, cfop, unidade: un,
      valorUnitario: Number(vlr.replace(',', '.')), tipoNf,
    });
    setSalvando(false);
    if (!r.ok) { setErro(r.error); return; }
    setProdutos([...produtos, r.produto]);
    onChange([...itens, {
      _key: `${r.produto.id}-${itens.length}`,
      descricao: r.produto.descricao, ncm: r.produto.ncm ?? '', cfop: r.produto.cfop ?? '',
      unidade: r.produto.unidade ?? 'UN', quantidade: 1, valorUnitario: r.produto.valorUnitario ?? 0,
    }]);
    setNovo(false); setD(''); setNcm(''); setCfop(''); setUn('UN'); setQtd('1'); setVlr('');
  }

  function removerLinha(key: string) {
    onChange(itens.filter((i) => i._key !== key));
  }
  function setQtdLinha(key: string, q: number) {
    onChange(itens.map((i) => (i._key === key ? { ...i, quantidade: q } : i)));
  }

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-muted-foreground-2">Itens da nota</label>

      <div className="flex gap-2">
        <select
          value={selecao}
          onChange={(e) => setSelecao(e.target.value)}
          className="flex-1 rounded-lg border border-border bg-surface-2 text-foreground px-3 py-2 text-sm"
        >
          <option value="">Buscar produto…</option>
          {produtos.map((p) => (
            <option key={p.id} value={p.id}>{p.descricao}{p.ncm ? ` · NCM ${p.ncm}` : ''}</option>
          ))}
        </select>
        <button type="button" onClick={addDoDropdown} disabled={!selecao}
          className="rounded-lg bg-primary px-3 py-2 text-sm text-white disabled:opacity-50">Adicionar</button>
        <button type="button" onClick={() => setNovo(!novo)}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-sm">
          <Plus className="size-4" /> Novo
        </button>
      </div>

      {novo && (
        <div className="grid grid-cols-2 gap-2 rounded-lg border border-border p-3 bg-surface-2">
          <input placeholder="Descrição" value={d} onChange={(e) => setD(e.target.value)} className="col-span-2 rounded border border-border bg-surface px-2 py-1 text-sm" />
          <input placeholder="NCM (8 díg)" value={ncm} onChange={(e) => setNcm(e.target.value.replace(/\D+/g, '').slice(0, 8))} className="rounded border border-border bg-surface px-2 py-1 text-sm font-mono" />
          <input placeholder="CFOP (4 díg)" value={cfop} onChange={(e) => setCfop(e.target.value.replace(/\D+/g, '').slice(0, 4))} className="rounded border border-border bg-surface px-2 py-1 text-sm font-mono" />
          <input placeholder="Unidade" value={un} onChange={(e) => setUn(e.target.value)} className="rounded border border-border bg-surface px-2 py-1 text-sm" />
          <input placeholder="Valor unit. (R$)" value={vlr} onChange={(e) => setVlr(e.target.value.replace(/[^\d.,]/g, ''))} className="rounded border border-border bg-surface px-2 py-1 text-sm" />
          <button type="button" onClick={criarEAdicionar} disabled={salvando} className="col-span-2 rounded bg-primary px-3 py-1.5 text-sm text-white disabled:opacity-50">
            {salvando ? 'Salvando…' : 'Criar e adicionar'}
          </button>
        </div>
      )}

      {erro && <p className="text-sm text-destructive">{erro}</p>}

      {itens.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum item adicionado.</p>
      ) : (
        <ul className="space-y-1">
          {itens.map((it) => (
            <li key={it._key} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
              <span className="flex-1">{it.descricao} <span className="text-muted-foreground">· NCM {it.ncm} · CFOP {it.cfop}</span></span>
              <input type="number" min={1} value={it.quantidade}
                onChange={(e) => setQtdLinha(it._key, Math.max(1, Number(e.target.value)))}
                className="w-16 rounded border border-border bg-surface-2 px-2 py-1 text-sm" />
              <span className="w-24 text-right">R$ {(it.quantidade * it.valorUnitario).toFixed(2)}</span>
              <button type="button" onClick={() => removerLinha(it._key)} className="text-destructive" aria-label="Remover item">
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verificar typecheck**

Run: `npm run typecheck`
Expected: zero erros.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(auth)/notas_fiscais/emissao/_components/ItensField.tsx"
git commit -m "feat(emissao): ItensField (dropdown aux_produtos + criação inline)"
```

---

## Task 7: Formulário e página de NF-e

**Files:**
- Create: `src/app/(auth)/notas_fiscais/emissao/nfe/page.tsx`
- Create: `src/app/(auth)/notas_fiscais/emissao/nfe/NfeForm.tsx`

- [ ] **Step 1: Implementar `NfeForm.tsx`**

Create `src/app/(auth)/notas_fiscais/emissao/nfe/NfeForm.tsx`:

```tsx
'use client';
// @custom — Emissão multi-tipo: form NF-e (modelo 55). Client component.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import ClienteCombobox, { type ClienteOption } from '../ClienteCombobox';
import ItensField, { type LinhaItem } from '../_components/ItensField';
import { emitirNfeAction, type ProdutoOption } from '../../actions';

export default function NfeForm({ clientes, produtos }: { clientes: ClienteOption[]; produtos: ProdutoOption[] }) {
  const router = useRouter();
  const [clienteId, setClienteId] = useState('');
  const [natureza, setNatureza] = useState('Venda de mercadoria');
  const [itens, setItens] = useState<LinhaItem[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function emitir() {
    setErro(null);
    if (!clienteId) { setErro('Selecione um cliente.'); return; }
    if (itens.length === 0) { setErro('Adicione ao menos um item.'); return; }
    setEnviando(true);
    const r = await emitirNfeAction({
      clienteId,
      naturezaOperacao: natureza,
      itens: itens.map(({ _key, ...rest }) => rest),
    });
    setEnviando(false);
    if (!r.ok) { setErro(r.error); return; }
    router.push('/notas_fiscais');
  }

  return (
    <div className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-muted-foreground-2 mb-1">Cliente (destinatário)</label>
        <ClienteCombobox clientes={clientes} value={clienteId} onChange={setClienteId} />
      </div>
      <div>
        <label className="block text-sm font-medium text-muted-foreground-2 mb-1">Natureza da operação</label>
        <input value={natureza} onChange={(e) => setNatureza(e.target.value)}
          className="w-full rounded-lg border border-border bg-surface-2 text-foreground px-3 py-2 text-sm" />
      </div>
      <ItensField produtosIniciais={produtos} tipoNf="nfe" itens={itens} onChange={setItens} />
      {erro && <p className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">{erro}</p>}
      <button type="button" onClick={emitir} disabled={enviando}
        className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">
        {enviando && <Loader2 className="size-4 animate-spin" />}{enviando ? 'Emitindo…' : 'Emitir NF-e'}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Implementar `nfe/page.tsx`**

Create `src/app/(auth)/notas_fiscais/emissao/nfe/page.tsx`:

```tsx
// @custom — Emissão multi-tipo: página NF-e. Server Component: guard + carga de dados.
import Link from 'next/link';
import { createServerClient } from '@/lib/supabase/server';
import { listarProdutosAction } from '../../actions';
import NfeForm from './NfeForm';

export default async function NfeEmissaoPage() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from('profiles').select('current_company').eq('user_id', user.id).single();
  const companyId = (profile?.current_company ?? null) as string | null;
  if (!companyId) return <Bloqueio msg="Nenhuma empresa selecionada." />;

  const [{ data: fiscal }, { data: clientes }, produtos] = await Promise.all([
    supabase.from('empresas_fiscais')
      .select('empresa_fiscal_ativada, focus_habilita_nfe')
      .eq('empresa_id', companyId).is('deleted_at', null).maybeSingle(),
    supabase.from('clientes')
      .select('id, razao_social, document, person_type, email')
      .eq('company_id', companyId).eq('status', 'active').is('deleted_at', null)
      .order('razao_social', { ascending: true }).limit(500),
    listarProdutosAction(),
  ]);

  if (!fiscal || fiscal.empresa_fiscal_ativada !== true) {
    return <Bloqueio msg="Ative a empresa fiscal antes de emitir." href="/configuracoes?tab=fiscal" />;
  }
  if (fiscal.focus_habilita_nfe !== true) {
    return <Bloqueio msg="Esta empresa não está habilitada para emitir NF-e." />;
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-xl font-semibold mb-1">Emitir NF-e</h1>
      <p className="text-sm text-muted-foreground mb-6">Nota fiscal de produto (modelo 55) · homologação.</p>
      <NfeForm clientes={(clientes ?? []) as never} produtos={produtos} />
    </div>
  );
}

function Bloqueio({ msg, href }: { msg: string; href?: string }) {
  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="rounded-lg border border-border bg-surface-2 p-6">
        <p className="text-sm text-foreground">{msg}</p>
        {href && <Link href={href} className="mt-3 inline-block text-sm text-primary">Resolver →</Link>}
        <Link href="/notas_fiscais/emissao" className="mt-3 ml-4 inline-block text-sm text-muted-foreground">← Voltar</Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verificar typecheck**

Run: `npm run typecheck`
Expected: zero erros.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(auth)/notas_fiscais/emissao/nfe"
git commit -m "feat(emissao): página e form de NF-e"
```

---

## Task 8: Formulário e página de NFC-e

**Files:**
- Create: `src/app/(auth)/notas_fiscais/emissao/nfce/page.tsx`
- Create: `src/app/(auth)/notas_fiscais/emissao/nfce/NfceForm.tsx`

- [ ] **Step 1: Implementar `NfceForm.tsx`**

Create `src/app/(auth)/notas_fiscais/emissao/nfce/NfceForm.tsx`:

```tsx
'use client';
// @custom — Emissão multi-tipo: form NFC-e (modelo 65). Consumidor final.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import ItensField, { type LinhaItem } from '../_components/ItensField';
import { emitirNfceAction, type ProdutoOption } from '../../actions';

const FORMAS = [
  { v: '01', label: 'Dinheiro' },
  { v: '03', label: 'Cartão de crédito' },
  { v: '04', label: 'Cartão de débito' },
  { v: '17', label: 'PIX' },
];

export default function NfceForm({ produtos }: { produtos: ProdutoOption[] }) {
  const router = useRouter();
  const [itens, setItens] = useState<LinhaItem[]>([]);
  const [formaPgto, setFormaPgto] = useState('01');
  const [cpf, setCpf] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const total = itens.reduce((s, i) => s + i.quantidade * i.valorUnitario, 0);

  async function emitir() {
    setErro(null);
    if (itens.length === 0) { setErro('Adicione ao menos um item.'); return; }
    setEnviando(true);
    const r = await emitirNfceAction({
      itens: itens.map(({ _key, ...rest }) => rest),
      pagamentos: [{ forma: formaPgto, valor: Math.round(total * 100) / 100 }],
      consumidorCpf: cpf.replace(/\D+/g, '') || null,
    });
    setEnviando(false);
    if (!r.ok) { setErro(r.error); return; }
    router.push('/notas_fiscais');
  }

  return (
    <div className="space-y-5">
      <ItensField produtosIniciais={produtos} tipoNf="nfce" itens={itens} onChange={setItens} />
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-muted-foreground-2 mb-1">Forma de pagamento</label>
          <select value={formaPgto} onChange={(e) => setFormaPgto(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface-2 text-foreground px-3 py-2 text-sm">
            {FORMAS.map((f) => <option key={f.v} value={f.v}>{f.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-muted-foreground-2 mb-1">CPF do consumidor (opcional)</label>
          <input value={cpf} onChange={(e) => setCpf(e.target.value.replace(/\D+/g, '').slice(0, 11))}
            placeholder="Somente números" className="w-full rounded-lg border border-border bg-surface-2 text-foreground px-3 py-2 text-sm font-mono" />
        </div>
      </div>
      <p className="text-sm text-muted-foreground">Total: <strong>R$ {total.toFixed(2)}</strong></p>
      {erro && <p className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">{erro}</p>}
      <button type="button" onClick={emitir} disabled={enviando}
        className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">
        {enviando && <Loader2 className="size-4 animate-spin" />}{enviando ? 'Emitindo…' : 'Emitir NFC-e'}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Implementar `nfce/page.tsx`**

Create `src/app/(auth)/notas_fiscais/emissao/nfce/page.tsx`:

```tsx
// @custom — Emissão multi-tipo: página NFC-e. Server Component: guard + carga.
import Link from 'next/link';
import { createServerClient } from '@/lib/supabase/server';
import { listarProdutosAction } from '../../actions';
import NfceForm from './NfceForm';

export default async function NfceEmissaoPage() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from('profiles').select('current_company').eq('user_id', user.id).single();
  const companyId = (profile?.current_company ?? null) as string | null;
  if (!companyId) return <Bloqueio msg="Nenhuma empresa selecionada." />;

  const [{ data: fiscal }, produtos] = await Promise.all([
    supabase.from('empresas_fiscais')
      .select('empresa_fiscal_ativada, focus_habilita_nfce')
      .eq('empresa_id', companyId).is('deleted_at', null).maybeSingle(),
    listarProdutosAction(),
  ]);

  if (!fiscal || fiscal.empresa_fiscal_ativada !== true) {
    return <Bloqueio msg="Ative a empresa fiscal antes de emitir." href="/configuracoes?tab=fiscal" />;
  }
  if (fiscal.focus_habilita_nfce !== true) {
    return <Bloqueio msg="Esta empresa não está habilitada para emitir NFC-e." />;
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-xl font-semibold mb-1">Emitir NFC-e</h1>
      <p className="text-sm text-muted-foreground mb-6">Nota de consumidor (modelo 65) · homologação.</p>
      <NfceForm produtos={produtos} />
    </div>
  );
}

function Bloqueio({ msg, href }: { msg: string; href?: string }) {
  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="rounded-lg border border-border bg-surface-2 p-6">
        <p className="text-sm text-foreground">{msg}</p>
        {href && <Link href={href} className="mt-3 inline-block text-sm text-primary">Resolver →</Link>}
        <Link href="/notas_fiscais/emissao" className="mt-3 ml-4 inline-block text-sm text-muted-foreground">← Voltar</Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verificar typecheck**

Run: `npm run typecheck`
Expected: zero erros.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(auth)/notas_fiscais/emissao/nfce"
git commit -m "feat(emissao): página e form de NFC-e"
```

---

## Task 9: Tela de escolha de tipo (rework do `emissao/page.tsx`)

**Files:**
- Modify: `src/app/(auth)/notas_fiscais/emissao/page.tsx`
- Create: `src/app/(auth)/notas_fiscais/emissao/nfse/page.tsx` (move o form NFS-e atual)
- Create: `src/app/(auth)/notas_fiscais/emissao/nfse/EmissaoForm.tsx` se necessário (ver passo)

A NFS-e atual está em `emissao/page.tsx` + `emissao/EmissaoForm.tsx`. Vamos: mover a página NFS-e para `emissao/nfse/page.tsx` (o form `EmissaoForm.tsx` e `ClienteCombobox.tsx` ficam onde estão — são importados por caminho relativo `../`), e transformar `emissao/page.tsx` na tela de escolha.

- [ ] **Step 1: Mover a página NFS-e para `nfse/page.tsx`**

```bash
cd app
git mv "src/app/(auth)/notas_fiscais/emissao/page.tsx" "src/app/(auth)/notas_fiscais/emissao/nfse/page.tsx"
```

Em `emissao/nfse/page.tsx`, corrija os imports relativos (subiram um nível): trocar `'./EmissaoForm'` por `'../EmissaoForm'`. Confirme que `EmissaoForm.tsx` e `ClienteCombobox.tsx` continuam em `emissao/` (não move). `EmissaoForm` importa `'../actions'` → agora é `'../../actions'`; ajuste se o import quebrar no typecheck.

> Nota: `EmissaoForm.tsx` está em `emissao/` e importa `from '../actions'`. Ele NÃO é movido — continua válido. Só `nfse/page.tsx` muda de nível e seu import de `./EmissaoForm` vira `../EmissaoForm`.

- [ ] **Step 2: Criar a tela de escolha em `emissao/page.tsx`**

Create `src/app/(auth)/notas_fiscais/emissao/page.tsx`:

```tsx
// @custom — Emissão multi-tipo: tela de escolha do tipo de nota.
// Os 3 cards sempre visíveis; desabilitados conforme as flags focus_habilita_*.
import Link from 'next/link';
import { FileText, Package, ShoppingCart } from 'lucide-react';
import { createServerClient } from '@/lib/supabase/server';

type Tipo = { key: 'nfse' | 'nfe' | 'nfce'; titulo: string; sub: string; href: string; icon: React.ReactNode; habilitado: boolean };

export default async function EmissaoEscolhaPage() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from('profiles').select('current_company').eq('user_id', user.id).single();
  const companyId = (profile?.current_company ?? null) as string | null;

  let nfse = false, nfe = false, nfce = false;
  if (companyId) {
    const { data: fiscal } = await supabase
      .from('empresas_fiscais')
      .select('focus_habilita_nfse, focus_habilita_nfsen_homologacao, focus_habilita_nfe, focus_habilita_nfce, empresa_fiscal_ativada')
      .eq('empresa_id', companyId).is('deleted_at', null).maybeSingle();
    const ativa = fiscal?.empresa_fiscal_ativada === true;
    nfse = ativa && (fiscal?.focus_habilita_nfse === true || fiscal?.focus_habilita_nfsen_homologacao === true);
    nfe = ativa && fiscal?.focus_habilita_nfe === true;
    nfce = ativa && fiscal?.focus_habilita_nfce === true;
  }

  const tipos: Tipo[] = [
    { key: 'nfse', titulo: 'NFS-e', sub: 'Serviço', href: '/notas_fiscais/emissao/nfse', icon: <FileText className="size-6" />, habilitado: nfse },
    { key: 'nfe', titulo: 'NF-e', sub: 'Produto (modelo 55)', href: '/notas_fiscais/emissao/nfe', icon: <Package className="size-6" />, habilitado: nfe },
    { key: 'nfce', titulo: 'NFC-e', sub: 'Consumidor (modelo 65)', href: '/notas_fiscais/emissao/nfce', icon: <ShoppingCart className="size-6" />, habilitado: nfce },
  ];

  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-xl font-semibold mb-1">Emitir nota fiscal</h1>
      <p className="text-sm text-muted-foreground mb-6">Escolha o tipo de documento.</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {tipos.map((t) => t.habilitado ? (
          <Link key={t.key} href={t.href}
            className="rounded-xl border border-border bg-surface-2 p-5 hover:border-primary hover:shadow-sm transition flex flex-col gap-2">
            <span className="text-primary">{t.icon}</span>
            <span className="font-medium text-foreground">{t.titulo}</span>
            <span className="text-xs text-muted-foreground">{t.sub}</span>
          </Link>
        ) : (
          <div key={t.key} aria-disabled
            className="rounded-xl border border-border bg-surface p-5 opacity-50 cursor-not-allowed flex flex-col gap-2"
            title="Empresa não habilitada para este tipo">
            <span className="text-muted-foreground">{t.icon}</span>
            <span className="font-medium text-muted-foreground">{t.titulo}</span>
            <span className="text-xs text-muted-foreground">{t.sub} · não habilitado</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verificar typecheck**

Run: `npm run typecheck`
Expected: zero erros. Se algum import relativo de `nfse/page.tsx` quebrar, corrija o nível (`../` → `../../` conforme o caso).

- [ ] **Step 4: Rodar a suíte de testes completa**

Run: `npm test -- --run`
Expected: PASS (incluindo `nfe-payload.test.ts` e `nfce-payload.test.ts` novos; nenhum teste existente quebrado).

- [ ] **Step 5: Commit**

```bash
git add "src/app/(auth)/notas_fiscais/emissao"
git commit -m "feat(emissao): tela de escolha de tipo + NFS-e movida p/ /nfse"
```

---

## Task 10: Verificação manual (homologação, AL Piscinas)

**Files:** nenhum (verificação).

- [ ] **Step 1: Subir o dev e validar o fluxo**

Run: `npm run dev` (NÃO rodar build em paralelo).

Com a empresa AL Piscinas selecionada:
1. Acessar `/notas_fiscais/emissao` → confirmar os 3 cards habilitados (clicáveis).
2. **NF-e**: abrir → selecionar cliente → "Novo" produto (descrição/NCM 8d/CFOP 4d/valor) → "Criar e adicionar" → confirmar que o item aparece e que o produto passa a existir no dropdown → "Emitir NF-e".
3. **Observar a resposta da Focus**: a nota aparece em `/notas_fiscais`. Status `erro` com a mensagem da Focus em `payload_focusnfe.error` é **resultado esperado e válido** (erro de CNAE/atividade) — significa que o wiring está completo. Status `pendente`/sucesso também é válido.
4. **NFC-e**: repetir, adicionando item + forma de pagamento → "Emitir NFC-e" → observar resposta.
5. **Guard**: (opcional) numa empresa sem as flags, confirmar que os cards NF-e/NFC-e aparecem **desabilitados** e que a action recusa se chamada diretamente.

- [ ] **Step 2: Anotar o resultado**

Registrar no PR/commit qual resposta a Focus deu para NF-e e NFC-e (sucesso, pendente, ou erro de CNAE com o texto). É o entregável que "destrava" os 2 braços.

---

## Self-Review (preenchido pelo autor do plano)

- **Cobertura do spec:** §2 (fluxo) → Task 9; §3 (forms) → Tasks 7,8; §4 (itens/aux_produtos) → Tasks 4,6; §5 (flags/guards) → Tasks 1,5; §6 (arquivos) → todas; §7 (builders) → Tasks 2,3; §8 (resposta/erro) → Task 5; §10 (testes) → Tasks 2,3,9,10. ✅ Sem lacunas.
- **Placeholders:** nenhum — todo passo tem código/comando completo. A migration usa match por razão social (não exige UUID hardcoded).
- **Consistência de tipos:** `NfeItem`/`NfeItemPayload`/`ProdutoOption`/`LinhaItem`/`EmitirNfeInput`/`EmitirNfceInput`/`NfceFormaPagamento` definidos uma vez e reusados; `toBrasiliaISO` exportado de `nfe-payload` e reusado em `nfce-payload`.
```
