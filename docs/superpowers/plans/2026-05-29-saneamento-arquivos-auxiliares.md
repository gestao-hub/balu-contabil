# Saneamento `arquivos_auxiliares` + `role_types` + `abertura_empresas` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Formalizar a FK de `arquivos_auxiliares`, padronizar o cert no Storage para `${company_id}/certificado.enc`, limpar o cruft legado do Bubble, e fechar os gaps de `role_types` (grant) e `abertura_empresas` (policy).

**Architecture:** Um script Node one-time (service_role) faz as operações de dados/Storage (move do cert válido, varredura do bucket, deleção das órfãs) ANTES de uma migration SQL `0011` (aplicada manual no SQL Editor) que renomeia a coluna para `company_id` + FK, dropa `unique_id_bubble`, recria policies e fecha os outros dois gaps. O código de Configurações passa a usar nome fixo de arquivo e `company_id`.

**Tech Stack:** Supabase (Postgres RLS + Storage), `@supabase/supabase-js`, Playwright, Next.js 15.

**Spec:** `docs/superpowers/specs/2026-05-29-saneamento-arquivos-auxiliares-design.md`

**Pré-requisitos de ambiente:**
- Migration aplicada **manualmente no SQL Editor** (sem CLI/conexão local).
- Script e testes batem no **Supabase de dev real** via `balu-next/.env.local`.
- Dados-âncora (descobertos por introspecção em 2026-05-29):
  - Empresa válida: `companies.id = 41a9c2a4-241f-40b0-a1c5-da3fced49359`.
  - Linha válida: `arquivos_auxiliares.id = 0b44bdec-f9b5-43b2-b65c-9e9ea3dd12e4`, objeto atual `41a9c2a4-241f-40b0-a1c5-da3fced49359/9783c30f-3238-45c4-8e7e-96dec4ad86d0.enc`.
  - Linhas órfãs a apagar: `5d8325bc-b125-4f4b-a307-4337bfdb55ca`, `5e29855c-bfb0-4ede-b964-40f4458335fe`.
  - Keep-set no bucket após o move: `41a9c2a4-241f-40b0-a1c5-da3fced49359/certificado.enc` + `.emptyFolderPlaceholder`.

Todos os comandos rodam a partir de `balu-next/`.

---

### Task 1: Script de saneamento (dry-run por padrão)

**Files:**
- Create: `balu-next/scripts/saneamento-arquivos-auxiliares.mjs`

- [ ] **Step 1: Escrever o script**

Criar `scripts/saneamento-arquivos-auxiliares.mjs`:

