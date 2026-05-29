# RLS Supabase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ligar RLS em produção com policies corretas em todas as tabelas e provar, por teste automatizado + fluxos de UI, que cada tenant só acessa os próprios dados sem quebrar nenhum fluxo do app.

**Architecture:** Migration SQL `0009_rls_policies.sql` cria um helper `user_owns_company` (SECURITY DEFINER) e policies por tabela seguindo o modelo `companies.user_id = auth.uid()`. Um teste de isolamento (Playwright runner, sem browser, usando `@supabase/supabase-js`) provisiona um 2º tenant via service_role e prova isolamento por tabela (red antes da migration, green depois). Fluxos de UI do dono são validados via Playwright logado.

**Tech Stack:** Supabase (Postgres RLS), `@supabase/supabase-js`, Playwright test runner, Next.js 15.

**Spec:** `docs/superpowers/specs/2026-05-29-rls-supabase-design.md`

**Pré-requisitos de ambiente:**
- A migration é aplicada **manualmente no SQL Editor do Supabase** (não há CLI nem string de conexão local).
- Os testes batem no **projeto Supabase de dev real** (criam e apagam um usuário/empresa descartáveis). Não são herméticos.
- Conta tenant **A** já existe com dados: `allanvalle@outlook.com` / `teste123` (empresa "AL PISCINAS LTDA", ≥1 cliente, notas).
- Variáveis em `balu-next/.env.local`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

Todos os comandos rodam a partir de `balu-next/`.

---

### Task 1: Migration 0009 — helper + enable RLS + policies

**Files:**
- Create: `balu-next/supabase/migrations/0009_rls_policies.sql`

- [ ] **Step 1: Criar a migration com o conteúdo completo**

Criar `supabase/migrations/0009_rls_policies.sql`:

