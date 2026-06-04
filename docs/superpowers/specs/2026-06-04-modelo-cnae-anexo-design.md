# Spec — Modelo CNAE + anexo (fundação multi-atividade)

**Data:** 2026-06-04
**Status:** ✅ Implementado (branch `feat/fundacao-cnae-anexo`; migration 0020 aplicada; verificado na
AL Piscinas). Plano: `docs/superpowers/plans/2026-06-04-modelo-cnae-anexo.md`.
**Origem:** P0.3 (Fator R) do `docs/planning/BACKLOG-IMPOSTOS.md`. Contexto e modelo fiscal em
`docs/investigations/FATOR-R-CNAE-SEGREGACAO.md`.

## Problema

O modelo atual amarra a empresa a **um CNAE** (`empresas_fiscais.cnae_principal`, sem uso fiscal)
e **um anexo manual** (`empresas_fiscais.anexo_simples`). Isso está errado para empresas
multi-atividade (que têm vários CNAEs e podem cair em vários anexos) e impede tratar Fator R
(sujeição vem do CNAE). Precisamos da **fundação de dados** para multi-atividade — sem ainda mudar
o motor de cálculo.

## Escopo (decisões fechadas no brainstorming 2026-06-04)

- **Alvo:** fundação de dados. **NÃO** muda o cálculo (apuração continua 1 fatia / atividade única),
  só passa a ler o anexo da estrutura nova.
- **CNAEs da empresa:** tabela **relacional** `company_cnaes` (não jsonb).
- **Resolução do anexo:** `cnae_anexo` resolve quando mapeado; senão **cai no `anexo_simples`
  manual** (que vira override + aviso). Nunca trava.
- **`cnae_anexo`:** semear um **conjunto inicial** curado. Fator R entra **só como flag** (sem
  cálculo agora).
- **Ingestão:** **auto-puxar da BrasilAPI** no lookup de CNPJ + backfill; best-effort com fallback
  pro principal da Focus; **sem CRUD** de CNAE nesta fase.

### Fora de escopo (planos seguintes)
Cálculo de Fator R (folha, decisão III↔V); segregação de receita por anexo na apuração; CRUD de
CNAE; mapear todo CNAE existente (a tabela cresce incrementalmente); Anexo IV / INSS à parte.

## Modelo de dados (migration 0020)

### `cnae_anexo` — referência global curada (não é dado de tenant)
| coluna | tipo | nota |
|---|---|---|
| `codigo` | text **PK** | 7 dígitos, sem máscara |
| `anexo_base` | text NULL | 'Anexo I'…'Anexo V'; **NULL** quando depende de Fator R ou é desconhecido |
| `fator_r` | boolean NOT NULL default false | atividade sujeita a Fator R (oscila III↔V) |
| `anexo_iv` | boolean NOT NULL default false | flag Anexo IV (INSS à parte) — só p/ tratar no futuro |
| `descricao` | text NULL | descrição oficial (conveniência) |
| `observacao` | text NULL | nota de curadoria |
| `created_at`, `updated_at` | timestamptz | |

RLS: SELECT para `authenticated`; sem policy de escrita (semeada/curada via migration =
service_role). É tabela de referência (lei), compartilhada entre todos os tenants.

### `company_cnaes` — CNAEs por empresa
| coluna | tipo | nota |
|---|---|---|
| `id` | uuid PK default gen_random_uuid() | |
| `company_id` | uuid NOT NULL → companies(id) ON DELETE CASCADE | |
| `owner_user_id` | uuid NOT NULL | segue o padrão de RLS por user_id do projeto |
| `codigo` | text NOT NULL | 7 dígitos |
| `descricao` | text NULL | |
| `tipo` | text NOT NULL CHECK in ('principal','secundario') | |
| `fonte` | text NULL | 'brasilapi' \| 'focus' \| 'manual' |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | soft delete |

Índice único parcial: `(company_id, codigo) WHERE deleted_at IS NULL`.
RLS: policies por `owner_user_id` (espelha empresas_fiscais).
**Não guarda o anexo** — o anexo é resolvido via `cnae_anexo` em tempo de leitura (mantém
normalizado; a curadoria da `cnae_anexo` reflete em todas as empresas sem rewrite).