```js
// One-time: padroniza o cert no Storage, varre o bucket e remove as linhas órfãs.
// Dry-run por padrão; passe --apply para executar de fato.
// Rodar: set -a; . ./.env.local; set +a; node scripts/saneamento-arquivos-auxiliares.mjs [--apply]
import { createClient } from '@supabase/supabase-js';

const APPLY = process.argv.includes('--apply');
const BUCKET = 'company-certificates';
const VALID_COMPANY = '41a9c2a4-241f-40b0-a1c5-da3fced49359';
const VALID_ROW_ID = '0b44bdec-f9b5-43b2-b65c-9e9ea3dd12e4';
const OLD_OBJECT = `${VALID_COMPANY}/9783c30f-3238-45c4-8e7e-96dec4ad86d0.enc`;
const NEW_OBJECT = `${VALID_COMPANY}/certificado.enc`;
const ORPHAN_ROW_IDS = ['5d8325bc-b125-4f4b-a307-4337bfdb55ca', '5e29855c-bfb0-4ede-b964-40f4458335fe'];
const KEEP = new Set([NEW_OBJECT, '.emptyFolderPlaceholder']);

const log = (...a) => console.log(APPLY ? '[APPLY]' : '[DRY] ', ...a);
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Lista o bucket recursivamente (1 nível de pasta — o esquema do projeto).
async function listAll() {
  const out = [];
  const { data: top, error } = await admin.storage.from(BUCKET).list('', { limit: 1000 });
  if (error) throw new Error(`list raiz: ${error.message}`);
  for (const f of top) {
    const isFolder = f.id === null || f.metadata == null;
    if (isFolder) {
      const { data: sub } = await admin.storage.from(BUCKET).list(f.name, { limit: 1000 });
      for (const s of (sub || [])) out.push(`${f.name}/${s.name}`);
    } else {
      out.push(f.name);
    }
  }
  return out;
}

async function main() {
  // 1) Move o cert válido (se ainda não movido).
  const before = await listAll();
  if (before.includes(OLD_OBJECT) && !before.includes(NEW_OBJECT)) {
    log('move', OLD_OBJECT, '->', NEW_OBJECT);
    if (APPLY) {
      const { error } = await admin.storage.from(BUCKET).move(OLD_OBJECT, NEW_OBJECT);
      if (error) throw new Error(`move: ${error.message}`);
    }
  } else if (before.includes(NEW_OBJECT)) {
    log('move pulado (destino já existe):', NEW_OBJECT);
  } else {
    log('AVISO: objeto de origem não encontrado:', OLD_OBJECT);
  }

  // 2) Atualiza storage_key/supabase_file_path da linha válida.
  log('update linha válida', VALID_ROW_ID, 'storage_key/supabase_file_path ->', NEW_OBJECT);
  if (APPLY) {
    const { error } = await admin.from('arquivos_auxiliares')
      .update({ storage_key: NEW_OBJECT, supabase_file_path: NEW_OBJECT }).eq('id', VALID_ROW_ID);
    if (error) throw new Error(`update válida: ${error.message}`);
  }

  // 3) Apaga as linhas órfãs.
  log('delete linhas órfãs', ORPHAN_ROW_IDS.join(', '));
  if (APPLY) {
    const { error } = await admin.from('arquivos_auxiliares').delete().in('id', ORPHAN_ROW_IDS);
    if (error) throw new Error(`delete órfãs: ${error.message}`);
  }

  // 4) Varre o bucket: remove tudo fora do keep-set.
  const after = await listAll();
  const toDelete = after.filter((p) => !KEEP.has(p));
  log('objetos a remover do bucket:', JSON.stringify(toDelete));
  if (APPLY && toDelete.length) {
    const { error } = await admin.storage.from(BUCKET).remove(toDelete);
    if (error) throw new Error(`remove objetos: ${error.message}`);
  }

  // 5) Confere estado final.
  const final = await listAll();
  log('bucket final:', JSON.stringify(final));
  const { count } = await admin.from('arquivos_auxiliares').select('*', { count: 'exact', head: true });
  log('linhas em arquivos_auxiliares:', count);
}

main().then(() => log('ok')).catch((e) => { console.error('FALHOU:', e.message); process.exit(1); });
```

- [ ] **Step 2: Rodar em dry-run e conferir o plano**

Run: `set -a; . ./.env.local; set +a; node scripts/saneamento-arquivos-auxiliares.mjs`
Expected: imprime `[DRY]` com: move `…/9783c30f….enc` → `…/certificado.enc`; delete das 2 órfãs; lista `objetos a remover` contendo `1779747182535x….pfx`, `cefa8a7e….pfx`, `db2b742d…/cert-confirm-test.pfx`, `42ba5775…/206f1b59….enc`, `dec3f6c6…/f7d1d91c….enc`, `5f1de1b4…/d8834803….enc`. NÃO deve listar `certificado.enc` nem `.emptyFolderPlaceholder` para remoção.

Se a lista de remoção contiver algo inesperado, PARAR e revisar antes do --apply.

- [ ] **Step 3: Commit do script**

```bash
git add scripts/saneamento-arquivos-auxiliares.mjs
git commit -m "chore(saneamento): script one-time de limpeza de arquivos_auxiliares + Storage"
```

---

### Task 2: Executar o script (--apply) — DESTRUTIVO, pausa para aval

**Files:** nenhum (execução em dados reais)

- [ ] **Step 1: Rodar com --apply**

> ⚠️ Apaga linhas e objetos no Supabase de dev. Confirme o dry-run da Task 1 antes.

Run: `set -a; . ./.env.local; set +a; node scripts/saneamento-arquivos-auxiliares.mjs --apply`
Expected: linhas `[APPLY]`; ao final `bucket final: ["…/certificado.enc",".emptyFolderPlaceholder"]` (ordem pode variar) e `linhas em arquivos_auxiliares: 1`.

- [ ] **Step 2: Conferir idempotência (re-rodar dry-run)**

Run: `set -a; . ./.env.local; set +a; node scripts/saneamento-arquivos-auxiliares.mjs`
Expected: `move pulado (destino já existe)`, `objetos a remover do bucket: []`, `linhas …: 1`.

---

### Task 3: Migration `0011_arquivos_auxiliares_fk.sql`

**Files:**
- Create: `balu-next/supabase/migrations/0011_arquivos_auxiliares_fk.sql`

- [ ] **Step 1: Escrever a migration**

Criar `supabase/migrations/0011_arquivos_auxiliares_fk.sql`:

```sql
-- 0011_arquivos_auxiliares_fk.sql
-- Pós-RLS: formaliza a FK de arquivos_auxiliares (a coluna unique_id_empresa já é
-- uuid = companies.id), dropa o legado unique_id_bubble, e fecha os gaps de
-- role_types (grant) e abertura_empresas (policy por user_id).
-- PRÉ-REQUISITO: rodar scripts/saneamento-arquivos-auxiliares.mjs --apply ANTES
-- (remove as órfãs; a FK falha se existirem company_id sem company correspondente).
-- Spec: docs/superpowers/specs/2026-05-29-saneamento-arquivos-auxiliares-design.md

-- 1) arquivos_auxiliares: rename + FK + drop coluna legada
alter table public.arquivos_auxiliares rename column unique_id_empresa to company_id;
alter table public.arquivos_auxiliares
  add constraint arquivos_auxiliares_company_id_fkey
  foreign key (company_id) references public.companies(id) on delete cascade;
alter table public.arquivos_auxiliares drop column unique_id_bubble;

-- 2) recria as policies referenciando company_id (o rename atualizaria sozinho; explicitamos)
drop policy if exists arquivos_auxiliares_select on public.arquivos_auxiliares;
drop policy if exists arquivos_auxiliares_insert on public.arquivos_auxiliares;
drop policy if exists arquivos_auxiliares_update on public.arquivos_auxiliares;
drop policy if exists arquivos_auxiliares_delete on public.arquivos_auxiliares;
create policy arquivos_auxiliares_select on public.arquivos_auxiliares for select using (public.user_owns_company(company_id));
create policy arquivos_auxiliares_insert on public.arquivos_auxiliares for insert with check (public.user_owns_company(company_id));
create policy arquivos_auxiliares_update on public.arquivos_auxiliares for update using (public.user_owns_company(company_id)) with check (public.user_owns_company(company_id));
create policy arquivos_auxiliares_delete on public.arquivos_auxiliares for delete using (public.user_owns_company(company_id));

-- 3) role_types: fecha o gap de GRANT (RLS own-row já criado na 0010)
grant select, insert, update, delete on public.role_types to authenticated;
grant all on public.role_types to service_role;

-- 4) abertura_empresas: policies por user_id (relação por user, não company)
drop policy if exists abertura_empresas_select on public.abertura_empresas;
drop policy if exists abertura_empresas_insert on public.abertura_empresas;
drop policy if exists abertura_empresas_update on public.abertura_empresas;
drop policy if exists abertura_empresas_delete on public.abertura_empresas;
create policy abertura_empresas_select on public.abertura_empresas for select using (user_id = auth.uid());
create policy abertura_empresas_insert on public.abertura_empresas for insert with check (user_id = auth.uid());
create policy abertura_empresas_update on public.abertura_empresas for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy abertura_empresas_delete on public.abertura_empresas for delete using (user_id = auth.uid());
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/0011_arquivos_auxiliares_fk.sql
git commit -m "feat(saneamento): migration 0011 — FK arquivos_auxiliares + grant role_types + policies abertura_empresas"
```

---

### Task 4: Aplicar a migration 0011 (manual, no Supabase) — pausa para o dono

**Files:** nenhum (ação no SQL Editor)

- [ ] **Step 1: Aplicar**

Colar/executar `supabase/migrations/0011_arquivos_auxiliares_fk.sql` no SQL Editor do projeto de dev.
Expected: sem erro. Se `violates foreign key constraint`, as órfãs não foram removidas — rodar a Task 2 antes.

- [ ] **Step 2: Conferir o schema**

No SQL Editor:
```sql
select column_name, data_type from information_schema.columns
where table_schema='public' and table_name='arquivos_auxiliares' order by ordinal_position;
select conname from pg_constraint where conrelid='public.arquivos_auxiliares'::regclass and contype='f';
```
Expected: existe `company_id` (uuid), NÃO existem `unique_id_empresa`/`unique_id_bubble`, e há a constraint `arquivos_auxiliares_company_id_fkey`.

---

### Task 5: Código — `actions.ts` (nome fixo + company_id)

**Files:**
- Modify: `balu-next/src/app/(auth)/configuracoes/actions.ts:176-209`

- [ ] **Step 1: Substituir o bloco de reuso de unique_id_bubble + insert/update**

Trocar o trecho atual (linhas ~176-209):