```sql
-- 0009_rls_policies.sql
-- RLS para produção. Modelo: companies.user_id = auth.uid(); tabelas de dados
-- acessíveis quando a company referenciada pertence ao usuário.
-- Spec: docs/superpowers/specs/2026-05-29-rls-supabase-design.md
-- DB é fonte de verdade: validado contra db_atual.sql (migrations 0001/0002 defasadas).

-- 1) Helper de ownership (bypassa RLS de companies via SECURITY DEFINER → sem recursão)
create or replace function public.user_owns_company(cid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.companies
    where id = cid and user_id = auth.uid()
  );
$$;

revoke all on function public.user_owns_company(uuid) from public;
grant execute on function public.user_owns_company(uuid) to authenticated;

-- 2) companies (chave: user_id)
alter table public.companies enable row level security;
drop policy if exists companies_select on public.companies;
drop policy if exists companies_insert on public.companies;
drop policy if exists companies_update on public.companies;
drop policy if exists companies_delete on public.companies;
create policy companies_select on public.companies for select using (user_id = auth.uid());
create policy companies_insert on public.companies for insert with check (user_id = auth.uid());
create policy companies_update on public.companies for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy companies_delete on public.companies for delete using (user_id = auth.uid());

-- 3) profiles (chave: user_id)
alter table public.profiles enable row level security;
drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_insert on public.profiles;
drop policy if exists profiles_update on public.profiles;
drop policy if exists profiles_delete on public.profiles;
create policy profiles_select on public.profiles for select using (user_id = auth.uid());
create policy profiles_insert on public.profiles for insert with check (user_id = auth.uid());
create policy profiles_update on public.profiles for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy profiles_delete on public.profiles for delete using (user_id = auth.uid());

-- 4) role_types (chave: user_id)
alter table public.role_types enable row level security;
drop policy if exists role_types_select on public.role_types;
drop policy if exists role_types_insert on public.role_types;
drop policy if exists role_types_update on public.role_types;
drop policy if exists role_types_delete on public.role_types;
create policy role_types_select on public.role_types for select using (user_id = auth.uid());
create policy role_types_insert on public.role_types for insert with check (user_id = auth.uid());
create policy role_types_update on public.role_types for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy role_types_delete on public.role_types for delete using (user_id = auth.uid());

-- 5) notas_fiscais — dropar as 4 policies ANTIGAS e erradas (auth.uid() = company_id)
drop policy if exists "Users can view their own notas_fiscais." on public.notas_fiscais;
drop policy if exists "Users can insert their own notas_fiscais." on public.notas_fiscais;
drop policy if exists "Users can update their own notas_fiscais." on public.notas_fiscais;
drop policy if exists "Users can delete their own notas_fiscais." on public.notas_fiscais;

-- 6) Tabelas escopadas por company_id
--    clientes, notas_fiscais, guias_fiscais, apuracoes_fiscais,
--    receitas_fiscais, honorarios, arquivos_auxiliares

alter table public.clientes enable row level security;
drop policy if exists clientes_select on public.clientes;
drop policy if exists clientes_insert on public.clientes;
drop policy if exists clientes_update on public.clientes;
drop policy if exists clientes_delete on public.clientes;
create policy clientes_select on public.clientes for select using (public.user_owns_company(company_id));
create policy clientes_insert on public.clientes for insert with check (public.user_owns_company(company_id));
create policy clientes_update on public.clientes for update using (public.user_owns_company(company_id)) with check (public.user_owns_company(company_id));
create policy clientes_delete on public.clientes for delete using (public.user_owns_company(company_id));

alter table public.notas_fiscais enable row level security;
create policy notas_fiscais_select on public.notas_fiscais for select using (public.user_owns_company(company_id));
create policy notas_fiscais_insert on public.notas_fiscais for insert with check (public.user_owns_company(company_id));
create policy notas_fiscais_update on public.notas_fiscais for update using (public.user_owns_company(company_id)) with check (public.user_owns_company(company_id));
create policy notas_fiscais_delete on public.notas_fiscais for delete using (public.user_owns_company(company_id));

alter table public.guias_fiscais enable row level security;
drop policy if exists guias_fiscais_select on public.guias_fiscais;
drop policy if exists guias_fiscais_insert on public.guias_fiscais;
drop policy if exists guias_fiscais_update on public.guias_fiscais;
drop policy if exists guias_fiscais_delete on public.guias_fiscais;
create policy guias_fiscais_select on public.guias_fiscais for select using (public.user_owns_company(company_id));
create policy guias_fiscais_insert on public.guias_fiscais for insert with check (public.user_owns_company(company_id));
create policy guias_fiscais_update on public.guias_fiscais for update using (public.user_owns_company(company_id)) with check (public.user_owns_company(company_id));
create policy guias_fiscais_delete on public.guias_fiscais for delete using (public.user_owns_company(company_id));

alter table public.apuracoes_fiscais enable row level security;
drop policy if exists apuracoes_fiscais_select on public.apuracoes_fiscais;
drop policy if exists apuracoes_fiscais_insert on public.apuracoes_fiscais;
drop policy if exists apuracoes_fiscais_update on public.apuracoes_fiscais;
drop policy if exists apuracoes_fiscais_delete on public.apuracoes_fiscais;
create policy apuracoes_fiscais_select on public.apuracoes_fiscais for select using (public.user_owns_company(company_id));
create policy apuracoes_fiscais_insert on public.apuracoes_fiscais for insert with check (public.user_owns_company(company_id));
create policy apuracoes_fiscais_update on public.apuracoes_fiscais for update using (public.user_owns_company(company_id)) with check (public.user_owns_company(company_id));
create policy apuracoes_fiscais_delete on public.apuracoes_fiscais for delete using (public.user_owns_company(company_id));

alter table public.receitas_fiscais enable row level security;
drop policy if exists receitas_fiscais_select on public.receitas_fiscais;
drop policy if exists receitas_fiscais_insert on public.receitas_fiscais;
drop policy if exists receitas_fiscais_update on public.receitas_fiscais;
drop policy if exists receitas_fiscais_delete on public.receitas_fiscais;
create policy receitas_fiscais_select on public.receitas_fiscais for select using (public.user_owns_company(company_id));
create policy receitas_fiscais_insert on public.receitas_fiscais for insert with check (public.user_owns_company(company_id));
create policy receitas_fiscais_update on public.receitas_fiscais for update using (public.user_owns_company(company_id)) with check (public.user_owns_company(company_id));
create policy receitas_fiscais_delete on public.receitas_fiscais for delete using (public.user_owns_company(company_id));

alter table public.honorarios enable row level security;
drop policy if exists honorarios_select on public.honorarios;
drop policy if exists honorarios_insert on public.honorarios;
drop policy if exists honorarios_update on public.honorarios;
drop policy if exists honorarios_delete on public.honorarios;
create policy honorarios_select on public.honorarios for select using (public.user_owns_company(company_id));
create policy honorarios_insert on public.honorarios for insert with check (public.user_owns_company(company_id));
create policy honorarios_update on public.honorarios for update using (public.user_owns_company(company_id)) with check (public.user_owns_company(company_id));
create policy honorarios_delete on public.honorarios for delete using (public.user_owns_company(company_id));

alter table public.arquivos_auxiliares enable row level security;
drop policy if exists arquivos_auxiliares_select on public.arquivos_auxiliares;
drop policy if exists arquivos_auxiliares_insert on public.arquivos_auxiliares;
drop policy if exists arquivos_auxiliares_update on public.arquivos_auxiliares;
drop policy if exists arquivos_auxiliares_delete on public.arquivos_auxiliares;
create policy arquivos_auxiliares_select on public.arquivos_auxiliares for select using (public.user_owns_company(company_id));
create policy arquivos_auxiliares_insert on public.arquivos_auxiliares for insert with check (public.user_owns_company(company_id));
create policy arquivos_auxiliares_update on public.arquivos_auxiliares for update using (public.user_owns_company(company_id)) with check (public.user_owns_company(company_id));
create policy arquivos_auxiliares_delete on public.arquivos_auxiliares for delete using (public.user_owns_company(company_id));

-- 7) empresas_fiscais (chave: empresa_id → companies.id)
alter table public.empresas_fiscais enable row level security;
drop policy if exists empresas_fiscais_select on public.empresas_fiscais;
drop policy if exists empresas_fiscais_insert on public.empresas_fiscais;
drop policy if exists empresas_fiscais_update on public.empresas_fiscais;
drop policy if exists empresas_fiscais_delete on public.empresas_fiscais;
create policy empresas_fiscais_select on public.empresas_fiscais for select using (public.user_owns_company(empresa_id));
create policy empresas_fiscais_insert on public.empresas_fiscais for insert with check (public.user_owns_company(empresa_id));
create policy empresas_fiscais_update on public.empresas_fiscais for update using (public.user_owns_company(empresa_id)) with check (public.user_owns_company(empresa_id));
create policy empresas_fiscais_delete on public.empresas_fiscais for delete using (public.user_owns_company(empresa_id));

-- 8) municipios_nfse (referência: leitura p/ authenticated; escrita só service_role)
alter table public.municipios_nfse enable row level security;
drop policy if exists municipios_nfse_select on public.municipios_nfse;
create policy municipios_nfse_select on public.municipios_nfse for select to authenticated using (true);

-- 9) abertura_empresas (sem chave de tenant → nega anon/auth; service_role bypassa)
alter table public.abertura_empresas enable row level security;
```

