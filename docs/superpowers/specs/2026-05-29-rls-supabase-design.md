# RLS Supabase: policies + teste de fluxos — design

**Data:** 2026-05-29
**Contexto:** preparação para deploy em produção. Hoje o RLS está **desligado** na maioria das tabelas e as únicas policies existentes (`notas_fiscais`) estão incorretas. Antes de ligar o RLS em produção, é preciso (1) definir policies corretas para todas as tabelas e (2) testar todos os fluxos do app com RLS ligado, incluindo isolamento entre tenants.

## Motivação / risco

O app inteiro acessa o Supabase com a **anon key + sessão do usuário** (`src/lib/supabase/server.ts` e `browser.ts` usam `NEXT_PUBLIC_SUPABASE_ANON_KEY`). Isso significa que **toda query autenticada é submetida ao RLS**. Apenas dois caminhos usam `service_role` e bypassam o RLS:

- `src/lib/clients/supabase-storage.ts` (storage de arquivos)
- `src/app/api/webhooks/focus/route.ts` (webhook externo do Focus)

Consequência: se o RLS for ligado **sem policies corretas**, todo o app autenticado quebra — leituras retornam vazio, escritas falham. Por isso, "ligar o RLS" precisa vir acompanhado das policies. Esta tarefa entrega as duas coisas: as policies e o teste de regressão de todos os fluxos.

## Modelo de tenancy (derivado do código)

A regra de acesso real do app é **`companies.user_id = auth.uid()`** — confirmada em `src/app/(auth)/layout.tsx`, que lista empresas com `.eq('user_id', user.id)`. Tanto o papel `empresa` quanto o `contador` "possuem" suas empresas via `companies.user_id` (o contador apenas possui várias). Toda tabela de dados referencia uma empresa do usuário por `company_id` (ou `empresa_id` em `empresas_fiscais`).

## Decisões

| Decisão | Escolha |
|---|---|
| Escopo | Policies (migration) **+** teste de todos os fluxos. |
| Helper | Função `public.user_owns_company(uuid)` `SECURITY DEFINER` (DRY, evita recursão de RLS). |
| Isolamento | Testar com **2 tenants** (allanvalle@outlook.com + 2ª conta de teste). |
| `abertura_empresas` | Sem chave de tenant → **travar** (negar anon/auth; só service_role). |
| Credenciais NFS-e plaintext | **Fora de escopo** (hardening separado) — apenas anotado. |

## Arquitetura

### 1. Helper de ownership

```sql
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
```

`SECURITY DEFINER` faz a checagem rodar com privilégios do dono da função, ignorando o RLS de `companies` na subconsulta — evita recursão e deixa a policy de cada tabela de dados simples e uniforme. `stable` permite cache no plano da query.

### 2. Policies por tabela

Para cada tabela: `alter table ... enable row level security;` e policies de CRUD. As de dados usam o helper tanto em `USING` (leitura/update/delete) quanto em `WITH CHECK` (insert/update — barra gravar para empresa de outro tenant).

| Tabela | Chave | Regra (USING / WITH CHECK) |
|---|---|---|
| `companies` | `user_id` | `user_id = auth.uid()` |
| `profiles` | `user_id` | `user_id = auth.uid()` |
| `role_types` | `user_id` | `user_id = auth.uid()` |
| `clientes` | `company_id` | `user_owns_company(company_id)` |
| `notas_fiscais` | `company_id` | `user_owns_company(company_id)` — **dropar** as 4 policies erradas (`auth.uid() = company_id`) antes |
| `guias_fiscais` | `company_id` | `user_owns_company(company_id)` |
| `apuracoes_fiscais` | `company_id` | `user_owns_company(company_id)` |
| `receitas_fiscais` | `company_id` | `user_owns_company(company_id)` |
| `honorarios` | `company_id` | `user_owns_company(company_id)` |
| `arquivos_auxiliares` | `company_id` | `user_owns_company(company_id)` |
| `empresas_fiscais` | `empresa_id` | `user_owns_company(empresa_id)` |
| `municipios_nfse` | — (referência) | SELECT liberado a `authenticated`; sem INSERT/UPDATE/DELETE (escrita só via service_role) |
| `abertura_empresas` | — (sem owner) | RLS ligado **sem policy** para anon/auth → nega tudo; só service_role acessa |

### 3. Entrega da migration

Arquivo `supabase/migrations/<timestamp>_rls_policies.sql` contendo: `enable row level security` em todas as 13 tabelas, `drop policy` das 4 policies erradas de `notas_fiscais`, a função `user_owns_company`, e os `create policy` da tabela acima.

**DB é fonte de verdade** (migrations 0001/0002 estão defasadas — ver `DB-DIVERGENCIA.md`): antes de aplicar, validar nomes exatos de colunas e a lista real de tabelas contra o banco/`db_atual.sql`. A migration deve ser idempotente onde possível (`drop policy if exists`, `create or replace function`).

### 4. service_role (sem mudança)

`supabase-storage.ts` e o webhook Focus continuam usando `SUPABASE_SERVICE_ROLE_KEY` e bypassam o RLS — comportamento esperado e desejado (storage e ingestão externa). Documentar que **não** devem ser migrados para anon. O RLS de `storage.objects` (bucket) é um tópico à parte; como o acesso a storage é 100% via service_role, não há policy de bucket a definir nesta tarefa (anotar).