## Resolução do anexo — `lib/fiscal/anexo-resolver.ts` (puro)

```
resolverAnexo({ cnaePrincipal, cnaeAnexo, anexoManual }) -> { anexo, origem, aviso? }
```
- `cnaePrincipal` mapeado em `cnae_anexo`, `anexo_base` != null, `fator_r=false`
  → `{ anexo: anexo_base, origem: 'cnae' }`.
- mapeado com `fator_r=true` (III↔V indefinido sem cálculo)
  → `{ anexo: anexoManual, origem: 'manual', aviso: 'Anexo depende do Fator R — confirmar (III ou V).' }`.
- não mapeado / sem CNAE principal / tabela ausente
  → `{ anexo: anexoManual, origem: 'manual', aviso: 'CNAE não mapeado — usando anexo informado.' }`.

Função pura (sem rede/Supabase), testável. Quem chama (server) busca o CNAE principal de
`company_cnaes` e o registro em `cnae_anexo`, e passa o `anexo_simples` como `anexoManual`.

**Degradação graciosa:** se a migration 0020 ainda não rodou (tabelas ausentes), o lookup volta
vazio e a resolução cai no `anexo_simples` — exatamente o comportamento atual. Nenhum fluxo quebra.

## Ingestão de CNAEs — BrasilAPI (best-effort)

- Novo client `lib/clients/brasilapi.ts`: `consultarCnpj(cnpj)` → `{ cnae_principal: {codigo,descricao},
  cnaes_secundarios: [{codigo,descricao}] }`. Endpoint público `GET /api/cnpj/v1/{cnpj}`.
- Server helper `sincronizarCnaesEmpresa(supabase, companyId, cnpj, ownerUserId)`: chama a BrasilAPI
  best-effort e grava em `company_cnaes` (principal + secundários, `fonte:'brasilapi'`).
  Falha da BrasilAPI → grava só o principal já conhecido da empresa (`fonte:'focus'`).
  Idempotente; nunca lança (best-effort, loga em erro).
  **Implementação:** usa **full-replace** (delete dos CNAEs da empresa + insert da lista), NÃO upsert
  — o índice único de `company_cnaes` é parcial (`WHERE deleted_at IS NULL`) e o Postgres não aceita
  `ON CONFLICT` contra índice parcial (`42P10`). Full-replace também reflete remoções de CNAE.
- **Quando roda:** ao **criar/salvar a empresa** (server actions de cadastro/onboarding — onde a
  empresa já é persistida), chamando o helper. NÃO no lookup client-side (que só autofilla o form).
- **Backfill** das empresas existentes: script Node best-effort (não migration SQL — precisa de
  rede) que percorre `companies` e chama o mesmo helper. Idempotente (upsert).

## Onde encaixa na apuração

`impostos/page.tsx` e `iniciarApuracaoAction` deixam de ler `anexo_simples` direto e passam a
chamar `resolverAnexo(...)`. O `aviso` (quando origem='manual') aparece na prévia/diagnóstico
("anexo assumido — confirmar"). O **motor de cálculo** (RBT12, alíquota, valor) **não muda** — só a
**origem do anexo**.

## Seed inicial da `cnae_anexo`

Migration de seed com conjunto curado à mão (LC 123 / Resoluções CGSN):
- CNAEs da base atual (AL Piscinas): `4299501`, `4322301`, `4744005`, `4744003`, `4789005`,
  `4120400` + os mais comuns.
- Mapear `anexo_base` + flags onde houver confiança. Sujeitos a Fator R → `fator_r=true,
  anexo_base=null`. Duvidosos → ficam de fora (caem no manual).

## Testes

- `anexo-resolver.test.ts`: mapeado (anexo_base), fator_r→manual+aviso, não-mapeado→manual+aviso,
  sem CNAE principal→manual.
- `brasilapi.test.ts`: mapper do shape (principal + secundários, descrições).
- (opcional) sanidade do seed.

## Migrações & estado do banco

- Nova migration **0020** (`cnae_anexo` + `company_cnaes` + RLS + seed). Aplicada manualmente
  (padrão do projeto; `docs/reference/db_atual.sql` é a fonte de verdade — migrations 0001/0002
  defasadas).
- Backfill é script à parte (rede), rodado após a migration.