- [ ] **Step 2: Validar nomes de colunas contra o dump real (DB é fonte de verdade)**

Run:
```bash
for pair in "companies:user_id" "profiles:user_id" "role_types:user_id" \
  "clientes:company_id" "notas_fiscais:company_id" "guias_fiscais:company_id" \
  "apuracoes_fiscais:company_id" "receitas_fiscais:company_id" "honorarios:company_id" \
  "arquivos_auxiliares:company_id" "empresas_fiscais:empresa_id"; do
  t=${pair%%:*}; c=${pair##*:};
  if grep -A40 "CREATE TABLE public.$t " db_atual.sql | grep -q "    $c "; then
    echo "OK  $t.$c";
  else
    echo "FALTA $t.$c  <-- AJUSTAR A MIGRATION";
  fi
done
```
Expected: todas as linhas começam com `OK`. Se aparecer `FALTA`, corrigir a coluna na migration antes de seguir.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0009_rls_policies.sql
git commit -m "feat(rls): migration 0009 — helper user_owns_company + policies de todas as tabelas"
```

---

### Task 2: Teste de isolamento entre tenants

**Files:**
- Create: `balu-next/tests/rls-isolation.spec.ts`

- [ ] **Step 1: Criar o teste**

Criar `tests/rls-isolation.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// Prova de RLS: provisiona um 2º tenant (B) via service_role, e confirma que B,
// autenticado com a anon key, NÃO enxerga nem grava dados do tenant A.
// Bate no Supabase de dev real (cria/apaga user+company descartáveis). Não hermético.
// Rodar: set -a; . ./.env.local; set +a; npx playwright test rls-isolation --reporter=line

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const A_EMAIL = 'allanvalle@outlook.com';
const A_PASS = 'teste123';

