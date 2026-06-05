# Spec — Seção "Declarações" no /impostos + reconciliação de migrations

**Data:** 2026-06-05
**Backlog:** P1.1 (`docs/planning/BACKLOG-IMPOSTOS.md`)
**Relacionado:** `docs/investigations/DB-DIVERGENCIA.md`, `balu-db-source-of-truth`.

## Problema

O `/impostos` mostra **guias** mas não **declarações** (PRD §11.1 prevê as duas). A consulta SERPRO
`CONSDECLARACAO13` (`consultarDeclaracoesSimples`) **já retorna** os dados da declaração por
competência — `{ competencia, numeroDeclaracao, dataTransmissao, numeroDas, dasPago, status }` — mas
`consultarDeclaracoesAction` **enfia tudo em `guias_fiscais`** e **descarta** `numeroDeclaracao` e
`dataTransmissao`. Não existe tabela `declaracoes_fiscais` no banco real.

Inconsistência de migrations: a `0001_init.sql` **declara** `declaracoes_fiscais` num schema
idealizado **nunca aplicado** (convenção velha: `empresa_id` + `competencia char(6)`), divergente do
banco real (`company_id` + `competencia_referencia` + `owner_user_id`). `db_atual.sql` é a verdade.

## Decisões fechadas (brainstorming)

- **Escopo A — display-only.** Aproveita a consulta `CONSDECLARACAO13` que já funciona. **Transmitir**
  PGDAS-D (`TRANSDECLARACAO11`, hoje código morto) é outro card; o display **não depende** dela.
- **Escopo B — tabela `declaracoes_fiscais`** (modelo PRD §11.1), separando declaração de guia.
- **Escopo C — Simples (PGDAS-D)** agora; **MEI (DASN-SIMEI)** fora (serviço não existe) → aviso.
- **Reconciliação:** criar a tabela na **convenção CORRETA** (não a da 0001); anotar a 0001 como
  superada; atualizar `DB-DIVERGENCIA.md`. Mesmo espírito da `0013` (que recriou `aux_produtos`), mas
  **corrigindo a convenção** em vez de copiar a 0001.

## Modelo de dados — `declaracoes_fiscais` (migration 0025)

```sql
CREATE TABLE IF NOT EXISTS public.declaracoes_fiscais (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  owner_user_id          UUID NOT NULL,
  competencia_referencia TEXT NOT NULL,                 -- YYYYMM
  tipo                   TEXT NOT NULL DEFAULT 'PGDAS-D', -- futuro: DASN-SIMEI, DEFIS
  numero_declaracao      TEXT,
  data_transmissao       TIMESTAMPTZ,
  status                 TEXT,                           -- 'transmitida' | 'pendente'
  guia_fiscal_id         UUID REFERENCES public.guias_fiscais(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT declaracoes_fiscais_company_comp_tipo_uniq UNIQUE (company_id, competencia_referencia, tipo)
);
```

- **Convenção real** (`company_id`/`competencia_referencia`/`owner_user_id`), alinhada a
  `apuracoes_fiscais`/`guias_fiscais` — corrige a divergência da 0001.
- **Sem `deleted_at`** de propósito (declaração se re-consulta/corrige, não se apaga) → `UNIQUE` real
  (não parcial) → `upsert onConflict` direto, sem `42P10` (lição da `folha_mensal`).
- RLS: `FOR ALL TO authenticated USING (owner_user_id = auth.uid()) WITH CHECK (...)` — igual
  `company_cnaes`/`folha_mensal`.
- Trigger `tg_set_updated_at`; índice `(company_id)`. Aditiva/idempotente (`IF NOT EXISTS`, policy em
  bloco `DO $$ ... EXCEPTION`). **Autocontida** (recria `tg_set_updated_at` via `CREATE OR REPLACE`,
  como a 0013, caso o banco não a tenha).
- Tipo em `app/src/types/database.ts`: `declaracoes_fiscais: { Row; Insert; Update }`.

## Reconciliação do histórico de migrations

1. **Anotar `0001_init.sql`**: comentário no bloco `declaracoes_fiscais` (linhas ~183-195) dizendo que
   é o schema idealizado **não aplicado** (convenção `empresa_id`/`char6`), **superado pela `0025`**
   com a convenção real. Não remover (preserva o histórico; mesmo padrão de não-edição destrutiva).
