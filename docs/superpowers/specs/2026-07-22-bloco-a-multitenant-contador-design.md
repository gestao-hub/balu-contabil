# Design: Bloco A — Multi-tenant do Contador, Painel, White-label e Honorários v2

**Data:** 2026-07-22
**Branch:** main (criar `feat/bloco-a-multitenant` na implementação)
**Origem:** devolutiva do Michel (`Direcionamento/devolutiva-dev-preenchido.html`) + batimento (`docs/investigations/BATIMENTO-PLANEJAMENTO-VERDE.md`). Maior bloco em aberto do §8 do plano.

---

## Contexto

O Balu hoje só tem empresas "soltas" (cada usuário dono das suas). A devolutiva definiu como **essencial para lançar**: multi-escritório (vários escritórios isolados), Painel do Contador **somente visualização**, white-label parcial (logo, nome, WhatsApp de suporte, e-mails com marca) e retrabalho de honorários (status pago/aberto/atrasado + recorrência mensal).

### Decisões fechadas no brainstorm

1. **Vínculo empresa↔escritório pelos dois caminhos**: contador cadastra o cliente (convite dirigido) E link de convite do escritório.
2. **1 escritório = N usuários com permissões iguais**; papéis diferenciados (dono/assistente) ficam para V2.
3. **Painel agregado + drill-down somente-leitura** nas telas reais do cliente.
4. **"Irregular" = 5 critérios fiscais com semáforo** (ver §Semáforo); honorário atrasado é coluna própria, não entra no semáforo.
5. **Co-branding** (identidade Balu preservada + marca do escritório para os clientes dele); e-mails de autenticação continuam Balu.
6. **Honorários: controle manual completo** (recorrência via cron, contador marca pago); campos `asaas_*` já nascem para o Bloco B plugar.
7. **Cadastro de escritório com aprovação** por admin do Balu, validando CRC.
8. **Arquitetura: tabela de vínculo + RLS por join + RPCs agregadoras** (Abordagem 1). JWT claim rejeitado (dessincroniza na revogação); views materializadas ficam como evolução V2 se o painel ficar lento.

### Fora deste bloco (registrado para não se perder)

- Retrabalho do dashboard do empresário (cli_2_2) — depende de resolver com o Michel a ambiguidade do **"saldo disponível real"** (não existe módulo financeiro/integração bancária).
- Disparo de e-mail/WhatsApp (cobrança, avisos) — Bloco C. O Bloco A só grava dados.
- Cobrança real de honorários via Asaas — Bloco B.
- Papéis internos do escritório — V2.

---

## Migrações

### `0030_contabilidades.sql` — o tenant

```sql
create table public.contabilidades (
  id uuid primary key default gen_random_uuid(),
  nome text not null,                    -- nome exibido no white-label
  cnpj text unique,                      -- validado no app (dígitos verificadores)
  crc text not null,                     -- registro CRC (DL 9.295/46, art. 12)
  crc_uf char(2) not null,
  logo_url text,                         -- path no bucket privado 'branding'
  whatsapp_suporte text,                 -- E.164; vira link wa.me para os clientes
  email_remetente_nome text,             -- "De:" das notificações (Bloco C)
  status text not null default 'pendente'
    check (status in ('pendente','aprovada','suspensa')),
  aprovada_em timestamptz,
  aprovada_por uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.contabilidade_membros (
  contabilidade_id uuid not null references public.contabilidades(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (contabilidade_id, user_id)
);
-- Lançamento: 1 usuário pertence a no máximo 1 contabilidade.
create unique index contabilidade_membros_user_unique on public.contabilidade_membros(user_id);
-- A PK composta já suporta multi-vínculo quando os papéis chegarem (V2): basta dropar o índice.

create table public.convites (
  id uuid primary key default gen_random_uuid(),
  contabilidade_id uuid not null references public.contabilidades(id) on delete cascade,
  tipo text not null check (tipo in ('cliente','membro')),
  email text,                            -- convite dirigido; null = link reutilizável do escritório
  token text not null unique,            -- 32 bytes url-safe (crypto.randomBytes)
  company_id uuid references public.companies(id) on delete cascade,  -- empresa pré-cadastrada
  expira_em timestamptz,                 -- 7 dias (dirigido); null = sem expiração (link)
  revogado_em timestamptz,
  usado_em timestamptz,
  usado_por uuid references auth.users(id),
  created_at timestamptz not null default now()
);
```