## Matriz de teste (todos os fluxos, RLS ligado)

Pré-condição: RLS ligado + migration aplicada; dois tenants — **A** = allanvalle@outlook.com (já tem dados: empresa "AL PISCINAS LTDA", 1 cliente, notas), **B** = 2ª conta de teste nova. Para cada fluxo, dois checks: **(funciona)** o dono executa com sucesso; **(isola)** o tenant B não enxerga/afeta dados de A.

| # | Fluxo | Rota/ação | funciona | isola |
|---|---|---|---|---|
| 1 | Login | `/login` | A e B logam | — |
| 2 | Cadastro | `/cadastro` | cria conta B | — |
| 3 | Onboarding (1ª empresa) | `CreateCompanyDialog` forçado | B cria empresa própria | B não vê empresa de A |
| 4 | Criar/trocar empresa | sidebar / `profiles.current_company` | A troca entre empresas | seletor de B só lista empresas de B |
| 5 | Clientes CRUD | `/clientes` (+ actions) | A cria/edita/exclui cliente | B não lista clientes de A; B não consegue editar id de cliente de A |
| 6 | Notas — listar | `/notas_fiscais` | A vê suas notas | B vê lista vazia |
| 7 | Notas — emitir | `/notas_fiscais/emissao` | A emite | nota gravada com company_id de A; B não consegue emitir para empresa de A |
| 8 | Notas — detalhe | `/notas_fiscais/[id]` | A abre a própria | B recebe 404/sem acesso na nota de A |
| 9 | Notas — download PDF | `/notas_fiscais/[id]/download` | A baixa | B não baixa PDF de nota de A |
| 10 | Impostos — apuração | `/impostos` (+ actions) | A vê apuração | B não vê apurações/guias de A |
| 11 | Impostos — DAS | gerar DAS (Serpro) | A gera (gated) | guia gravada com company_id de A |
| 12 | Configurações — empresa | `/configuracoes` | A edita dados da empresa | B não edita empresa de A |
| 13 | Configurações — fiscal/NFS-e | `empresas_fiscais` | A salva config fiscal | B não lê/grava config fiscal de A |
| 14 | Dashboard | `/` (`lib/dashboard/queries.ts`) | A vê seus números | B vê zerado (sem dados de A) |
| 15 | Storage — upload/download | `supabase-storage.ts` | A anexa/baixa arquivo | service_role: validar que o caminho/escopo do arquivo é por empresa |
| 16 | Webhook Focus | `/api/webhooks/focus` | grava via service_role | intacto (não depende de sessão) |

Método: Playwright logado em cada tenant (como no teste do toggle de tema) para os fluxos de UI; checagem direta no banco (psql/Supabase) para confirmar `company_id` gravado e ausência de vazamento; para os caminhos service_role, inspeção de que o escopo por empresa é aplicado em código (o RLS não protege esses).

## Tratamento de erros / edge cases

- **Recursão de RLS:** resolvida pelo `SECURITY DEFINER` no helper.
- **Policy errada de `notas_fiscais`:** `drop policy if exists` das 4 antes de recriar.
- **`abertura_empresas` sem owner:** RLS ligado sem policy = nega anon/auth; se algum fluxo autenticado precisar ler/gravar (a confirmar), vira follow-up para adicionar coluna de owner.
- **`current_company` apontando para empresa que o usuário não possui:** a policy de `profiles` (user_id) protege o próprio profile; o seletor de empresa já filtra por `user_id`, mas validar no teste #4 que não há como setar `current_company` para empresa de outro tenant.
- **Storage não coberto por RLS:** como é service_role, a segregação por empresa precisa estar no código (caminho do arquivo/escopo) — verificado no teste #15, não pelo RLS.

## Critérios de aceite

1. Migration aplicada: RLS ligado nas 13 tabelas, helper criado, policies erradas de `notas_fiscais` removidas, policies novas no lugar.
2. Todos os 16 fluxos passam no check **(funciona)** para o dono.
3. Todos os fluxos com coluna **(isola)** passam: tenant B não lê nem altera dados de A; nenhuma query autenticada vaza linha de outro tenant.
4. Caminhos service_role (storage, webhook) seguem funcionando.
5. Nenhuma regressão visível no app para o tenant dono.

## Fora de escopo (YAGNI)

- Criptografia/hardening das credenciais NFS-e em plaintext (`nfse_senha_login`/`nfse_token_api`) — tarefa de segurança separada.
- Policies de `storage.objects` (acesso a storage é só service_role).
- Modelo de compartilhamento contador↔empresa além de ownership por `companies.user_id` (o modelo atual já cobre o contador como dono de várias empresas).
- Migrar caminhos service_role para anon.

## Arquivos afetados

| Arquivo | Mudança |
|---|---|
| `supabase/migrations/<timestamp>_rls_policies.sql` | **novo** — enable RLS + helper + policies |
| `docs/...` (teste) | registro do resultado da matriz de teste (evidências) |
| (código) | nenhuma mudança esperada se as policies espelharem o modelo; ajustes pontuais só se algum fluxo quebrar |