// Tabelas escopadas por company_id (empresas_fiscais usa empresa_id, testada à parte)
const COMPANY_TABLES = [
  'clientes', 'notas_fiscais', 'guias_fiscais', 'apuracoes_fiscais',
  'receitas_fiscais', 'honorarios', 'arquivos_auxiliares',
];

test('RLS isola tenants: B não acessa dados de A', async () => {
  expect(URL && ANON && SERVICE, 'env do Supabase não carregada (source .env.local)').toBeTruthy();

  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

  // 1) Provisiona tenant B (confirmado) + uma company de B
  const bEmail = `rls-b-${Date.now()}@balu-test.local`;
  const bPass = 'senha-teste-B-123';
  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email: bEmail, password: bPass, email_confirm: true,
  });
  expect(cErr, `createUser falhou: ${cErr?.message}`).toBeNull();
  const bUserId = created.user!.id;

  const { error: bcErr } = await admin
    .from('companies').insert({ user_id: bUserId, nome: 'B Teste LTDA' });
  expect(bcErr, `insert company B falhou: ${bcErr?.message}`).toBeNull();

  try {
    // 2) Sessão A (anon + login)
    const aClient = createClient(URL, ANON, { auth: { persistSession: false } });
    const { error: aErr } = await aClient.auth.signInWithPassword({ email: A_EMAIL, password: A_PASS });
    expect(aErr, `login A falhou: ${aErr?.message}`).toBeNull();
    const { data: aCompanies } = await aClient.from('companies').select('id');
    expect(aCompanies?.length ?? 0, 'A precisa ter ao menos 1 empresa').toBeGreaterThan(0);
    const aCompanyId = aCompanies![0].id as string;

    // 3) Sessão B (anon + login)
    const bClient = createClient(URL, ANON, { auth: { persistSession: false } });
    const { error: bErr } = await bClient.auth.signInWithPassword({ email: bEmail, password: bPass });
    expect(bErr, `login B falhou: ${bErr?.message}`).toBeNull();

    // 4) B não enxerga a company de A
    const { data: bSeesA } = await bClient.from('companies').select('id').eq('id', aCompanyId);
    expect(bSeesA ?? [], 'B enxergou a company de A (RLS não isola)').toHaveLength(0);

    // 5) B não enxerga linhas de A nas tabelas company_id
    for (const t of COMPANY_TABLES) {
      const { data } = await bClient.from(t).select('id').eq('company_id', aCompanyId);
      expect(data ?? [], `B vazou linhas de A em ${t}`).toHaveLength(0);
    }
    // empresas_fiscais (empresa_id)
    {
      const { data } = await bClient.from('empresas_fiscais').select('id').eq('empresa_id', aCompanyId);
      expect(data ?? [], 'B vazou empresas_fiscais de A').toHaveLength(0);
    }

    // 6) B não consegue INSERIR cliente na company de A
    const { error: insErr } = await bClient
      .from('clientes').insert({ company_id: aCompanyId, razao_social: 'intruso-rls' });
    expect(insErr, 'B conseguiu inserir cliente na company de A (WITH CHECK falhou)').not.toBeNull();

    // 7) Sanidade: A enxerga a própria company
    const { data: aSelf } = await aClient.from('companies').select('id').eq('id', aCompanyId);
    expect(aSelf ?? [], 'A não enxerga a própria company (policy quebrou o dono)').toHaveLength(1);
  } finally {
    // Teardown: apaga company e user de B
    await admin.from('companies').delete().eq('user_id', bUserId);
    await admin.auth.admin.deleteUser(bUserId);
  }
});
```

- [ ] **Step 2: Verificar typecheck**

Run: `npm run typecheck`
Expected: PASS (sem novos erros).

- [ ] **Step 3: Commit**

```bash
git add tests/rls-isolation.spec.ts
git commit -m "test(rls): teste de isolamento entre tenants (2º tenant via service_role)"
```

---

### Task 3: Rodar o teste ANTES da migration (red)

**Files:** nenhum (execução)

- [ ] **Step 1: Rodar o teste de isolamento contra o estado atual (RLS desligado)**

Run:
```bash
set -a; . ./.env.local; set +a; npx playwright test rls-isolation --reporter=line
```
Expected: **FAIL.** Com RLS desligado, B (autenticado) enxerga as linhas de A — o assert do passo 4 (`B enxergou a company de A`) ou do passo 6 (insert não bloqueado) falha. Esse é o estado vermelho que prova que o teste detecta vazamento.

Se por acaso PASSAR aqui, parar: ou o RLS já está parcialmente ligado, ou o teste não está exercitando o que deveria — investigar antes de seguir.

---

### Task 4: Aplicar a migration + ligar RLS (manual, no Supabase)

**Files:** nenhum (ação no painel do Supabase, feita pelo dono do projeto)

- [ ] **Step 1: Aplicar a migration**

Abrir o **SQL Editor** do projeto Supabase de dev e colar/executar o conteúdo completo de `supabase/migrations/0009_rls_policies.sql`. O script já faz `enable row level security` em cada tabela e cria/dropa as policies — não é preciso ligar o RLS manualmente no toggle do painel (a migration liga).

Expected: execução sem erro. Se algum `column ... does not exist`, é divergência de schema: corrigir a coluna na migration (Task 1) e reaplicar.

- [ ] **Step 2: Conferir que o RLS está ligado nas 13 tabelas**

No SQL Editor:
```sql
select relname, relrowsecurity
from pg_class
where relnamespace = 'public'::regnamespace
  and relname in ('companies','profiles','role_types','clientes','notas_fiscais',
    'guias_fiscais','apuracoes_fiscais','receitas_fiscais','honorarios',
    'arquivos_auxiliares','empresas_fiscais','municipios_nfse','abertura_empresas')