Regras:
- Convite **dirigido** (`email` preenchido): single-use, expira em 7 dias.
- Convite **link do escritório** (`email` null, `tipo='cliente'`): reutilizável, sem expiração, revogável (`revogado_em`). `usado_em/usado_por` não se aplicam (multiuso) — a trilha de consentimento fica no aceite (ver §LGPD).
- Convite `tipo='membro'`: dirigido sempre.

### `0031_companies_contabilidade.sql`

```sql
alter table public.companies
  add column contabilidade_id uuid references public.contabilidades(id) on delete set null;
create index companies_contabilidade_idx on public.companies(contabilidade_id);
```

- **Migração de dados: nenhuma.** Empresas existentes ficam `null` (= "solta", experiência 100% atual).
- Desvínculo é `set null` — o dado fiscal pertence à empresa, não ao escritório (LGPD art. 6º).
- Empresa cadastrada pelo contador (caminho A) nasce com `contabilidade_id` e `owner_user_id null` até o aceite do convite (ajustar a constraint/policies que assumem owner not null — verificar `0028`).

### `0032_honorarios_v2.sql` — retrabalho (cli_2_11)

```sql
alter table public.honorarios
  add column contabilidade_id uuid references public.contabilidades(id) on delete cascade,
  add column valor_centavos integer,                -- nunca float para dinheiro
  add column competencia date,                      -- primeiro dia do mês de referência
  add column vencimento date,
  add column pago_em timestamptz,
  add column forma_pagamento text,
  add column recorrente boolean not null default false,
  add column recorrencia_dia int check (recorrencia_dia between 1 and 28),
  add column asaas_charge_id text,                  -- gancho Bloco B (sem uso agora)
  add column asaas_customer_id text;                -- gancho Bloco B (sem uso agora)

-- status derivado (não é coluna): 'pago' se pago_em is not null;
-- 'atrasado' se vencimento < current_date; senão 'aberto'.
-- Exposto como generated column OU calculado na RPC/query — decidir na implementação
-- (generated column não pode referenciar current_date; será computed na leitura).

create unique index honorarios_competencia_unique
  on public.honorarios(company_id, contabilidade_id, competencia)
  where recorrente = true;               -- idempotência do cron
```

Dados legados de `honorarios` (estrutura da `0001`): mapear colunas antigas para as novas na própria migração; o que não tiver correspondência fica preservado (nada é dropado neste bloco).

### `0033_rls_contador.sql` — fronteira de segurança

Helper (padrão `security definer stable` para não recursar RLS):

```sql
create or replace function public.minha_contabilidade()
returns uuid language sql security definer stable set search_path = public as $$
  select cm.contabilidade_id
  from contabilidade_membros cm
  join contabilidades c on c.id = cm.contabilidade_id and c.status = 'aprovada'
  where cm.user_id = auth.uid()
$$;
```

- O filtro `status='aprovada'` **dentro do helper** garante: contabilidade pendente/suspensa ⇒ helper retorna null ⇒ todas as políticas de contador negam. Um único ponto de corte.

Políticas novas, **só SELECT**, para as 9 tabelas de dados do cliente
(`companies`, `empresas_fiscais`, `notas_fiscais`, `apuracoes_fiscais`, `declaracoes_fiscais`, `guias_fiscais`, `clientes`, `company_cnaes`, `arquivos_auxiliares`):

```sql
create policy <tabela>_select_contador on public.<tabela> for select
  using (company_id in (select id from public.companies
                        where contabilidade_id = public.minha_contabilidade()));
-- em companies a condição é direta: contabilidade_id = minha_contabilidade()
```