2. **Atualizar `docs/investigations/DB-DIVERGENCIA.md`**:
   - Seção A: mover `declaracoes_fiscais` de "só nos migrations (não existem no banco)" para uma nota
     "criada de verdade pela `0025` na convenção real" (como `aux_produtos`/`0013`).
   - Seção F (Passo 3): marcar a decisão de `declaracoes_fiscais` como **resolvida** (criar mínima,
     aditivo, convenção corrigida).

## Persistência — refinar `consultarDeclaracoesAction`

Hoje só faz upsert em `guias_fiscais`. Passa a **também** upsertar em `declaracoes_fiscais`:

```ts
const decls = r.situacoes.map((s) => ({
  company_id: companyId, owner_user_id: user.id,
  competencia_referencia: s.competencia, tipo: 'PGDAS-D',
  numero_declaracao: s.numeroDeclaracao,
  data_transmissao: s.dataTransmissao,
  status: s.numeroDeclaracao ? 'transmitida' : 'pendente',
  updated_at: new Date().toISOString(),
}));
if (decls.length) await supabase.from('declaracoes_fiscais')
  .upsert(decls, { onConflict: 'company_id,competencia_referencia,tipo' });
```

- O upsert de `guias_fiscais` (DAS/situação) **continua igual** — separação limpa.
- `revalidatePath('/impostos')` já existe.
- `guia_fiscal_id` não é preenchido nesta entrega (vínculo direto fica p/ depois; a UI casa por
  competência se precisar). Documentar.

## Carregamento + UI

### `impostos/page.tsx`
- Adicionar ao `Promise.all` a leitura de `declaracoes_fiscais` (Simples; limit ~24, desc por
  `competencia_referencia`):
  ```ts
  supabase.from('declaracoes_fiscais')
    .select('id, competencia_referencia, tipo, numero_declaracao, data_transmissao, status')
    .eq('company_id', companyId)
    .order('competencia_referencia', { ascending: false }).limit(24)
  ```
- Mapear p/ `DeclaracaoRow[]` e renderizar uma nova `<section>` **"Declarações"** entre "Competência
  atual" e "Histórico de guias", só quando `isSimples`. Para MEI, um aviso curto "DASN-SIMEI em breve".

### `DeclaracoesSection.tsx` (novo, server component presentational)
- Recebe `declaracoes: DeclaracaoRow[]`. Tabela compacta: **Competência · Tipo · Situação · Nº
  declaração · Transmitida em**. Badge de status (transmitida = verde; pendente = âmbar).
- Vazio: "Nenhuma declaração consultada. Use 'Consultar na SERPRO'."
- Reusa o `ConsultarSerproButton` existente (já alimenta a consulta; agora popula as duas tabelas).

```ts
export type DeclaracaoRow = {
  id: string;
  competencia: string;            // YYYYMM
  tipo: string;                   // 'PGDAS-D'
  numeroDeclaracao: string | null;
  dataTransmissao: string | null; // ISO
  status: string | null;          // 'transmitida' | 'pendente'
};
```

## Fora de escopo
- Transmitir PGDAS-D (`TRANSDECLARACAO11`); DASN-SIMEI/DEFIS; vínculo `guia_fiscal_id` automático;
  paginação da lista de declarações.

## Testes
- A action é I/O (SERPRO + upsert) — coberta indiretamente. Sem unidade pura nova relevante.
- Verificação manual/live: rodar "Consultar na SERPRO" numa empresa Simples e conferir a seção.

## Arquivos
- **Create** `app/supabase/migrations/0025_declaracoes_fiscais.sql`
- **Modify** `app/supabase/migrations/0001_init.sql` (anotação no bloco declaracoes)
- **Modify** `app/src/types/database.ts` (`declaracoes_fiscais`)
- **Modify** `docs/investigations/DB-DIVERGENCIA.md` (reconciliação)
- **Modify** `app/src/app/(auth)/impostos/actions.ts` (`consultarDeclaracoesAction` upserta declarações)
- **Modify** `app/src/app/(auth)/impostos/page.tsx` (carregar + renderizar seção)
- **Create** `app/src/app/(auth)/impostos/DeclaracoesSection.tsx`