order by relname;
```
Expected: `relrowsecurity = true` para as 13 linhas.

---

### Task 5: Rodar o teste DEPOIS da migration (green)

**Files:** nenhum (execução)

- [ ] **Step 1: Re-rodar o teste de isolamento**

Run:
```bash
set -a; . ./.env.local; set +a; npx playwright test rls-isolation --reporter=line
```
Expected: **PASS.** B não enxerga nada de A, não consegue inserir na company de A, e A continua enxergando a própria company.

Se falhar no passo 7 (A não enxerga a própria company), a policy quebrou o dono — revisar a regra da tabela apontada no erro.

---

### Task 6: Validar fluxos de UI do dono (sem regressão) via Playwright

**Files:** nenhum (verificação manual assistida por Playwright MCP)

Pré: dev server no ar (`http://localhost:3000`), RLS já ligado (Task 4). Logar como A (`allanvalle@outlook.com` / `teste123`).

- [ ] **Step 1: Dashboard e leitura**

Navegar para `/` logado como A. Confirmar que os cards do dashboard mostram os números de A (Receita do mês, Última nota, Notas no mês) — ou seja, as queries de leitura via anon key continuam retornando as linhas do dono com RLS ligado. Tirar screenshot.
Expected: dados de A aparecem (não zerado/erro).