- **Zero política de INSERT/UPDATE/DELETE** para contador em dados do cliente. O "somente visualizar" é garantido no banco.
- `honorarios`: contador (membro da contabilidade dona) CRUD completo; empresário SELECT dos da própria empresa.
- `contabilidades`: membro lê/edita a própria (UPDATE restrito a campos de branding — não a `status`); demais usuários não leem nada.
- `contabilidade_membros`: membro lê os da própria contabilidade; INSERT/DELETE só via server actions (service role) — nunca pelo client.
- `convites`: membro lê/gerencia os da própria contabilidade; aceite roda via RPC (abaixo).

### RPCs (mesma migração)

```sql
painel_contador() returns table (...)   -- 1 linha por cliente do escritório
resumo_escritorio() returns record       -- totais agregados
aceitar_convite(p_token text) returns uuid  -- transacional, idempotente
```

- `painel_contador()`: nome, cnpj, regime, semáforo + motivos (array), faturamento 12m, honorários em aberto/atrasados, % do limite, convite pendente?
- Todas `security definer` com guarda interna `minha_contabilidade() is not null` (ou, no aceite, validação completa do token).
- `aceitar_convite`: valida token (existe, não revogado, não expirado, não usado se dirigido) → vincula (empresa assume owner / empresa ganha contabilidade_id / membro entra na equipe) → grava `usado_em/usado_por` → tudo numa transação. Segundo clique = no-op idempotente. Falha se a empresa já está vinculada a **outro** escritório (mensagem clara; trocar exige desvincular antes).

### `parametros_fiscais` (na `0033` ou própria)

```sql
create table public.parametros_fiscais (
  chave text primary key,      -- 'limite_mei', 'limite_simples', 'dasn_prazo', ...
  valor numeric not null,
  vigencia_inicio date not null,
  norma text                   -- ex.: 'LC 123/2006, art. 18-A, §1º'
);
```

Tetos e prazos **nunca hard-coded** (PLP 108/2024 e agenda da reforma podem reajustar): atualizar vira UPDATE, não deploy. O motor de limite existente (`LimiteEmissaoBanner` / lib fiscal) passa a ler daqui — refactor pontual incluído no bloco.

---

## Semáforo "cliente irregular"

Lógica **centralizada na RPC** `painel_contador()` (única fonte), com motivos em português simples + citação da norma (tooltips didáticos na UI):

| Cor | Critério | Norma | Fonte do dado |
|---|---|---|---|
| 🔴 | DAS vencido e não pago | LC 123/2006, art. 21; Res. CGSN 140/2018 | `guias_fiscais` |
| 🔴 | PGDAS-D do mês anterior não transmitida | Res. CGSN 140/2018, art. 38 | `declaracoes_fiscais` |
| 🔴 | DASN-SIMEI pendente após 31/05 (só MEI) | Res. CGSN 140/2018, art. 109 | consulta SERPRO persistida |
| 🟡 | Faturamento 12m ≥ 80% do limite do regime | LC 123/2006, arts. 3º e 18-A | motor de limite + `parametros_fiscais` |
| 🟡 | Certificado A1 vence em < 30 dias | exigência operacional de emissão | metadata do certificado |
| 🟢 | nenhum dos anteriores | — | — |

Honorário atrasado **não** entra no semáforo (inadimplência comercial ≠ situação fiscal); é coluna própria na tabela do painel.

---

## Rotas e telas

### Cadastro e aprovação do escritório

- Signup mantém a escolha de papel (`role_types`, migração `0002`). Papel **Contador** ⇒ passo pós-confirmação: formulário da contabilidade (nome, CNPJ validado, CRC + UF) ⇒ cria `contabilidades` `status='pendente'` + vínculo em `contabilidade_membros`.
- `/contador/aguardando`: tela de espera didática ("Validamos o registro CRC de cada escritório — exigência do DL 9.295/46"). E-mail de aviso na aprovação (template Balu; disparo simples via Supabase/SMTP atual — não depende do Bloco C).
- `/admin/contabilidades`: lista pendentes ⇒ aprovar/recusar. Acesso só `role_types = 'AdminBalu'` (valor novo, concedido via SQL — sem tela de gestão de admins no lançamento). Server action com service role + verificação explícita do papel.