```ts
  // Reaproveita unique_id_bubble se já existe registro pra empresa.
  const { data: existing } = await supabase
    .from('arquivos_auxiliares')
    .select('id, unique_id_bubble')
    .eq('unique_id_empresa', companyId)
    .is('deleted_at', null)
    .maybeSingle();
  const uniqueIdBubble = (existing?.unique_id_bubble as string | null) ?? crypto.randomUUID();

  let path: string;
  try {
    ({ path } = await storageUploadCertificado(blob, `${uniqueIdBubble}.enc`, companyId));
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Falha ao enviar o arquivo.' };
  }
```

por:

```ts
  // Nome fixo: 1 cert por empresa; upsert:true sobrescreve no re-upload.
  const CERT_FILENAME = 'certificado.enc';
  // Decide insert vs update (registro existente da empresa).
  const { data: existing } = await supabase
    .from('arquivos_auxiliares')
    .select('id')
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .maybeSingle();

  let path: string;
  try {
    ({ path } = await storageUploadCertificado(blob, CERT_FILENAME, companyId));
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Falha ao enviar o arquivo.' };
  }
```

E trocar o ramo de `insert` (linhas ~205-209):

```ts
  } else {
    const { error } = await supabase
      .from('arquivos_auxiliares')
      .insert({ unique_id_empresa: companyId, unique_id_bubble: uniqueIdBubble, ...row });
    if (error) return { ok: false, error: error.message };
  }
```

por:

```ts
  } else {
    const { error } = await supabase
      .from('arquivos_auxiliares')
      .insert({ company_id: companyId, ...row });
    if (error) return { ok: false, error: error.message };
  }
```

(O objeto `row` e o ramo de `update` por `id` permanecem iguais.)

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (sem novos erros).

---

### Task 6: Código — `page.tsx`, storage morto, tipos

**Files:**
- Modify: `balu-next/src/app/(auth)/configuracoes/page.tsx:79`
- Modify: `balu-next/src/lib/clients/supabase-storage.ts:50-59`
- Modify: `balu-next/src/types/database.ts:234-248`

- [ ] **Step 1: `page.tsx` — filtrar por company_id**

Trocar (linha ~79):
```ts
      .eq('unique_id_empresa', company.id as string)
```
por:
```ts
      .eq('company_id', company.id as string)
```

- [ ] **Step 2: Remover `removeCertificado` morto de `supabase-storage.ts`**

Apagar o bloco inteiro (linhas ~50-59):
```ts
/**
 * Remove um objeto do bucket `company-certificates` pelo path completo
 * (ex.: `${companyId}/${fileName}`). Usado para limpar o certificado antigo
 * quando um novo é enviado com nome diferente. Lança em caso de erro.
 */
export async function removeCertificado(path: string): Promise<void> {
  if (!path) return;
  const { error } = await admin().storage.from(BUCKET).remove([path]);
  if (error) throw new Error(`Supabase Storage remove falhou: ${error.message}`);
}
```

- [ ] **Step 3: Ajustar o tipo em `database.ts`**

Trocar o bloco `arquivos_auxiliares` (linhas ~234-248):
```ts
  arquivos_auxiliares: {
    id: string;
    unique_id_bubble: string | null;
    unique_id_empresa: string | null;
    supabase_file_path: string | null;
    storage_key: string | null;
    cert_password: string | null;
    cert_not_after: string | null;
    cert_subject_cn: string | null;
    cert_cnpj: string | null;
    cert_fingerprint: string | null;
    created_at: string | null;
    updated_at: string | null;
    deleted_at: string | null;
  };
```
por:
```ts
  arquivos_auxiliares: {
    id: string;
    company_id: string;
    supabase_file_path: string | null;
    storage_key: string | null;
    cert_password: string | null;
    cert_not_after: string | null;
    cert_subject_cn: string | null;
    cert_cnpj: string | null;
    cert_fingerprint: string | null;
    created_at: string | null;
    updated_at: string | null;
    deleted_at: string | null;
  };
```

- [ ] **Step 4: Typecheck + grep de resíduos**

Run: `npm run typecheck`
Expected: PASS.

Run: `grep -rn "unique_id_empresa\|unique_id_bubble\|removeCertificado" src`
Expected: nenhuma ocorrência em código (comentários/_endpoints.ts de referência podem ser ajustados se aparecerem).

- [ ] **Step 5: Commit (código)**

```bash
git add src/app/\(auth\)/configuracoes/actions.ts src/app/\(auth\)/configuracoes/page.tsx src/lib/clients/supabase-storage.ts src/types/database.ts
git commit -m "refactor(saneamento): cert por company_id + nome fixo certificado.enc; remove unique_id_* e removeCertificado morto"
```

---

### Task 7: Teste de isolamento — ajustar para company_id + GREEN