- [ ] **Step 2: Clientes CRUD**

Navegar para `/clientes`. Confirmar que a lista mostra o(s) cliente(s) de A. Criar um cliente de teste (`+ Novo cliente`), editar, e excluir. 
Expected: cada operação conclui com sucesso (a policy `clientes` permite CRUD na company do dono).

- [ ] **Step 3: Notas fiscais (leitura)**

Navegar para `/notas_fiscais` e abrir o detalhe de uma nota existente (`/notas_fiscais/[id]`). 
Expected: lista e detalhe carregam as notas de A. (Emissão real é gated por Focus/homologação — fora do escopo de "não quebrou a leitura".)

- [ ] **Step 4: Impostos e Configurações**

Navegar para `/impostos` (apuração/competências) e `/configuracoes` (dados da empresa + aba fiscal/NFS-e). Confirmar que os dados de A carregam e que salvar uma alteração em Configurações conclui.
Expected: leituras retornam dados de A; gravação em `companies`/`empresas_fiscais` conclui (policies do dono permitem).

- [ ] **Step 5: Registrar evidências**

Anotar resultado de cada step (OK / problema) — vira insumo da Task 8.

---

### Task 7: Sanidade dos caminhos service_role

**Files:** nenhum (verificação)

- [ ] **Step 1: Storage (upload/download)**

Logado como A, em uma tela que use anexo (arquivos auxiliares / certificado em Configurações), fazer upload e download de um arquivo.
Expected: funciona — storage usa service_role (`src/lib/clients/supabase-storage.ts`), não é afetado pelo RLS. Confirmar que o escopo do arquivo é por empresa **no código** (o caminho do objeto inclui o id da empresa) — o RLS não protege storage.

- [ ] **Step 2: Webhook Focus**

Confirmar (por inspeção de `src/app/api/webhooks/focus/route.ts`) que ele usa `SUPABASE_SERVICE_ROLE_KEY` e portanto continua gravando sem sessão.
Expected: caminho intacto, sem dependência de RLS.

---

### Task 8: Documento de resultados + commit

**Files:**
- Create: `balu-next/docs/rls-test-results-2026-05-29.md` (ou data da execução)

- [ ] **Step 1: Escrever o resultado da matriz**

Criar `docs/rls-test-results-<data>.md` com: data, commit da migration, saída do teste de isolamento (red antes / green depois), e o resultado de cada step das Tasks 6 e 7 (OK/problema + screenshots quando houver). Listar qualquer fluxo que precisou de ajuste de código.

- [ ] **Step 2: Commit**

```bash
git add docs/rls-test-results-*.md
git commit -m "docs(rls): resultados do teste de fluxos com RLS ligado"
```

---

## Notas de execução

- **Ordem dos portões:** Task 3 (red) **antes** da Task 4 (aplicar). Se não der red, não aplique — investigue.
- **Se um fluxo do dono quebrar** na Task 6 (leitura volta vazia), a causa provável é uma coluna de tenant diferente da assumida; cruze com `db_atual.sql` e ajuste a policy daquela tabela (nova migration `0010_...` ou correção no SQL Editor + atualizar `0009`).
- **abertura_empresas:** se algum fluxo autenticado precisar lê-la/gravá-la (a confirmar na Task 6), vira follow-up para adicionar coluna de owner — hoje fica travada (só service_role).
- **Não** migrar storage/webhook para anon (continuam service_role por design).

## Resumo de arquivos

| Arquivo | Task | Mudança |
|---|---|---|
| `supabase/migrations/0009_rls_policies.sql` | 1 | novo — helper + enable RLS + policies |
| `tests/rls-isolation.spec.ts` | 2 | novo — teste de isolamento |
| (Supabase SQL Editor) | 4 | aplicar migration + ligar RLS |
| `docs/rls-test-results-<data>.md` | 8 | novo — evidências |