### Área do contador — rotas novas em `(auth)`

| Rota | Conteúdo |
|---|---|
| `/contador` | Painel: cards (`resumo_escritorio()`) + tabela (`painel_contador()`), filtros status/regime, tooltips didáticos com a norma |
| `/contador/clientes/[companyId]/…` | Drill-down leitura: **reusa os componentes existentes** de notas/impostos/guias parametrizados por `companyId` + `ReadOnlyContext` que oculta ações. Banner fixo: "Você está vendo os dados de [Cliente] em modo leitura". Garantia real = RLS |
| `/contador/clientes/novo` | Reusa `CreateCompanyDialog` (busca CNPJ Focus, autofill) criando empresa com `contabilidade_id` + convite dirigido |
| `/contador/honorarios` | Honorários v2: filtros (aberto/atrasado/pago, competência), criação com recorrência (dia 1–28), Marcar como pago (data + forma) |
| `/contador/equipe` | Membros + convite de membro por e-mail |
| `/contador/configuracoes` | White-label: logo (bucket privado `branding`, 1MB, PNG/SVG/JPG, magic bytes, signed URL), nome, WhatsApp, nome do remetente |

- Sidebar: seção "Escritório" visível só para quem tem vínculo em `contabilidade_membros`; empresários nunca a veem.
- Honorários por papel: `/honorarios` passa a ser a **visão do empresário** (lista dos seus, com status — somente leitura); usuário contador que acessar `/honorarios` é redirecionado para `/contador/honorarios` (gestão completa).
- **Zero componente de design novo** — composição dos componentes, fontes (Syne/Outfit/Nunito via tokens atuais) e Tailwind existentes.

### Vínculo (dois caminhos)

- **Caminho A — contador cadastra:** empresa nasce vinculada e sem dono ⇒ convite dirigido (7 dias) ⇒ `/convite/[token]`: sem conta = signup encurtado (empresa já existe, vira owner); com conta = confirma e assume. Antes do aceite o contador já vê a empresa no painel ("convite pendente").
- **Caminho B — link do escritório:** `/r/[token]` ⇒ cadastro normal + criação de empresa que nasce com `contabilidade_id`.
- **Tela de aceite (ambos):** consentimento informado (LGPD arts. 7º e 9º) — "O escritório X poderá **visualizar** suas notas, impostos e guias. Ele **não pode** emitir nem alterar nada."
- **Desvínculo:** empresário desvincula em `/configuracoes` (LGPD art. 18, IX); contador remove cliente da carteira. Ambos `set null`, nada é apagado; acesso do contador cessa imediatamente (RLS avalia o vínculo a cada request).

### Co-branding

`(auth)/layout.tsx` resolve a contabilidade da empresa ativa (1 query cacheada por request):
- Logo + nome no topo da sidebar, "oferecido por [Escritório]" discreto; rodapé "Balu".
- Botão de suporte vira `wa.me/<whatsapp_suporte>`.
- Empresa solta = experiência atual intocada. E-mails de **autenticação** continuam Balu nas duas situações; e-mails de **notificação** com marca do escritório são Bloco C.

### Cron de honorários

`/api/cron/honorarios-recorrentes` — Vercel Cron, dia 1 às 06:00 BRT, autenticado por `CRON_SECRET` (mesmo padrão de `cron/sync-municipios`):
- Para cada honorário `recorrente=true`, cria a cobrança da competência corrente se não existir (idempotente pelo índice único).
- Loop com try/catch por contabilidade: falha de uma não bloqueia as demais; erros logados.
- Status "atrasado" não precisa de cron — derivado de `vencimento < hoje` na leitura.

---

## Enquadramento legal