**Files:**
- Modify: `balu-next/tests/rls-isolation.spec.ts`

- [ ] **Step 1: Trocar a checagem de arquivos_auxiliares**

Trocar:
```ts
    // arquivos_auxiliares (unique_id_empresa = companies.id como texto)
    {
      const { data } = await bClient.from('arquivos_auxiliares').select('id').eq('unique_id_empresa', aCompanyId);
      expect(data ?? [], 'B vazou arquivos_auxiliares de A').toHaveLength(0);
    }
```
por:
```ts
    // arquivos_auxiliares (agora company_id, FK -> companies.id)
    {
      const { data } = await bClient.from('arquivos_auxiliares').select('id').eq('company_id', aCompanyId);
      expect(data ?? [], 'B vazou arquivos_auxiliares de A').toHaveLength(0);
    }
```

- [ ] **Step 2: Rodar o teste (GREEN)**

Run: `set -a; . ./.env.local; set +a; npx playwright test rls-isolation --reporter=line`
Expected: **PASS (1) FAIL (0)**. (Migration 0011 já aplicada na Task 4.)

- [ ] **Step 3: Commit**

```bash
git add tests/rls-isolation.spec.ts
git commit -m "test(saneamento): isolamento de arquivos_auxiliares por company_id"
```

---

### Task 8: Verificação de UI (Playwright, logado como A)

**Files:** nenhum (verificação)

Pré: dev server no ar (`http://localhost:3000`), migration aplicada, código deployado. Logar como A (`allanvalle@outlook.com` / `teste123`).

- [ ] **Step 1: Cert presente sem regressão**

Navegar para `/configuracoes?tab=fiscal`. Confirmar que o card "Certificado A1" ainda mostra o certificado como **enviado/válido** (lê `arquivos_auxiliares` por `company_id` + `storage_key` apontando para `certificado.enc`). Tirar screenshot.
Expected: cert aparece como presente (não "nenhum certificado").

- [ ] **Step 2: Re-upload grava em certificado.enc**

(Opcional, se houver um `.pfx`+senha de teste à mão.) Substituir o certificado pela UI e confirmar sucesso; conferir no bucket que o objeto continua `…/certificado.enc` (upsert).
Expected: upload conclui; bucket segue com 1 objeto `certificado.enc` para a empresa.

---

### Task 9: Documento de resultados + commit

**Files:**
- Create: `balu-next/docs/saneamento-results-2026-05-29.md`

- [ ] **Step 1: Escrever o resultado**

Criar `docs/saneamento-results-<data>.md` com: data, commit da migration, saída do script (--apply), confirmação do schema (Task 4 Step 2), saída do teste de isolamento (GREEN), e resultado da verificação de UI (Task 8). Listar qualquer ajuste necessário.

- [ ] **Step 2: Commit**

```bash
git add docs/saneamento-results-*.md
git commit -m "docs(saneamento): resultados do saneamento de arquivos_auxiliares"
```

---

## Notas de execução
- **Ordem dos portões:** Task 2 (--apply) **antes** da Task 4 (migration), senão a FK falha por órfã. Tasks 5/6 (código) **depois** da Task 4 (a coluna `company_id` precisa existir; entre 4 e 6 o `/configuracoes` quebra transitoriamente em dev — esperado).
- **Janela script↔código:** se um upload ocorrer com o código antigo entre a Task 2 e a Task 6, ele recria `${companyId}/${id}.enc`; re-rodar o script resolve.
- **Rollback:** revert dos commits de código; na migration, `rename company_id → unique_id_empresa`, `drop constraint`, re-`add column unique_id_bubble text`. Linhas/objetos apagados não voltam (cruft).

## Resumo de arquivos

| Arquivo | Task | Mudança |
|---|---|---|
| `scripts/saneamento-arquivos-auxiliares.mjs` | 1 | novo — script one-time |
| (execução --apply) | 2 | Storage + deleção de órfãs |
| `supabase/migrations/0011_arquivos_auxiliares_fk.sql` | 3 | novo — FK + grant + policies |
| (SQL Editor) | 4 | aplicar migration |
| `src/app/(auth)/configuracoes/actions.ts` | 5 | nome fixo + company_id |
| `src/app/(auth)/configuracoes/page.tsx` | 6 | filtro por company_id |
| `src/lib/clients/supabase-storage.ts` | 6 | remove removeCertificado morto |
| `src/types/database.ts` | 6 | tipo arquivos_auxiliares |
| `tests/rls-isolation.spec.ts` | 7 | checagem por company_id |
| `docs/saneamento-results-<data>.md` | 9 | novo — evidências |
```