| Item do design | Norma | Como cumpre |
|---|---|---|
| Gate de CRC no cadastro do escritório | DL 9.295/46, art. 12; Res. CFC 1.554/18 | `crc + crc_uf` obrigatórios; aprovação manual valida. O Balu é software — quem exerce contabilidade é o escritório; o gate evita facilitar exercício ilegal da profissão |
| Contador acessa dados fiscais do cliente | LGPD art. 7º, V (contrato) e IX (legítimo interesse); art. 9º (transparência) | Tela de aceite lista o que fica visível; `usado_em/usado_por` é a trilha de consentimento |
| Revogação do vínculo | LGPD art. 18, IX | Desvínculo self-service; corte imediato via RLS (motivo da rejeição do JWT claim) |
| Semáforo cita a norma | LC 123/2006 arts. 3º, 18-A, 21; Res. CGSN 140/2018 arts. 38 (PGDAS-D até dia 20 do mês seguinte) e 109 (DASN-SIMEI até 31/05) | Critérios na RPC única, testes unitários por norma, tooltip didático na UI |
| Tetos parametrizados | LC 123/2006 (valores vigentes); PLP 108/2024 (risco de reajuste) | `parametros_fiscais` com vigência e citação da norma |
| Honorário/inadimplência é dado pessoal | LGPD art. 5º | RLS: visível só ao escritório dono e ao próprio cliente |
| Reforma Tributária | LC 214/2025 (CBS/IBS, transição 2026–2033) | Não altera o Bloco A (Simples/MEI preservados); risco registrado no PRD para os blocos de emissão |

---

## Erros e casos-limite

- Token inexistente/expirado/revogado/usado ⇒ página amigável ("peça um novo link ao seu contador"), nunca erro cru.
- Aceite transacional + idempotente (RPC `aceitar_convite`).
- Empresa já vinculada a outro escritório ⇒ aceite falha com mensagem clara; trocar exige desvincular antes.
- Contabilidade suspensa ⇒ membros veem só tela de status; leitura de clientes cortada pelo helper; clientes seguem operando (co-branding some).
- Último membro: remoção bloqueada — sempre ≥ 1; esvaziar exige suspensão pelo admin.
- Upload de logo: MIME por magic bytes, 1MB, redimensionado, bucket privado + signed URL.
- Server actions do contador: RLS (banco) + `requireContador()` (aplicação). Escrita indevida falha **no banco** mesmo com bug na aplicação.

---

## Testes

1. **Unitários (Vitest):** semáforo — 1 caso por norma + combinações (DAS vencido; PGDAS-D ausente; DASN pós-31/05 só MEI; ≥80% por regime; cert <30d); recorrência (dia 28, competência dupla, idempotência); validadores CNPJ/CRC.
2. **RLS (padrão do teste `rls-isolation` existente) — prioridade máxima:**
   - contador lê cliente vinculado ✓
   - contador NÃO lê empresa solta ✗
   - contador NÃO lê cliente de outro escritório ✗
   - contador NÃO escreve em nenhuma das 9 tabelas do cliente ✗
   - empresário NÃO lê `contabilidades`/`honorarios` alheios ✗
   - membro de contabilidade pendente/suspensa NÃO lê clientes ✗
3. **E2E (Playwright, contra build):** signup contador → aprovação admin → cadastra cliente → aceite do convite → painel com semáforo → drill-down read-only (ações ausentes) → honorário recorrente → marcar pago → co-branding visível ao cliente.
4. **Critério de merge:** nenhum PR do bloco entra sem os testes de RLS verdes — é a fronteira de segurança do produto.

---

## Dependências e sequência com os outros blocos

- **Não depende** de credenciais externas (Asaas/SERPRO/WhatsApp) — pode começar imediatamente.
- **Bloco E (hardening)** deve reativar/confirmar a RLS base (`0009` desabilitou; `0010` criou políticas) **antes** do E2E final deste bloco rodar em produção.
- Bloco B pluga nos campos `asaas_*`; Bloco C consome `contabilidades` (branding de e-mail) e o semáforo (avisos).
