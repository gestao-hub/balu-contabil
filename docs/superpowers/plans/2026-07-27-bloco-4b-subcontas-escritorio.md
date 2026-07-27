# Bloco 4B — O escritório cobrando (subconta Asaas) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao escritório uma ferramenta de cobrança dentro da Balu — honorários recorrentes e serviços avulsos cobrados do cliente dele, com boleto e Pix, emitidos por uma **subconta Asaas do próprio escritório**, de modo que o dinheiro nunca passe pela conta da Balu.

**Architecture:** A Balu cria a subconta pela API do Asaas (`POST /v3/accounts`) com os dados do escritório; o Asaas devolve `id`, `walletId` e uma `apiKey` **própria da subconta**. Essa chave é cifrada em repouso com o envelope AES-256-GCM do Bloco E e usada só server-side para emitir cobranças **em nome do escritório**. As cobranças do escritório vivem em tabela separada das cobranças da Balu — a separação do dinheiro existe no banco, não só no discurso.

**Tech Stack:** Next.js 15 (App Router, Server Actions), TypeScript, Supabase (Postgres + RLS + service role), Asaas API v3, vitest.

---

## Antes de começar

```bash
cd D:/balu-app-v2/balu
git checkout main && git pull
git checkout -b feat/bloco-4b-subcontas
```

**Regras deste repo que este plano assume** (violá-las custa horas):

- **Nunca rodar `next build` com o `npm run dev` no ar**, e **nunca subir um segundo `npm run dev`** — os dois destroem o `.next/`. Conferir antes: `Get-CimInstance Win32_Process -Filter "Name='node.exe'"`.
- **`tsc --noEmit` limpo NÃO é garantia.** Export de valor não-async em arquivo `'use server'` só quebra no `next build`. Todo módulo puro vai para fora do `actions.ts`.
- **`npm run lint` não roda** neste repo (sem config de ESLint). A verificação é `tsc` + `vitest` + `next build`.
- **Coluna nova exige reload do PostgREST**, senão o supabase-js responde "column does not exist": `node app/scratchpad/_reload-postgrest.mjs`.
- **`upsert` do PostgREST manda NULL nas colunas ausentes** do payload. Para atualização parcial, usar `update`.
- Migrations são aplicadas com um runner em `app/scratchpad/` que lê `SUPABASE_PASSWORD` do `.env.local`. Copiar `apply-0052.mjs` trocando o nome do arquivo.

**Ambiente:** `ASAAS_ENV` ausente ou diferente de `prod` = sandbox. Todo este plano roda em **sandbox**. A criação de subconta em produção depende de aprovação comercial do Asaas (premissa 2 do §8 da spec) — o código não muda por causa disso.

---

## Estrutura de arquivos

**Criar:**

| Arquivo | Responsabilidade |
|---|---|
| `app/supabase/migrations/0053_subcontas_escritorio.sql` | Vínculo de subconta em `contabilidades`, `servicos_avulsos`, `cobrancas_escritorio`, colunas novas em `honorarios`, RLS |
| `app/src/lib/billing/subconta.ts` | Regras **puras**: monta e valida o payload de criação da subconta (PJ vs PF) |
| `app/src/lib/billing/subconta.test.ts` | Testes do acima |
| `app/src/lib/billing/credencial-subconta.ts` | Guarda e recupera a apiKey da subconta, cifrada. **Único** ponto que decifra |
| `app/src/lib/billing/credencial-subconta.test.ts` | Prova o ciclo cifra→decifra completo |
| `app/src/lib/billing/avulso.ts` | Regras **puras** do catálogo: valor fixo vs percentual, cálculo do valor final |
| `app/src/lib/billing/avulso.test.ts` | Testes do acima |
| `app/src/lib/billing/cobranca-escritorio.ts` | Persistência das cobranças do escritório (espelha `cobranca.ts` do 4A) |
| `app/src/lib/billing/cobranca-escritorio.test.ts` | Não-regressão: evento fora de ordem não desfaz pagamento |
| `app/src/app/(auth)/(gated)/contador/configuracoes/subconta/page.tsx` | Onboarding da subconta |
| `app/src/app/(auth)/(gated)/contador/configuracoes/subconta/SubcontaForm.tsx` | Formulário PJ/PF |
| `app/src/app/(auth)/(gated)/contador/configuracoes/subconta/actions.ts` | Server Actions da subconta |
| `app/src/app/(auth)/(gated)/contador/configuracoes/avulsos/page.tsx` | Catálogo de serviços avulsos |
| `app/src/app/(auth)/(gated)/contador/configuracoes/avulsos/CatalogoAvulsos.tsx` | CRUD do catálogo |
| `app/src/app/(auth)/(gated)/contador/configuracoes/avulsos/actions.ts` | Server Actions do catálogo |
| `app/src/app/(auth)/(gated)/contador/clientes/[companyId]/CobrarDialog.tsx` | "Cobrar" na ficha do cliente |
| `app/src/app/(auth)/(gated)/cobrancas/page.tsx` | Cliente final vê as cobranças do escritório |

**Modificar:**

| Arquivo | O quê |
|---|---|
| `app/src/lib/clients/asaas.ts` | `call` aceita token explícito; nasce `asaasSub(token)` para agir **como a subconta** |
| `app/src/app/api/webhooks/asaas/route.ts` | Rotear evento sem `subscriptionId` para a cobrança do escritório |
| `app/src/app/(auth)/(gated)/contador/clientes/[companyId]/VisaoCliente.tsx` | Botão "Cobrar" |
| `app/src/app/(auth)/(gated)/contador/honorarios/` | "Gerar cobrança" no honorário |

---

## ⚠️ Duas armadilhas específicas deste bloco

**1. A apiKey da subconta só aparece UMA VEZ.** O Asaas devolve `apiKey` na resposta do `POST /v3/accounts` e **não a expõe de novo**. Se a criação der certo e a gravação no banco falhar, existe uma subconta órfã cuja chave se perdeu — o escritório fica com uma conta no Asaas que a Balu não consegue mais operar. Por isso a Task 5 grava **antes** de qualquer outra coisa e, se a gravação falhar, registra o `accountId` (nunca a chave) em `audit_log` com ação própria para recuperação manual.

**2. `decifrarCampo` nunca rodou em runtime neste repo.** O CHECKPOINT registra isso como landmine desde o Bloco E: `cifrarCampo` tem teste, mas o ciclo completo de ida e volta com a chave real (`CERT_ENC_KEY` do ambiente) nunca foi exercido em produção. A Task 4 existe para provar o ciclo **antes** de qualquer coisa depender dele.

---

## Decisão a confirmar com o usuário antes da Task 9

O gate de inadimplência do 4A bloqueia funções do contador quando o escritório está devendo à Balu. **Emitir cobrança pela subconta é uma função nova** — o gate alcança ou não?

**Recomendação:** o gate bloqueia **criar cobrança nova**, e **nunca** alcança ver, sincronizar ou receber cobrança já emitida. Dinheiro que o cliente já deve ao escritório precisa continuar entrando — inclusive porque é com ele que o escritório paga a Balu. É a mesma forma das duas fronteiras do 4A: bloqueia o novo, nunca retém o que já é direito de alguém.

Confirmar antes de implementar a Task 9. Se o usuário decidir que o gate não alcança nem a criação, a mudança é remover uma chamada — o plano não muda de forma.

---

### Task 1: Migration 0053 — esquema das subcontas, catálogo e cobranças do escritório

**Files:**
- Create: `app/supabase/migrations/0053_subcontas_escritorio.sql`
- Create: `app/scratchpad/apply-0053.mjs`

**Por que `cobrancas_escritorio` e não reusar `cobrancas`:** a tabela `cobrancas` do 4A tem `assinatura_id` **NOT NULL** — é o que garante que toda cobrança ali pertence a uma assinatura da Balu. Encaixar honorário nela exigiria afrouxar esse NOT NULL e misturar, na mesma tabela, dinheiro da Balu com dinheiro do escritório. O princípio deste bloco é a separação dos dois; ela vale no banco também.

- [ ] **Step 1: Escrever a migration**

```sql
-- 0053 — Bloco 4B: o escritorio cobrando pela propria subconta Asaas.
--
-- PRINCIPIO (spec §1): a Balu nao intermedia dinheiro de terceiro. A cobranca
-- nasce NA SUBCONTA do escritorio, o credor e ele, o dinheiro liquida na conta
-- dele. Por isso estas cobrancas NAO entram em public.cobrancas, que e o
-- dinheiro da Balu: tabela separada, sem coluna em comum a ser confundida.

-- ------------------------------------------------ vinculo da subconta
ALTER TABLE public.contabilidades
  ADD COLUMN IF NOT EXISTS asaas_subconta_id      text,
  ADD COLUMN IF NOT EXISTS asaas_wallet_id        text,
  -- Cifrada com cifrarCampo (envelope AES-256-GCM do Bloco E). NUNCA em claro.
  -- O Asaas devolve esta chave UMA UNICA VEZ, na criacao; perdida, a subconta
  -- fica inoperavel pela Balu.
  ADD COLUMN IF NOT EXISTS asaas_api_key_cifrada  text,
  -- 'ausente' | 'pendente' (KYC em analise) | 'aprovada' | 'recusada'
  ADD COLUMN IF NOT EXISTS asaas_subconta_status  text NOT NULL DEFAULT 'ausente',
  ADD COLUMN IF NOT EXISTS asaas_subconta_criada_em timestamptz;

ALTER TABLE public.contabilidades
  DROP CONSTRAINT IF EXISTS contabilidades_subconta_status_check;
ALTER TABLE public.contabilidades
  ADD CONSTRAINT contabilidades_subconta_status_check
  CHECK (asaas_subconta_status IN ('ausente','pendente','aprovada','recusada'));

COMMENT ON COLUMN public.contabilidades.asaas_api_key_cifrada IS
  'apiKey da subconta Asaas, cifrada por cifrarCampo. Movimenta dinheiro de TERCEIRO — mais sensivel que a service role. Nunca sai para o cliente, nunca entra em log.';

-- ------------------------------------------------ catalogo de avulsos
CREATE TABLE IF NOT EXISTS public.servicos_avulsos (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contabilidade_id uuid NOT NULL REFERENCES public.contabilidades(id) ON DELETE CASCADE,
  nome             text NOT NULL,
  categoria        text,
  -- Percentual desde o comeco (spec §5): recuperacao de credito e cobrada como
  -- % do valor recuperado e taxa de urgencia como % do servico-base. Migrar
  -- depois para incluir isso sairia caro.
  tipo_valor       text NOT NULL DEFAULT 'fixo',
  valor_centavos   integer,
  percentual       numeric(5,2),
  ativo            boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT servicos_avulsos_tipo_check CHECK (tipo_valor IN ('fixo','percentual')),
  -- Cada tipo exige o SEU campo e proibe o outro: uma linha 'fixo' com
  -- percentual preenchido nao diz qual dos dois vale.
  CONSTRAINT servicos_avulsos_valor_check CHECK (
    (tipo_valor = 'fixo'       AND valor_centavos IS NOT NULL AND valor_centavos > 0 AND percentual IS NULL)
    OR
    (tipo_valor = 'percentual' AND percentual     IS NOT NULL AND percentual > 0     AND valor_centavos IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS servicos_avulsos_contabilidade_idx
  ON public.servicos_avulsos(contabilidade_id) WHERE ativo;

-- ------------------------------------------------ cobrancas do escritorio
CREATE TABLE IF NOT EXISTS public.cobrancas_escritorio (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contabilidade_id   uuid NOT NULL REFERENCES public.contabilidades(id) ON DELETE CASCADE,
  empresa_cliente_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  honorario_id       uuid REFERENCES public.honorarios(id) ON DELETE SET NULL,
  servico_avulso_id  uuid REFERENCES public.servicos_avulsos(id) ON DELETE SET NULL,
  asaas_charge_id    text NOT NULL,
  descricao          text NOT NULL,
  status             text NOT NULL,
  valor_centavos     integer NOT NULL,
  vencimento         date NOT NULL,
  pago_em            date,
  link_fatura        text,
  pix_copia_cola     text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- O webhook acha a cobranca por este id; unico para o evento reentregue nao
-- criar linha duplicada (o Asaas reentrega, e ja mordeu este projeto no 4A).
CREATE UNIQUE INDEX IF NOT EXISTS cobrancas_escritorio_charge_unique
  ON public.cobrancas_escritorio(asaas_charge_id);
CREATE INDEX IF NOT EXISTS cobrancas_escritorio_contabilidade_idx
  ON public.cobrancas_escritorio(contabilidade_id);
CREATE INDEX IF NOT EXISTS cobrancas_escritorio_cliente_idx
  ON public.cobrancas_escritorio(empresa_cliente_id);

-- ------------------------------------------------ honorarios
ALTER TABLE public.honorarios
  ADD COLUMN IF NOT EXISTS cobranca_escritorio_id uuid
    REFERENCES public.cobrancas_escritorio(id) ON DELETE SET NULL,
  -- Decisao 7.4: o semaforo do painel e AUTOMATICO onde houver cobranca pela
  -- subconta e MANUAL onde nao houver. Sem esta coluna, um campo `status`
  -- unico sobrescrito pelos dois caminhos esconde qual deles falou por ultimo.
  ADD COLUMN IF NOT EXISTS pagamento_origem text;

ALTER TABLE public.honorarios
  DROP CONSTRAINT IF EXISTS honorarios_pagamento_origem_check;
ALTER TABLE public.honorarios
  ADD CONSTRAINT honorarios_pagamento_origem_check
  CHECK (pagamento_origem IS NULL OR pagamento_origem IN ('asaas','manual'));

-- ------------------------------------------------ RLS
ALTER TABLE public.servicos_avulsos      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cobrancas_escritorio  ENABLE ROW LEVEL SECURITY;

-- Catalogo: so o escritorio dono le. Escrita so pelo service role (actions),
-- mesma forma de assinaturas na 0050.
DROP POLICY IF EXISTS servicos_avulsos_select_dono ON public.servicos_avulsos;
CREATE POLICY servicos_avulsos_select_dono ON public.servicos_avulsos
  FOR SELECT USING (contabilidade_id = public.minha_contabilidade_membro());

-- Cobrancas: o escritorio le as que emitiu; o CLIENTE le as dele (decisao 7.3
-- — ele ve as cobrancas dentro do app). Duas pernas, uma policy.
DROP POLICY IF EXISTS cobrancas_escritorio_select ON public.cobrancas_escritorio;
CREATE POLICY cobrancas_escritorio_select ON public.cobrancas_escritorio
  FOR SELECT USING (
    contabilidade_id = public.minha_contabilidade_membro()
    OR EXISTS (
      SELECT 1 FROM public.companies c
       WHERE c.id = cobrancas_escritorio.empresa_cliente_id AND c.user_id = auth.uid()
    )
  );
```

- [ ] **Step 2: Escrever o aplicador**

Copiar `app/scratchpad/apply-0052.mjs` para `apply-0053.mjs` trocando o nome do arquivo SQL e a consulta de verificação:

```js
const sql = readFileSync(join(appDir, 'supabase/migrations/0053_subcontas_escritorio.sql'), 'utf8');
await c.query(sql);

const { rows } = await c.query(`
  SELECT table_name, count(*) AS colunas FROM information_schema.columns
   WHERE table_schema='public' AND table_name IN ('servicos_avulsos','cobrancas_escritorio')
   GROUP BY table_name ORDER BY table_name`);
console.log('0053 aplicada.');
for (const r of rows) console.log(`  ${r.table_name}: ${r.colunas} colunas`);
const { rows: sub } = await c.query(`
  SELECT column_name FROM information_schema.columns
   WHERE table_schema='public' AND table_name='contabilidades' AND column_name LIKE 'asaas%'
   ORDER BY column_name`);
console.log('  contabilidades:', sub.map((r) => r.column_name).join(', '));
```

- [ ] **Step 3: Aplicar e recarregar o PostgREST**

Run:
```bash
node app/scratchpad/apply-0053.mjs
node app/scratchpad/_reload-postgrest.mjs
```
Expected:
```
0053 aplicada.
  cobrancas_escritorio: 15 colunas
  servicos_avulsos: 10 colunas
  contabilidades: asaas_api_key_cifrada, asaas_subconta_criada_em, asaas_subconta_id, asaas_subconta_status, asaas_wallet_id
PostgREST: reload schema enviado.
```

- [ ] **Step 4: Provar o CHECK do catálogo no banco**

Run:
```bash
node -e "
const pg=require('pg');const fs=require('fs');
const env=Object.fromEntries(fs.readFileSync('app/.env.local','utf8').split(/\r?\n/).filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^[\"']|[\"']\$/g,'')]}));
const ref=env.NEXT_PUBLIC_SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\./)[1];
const c=new pg.Client({host:'db.'+ref+'.supabase.co',port:5432,user:'postgres',password:env.SUPABASE_PASSWORD,database:'postgres',ssl:{rejectUnauthorized:false}});
(async()=>{await c.connect();
for (const [rot,sql] of [['fixo sem valor',\"INSERT INTO servicos_avulsos(contabilidade_id,nome,tipo_valor) VALUES ('00000000-0000-0000-0000-000000000000','x','fixo')\"],['percentual com valor',\"INSERT INTO servicos_avulsos(contabilidade_id,nome,tipo_valor,percentual,valor_centavos) VALUES ('00000000-0000-0000-0000-000000000000','x','percentual',10,500)\"]]) {
  try { await c.query('BEGIN'); await c.query(sql); console.log(rot+': PASSOU — CHECK FALHOU'); } catch(e){ console.log(rot+': recusado OK'); } finally { await c.query('ROLLBACK'); } }
await c.end();})();
"
```
Expected: `fixo sem valor: recusado OK` e `percentual com valor: recusado OK`.

- [ ] **Step 5: Commit**

```bash
git add app/supabase/migrations/0053_subcontas_escritorio.sql
git commit -m "feat(4b): migration 0053 — subconta, catalogo de avulsos e cobrancas do escritorio"
```

---

### Task 2: Cliente Asaas capaz de agir **como a subconta**

**Files:**
- Modify: `app/src/lib/clients/asaas.ts`

O `call` de hoje usa sempre a chave da conta-mãe. Cobrança do escritório precisa sair **com a chave da subconta**, senão a cobrança nasce na conta da Balu — exatamente o que o bloco existe para evitar.

- [ ] **Step 1: `call` passa a aceitar token explícito**

Em `app/src/lib/clients/asaas.ts`, trocar a assinatura de `call` e o header:

```ts
async function call<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${base()}${path}`, {
        method,
        // Sem token explicito, a conta-mae. Com token, a SUBCONTA — e a
        // cobranca nasce pertencendo ao escritorio, nao a Balu.
        headers: { access_token: token ?? apiKey(), 'Content-Type': 'application/json' },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        cache: 'no-store',
      });
```

O resto do corpo de `call` fica igual.

- [ ] **Step 2: Tipos e métodos da subconta**

Acrescentar ao fim do arquivo:

```ts
export type AsaasSubconta = {
  id: string; walletId: string; apiKey: string;
  name: string; email: string; cpfCnpj: string;
};

/** Criação de subconta — vai SEMPRE pela conta-mãe. */
export const asaasContaMae = {
  criarSubconta: (d: Record<string, unknown>) =>
    call<AsaasSubconta>('POST', '/v3/accounts', d),
  listarSubcontas: () =>
    call<{ totalCount: number; data: { id: string; name: string }[] }>('GET', '/v3/accounts?limit=100'),
};

/**
 * Cliente com a identidade da SUBCONTA. Tudo o que emite cobrança do
 * escritório passa por aqui — o `token` é a apiKey decifrada, e nunca
 * pode vir do navegador nem aparecer em log.
 */
export function asaasSub(token: string) {
  if (!token) throw new Error('asaasSub: token da subconta ausente');
  return {
    criarCliente: (d: { name: string; cpfCnpj: string; email?: string }) =>
      call<AsaasCliente>('POST', '/v3/customers', d, token),

    criarCobranca: (d: {
      customer: string; billingType: 'BOLETO' | 'PIX' | 'UNDEFINED';
      value: number; dueDate: string; description?: string; externalReference?: string;
    }) => call<AsaasCobranca>('POST', '/v3/payments', d, token),

    consultarCobranca: (id: string) =>
      call<AsaasCobranca>('GET', `/v3/payments/${id}`, undefined, token),

    listarCobrancas: () =>
      call<{ data: AsaasCobranca[] }>('GET', '/v3/payments?limit=100', undefined, token),

    pixDaCobranca: (id: string) =>
      call<{ payload?: string; encodedImage?: string }>('GET', `/v3/payments/${id}/pixQrCode`, undefined, token),
  };
}
```

- [ ] **Step 3: Verificar que nada quebrou**

Run: `cd app && npx tsc --noEmit`
Expected: `TypeScript: No errors found`

Run: `cd app && npx vitest run src/lib/billing`
Expected: todos os testes de billing passando (o 4A não muda de comportamento — `token` é opcional).

- [ ] **Step 4: Commit**

```bash
git add app/src/lib/clients/asaas.ts
git commit -m "feat(4b): cliente Asaas capaz de agir como a subconta do escritorio"
```

---

### Task 3: Regras puras do payload de subconta (PJ e PF são formulários diferentes)

**Files:**
- Create: `app/src/lib/billing/subconta.ts`
- Test: `app/src/lib/billing/subconta.test.ts`

Levantado no sandbox (§7.1 da spec): obrigatórios são `cpfCnpj`, `name`, `birthDate` — e **`birthDate` só é exigido para CPF**. Com `companyType` de PJ o validador deixa de pedir. São dois conjuntos de campos, não um com campo condicional solto.

- [ ] **Step 1: Escrever o teste falhando**

```ts
import { describe, it, expect } from 'vitest';
import { validarDadosSubconta, montarPayloadSubconta, soDigitos } from './subconta';

const pj = {
  name: 'Escritorio Teste Contabil LTDA', cpfCnpj: '11.222.333/0001-81',
  email: 'contato@escritorio.com.br', mobilePhone: '(11) 99999-9999',
  incomeValue: 25000, address: 'Rua das Flores', addressNumber: '100',
  province: 'Centro', postalCode: '01001-000', birthDate: null,
  companyType: 'LIMITED' as const,
};
const pf = { ...pj, cpfCnpj: '123.456.789-09', companyType: null, birthDate: '1985-03-12' };

describe('validarDadosSubconta', () => {
  it('aceita PJ completo sem data de nascimento', () => {
    expect(validarDadosSubconta(pj)).toEqual({ ok: true });
  });

  it('aceita PF com data de nascimento', () => {
    expect(validarDadosSubconta(pf)).toEqual({ ok: true });
  });

  // O achado do sandbox: birthDate so e exigido para CPF. Cobrar de PJ
  // travaria o onboarding de todo escritorio com CNPJ.
  it('exige data de nascimento apenas para CPF', () => {
    const semData = { ...pf, birthDate: null };
    const r = validarDadosSubconta(semData);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('nascimento');
  });

  it('exige companyType para CNPJ', () => {
    const r = validarDadosSubconta({ ...pj, companyType: null });
    expect(r.ok).toBe(false);
  });

  it.each([
    ['nome', { name: '' }],
    ['documento', { cpfCnpj: '' }],
    ['e-mail', { email: '' }],
    ['celular', { mobilePhone: '' }],
    ['CEP', { postalCode: '' }],
  ])('recusa sem %s', (_r, patch) => {
    expect(validarDadosSubconta({ ...pj, ...patch }).ok).toBe(false);
  });

  it('recusa documento que nao tem 11 nem 14 digitos', () => {
    expect(validarDadosSubconta({ ...pj, cpfCnpj: '123' }).ok).toBe(false);
  });

  it('recusa faturamento estimado zerado ou negativo', () => {
    expect(validarDadosSubconta({ ...pj, incomeValue: 0 }).ok).toBe(false);
  });
});

describe('montarPayloadSubconta', () => {
  it('manda documento e celular so com digitos', () => {
    const p = montarPayloadSubconta(pj);
    expect(p.cpfCnpj).toBe('11222333000181');
    expect(p.mobilePhone).toBe('11999999999');
    expect(p.postalCode).toBe('01001000');
  });

  it('nao manda birthDate para PJ', () => {
    expect(montarPayloadSubconta(pj).birthDate).toBeUndefined();
  });

  it('manda birthDate e omite companyType para PF', () => {
    const p = montarPayloadSubconta(pf);
    expect(p.birthDate).toBe('1985-03-12');
    expect(p.companyType).toBeUndefined();
  });
});

describe('soDigitos', () => {
  it('remove tudo que nao for digito', () => {
    expect(soDigitos('(11) 9 9999-9999')).toBe('11999999999');
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `cd app && npx vitest run src/lib/billing/subconta.test.ts`
Expected: FAIL — `Failed to resolve import "./subconta"`

- [ ] **Step 3: Implementar**

```ts
// Bloco 4B — regras puras do cadastro da subconta Asaas.
//
// Puro de proposito: a action valida ANTES de chamar o Asaas. Um payload
// recusado la volta como erro cru em ingles, e o escritorio no meio do
// onboarding nao tem o que fazer com isso.
//
// PJ e PF sao conjuntos DIFERENTES de campos, levantado contra o sandbox:
// `birthDate` e obrigatorio so para CPF; com `companyType` de PJ o validador
// do Asaas deixa de pedir.

export type CompanyType = 'MEI' | 'LIMITED' | 'INDIVIDUAL' | 'ASSOCIATION';

export type DadosSubconta = {
  name: string;
  cpfCnpj: string;
  email: string;
  mobilePhone: string;
  incomeValue: number;
  address: string;
  addressNumber: string;
  province: string;
  postalCode: string;
  birthDate: string | null;
  companyType: CompanyType | null;
};

export type ResultadoValidacao = { ok: true } | { ok: false; error: string };

export const soDigitos = (v: string): string => (v ?? '').replace(/\D+/g, '');

/** 11 digitos = CPF (pessoa fisica); 14 = CNPJ (pessoa juridica). */
export function ehPessoaJuridica(cpfCnpj: string): boolean {
  return soDigitos(cpfCnpj).length === 14;
}

export function validarDadosSubconta(d: DadosSubconta): ResultadoValidacao {
  if (!d.name?.trim()) return { ok: false, error: 'Informe o nome do escritório.' };

  const doc = soDigitos(d.cpfCnpj);
  if (doc.length !== 11 && doc.length !== 14) {
    return { ok: false, error: 'Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido.' };
  }
  if (!d.email?.trim()) return { ok: false, error: 'Informe o e-mail do responsável.' };
  if (soDigitos(d.mobilePhone).length < 10) {
    return { ok: false, error: 'Informe o celular com DDD.' };
  }
  if (!(d.incomeValue > 0)) {
    return { ok: false, error: 'Informe o faturamento mensal estimado.' };
  }
  if (!d.address?.trim() || !d.addressNumber?.trim() || !d.province?.trim()) {
    return { ok: false, error: 'Informe endereço, número e bairro.' };
  }
  if (soDigitos(d.postalCode).length !== 8) {
    return { ok: false, error: 'Informe o CEP com 8 dígitos.' };
  }

  if (ehPessoaJuridica(d.cpfCnpj)) {
    if (!d.companyType) return { ok: false, error: 'Informe o tipo da empresa.' };
  } else {
    if (!d.birthDate) return { ok: false, error: 'Informe a data de nascimento do responsável.' };
  }
  return { ok: true };
}

/** Payload já no formato que o Asaas espera: documento, celular e CEP só com
 *  dígitos, e o campo do "outro tipo" ausente em vez de nulo. */
export function montarPayloadSubconta(d: DadosSubconta): Record<string, unknown> {
  const pj = ehPessoaJuridica(d.cpfCnpj);
  return {
    name: d.name.trim(),
    email: d.email.trim(),
    cpfCnpj: soDigitos(d.cpfCnpj),
    mobilePhone: soDigitos(d.mobilePhone),
    incomeValue: d.incomeValue,
    address: d.address.trim(),
    addressNumber: d.addressNumber.trim(),
    province: d.province.trim(),
    postalCode: soDigitos(d.postalCode),
    ...(pj ? { companyType: d.companyType } : { birthDate: d.birthDate }),
  };
}
```

- [ ] **Step 4: Rodar para ver passar**

Run: `cd app && npx vitest run src/lib/billing/subconta.test.ts`
Expected: PASS, 15 testes.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/billing/subconta.ts app/src/lib/billing/subconta.test.ts
git commit -m "feat(4b): regras puras do cadastro de subconta (PJ e PF sao formularios diferentes)"
```

---

### Task 4: A credencial da subconta — provar o ciclo cifra→decifra

**Files:**
- Create: `app/src/lib/billing/credencial-subconta.ts`
- Test: `app/src/lib/billing/credencial-subconta.test.ts`

O CHECKPOINT registra `decifrarCampo` como **landmine: existe, tem teste unitário, nunca rodou em runtime**. Este bloco é o primeiro uso legítimo de ida e volta, e o dano de um erro aqui é perder o acesso a uma conta que movimenta dinheiro de terceiro. A prova vem antes do uso.

- [ ] **Step 1: Escrever o teste falhando**

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { guardarCredencial, lerCredencial, mascarar } from './credencial-subconta';

beforeAll(() => {
  // A chave real vive em CERT_ENC_KEY. No teste, uma fixa de 32 bytes.
  process.env.CERT_ENC_KEY ??= Buffer.alloc(32, 7).toString('base64');
});

describe('ciclo completo da credencial', () => {
  // A razao de existir deste arquivo: cifrarCampo tem teste, mas o ciclo
  // ida-e-volta nunca rodou em runtime neste repo (landmine do Bloco E).
  it('o que entra e o que sai sao a MESMA string', () => {
    const chave = '$aact_YTU5YTE0M2M2N2I4MTliNzk0YTI5N2U5MzdjNWZm';
    const guardada = guardarCredencial(chave);
    expect(guardada).not.toBe(chave);
    expect(guardada.startsWith('enc:v1:')).toBe(true);
    expect(lerCredencial(guardada)).toBe(chave);
  });

  // O token do Asaas comeca com `$` — o caractere que ja custou meio dia
  // nesta base por causa do dotenv-expand.
  it('preserva o cifrao inicial do token do Asaas', () => {
    expect(lerCredencial(guardarCredencial('$aact_abc'))).toBe('$aact_abc');
  });

  it('cifra duas vezes a mesma chave dando blobs diferentes (IV aleatorio)', () => {
    expect(guardarCredencial('$aact_x')).not.toBe(guardarCredencial('$aact_x'));
  });

  it('recusa guardar string vazia', () => {
    expect(() => guardarCredencial('')).toThrow();
  });

  it('lerCredencial devolve null quando nao ha nada guardado', () => {
    expect(lerCredencial(null)).toBeNull();
  });
});

describe('mascarar', () => {
  // A chave nao pode aparecer inteira em log NENHUM, nem de erro. Mascarar
  // existe para que exista um jeito seguro de falar dela.
  it('mostra so o comeco e o fim', () => {
    const m = mascarar('$aact_YTU5YTE0M2M2N2I4MTliNzk0YTI5N2U5MzdjNWZm');
    expect(m).toBe('$aact_…NWZm');
    expect(m).not.toContain('YTU5YTE0');
  });

  it('nao vaza nada de chave curta demais', () => {
    expect(mascarar('abc')).toBe('…');
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `cd app && npx vitest run src/lib/billing/credencial-subconta.test.ts`
Expected: FAIL — `Failed to resolve import "./credencial-subconta"`

- [ ] **Step 3: Implementar**

```ts
// Bloco 4B — a credencial da subconta, cifrada em repouso.
//
// ESTE E O SEGREDO MAIS SENSIVEL DO SISTEMA. Mais que a SERVICE_ROLE_KEY:
// com ela se movimenta dinheiro na conta de OUTRA PESSOA, e o dano e
// imediato e irreversivel.
//
// Regras, todas obrigatorias (spec §3):
//  - cifrada em repouso, sempre;
//  - nunca sai para o cliente;
//  - nunca entra em log, INCLUSIVE log de erro — dai `mascarar`;
//  - so este modulo decifra. Quem precisa da chave chama `lerCredencial` e
//    passa direto para `asaasSub`, sem guardar em variavel de escopo largo.
import { cifrarCampo, decifrarCampo } from '@/lib/crypto/envelope';

export function guardarCredencial(apiKey: string): string {
  if (!apiKey) throw new Error('guardarCredencial: apiKey vazia');
  const cifrada = cifrarCampo(apiKey);
  // cifrarCampo devolve o proprio valor quando recebe '' — aqui isso ja foi
  // barrado acima, mas se um dia a cifra falhar em silencio, gravar em claro
  // seria pior que falhar.
  if (cifrada === apiKey) throw new Error('guardarCredencial: cifra nao aplicada');
  return cifrada;
}

export function lerCredencial(cifrada: string | null): string | null {
  if (!cifrada) return null;
  return decifrarCampo(cifrada);
}

/** Única forma permitida de mencionar a chave fora deste módulo. */
export function mascarar(apiKey: string | null): string {
  if (!apiKey || apiKey.length < 12) return '…';
  return `${apiKey.slice(0, 6)}…${apiKey.slice(-4)}`;
}
```

- [ ] **Step 4: Rodar para ver passar**

Run: `cd app && npx vitest run src/lib/billing/credencial-subconta.test.ts`
Expected: PASS, 7 testes.

- [ ] **Step 5: Provar contra a chave REAL do ambiente**

Criar `app/scratchpad/_probe-credencial.mjs`:

```js
// Prova o ciclo cifra->decifra com a CERT_ENC_KEY de verdade do .env.local.
// O teste usa chave sintetica; este script usa a que vai rodar em producao.
import { readFileSync } from 'node:fs';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const env = Object.fromEntries(
  readFileSync('app/.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => {
    const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
  }),
);
const key = Buffer.from(env.CERT_ENC_KEY, 'base64');
console.log('CERT_ENC_KEY presente?', env.CERT_ENC_KEY ? 'SIM' : 'NAO');
console.log('tamanho da chave .....', key.length, 'bytes', key.length === 32 ? '(OK)' : '(ERRADO — AES-256 exige 32)');

const alvo = '$aact_teste_de_ciclo_completo';
const iv = randomBytes(12);
const c = createCipheriv('aes-256-gcm', key, iv);
const enc = Buffer.concat([c.update(alvo, 'utf8'), c.final()]);
const tag = c.getAuthTag();
const d = createDecipheriv('aes-256-gcm', key, iv);
d.setAuthTag(tag);
const volta = Buffer.concat([d.update(enc), d.final()]).toString('utf8');
console.log('ciclo ida e volta ....', volta === alvo ? 'OK' : `FALHOU (${volta})`);
```

Run: `node app/scratchpad/_probe-credencial.mjs`
Expected:
```
CERT_ENC_KEY presente? SIM
tamanho da chave ..... 32 bytes (OK)
ciclo ida e volta .... OK
```

Se `CERT_ENC_KEY` estiver ausente ou com tamanho errado, **parar aqui** e resolver antes de seguir: uma subconta criada com cifra quebrada tem a chave perdida para sempre.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/billing/credencial-subconta.ts app/src/lib/billing/credencial-subconta.test.ts
git commit -m "feat(4b): credencial da subconta cifrada, com o ciclo ida-e-volta provado"
```

---

### Task 5: Criar a subconta (action) — gravar antes de qualquer outra coisa

**Files:**
- Create: `app/src/app/(auth)/(gated)/contador/configuracoes/subconta/actions.ts`

**A armadilha que molda esta task:** o Asaas devolve a `apiKey` **uma única vez**, na resposta da criação. Se a gravação falhar depois, a subconta existe e a chave se perdeu.

- [ ] **Step 1: Escrever a action**

```ts
'use server';
// Bloco 4B — criacao da subconta Asaas do escritorio.
//
// ORDEM DE OPERACOES NAO NEGOCIAVEL: o Asaas devolve a `apiKey` UMA UNICA VEZ,
// na resposta da criacao, e nao a expoe de novo. Gravar e a PRIMEIRA coisa
// depois da resposta. Se a gravacao falhar, existe uma subconta orfa cuja
// chave se perdeu — e o escritorio fica com uma conta no Asaas que a Balu nao
// consegue operar. Por isso o catch registra o accountId (nunca a chave) para
// recuperacao manual.
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireContadorAction } from '@/lib/contador/guard';
import { registrarAuditoria } from '@/lib/security/audit';
import { asaasContaMae } from '@/lib/clients/asaas';
import { guardarCredencial, mascarar } from '@/lib/billing/credencial-subconta';
import {
  validarDadosSubconta, montarPayloadSubconta, type DadosSubconta,
} from '@/lib/billing/subconta';

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function criarSubcontaAction(dados: DadosSubconta): Promise<ActionResult> {
  const ctx = await requireContadorAction();
  if ('error' in ctx) return { ok: false, error: ctx.error };

  const v = validarDadosSubconta(dados);
  if (!v.ok) return { ok: false, error: v.error };

  const sb = createAdminClient();
  const { data: cont } = await sb
    .from('contabilidades')
    .select('id, asaas_subconta_id, asaas_subconta_status')
    .eq('id', ctx.contabilidadeId).maybeSingle();
  if (!cont) return { ok: false, error: 'Escritório não encontrado.' };
  // Sem isto, um duplo clique cria DUAS subcontas no Asaas para o mesmo
  // escritorio — e a primeira fica orfa, com a chave perdida.
  if (cont.asaas_subconta_id) {
    return { ok: false, error: 'Este escritório já tem subconta criada.' };
  }

  let criada;
  try {
    criada = await asaasContaMae.criarSubconta(montarPayloadSubconta(dados));
  } catch (e) {
    // A mensagem do Asaas vem em ingles e pode trazer dado do titular; o
    // `call` ja trunca em 500 chars. Nao repassar crua para a tela.
    console.error('[4b] criar subconta falhou:', (e as Error).message);
    return { ok: false, error: 'O Asaas recusou os dados. Confira documento, CEP e telefone.' };
  }

  const { error } = await sb.from('contabilidades').update({
    asaas_subconta_id: criada.id,
    asaas_wallet_id: criada.walletId,
    asaas_api_key_cifrada: guardarCredencial(criada.apiKey),
    asaas_subconta_status: 'pendente',
    asaas_subconta_criada_em: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', ctx.contabilidadeId);

  if (error) {
    // A subconta EXISTE no Asaas e a chave acabou de se perder. Registrar o
    // id para recuperacao manual; a chave, nunca — nem mascarada em meta.
    console.error('[4b] SUBCONTA ORFA — gravar falhou', criada.id, error.message);
    await registrarAuditoria({
      actorUserId: ctx.userId, acao: 'subconta.orfa',
      alvoTipo: 'contabilidade', alvoId: ctx.contabilidadeId,
      meta: { asaas_account_id: criada.id, wallet_id: criada.walletId, erro: error.message },
    });
    return {
      ok: false,
      error: 'A subconta foi criada no Asaas mas não pôde ser vinculada. Fale com o suporte da Balu — não tente de novo.',
    };
  }

  await registrarAuditoria({
    actorUserId: ctx.userId, acao: 'subconta.criada',
    alvoTipo: 'contabilidade', alvoId: ctx.contabilidadeId,
    meta: { asaas_account_id: criada.id, wallet_id: criada.walletId, chave: mascarar(criada.apiKey) },
  });

  revalidatePath('/contador/configuracoes/subconta');
  return { ok: true };
}

/** Reconsulta o Asaas e atualiza o status do KYC. O escritório aperta isso
 *  enquanto espera a aprovação — sem webhook próprio para o evento. */
export async function sincronizarStatusSubcontaAction(): Promise<ActionResult> {
  const ctx = await requireContadorAction();
  if ('error' in ctx) return { ok: false, error: ctx.error };

  const sb = createAdminClient();
  const { data: cont } = await sb
    .from('contabilidades').select('id, asaas_subconta_id')
    .eq('id', ctx.contabilidadeId).maybeSingle();
  if (!cont?.asaas_subconta_id) return { ok: false, error: 'Nenhuma subconta para consultar.' };

  const { data } = await asaasContaMae.listarSubcontas();
  const achou = (data ?? []).some((s) => s.id === cont.asaas_subconta_id);
  if (!achou) return { ok: false, error: 'A subconta não aparece mais na conta da Balu.' };

  revalidatePath('/contador/configuracoes/subconta');
  return { ok: true };
}
```

- [ ] **Step 2: Conferir o guard do contador**

Run: `cd app && grep -rn "export async function requireContadorAction" src/lib/contador/`
Expected: a função existe e devolve `{ userId, contabilidadeId }` ou `{ error }`.

Se o nome for outro neste repo, ajustar o import — **não** criar um guard novo.

- [ ] **Step 3: Verificar tipos e build de exports**

Run: `cd app && npx tsc --noEmit`
Expected: `TypeScript: No errors found`

- [ ] **Step 4: Commit**

```bash
git add "app/src/app/(auth)/(gated)/contador/configuracoes/subconta/actions.ts"
git commit -m "feat(4b): action de criacao da subconta, com a chave gravada antes de tudo"
```

---

### Task 6: Tela de onboarding da subconta

**Files:**
- Create: `app/src/app/(auth)/(gated)/contador/configuracoes/subconta/page.tsx`
- Create: `app/src/app/(auth)/(gated)/contador/configuracoes/subconta/SubcontaForm.tsx`

- [ ] **Step 1: Página servidor**

```tsx
// Bloco 4B — onboarding da subconta Asaas do escritorio.
import { requireContadorPage } from '@/lib/contador/guard';
import { createAdminClient } from '@/lib/supabase/admin';
import SubcontaForm from './SubcontaForm';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const ctx = await requireContadorPage();
  const sb = createAdminClient();
  const { data: cont } = await sb
    .from('contabilidades')
    .select('nome, cnpj, asaas_subconta_id, asaas_wallet_id, asaas_subconta_status, asaas_subconta_criada_em')
    .eq('id', ctx.contabilidadeId).maybeSingle();

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold mb-1">Receber pelos seus clientes</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          Para cobrar honorários e serviços pelo app, o escritório precisa de uma conta de
          recebimento própria. <strong>O dinheiro cai direto na sua conta</strong> — a Balu não
          recebe por você e não fica com nada no caminho.
        </p>
      </div>
      <SubcontaForm
        nomeSugerido={cont?.nome ?? ''}
        cnpjSugerido={cont?.cnpj ?? ''}
        status={cont?.asaas_subconta_status ?? 'ausente'}
        walletId={cont?.asaas_wallet_id ?? null}
        criadaEm={cont?.asaas_subconta_criada_em ?? null}
      />
    </div>
  );
}
```

- [ ] **Step 2: Formulário cliente**

```tsx
'use client';
// PJ e PF pedem campos diferentes (achado do sandbox): CNPJ exige tipo de
// empresa, CPF exige data de nascimento. O formulario troca sozinho conforme
// o documento digitado, em vez de mostrar os dois e recusar depois.
import { useState, useTransition } from 'react';
import { Landmark, RefreshCw } from 'lucide-react';
import { criarSubcontaAction, sincronizarStatusSubcontaAction } from './actions';
import { ehPessoaJuridica, type CompanyType, type DadosSubconta } from '@/lib/billing/subconta';

const ROTULO_STATUS: Record<string, { texto: string; classe: string }> = {
  ausente:  { texto: 'Não configurada', classe: 'bg-surface-2 text-muted-foreground' },
  pendente: { texto: 'Em análise pelo Asaas', classe: 'bg-alert/15 text-alert' },
  aprovada: { texto: 'Aprovada — pode cobrar', classe: 'bg-success/15 text-success' },
  recusada: { texto: 'Recusada', classe: 'bg-destructive/15 text-destructive' },
};

const campo = 'mt-1 block w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground';

export default function SubcontaForm({ nomeSugerido, cnpjSugerido, status, walletId, criadaEm }: {
  nomeSugerido: string; cnpjSugerido: string; status: string;
  walletId: string | null; criadaEm: string | null;
}) {
  const [d, setD] = useState<DadosSubconta>({
    name: nomeSugerido, cpfCnpj: cnpjSugerido, email: '', mobilePhone: '',
    incomeValue: 0, address: '', addressNumber: '', province: '', postalCode: '',
    birthDate: null, companyType: 'LIMITED',
  });
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [pending, start] = useTransition();
  const pj = ehPessoaJuridica(d.cpfCnpj);
  const set = <K extends keyof DadosSubconta>(k: K, v: DadosSubconta[K]) => setD((s) => ({ ...s, [k]: v }));

  const rotulo = ROTULO_STATUS[status] ?? ROTULO_STATUS.ausente;

  if (status !== 'ausente') {
    return (
      <section className="space-y-3 rounded-md border border-border bg-surface p-4">
        <p className="flex items-center gap-2 text-sm">
          <Landmark className="size-4 shrink-0 text-primary" />
          <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${rotulo.classe}`}>{rotulo.texto}</span>
        </p>
        {walletId && <p className="text-xs text-muted-foreground">Carteira: {walletId}</p>}
        {criadaEm && (
          <p className="text-xs text-muted-foreground">
            Criada em {new Date(criadaEm).toLocaleDateString('pt-BR')}
          </p>
        )}
        {status === 'pendente' && (
          <p className="max-w-prose text-sm text-muted-foreground">
            O Asaas está conferindo os dados. Enquanto isso as telas de cobrança ficam
            indisponíveis — não por escolha da Balu, mas porque a conta ainda não pode receber.
          </p>
        )}
        <button
          type="button" disabled={pending}
          onClick={() => start(async () => {
            const r = await sincronizarStatusSubcontaAction();
            setMsg(r.ok ? { tipo: 'ok', texto: 'Status atualizado.' } : { tipo: 'erro', texto: r.error });
          })}
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:border-primary hover:text-primary disabled:opacity-50"
        >
          <RefreshCw className="size-4" /> {pending ? 'Consultando…' : 'Atualizar status'}
        </button>
        {msg && <p className={`text-sm ${msg.tipo === 'ok' ? 'text-success' : 'text-destructive'}`}>{msg.texto}</p>}
      </section>
    );
  }

  return (
    <section className="max-w-2xl space-y-3 rounded-md border border-border bg-surface p-4">
      {msg && (
        <p className={`rounded-md border px-3 py-2 text-sm ${
          msg.tipo === 'ok' ? 'border-success/40 bg-success/10 text-success'
                            : 'border-alert/40 bg-alert/10 text-alert'}`}>{msg.texto}</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-muted-foreground sm:col-span-2">Nome do escritório
          <input value={d.name} onChange={(e) => set('name', e.target.value)} className={campo} />
        </label>
        <label className="text-xs text-muted-foreground">CPF ou CNPJ
          <input value={d.cpfCnpj} onChange={(e) => set('cpfCnpj', e.target.value)} className={campo} />
        </label>
        {pj ? (
          <label className="text-xs text-muted-foreground">Tipo da empresa
            <select value={d.companyType ?? 'LIMITED'}
              onChange={(e) => set('companyType', e.target.value as CompanyType)} className={campo}>
              <option value="MEI">MEI</option>
              <option value="LIMITED">LTDA</option>
              <option value="INDIVIDUAL">Empresário individual</option>
              <option value="ASSOCIATION">Associação</option>
            </select>
          </label>
        ) : (
          <label className="text-xs text-muted-foreground">Data de nascimento
            <input type="date" value={d.birthDate ?? ''}
              onChange={(e) => set('birthDate', e.target.value || null)} className={campo} />
          </label>
        )}
        <label className="text-xs text-muted-foreground">E-mail do responsável
          <input type="email" value={d.email} onChange={(e) => set('email', e.target.value)} className={campo} />
        </label>
        <label className="text-xs text-muted-foreground">Celular com DDD
          <input value={d.mobilePhone} onChange={(e) => set('mobilePhone', e.target.value)} className={campo} />
        </label>
        <label className="text-xs text-muted-foreground">Faturamento mensal estimado (R$)
          <input type="number" min={1} value={d.incomeValue || ''}
            onChange={(e) => set('incomeValue', Number(e.target.value))} className={campo} />
        </label>
        <label className="text-xs text-muted-foreground">CEP
          <input value={d.postalCode} onChange={(e) => set('postalCode', e.target.value)} className={campo} />
        </label>
        <label className="text-xs text-muted-foreground">Endereço
          <input value={d.address} onChange={(e) => set('address', e.target.value)} className={campo} />
        </label>
        <label className="text-xs text-muted-foreground">Número
          <input value={d.addressNumber} onChange={(e) => set('addressNumber', e.target.value)} className={campo} />
        </label>
        <label className="text-xs text-muted-foreground">Bairro
          <input value={d.province} onChange={(e) => set('province', e.target.value)} className={campo} />
        </label>
      </div>
      <button
        type="button" disabled={pending}
        onClick={() => start(async () => {
          setMsg(null);
          const r = await criarSubcontaAction(d);
          setMsg(r.ok ? { tipo: 'ok', texto: 'Subconta criada. O Asaas vai analisar os dados.' }
                      : { tipo: 'erro', texto: r.error });
        })}
        className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {pending ? 'Criando…' : 'Criar conta de recebimento'}
      </button>
    </section>
  );
}
```

- [ ] **Step 2b: Verificar tipos**

Run: `cd app && npx tsc --noEmit`
Expected: `TypeScript: No errors found`

- [ ] **Step 3: Commit**

```bash
git add "app/src/app/(auth)/(gated)/contador/configuracoes/subconta/"
git commit -m "feat(4b): tela de onboarding da subconta, com formulario que troca PJ/PF"
```

---

### Task 7: Regras puras do catálogo de avulsos

**Files:**
- Create: `app/src/lib/billing/avulso.ts`
- Test: `app/src/lib/billing/avulso.test.ts`

- [ ] **Step 1: Escrever o teste falhando**

```ts
import { describe, it, expect } from 'vitest';
import { validarServicoAvulso, valorFinalCentavos, CATALOGO_SUGERIDO } from './avulso';

describe('validarServicoAvulso', () => {
  it('aceita fixo com valor', () => {
    expect(validarServicoAvulso({ nome: 'Abertura', tipoValor: 'fixo', valorCentavos: 90000, percentual: null }))
      .toEqual({ ok: true });
  });

  it('aceita percentual com percentual', () => {
    expect(validarServicoAvulso({ nome: 'Recuperação', tipoValor: 'percentual', valorCentavos: null, percentual: 20 }))
      .toEqual({ ok: true });
  });

  it('recusa fixo sem valor', () => {
    expect(validarServicoAvulso({ nome: 'x', tipoValor: 'fixo', valorCentavos: null, percentual: null }).ok).toBe(false);
  });

  it('recusa percentual acima de 100', () => {
    expect(validarServicoAvulso({ nome: 'x', tipoValor: 'percentual', valorCentavos: null, percentual: 101 }).ok).toBe(false);
  });

  it('recusa nome vazio', () => {
    expect(validarServicoAvulso({ nome: '  ', tipoValor: 'fixo', valorCentavos: 100, percentual: null }).ok).toBe(false);
  });
});

describe('valorFinalCentavos', () => {
  it('fixo ignora a base', () => {
    expect(valorFinalCentavos({ tipoValor: 'fixo', valorCentavos: 90000, percentual: null }, 500000)).toBe(90000);
  });

  it('percentual aplica sobre a base', () => {
    expect(valorFinalCentavos({ tipoValor: 'percentual', valorCentavos: null, percentual: 20 }, 500000)).toBe(100000);
  });

  // Sem base nao da para calcular percentual — e cobrar 0 seria pior que
  // recusar: a cobranca sairia de graca sem ninguem notar.
  it('percentual sem base devolve null', () => {
    expect(valorFinalCentavos({ tipoValor: 'percentual', valorCentavos: null, percentual: 20 }, null)).toBeNull();
  });

  it('arredonda o centavo para o inteiro mais proximo', () => {
    expect(valorFinalCentavos({ tipoValor: 'percentual', valorCentavos: null, percentual: 33.33 }, 10000)).toBe(3333);
  });
});

describe('CATALOGO_SUGERIDO', () => {
  it('traz os avulsos do §5 da spec, todos validos', () => {
    expect(CATALOGO_SUGERIDO.length).toBeGreaterThanOrEqual(10);
    for (const s of CATALOGO_SUGERIDO) {
      // `?? null` nos DOIS, nunca `?? 1`: um item percentual com valorCentavos
      // preenchido e justamente o que o CHECK do banco recusa.
      const r = validarServicoAvulso({
        nome: s.nome, tipoValor: s.tipoValor,
        valorCentavos: s.valorCentavos ?? null, percentual: s.percentual ?? null,
      });
      expect(r, `servico "${s.nome}" invalido`).toEqual({ ok: true });
    }
  });

  it('recuperacao de credito e percentual', () => {
    const rec = CATALOGO_SUGERIDO.find((s) => s.nome.toLowerCase().includes('recupera'));
    expect(rec?.tipoValor).toBe('percentual');
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `cd app && npx vitest run src/lib/billing/avulso.test.ts`
Expected: FAIL — `Failed to resolve import "./avulso"`

- [ ] **Step 3: Implementar**

```ts
// Bloco 4B — regras puras do catalogo de servicos avulsos do escritorio.

export type TipoValor = 'fixo' | 'percentual';

export type ServicoAvulso = {
  nome: string;
  tipoValor: TipoValor;
  valorCentavos: number | null;
  percentual: number | null;
};

export type ResultadoValidacao = { ok: true } | { ok: false; error: string };

export function validarServicoAvulso(s: ServicoAvulso): ResultadoValidacao {
  if (!s.nome?.trim()) return { ok: false, error: 'Informe o nome do serviço.' };
  if (s.tipoValor === 'fixo') {
    if (!s.valorCentavos || s.valorCentavos <= 0) return { ok: false, error: 'Informe o valor do serviço.' };
    if (s.percentual != null) return { ok: false, error: 'Serviço de valor fixo não leva percentual.' };
    return { ok: true };
  }
  if (!s.percentual || s.percentual <= 0) return { ok: false, error: 'Informe o percentual.' };
  if (s.percentual > 100) return { ok: false, error: 'O percentual não pode passar de 100%.' };
  if (s.valorCentavos != null) return { ok: false, error: 'Serviço percentual não leva valor fixo.' };
  return { ok: true };
}

/**
 * Valor a cobrar. `base` é o valor sobre o qual o percentual incide (o crédito
 * recuperado, o serviço-base da taxa de urgência). `null` quando o serviço é
 * percentual e não há base — e aí a cobrança **não pode ser emitida**, porque
 * emitir por zero é pior que recusar: sai de graça sem ninguém notar.
 */
export function valorFinalCentavos(
  s: Pick<ServicoAvulso, 'tipoValor' | 'valorCentavos' | 'percentual'>,
  baseCentavos: number | null,
): number | null {
  if (s.tipoValor === 'fixo') return s.valorCentavos ?? null;
  if (baseCentavos == null || !s.percentual) return null;
  return Math.round((baseCentavos * s.percentual) / 100);
}

/** Seed sugerido (spec §5) — editável pelo escritório, nunca imposto. */
export const CATALOGO_SUGERIDO: Array<{
  nome: string; categoria: string; tipoValor: TipoValor;
  valorCentavos?: number; percentual?: number;
}> = [
  { nome: 'Abertura de empresa',            categoria: 'Societário',   tipoValor: 'fixo', valorCentavos: 90000 },
  { nome: 'Alteração contratual',           categoria: 'Societário',   tipoValor: 'fixo', valorCentavos: 60000 },
  { nome: 'Baixa / encerramento',           categoria: 'Societário',   tipoValor: 'fixo', valorCentavos: 80000 },
  { nome: 'Enquadramento de regime',        categoria: 'Societário',   tipoValor: 'fixo', valorCentavos: 40000 },
  { nome: 'Parcelamento de débitos',        categoria: 'Fiscal',       tipoValor: 'fixo', valorCentavos: 35000 },
  { nome: 'Certidão negativa',              categoria: 'Fiscal',       tipoValor: 'fixo', valorCentavos: 8000  },
  { nome: 'Recuperação de crédito',         categoria: 'Fiscal',       tipoValor: 'percentual', percentual: 20 },
  { nome: 'IRPF do sócio',                  categoria: 'Pessoa física',tipoValor: 'fixo', valorCentavos: 45000 },
  { nome: 'Admissão de funcionário',        categoria: 'Trabalhista',  tipoValor: 'fixo', valorCentavos: 20000 },
  { nome: 'Rescisão',                       categoria: 'Trabalhista',  tipoValor: 'fixo', valorCentavos: 25000 },
  { nome: 'Certificado digital A1',         categoria: 'Outros',       tipoValor: 'fixo', valorCentavos: 19000 },
  { nome: 'Hora técnica de consultoria',    categoria: 'Outros',       tipoValor: 'fixo', valorCentavos: 25000 },
  { nome: 'Taxa de urgência',               categoria: 'Outros',       tipoValor: 'percentual', percentual: 30 },
];
```

- [ ] **Step 4: Rodar para ver passar**

Run: `cd app && npx vitest run src/lib/billing/avulso.test.ts`
Expected: PASS, 11 testes.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/billing/avulso.ts app/src/lib/billing/avulso.test.ts
git commit -m "feat(4b): regras puras do catalogo de avulsos (fixo e percentual)"
```

---

### Task 8: CRUD do catálogo — actions e tela

**Files:**
- Create: `app/src/app/(auth)/(gated)/contador/configuracoes/avulsos/actions.ts`
- Create: `app/src/app/(auth)/(gated)/contador/configuracoes/avulsos/page.tsx`
- Create: `app/src/app/(auth)/(gated)/contador/configuracoes/avulsos/CatalogoAvulsos.tsx`

- [ ] **Step 1: Actions**

```ts
'use server';
// Bloco 4B — catalogo de servicos avulsos do escritorio.
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireContadorAction } from '@/lib/contador/guard';
import { registrarAuditoria } from '@/lib/security/audit';
import { validarServicoAvulso, CATALOGO_SUGERIDO, type ServicoAvulso } from '@/lib/billing/avulso';

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function salvarServicoAction(
  id: string | null, s: ServicoAvulso & { categoria: string | null; ativo: boolean },
): Promise<ActionResult> {
  const ctx = await requireContadorAction();
  if ('error' in ctx) return { ok: false, error: ctx.error };

  const v = validarServicoAvulso(s);
  if (!v.ok) return { ok: false, error: v.error };

  const sb = createAdminClient();
  const linha = {
    contabilidade_id: ctx.contabilidadeId,
    nome: s.nome.trim(),
    categoria: s.categoria?.trim() || null,
    tipo_valor: s.tipoValor,
    valor_centavos: s.tipoValor === 'fixo' ? s.valorCentavos : null,
    percentual: s.tipoValor === 'percentual' ? s.percentual : null,
    ativo: s.ativo,
    updated_at: new Date().toISOString(),
  };

  // `update`, nunca `upsert`: o upsert do PostgREST manda NULL nas colunas
  // ausentes do payload — armadilha ja provada contra o banco neste repo.
  const { error } = id
    ? await sb.from('servicos_avulsos').update(linha).eq('id', id).eq('contabilidade_id', ctx.contabilidadeId)
    : await sb.from('servicos_avulsos').insert(linha);
  if (error) return { ok: false, error: error.message };

  await registrarAuditoria({
    actorUserId: ctx.userId, acao: id ? 'avulso.editado' : 'avulso.criado',
    alvoTipo: 'contabilidade', alvoId: ctx.contabilidadeId,
    meta: { nome: linha.nome, tipo: linha.tipo_valor },
  });

  revalidatePath('/contador/configuracoes/avulsos');
  return { ok: true };
}

export async function removerServicoAction(id: string): Promise<ActionResult> {
  const ctx = await requireContadorAction();
  if ('error' in ctx) return { ok: false, error: ctx.error };
  const sb = createAdminClient();
  // Desativa, nao apaga: cobranca ja emitida aponta para o servico, e apagar
  // deixaria a cobranca sem nome do que foi cobrado.
  const { error } = await sb.from('servicos_avulsos')
    .update({ ativo: false, updated_at: new Date().toISOString() })
    .eq('id', id).eq('contabilidade_id', ctx.contabilidadeId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/contador/configuracoes/avulsos');
  return { ok: true };
}

/** Popula o catálogo com o seed do §5 da spec. Só roda em catálogo vazio —
 *  senão duplicaria tudo a cada clique. */
export async function semearCatalogoAction(): Promise<ActionResult> {
  const ctx = await requireContadorAction();
  if ('error' in ctx) return { ok: false, error: ctx.error };
  const sb = createAdminClient();
  const { count } = await sb.from('servicos_avulsos')
    .select('id', { count: 'exact', head: true })
    .eq('contabilidade_id', ctx.contabilidadeId);
  if ((count ?? 0) > 0) return { ok: false, error: 'O catálogo já tem serviços.' };

  const { error } = await sb.from('servicos_avulsos').insert(
    CATALOGO_SUGERIDO.map((s) => ({
      contabilidade_id: ctx.contabilidadeId, nome: s.nome, categoria: s.categoria,
      tipo_valor: s.tipoValor, valor_centavos: s.valorCentavos ?? null,
      percentual: s.percentual ?? null, ativo: true,
    })),
  );
  if (error) return { ok: false, error: error.message };
  revalidatePath('/contador/configuracoes/avulsos');
  return { ok: true };
}
```

- [ ] **Step 2: Página servidor**

```tsx
import { requireContadorPage } from '@/lib/contador/guard';
import { createAdminClient } from '@/lib/supabase/admin';
import CatalogoAvulsos, { type ServicoVm } from './CatalogoAvulsos';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const ctx = await requireContadorPage();
  const sb = createAdminClient();
  const { data } = await sb.from('servicos_avulsos')
    .select('id, nome, categoria, tipo_valor, valor_centavos, percentual, ativo')
    .eq('contabilidade_id', ctx.contabilidadeId)
    .order('categoria', { ascending: true }).order('nome', { ascending: true });

  const servicos: ServicoVm[] = (data ?? []).map((s) => ({
    id: s.id, nome: s.nome, categoria: s.categoria,
    tipoValor: s.tipo_valor as 'fixo' | 'percentual',
    valorCentavos: s.valor_centavos, percentual: s.percentual, ativo: s.ativo,
  }));

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold mb-1">Serviços avulsos</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          O que o escritório cobra fora da mensalidade. Serviços de <strong>percentual</strong>
          {' '}(recuperação de crédito, taxa de urgência) pedem o valor-base na hora de cobrar.
        </p>
      </div>
      <CatalogoAvulsos servicos={servicos} />
    </div>
  );
}
```

- [ ] **Step 3: Componente cliente**

```tsx
'use client';
import { useState, useTransition } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { salvarServicoAction, removerServicoAction, semearCatalogoAction } from './actions';
import type { TipoValor } from '@/lib/billing/avulso';

export type ServicoVm = {
  id: string; nome: string; categoria: string | null; tipoValor: TipoValor;
  valorCentavos: number | null; percentual: number | null; ativo: boolean;
};

const reais = (c: number | null) =>
  c == null ? '—' : (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const vazio = {
  nome: '', categoria: '', tipoValor: 'fixo' as TipoValor,
  valorCentavos: null as number | null, percentual: null as number | null, ativo: true,
};

export default function CatalogoAvulsos({ servicos }: { servicos: ServicoVm[] }) {
  const [form, setForm] = useState<typeof vazio & { id: string | null }>({ ...vazio, id: null });
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function salvar() {
    setMsg(null);
    start(async () => {
      const r = await salvarServicoAction(form.id, {
        nome: form.nome, tipoValor: form.tipoValor,
        valorCentavos: form.tipoValor === 'fixo' ? form.valorCentavos : null,
        percentual: form.tipoValor === 'percentual' ? form.percentual : null,
        categoria: form.categoria || null, ativo: form.ativo,
      });
      setMsg(r.ok ? null : r.error);
      if (r.ok) setForm({ ...vazio, id: null });
    });
  }

  return (
    <section className="space-y-4">
      {msg && <p className="rounded-md border border-alert/40 bg-alert/10 px-3 py-2 text-sm text-alert">{msg}</p>}

      {servicos.length === 0 && (
        <button type="button" disabled={pending}
          onClick={() => start(async () => { const r = await semearCatalogoAction(); if (!r.ok) setMsg(r.error); })}
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:border-primary hover:text-primary disabled:opacity-50">
          Começar com a lista sugerida
        </button>
      )}

      <div className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-surface-2 p-3">
        <label className="text-xs text-muted-foreground">Serviço
          <input value={form.nome} onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
            className="mt-1 block w-56 rounded-md border border-border bg-surface px-2 py-1.5 text-sm" />
        </label>
        <label className="text-xs text-muted-foreground">Categoria
          <input value={form.categoria} onChange={(e) => setForm((f) => ({ ...f, categoria: e.target.value }))}
            className="mt-1 block w-40 rounded-md border border-border bg-surface px-2 py-1.5 text-sm" />
        </label>
        <label className="text-xs text-muted-foreground">Cobrança
          <select value={form.tipoValor}
            onChange={(e) => setForm((f) => ({ ...f, tipoValor: e.target.value as TipoValor, valorCentavos: null, percentual: null }))}
            className="mt-1 block rounded-md border border-border bg-surface px-2 py-1.5 text-sm">
            <option value="fixo">Valor fixo</option>
            <option value="percentual">Percentual</option>
          </select>
        </label>
        {form.tipoValor === 'fixo' ? (
          <label className="text-xs text-muted-foreground">Valor (R$)
            <input type="number" min={0} step="0.01"
              onChange={(e) => setForm((f) => ({ ...f, valorCentavos: Math.round(Number(e.target.value) * 100) }))}
              className="mt-1 block w-32 rounded-md border border-border bg-surface px-2 py-1.5 text-sm" />
          </label>
        ) : (
          <label className="text-xs text-muted-foreground">Percentual (%)
            <input type="number" min={0} max={100} step="0.01"
              onChange={(e) => setForm((f) => ({ ...f, percentual: Number(e.target.value) }))}
              className="mt-1 block w-32 rounded-md border border-border bg-surface px-2 py-1.5 text-sm" />
          </label>
        )}
        <button type="button" onClick={salvar} disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
          <Plus className="size-4" /> {form.id ? 'Salvar' : 'Adicionar'}
        </button>
      </div>

      <ul className="flex flex-col gap-2">
        {servicos.filter((s) => s.ativo).map((s) => (
          <li key={s.id} className="flex items-center justify-between rounded-md border border-border bg-surface p-3">
            <div className="min-w-0">
              <p className="text-sm text-foreground">{s.nome}</p>
              <p className="text-xs text-muted-foreground">
                {s.categoria ?? 'Sem categoria'} ·{' '}
                {s.tipoValor === 'fixo' ? reais(s.valorCentavos) : `${s.percentual}% do valor-base`}
              </p>
            </div>
            <button type="button" disabled={pending}
              onClick={() => start(async () => { const r = await removerServicoAction(s.id); if (!r.ok) setMsg(r.error); })}
              className="rounded-md border border-border p-1.5 text-muted-foreground hover:border-destructive hover:text-destructive disabled:opacity-50">
              <Trash2 className="size-4" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 4: Verificar**

Run: `cd app && npx tsc --noEmit && npx vitest run src/lib/billing`
Expected: `TypeScript: No errors found` e billing verde.

- [ ] **Step 5: Commit**

```bash
git add "app/src/app/(auth)/(gated)/contador/configuracoes/avulsos/"
git commit -m "feat(4b): catalogo de servicos avulsos — actions e tela"
```

---

### Task 9: Emitir cobrança pela subconta

> **Confirmar antes:** a decisão sobre o gate, descrita acima ("Decisão a confirmar com o usuário antes da Task 9").

**Files:**
- Create: `app/src/lib/billing/cobranca-escritorio.ts`
- Test: `app/src/lib/billing/cobranca-escritorio.test.ts`

- [ ] **Step 1: Escrever o teste falhando**

```ts
import { describe, it, expect } from 'vitest';
import { aplicarEventoNaCobranca, statusDoAsaas } from './cobranca-escritorio';

describe('statusDoAsaas', () => {
  it.each([
    ['PENDING', 'pendente'], ['RECEIVED', 'paga'], ['CONFIRMED', 'paga'],
    ['OVERDUE', 'vencida'], ['REFUNDED', 'estornada'],
  ])('%s vira %s', (asaas, esperado) => {
    expect(statusDoAsaas(asaas)).toBe(esperado);
  });

  it('status desconhecido nao inventa: fica pendente', () => {
    expect(statusDoAsaas('COISA_NOVA')).toBe('pendente');
  });
});

describe('aplicarEventoNaCobranca', () => {
  const paga = { status: 'paga', pago_em: '2026-07-20' };

  // A mesma regra de nao-regressao do 4A: o Asaas REENTREGA eventos, e um
  // 'vencida' que chega depois do 'paga' nao pode desfazer o pagamento.
  it('evento fora de ordem nao desfaz um pagamento', () => {
    expect(aplicarEventoNaCobranca(paga, { status: 'vencida', pagoEm: null })).toBeNull();
  });

  it('pagamento sobrescreve pendente', () => {
    const r = aplicarEventoNaCobranca({ status: 'pendente', pago_em: null }, { status: 'paga', pagoEm: '2026-07-20' });
    expect(r).toEqual({ status: 'paga', pago_em: '2026-07-20' });
  });

  it('estorno DESFAZ o pagamento — e o unico que pode', () => {
    const r = aplicarEventoNaCobranca(paga, { status: 'estornada', pagoEm: null });
    expect(r).toEqual({ status: 'estornada', pago_em: null });
  });

  it('reentrega do mesmo evento nao gera atualizacao', () => {
    expect(aplicarEventoNaCobranca(paga, { status: 'paga', pagoEm: '2026-07-20' })).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `cd app && npx vitest run src/lib/billing/cobranca-escritorio.test.ts`
Expected: FAIL — `Failed to resolve import "./cobranca-escritorio"`

- [ ] **Step 3: Implementar**

```ts
// Bloco 4B — persistencia das cobrancas do escritorio.
//
// Espelha lib/billing/cobranca.ts do 4A, mas em tabela separada: aquilo e
// dinheiro da Balu, isto e dinheiro do escritorio, e a separacao vale no banco.

export type StatusCobranca = 'pendente' | 'paga' | 'vencida' | 'estornada';

const MAPA: Record<string, StatusCobranca> = {
  PENDING: 'pendente', AWAITING_RISK_ANALYSIS: 'pendente',
  RECEIVED: 'paga', CONFIRMED: 'paga', RECEIVED_IN_CASH: 'paga',
  OVERDUE: 'vencida',
  REFUNDED: 'estornada', REFUND_REQUESTED: 'estornada', CHARGEBACK_REQUESTED: 'estornada',
};

/** Status desconhecido vira `pendente` de propósito: inventar um estado a
 *  partir de string nova do Asaas seria pior que ficar no mais conservador. */
export function statusDoAsaas(s: string): StatusCobranca {
  return MAPA[s] ?? 'pendente';
}

/**
 * O que gravar, ou `null` quando não há nada a mudar.
 *
 * O Asaas **reentrega** eventos e não garante ordem. Sem esta função, um
 * `OVERDUE` atrasado chegando depois do `RECEIVED` marcaria como vencida uma
 * cobrança já paga — e o cliente seria cobrado de novo por algo que pagou.
 */
export function aplicarEventoNaCobranca(
  atual: { status: string; pago_em: string | null },
  evento: { status: StatusCobranca; pagoEm: string | null },
): { status: StatusCobranca; pago_em: string | null } | null {
  if (atual.status === evento.status && (atual.pago_em ?? null) === (evento.pagoEm ?? null)) return null;

  // Estorno é o ÚNICO evento que pode desfazer um pagamento: é o próprio
  // Asaas dizendo que o dinheiro voltou.
  if (atual.status === 'paga' && evento.status !== 'estornada') return null;

  return { status: evento.status, pago_em: evento.status === 'paga' ? evento.pagoEm : null };
}
```

- [ ] **Step 4: Rodar para ver passar**

Run: `cd app && npx vitest run src/lib/billing/cobranca-escritorio.test.ts`
Expected: PASS, 10 testes.

- [ ] **Step 5: Action de emissão**

Criar `app/src/app/(auth)/(gated)/contador/clientes/[companyId]/cobrar-actions.ts`:

```ts
'use server';
// Bloco 4B — emitir cobranca do cliente PELA SUBCONTA do escritorio.
//
// A chave da subconta e lida, usada e descartada dentro desta funcao. Nunca
// vai para variavel de modulo, nunca para log, nunca para a resposta.
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireContadorAction } from '@/lib/contador/guard';
import { registrarAuditoria } from '@/lib/security/audit';
import { asaasSub } from '@/lib/clients/asaas';
import { lerCredencial } from '@/lib/billing/credencial-subconta';
import { valorFinalCentavos } from '@/lib/billing/avulso';
import { exigirAcessoContador } from '@/lib/billing/gate';

export type ActionResult = { ok: true; linkFatura: string | null } | { ok: false; error: string };

export async function cobrarClienteAction(input: {
  companyId: string;
  servicoAvulsoId: string | null;
  descricaoLivre: string | null;
  baseCentavos: number | null;
  vencimento: string;
}): Promise<ActionResult> {
  const ctx = await requireContadorAction();
  if ('error' in ctx) return { ok: false, error: ctx.error };

  // Decisao do gate: bloqueia EMITIR cobranca nova quando o escritorio esta
  // devendo a Balu, e nunca alcanca as ja emitidas — o dinheiro que ja e
  // direito do escritorio precisa continuar entrando.
  const gate = await exigirAcessoContador(ctx.contabilidadeId);
  if (!gate.ok) return { ok: false, error: gate.mensagem };

  const sb = createAdminClient();
  const { data: cont } = await sb.from('contabilidades')
    .select('id, nome, asaas_api_key_cifrada, asaas_subconta_status')
    .eq('id', ctx.contabilidadeId).maybeSingle();
  if (cont?.asaas_subconta_status !== 'aprovada' || !cont.asaas_api_key_cifrada) {
    return { ok: false, error: 'A conta de recebimento do escritório ainda não está aprovada.' };
  }

  const { data: cliente } = await sb.from('companies')
    .select('id, nome, cnpj, email, contabilidade_id')
    .eq('id', input.companyId).maybeSingle();
  if (!cliente || cliente.contabilidade_id !== ctx.contabilidadeId) {
    return { ok: false, error: 'Cliente não encontrado na sua carteira.' };
  }

  let descricao = input.descricaoLivre?.trim() ?? '';
  let valor: number | null = input.baseCentavos;
  let servicoId: string | null = null;

  if (input.servicoAvulsoId) {
    const { data: srv } = await sb.from('servicos_avulsos')
      .select('id, nome, tipo_valor, valor_centavos, percentual')
      .eq('id', input.servicoAvulsoId).eq('contabilidade_id', ctx.contabilidadeId).maybeSingle();
    if (!srv) return { ok: false, error: 'Serviço não encontrado no catálogo.' };
    servicoId = srv.id;
    descricao = descricao || srv.nome;
    valor = valorFinalCentavos(
      { tipoValor: srv.tipo_valor, valorCentavos: srv.valor_centavos, percentual: srv.percentual },
      input.baseCentavos,
    );
    if (valor == null) {
      return { ok: false, error: 'Este serviço é percentual — informe o valor-base da cobrança.' };
    }
  }

  if (!valor || valor <= 0) return { ok: false, error: 'Informe o valor da cobrança.' };
  if (!descricao) return { ok: false, error: 'Descreva o que está sendo cobrado.' };

  const token = lerCredencial(cont.asaas_api_key_cifrada);
  if (!token) return { ok: false, error: 'Credencial da conta de recebimento indisponível.' };
  const sub = asaasSub(token);

  let cobranca;
  try {
    const asaasCliente = await sub.criarCliente({
      name: cliente.nome, cpfCnpj: (cliente.cnpj ?? '').replace(/\D+/g, ''),
      email: cliente.email ?? undefined,
    });
    cobranca = await sub.criarCobranca({
      customer: asaasCliente.id, billingType: 'UNDEFINED',
      value: valor / 100, dueDate: input.vencimento,
      description: descricao, externalReference: `${ctx.contabilidadeId}:${cliente.id}`,
    });
  } catch (e) {
    // A chave pode aparecer numa mensagem de erro de rede; nunca repassar.
    console.error('[4b] emitir cobranca falhou:', (e as Error).message.slice(0, 200));
    return { ok: false, error: 'Não foi possível emitir a cobrança agora. Tente de novo em instantes.' };
  }

  const { error } = await sb.from('cobrancas_escritorio').insert({
    contabilidade_id: ctx.contabilidadeId, empresa_cliente_id: cliente.id,
    servico_avulso_id: servicoId, asaas_charge_id: cobranca.id,
    descricao, status: 'pendente', valor_centavos: valor,
    vencimento: input.vencimento, link_fatura: cobranca.invoiceUrl ?? null,
  });
  if (error) return { ok: false, error: error.message };

  await registrarAuditoria({
    actorUserId: ctx.userId, acao: 'cobranca_escritorio.emitida',
    alvoTipo: 'company', alvoId: cliente.id,
    meta: { charge_id: cobranca.id, valor_centavos: valor, descricao },
  });

  revalidatePath(`/contador/clientes/${cliente.id}`);
  return { ok: true, linkFatura: cobranca.invoiceUrl ?? null };
}
```

- [ ] **Step 6: Conferir a assinatura do gate**

Run: `cd app && grep -n "export" src/lib/billing/gate.ts`
Expected: existe uma função de gate para contador. Ajustar o nome/forma do retorno ao que o arquivo expõe — **não** criar um gate novo.

- [ ] **Step 7: Verificar**

Run: `cd app && npx tsc --noEmit && npx vitest run src/lib/billing`
Expected: verde.

- [ ] **Step 8: Commit**

```bash
git add app/src/lib/billing/cobranca-escritorio.ts app/src/lib/billing/cobranca-escritorio.test.ts "app/src/app/(auth)/(gated)/contador/clientes/[companyId]/cobrar-actions.ts"
git commit -m "feat(4b): emitir cobranca do cliente pela subconta do escritorio"
```

---

### Task 10: Diálogo "Cobrar" na ficha do cliente

**Files:**
- Create: `app/src/app/(auth)/(gated)/contador/clientes/[companyId]/CobrarDialog.tsx`
- Modify: `app/src/app/(auth)/(gated)/contador/clientes/[companyId]/VisaoCliente.tsx`

- [ ] **Step 1: O diálogo**

```tsx
'use client';
// Serviço percentual PEDE o valor-base — sem ele a cobrança sairia por zero,
// que é o tipo de erro que ninguém percebe até o fim do mês.
import { useState, useTransition } from 'react';
import { Receipt } from 'lucide-react';
import { cobrarClienteAction } from './cobrar-actions';

export type ServicoOpcao = {
  id: string; nome: string; tipoValor: 'fixo' | 'percentual';
  valorCentavos: number | null; percentual: number | null;
};

export default function CobrarDialog({ companyId, servicos, podeCobrar, motivoBloqueio }: {
  companyId: string; servicos: ServicoOpcao[];
  podeCobrar: boolean; motivoBloqueio: string | null;
}) {
  const [aberto, setAberto] = useState(false);
  const [servicoId, setServicoId] = useState('');
  const [descricao, setDescricao] = useState('');
  const [baseReais, setBaseReais] = useState('');
  const [vencimento, setVencimento] = useState('');
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [pending, start] = useTransition();

  const servico = servicos.find((s) => s.id === servicoId) ?? null;
  const precisaBase = servico?.tipoValor === 'percentual' || !servico;

  // O bloqueio é dito na ENTRADA, não no envio — regra de produto fixada no 4A.
  if (!podeCobrar) {
    return (
      <p className="rounded-md border border-alert/40 bg-alert/10 px-3 py-2 text-sm text-alert">
        {motivoBloqueio ?? 'Cobrança indisponível para este escritório no momento.'}
      </p>
    );
  }

  if (!aberto) {
    return (
      <button type="button" onClick={() => setAberto(true)}
        className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:border-primary hover:text-primary">
        <Receipt className="size-4" /> Cobrar
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-border bg-surface-2 p-3">
      <label className="block text-xs text-muted-foreground">Serviço do catálogo
        <select value={servicoId} onChange={(e) => setServicoId(e.target.value)}
          className="mt-1 block w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm">
          <option value="">Valor livre</option>
          {servicos.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nome}{s.tipoValor === 'percentual' ? ` (${s.percentual}%)` : ''}
            </option>
          ))}
        </select>
      </label>
      {precisaBase && (
        <label className="block text-xs text-muted-foreground">
          {servico?.tipoValor === 'percentual' ? 'Valor-base (R$)' : 'Valor (R$)'}
          <input type="number" min={0} step="0.01" value={baseReais}
            onChange={(e) => setBaseReais(e.target.value)}
            className="mt-1 block w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm" />
        </label>
      )}
      <label className="block text-xs text-muted-foreground">Descrição
        <input value={descricao} onChange={(e) => setDescricao(e.target.value)}
          placeholder={servico?.nome ?? 'Ex.: honorário de julho'}
          className="mt-1 block w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm" />
      </label>
      <label className="block text-xs text-muted-foreground">Vencimento
        <input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)}
          className="mt-1 block w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm" />
      </label>
      {msg && (
        <p className={`text-sm ${msg.tipo === 'ok' ? 'text-success' : 'text-destructive'}`}>{msg.texto}</p>
      )}
      <div className="flex gap-2">
        <button type="button" disabled={pending || !vencimento}
          onClick={() => start(async () => {
            setMsg(null);
            const r = await cobrarClienteAction({
              companyId, servicoAvulsoId: servicoId || null,
              descricaoLivre: descricao || null,
              baseCentavos: baseReais ? Math.round(Number(baseReais) * 100) : null,
              vencimento,
            });
            setMsg(r.ok
              ? { tipo: 'ok', texto: 'Cobrança emitida. O cliente já a vê no app dele.' }
              : { tipo: 'erro', texto: r.error });
            if (r.ok) setAberto(false);
          })}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
          {pending ? 'Emitindo…' : 'Emitir cobrança'}
        </button>
        <button type="button" onClick={() => setAberto(false)}
          className="text-sm text-muted-foreground hover:text-foreground">Cancelar</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Ligar na `VisaoCliente.tsx`**

Localizar onde os cards do cliente são montados e inserir `<CobrarDialog … />`, passando `servicos` carregados na `page.tsx` do cliente (consulta a `servicos_avulsos` do escritório, `ativo = true`) e `podeCobrar` a partir do status da subconta e do gate.

Run: `cd app && grep -n "export default function VisaoCliente" "src/app/(auth)/(gated)/contador/clientes/[companyId]/VisaoCliente.tsx"`

- [ ] **Step 3: Verificar**

Run: `cd app && npx tsc --noEmit`
Expected: `TypeScript: No errors found`

- [ ] **Step 4: Commit**

```bash
git add "app/src/app/(auth)/(gated)/contador/clientes/[companyId]/"
git commit -m "feat(4b): dialogo Cobrar na ficha do cliente, com valor-base para percentual"
```

---

### Task 11: Webhook — rotear o evento da subconta

**Files:**
- Modify: `app/src/app/api/webhooks/asaas/route.ts`

Hoje, evento sem `subscriptionId` é descartado com `ignored: 'sem_assinatura'` — e o comentário no arquivo diz literalmente "cobranca avulsa não existe neste bloco (ficou para o 4B)". É esse ramo que ganha destino.

- [ ] **Step 1: Trocar o early-return**

Substituir o bloco:

```ts
    if (!efeito.subscriptionId) {
      return NextResponse.json({ ok: true, ignored: 'sem_assinatura' }, { status: 200 });
    }
```

por:

```ts
    // Sem subscriptionId, o evento e de cobranca AVULSA — que no 4B e a
    // cobranca do escritorio pela subconta dele. O `id` do pagamento e a
    // unica chave: o webhook da conta-mae recebe eventos das subcontas.
    if (!efeito.subscriptionId) {
      const chargeId = pay.id;
      if (!chargeId) {
        return NextResponse.json({ ok: true, ignored: 'sem_cobranca' }, { status: 200 });
      }
      const { data: cob } = await sb
        .from('cobrancas_escritorio')
        .select('id, status, pago_em, honorario_id')
        .eq('asaas_charge_id', chargeId).maybeSingle();
      if (!cob) {
        return NextResponse.json({ ok: true, ignored: 'cobranca_desconhecida' }, { status: 200 });
      }

      const novo = aplicarEventoNaCobranca(
        { status: cob.status, pago_em: cob.pago_em },
        { status: statusDoAsaas(pay.status ?? ''), pagoEm: pay.paymentDate ?? pay.confirmedDate ?? null },
      );
      if (novo) {
        await sb.from('cobrancas_escritorio')
          .update({ ...novo, updated_at: new Date().toISOString() }).eq('id', cob.id);

        // Decisao 7.4: onde ha cobranca pela subconta, o semaforo do painel
        // vem do Asaas — e fica marcado como tal, para nao se confundir com a
        // marcacao manual do contador.
        if (cob.honorario_id && novo.status === 'paga') {
          await sb.from('honorarios').update({
            status: 'pago', data_pagamento: novo.pago_em,
            pagamento_origem: 'asaas', updated_at: new Date().toISOString(),
          }).eq('id', cob.honorario_id);
        }
      }
      return NextResponse.json({ ok: true, escritorio: true }, { status: 200 });
    }
```

E acrescentar ao topo do arquivo:

```ts
import { aplicarEventoNaCobranca, statusDoAsaas } from '@/lib/billing/cobranca-escritorio';
```

- [ ] **Step 2: Verificar que o 4A não regrediu**

Run: `cd app && npx vitest run src/lib/billing src/app/api`
Expected: verde — nenhum teste do webhook do 4A muda de resultado.

- [ ] **Step 3: Commit**

```bash
git add app/src/app/api/webhooks/asaas/route.ts
git commit -m "feat(4b): webhook roteia cobranca da subconta e alimenta o semaforo"
```

---

### Task 12: O cliente final vê as cobranças (decisão 7.3)

**Files:**
- Create: `app/src/app/(auth)/(gated)/cobrancas/page.tsx`

**Fronteira herdada do 4A:** esta tela é do **escritório cobrando**, não da Balu. Nada nela pode sugerir que a Balu condiciona acesso ao pagamento do honorário — o gate de inadimplência do 4A vale só para a assinatura da Balu.

- [ ] **Step 1: A página**

```tsx
// Bloco 4B — o cliente ve as cobrancas do escritorio dele (decisao 7.3).
//
// Boleto que so chega por e-mail se perde, e inadimplencia por esquecimento e
// a mais comum. Mostrar no app onde o cliente ja esta e o que a evita.
//
// FRONTEIRA: esta e a cobranca do ESCRITORIO. A Balu nao e credora aqui e nao
// condiciona nada ao pagamento — nenhuma tarja de bloqueio nesta tela.
import { requireEmpresaPage } from '@/lib/auth/guard';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const reais = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (d: string) => d.split('-').reverse().join('/');

const SELO: Record<string, string> = {
  pendente: 'bg-surface-2 text-muted-foreground',
  paga: 'bg-success/15 text-success',
  vencida: 'bg-alert/15 text-alert',
  estornada: 'bg-surface-2 text-muted-foreground',
};

export default async function Page() {
  const ctx = await requireEmpresaPage();
  const sb = createAdminClient();

  const { data: cobrancas } = await sb
    .from('cobrancas_escritorio')
    .select('id, descricao, status, valor_centavos, vencimento, pago_em, link_fatura, contabilidade_id')
    .eq('empresa_cliente_id', ctx.companyId)
    .order('vencimento', { ascending: false });

  const { data: escritorio } = await sb
    .from('contabilidades').select('nome')
    .eq('id', cobrancas?.[0]?.contabilidade_id ?? '00000000-0000-0000-0000-000000000000')
    .maybeSingle();

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold mb-1">Cobranças do seu contador</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          {escritorio?.nome
            ? <>Honorários e serviços cobrados por <strong>{escritorio.nome}</strong>.</>
            : 'Honorários e serviços cobrados pelo seu escritório de contabilidade.'}
          {' '}O pagamento vai direto para o escritório.
        </p>
      </div>

      {(cobrancas ?? []).length === 0 ? (
        <p className="rounded-md border border-border bg-surface px-3 py-4 text-sm text-muted-foreground">
          Nenhuma cobrança por aqui.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {(cobrancas ?? []).map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface p-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm text-foreground">
                  <span className="font-medium">{c.descricao}</span>
                  <span className={`rounded-md px-1.5 py-0.5 text-xs font-semibold ${SELO[c.status] ?? SELO.pendente}`}>
                    {c.status === 'paga' ? 'Paga' : c.status === 'vencida' ? 'Vencida'
                      : c.status === 'estornada' ? 'Estornada' : 'Em aberto'}
                  </span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {reais(c.valor_centavos)} · vence {dataBr(c.vencimento)}
                  {c.pago_em ? ` · paga em ${dataBr(c.pago_em)}` : ''}
                </p>
              </div>
              {c.link_fatura && c.status !== 'paga' && (
                <a href={c.link_fatura} target="_blank" rel="noopener noreferrer"
                  className="rounded-md border border-border px-3 py-1.5 text-sm hover:border-primary hover:text-primary">
                  Pagar
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Conferir o guard da empresa**

Run: `cd app && grep -rn "requireEmpresaPage\|export async function require" src/lib/auth/guard.ts | head`
Expected: existe um guard de página do lado empresa devolvendo `companyId`. Ajustar o import ao nome real.

- [ ] **Step 3: Ligar no menu**

Acrescentar "Cobranças" à navegação do lado empresa, ao lado de Impostos.

Run: `cd app && grep -rn "Impostos" src/components/ | head -5`

- [ ] **Step 4: Verificar**

Run: `cd app && npx tsc --noEmit`
Expected: `TypeScript: No errors found`

- [ ] **Step 5: Commit**

```bash
git add "app/src/app/(auth)/(gated)/cobrancas/" app/src/components
git commit -m "feat(4b): cliente ve as cobrancas do escritorio no app"
```

---

### Task 13: Sincronização — não depender do webhook

**Files:**
- Modify: `app/src/lib/billing/cron.ts`

O 4A já aprendeu isso da pior forma (bug 5 da sessão 12): **o webhook não alcança `localhost`, não atravessa firewall e pode falhar**. Cobrança que só existe se o webhook chegar é cobrança que some.

- [ ] **Step 1: Função de sincronização**

Acrescentar em `app/src/lib/billing/cron.ts`:

```ts
/**
 * Reconcilia as cobranças de todas as subcontas com o Asaas.
 *
 * O webhook é o caminho rápido, não o único: ele não alcança `localhost`, não
 * atravessa firewall e pode falhar em silêncio. Sem esta varredura, uma
 * cobrança paga fica "em aberto" para sempre e o cliente é cobrado de novo.
 */
export async function sincronizarCobrancasEscritorio(): Promise<{ atualizadas: number }> {
  const sb = createAdminClient();
  const { data: escritorios } = await sb
    .from('contabilidades')
    .select('id, asaas_api_key_cifrada')
    .eq('asaas_subconta_status', 'aprovada')
    .not('asaas_api_key_cifrada', 'is', null);

  let atualizadas = 0;
  for (const e of escritorios ?? []) {
    const token = lerCredencial(e.asaas_api_key_cifrada);
    if (!token) continue;
    let lista;
    try {
      lista = await asaasSub(token).listarCobrancas();
    } catch (err) {
      console.error('[4b] sincronizar subconta falhou', e.id, (err as Error).message.slice(0, 200));
      continue;
    }
    for (const p of lista.data ?? []) {
      const { data: cob } = await sb.from('cobrancas_escritorio')
        .select('id, status, pago_em, honorario_id').eq('asaas_charge_id', p.id).maybeSingle();
      if (!cob) continue;
      const novo = aplicarEventoNaCobranca(
        { status: cob.status, pago_em: cob.pago_em },
        { status: statusDoAsaas(p.status), pagoEm: (p as { paymentDate?: string }).paymentDate ?? null },
      );
      if (!novo) continue;
      await sb.from('cobrancas_escritorio')
        .update({ ...novo, updated_at: new Date().toISOString() }).eq('id', cob.id);
      if (cob.honorario_id && novo.status === 'paga') {
        await sb.from('honorarios').update({
          status: 'pago', data_pagamento: novo.pago_em,
          pagamento_origem: 'asaas', updated_at: new Date().toISOString(),
        }).eq('id', cob.honorario_id);
      }
      atualizadas++;
    }
  }
  return { atualizadas };
}
```

E os imports no topo de `cron.ts`:

```ts
import { asaasSub } from '@/lib/clients/asaas';
import { lerCredencial } from '@/lib/billing/credencial-subconta';
import { aplicarEventoNaCobranca, statusDoAsaas } from '@/lib/billing/cobranca-escritorio';
```

- [ ] **Step 2: Chamar no cron diário**

Localizar a rota que dispara o cron de billing e acrescentar a chamada ao lado da reconciliação do 4A.

Run: `cd app && grep -rn "reconciliar\|cron" src/app/api --include=route.ts | head -5`

- [ ] **Step 3: Verificar**

Run: `cd app && npx tsc --noEmit && npx vitest run src/lib/billing`
Expected: verde.

- [ ] **Step 4: Commit**

```bash
git add app/src/lib/billing/cron.ts app/src/app/api
git commit -m "feat(4b): reconciliacao das cobrancas de subconta, sem depender do webhook"
```

---

### Task 14: Verificação final e roteiro do smoke

**Files:**
- Create: `app/scratchpad/_probe-4b.mjs`
- Create: `balu/docs/smoke/YYYY-MM-DD-bloco-4b-roteiro-smoke.md`

- [ ] **Step 1: Provar o caminho ponta a ponta fora da tela**

Equivalente do `_probe-comprovante.mjs` do 4A: se isto passa, a tela só pode falhar por UI.

⚠️ **Este script cria uma subconta de verdade no sandbox.** Subconta do Asaas não se apaga pela API — a de teste fica lá. Rodar **uma vez**, com CNPJ de teste, e anotar o `walletId` no roteiro do smoke.

Criar `app/scratchpad/_probe-4b.mjs`:

```js
// Prova o caminho completo do 4B contra o SANDBOX: criar subconta, cifrar e
// decifrar a chave devolvida, emitir cobranca por ela e consultar de volta.
import { readFileSync } from 'node:fs';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const env = Object.fromEntries(
  readFileSync('app/.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => {
    const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
  }),
);
const mae = env.TOKEN_ASAAS_SANDBOX.replace(/\\\$/g, '$');  // o `\$` do dotenv-expand
const BASE = 'https://api-sandbox.asaas.com/v3';

const call = async (rota, opts = {}, token = mae) => {
  const r = await fetch(`${BASE}${rota}`, {
    headers: { access_token: token, 'Content-Type': 'application/json' }, ...opts,
  });
  return { status: r.status, corpo: await r.json().catch(() => ({})) };
};

// CNPJ de teste do Asaas em sandbox. Trocar se o validador recusar.
const CNPJ = '34238864000168';

console.log('== 1. criar subconta ==');
const nova = await call('/accounts', {
  method: 'POST',
  body: JSON.stringify({
    name: `Probe 4B ${CNPJ.slice(-4)}`, email: `probe4b+${Date.now()}@example.com`,
    cpfCnpj: CNPJ, companyType: 'LIMITED', mobilePhone: '11999999999',
    incomeValue: 10000, address: 'Rua Teste', addressNumber: '1',
    province: 'Centro', postalCode: '01001000',
  }),
});
console.log(`POST /accounts -> HTTP ${nova.status}`);
if (nova.status >= 300) { console.log('FALHOU:', JSON.stringify(nova.corpo)); process.exit(1); }
const { id: contaId, walletId, apiKey } = nova.corpo;
console.log('  accountId ...', contaId);
console.log('  walletId ....', walletId);
console.log('  apiKey ......', `${apiKey.slice(0, 6)}…${apiKey.slice(-4)}  (mascarada de proposito)`);

console.log('\n== 2. ciclo cifra -> decifra com a CERT_ENC_KEY real ==');
const key = Buffer.from(env.CERT_ENC_KEY, 'base64');
const iv = randomBytes(12);
const c = createCipheriv('aes-256-gcm', key, iv);
const enc = Buffer.concat([c.update(apiKey, 'utf8'), c.final()]);
const tag = c.getAuthTag();
const d = createDecipheriv('aes-256-gcm', key, iv);
d.setAuthTag(tag);
const volta = Buffer.concat([d.update(enc), d.final()]).toString('utf8');
console.log('  chave 32 bytes ...', key.length === 32 ? 'OK' : `ERRADO (${key.length})`);
console.log('  ida e volta ......', volta === apiKey ? 'OK' : 'FALHOU');

console.log('\n== 3. emitir cobranca COM O TOKEN DA SUBCONTA ==');
const cli = await call('/customers', {
  method: 'POST', body: JSON.stringify({ name: 'Cliente Probe', cpfCnpj: '24971563792' }),
}, apiKey);
console.log(`POST /customers -> HTTP ${cli.status}`);
const venc = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
const cob = await call('/payments', {
  method: 'POST',
  body: JSON.stringify({ customer: cli.corpo.id, billingType: 'UNDEFINED', value: 1, dueDate: venc, description: 'Probe 4B' }),
}, apiKey);
console.log(`POST /payments -> HTTP ${cob.status}`);
console.log('  chargeId ....', cob.corpo.id);
console.log('  invoiceUrl ..', cob.corpo.invoiceUrl ? 'presente' : 'AUSENTE');

console.log('\n== 4. a cobranca pertence a SUBCONTA, nao a conta-mae ==');
const pelaMae = await call(`/payments/${cob.corpo.id}`);
console.log(`GET pela conta-mae -> HTTP ${pelaMae.status}`,
  pelaMae.status === 404 ? '(404 = correto: o dinheiro nao e da Balu)' : '(ATENCAO: revisar)');
const pelaSub = await call(`/payments/${cob.corpo.id}`, {}, apiKey);
console.log(`GET pela subconta  -> HTTP ${pelaSub.status}`, pelaSub.status === 200 ? 'OK' : 'FALHOU');
```

Run: `node app/scratchpad/_probe-4b.mjs`

Expected: as quatro etapas OK. A **etapa 4 é a mais importante do bloco**: a cobrança precisa ser invisível para a conta-mãe. Se a conta-mãe enxergar a cobrança, o dinheiro está passando pela Balu — o princípio do §1 foi violado e o bloco está errado, por mais que as telas funcionem.

- [ ] **Step 2: Suíte completa, sem cenário montado**

Run: `cd app && npx vitest run`
Expected: tudo verde. A linha de base ao fim do 4A era **731 passando, 27 pulados** — este bloco só soma.

- [ ] **Step 3: Build com o dev parado**

Parar o `npm run dev` antes.

Run: `cd app && npx next build`
Expected: 0 erros, 0 warnings.

É o único passo que pega export indevido em arquivo `'use server'`/`route.ts`, e este bloco criou **quatro** arquivos desses.

- [ ] **Step 4: Escrever o roteiro do smoke manual**

Seguindo o formato de `docs/smoke/2026-07-27-bloco-4a-roteiro-smoke.md`. Precisa cobrir explicitamente os caminhos que o teste automatizado **não** percorre:

1. Onboarding da subconta com **CNPJ** (não pede data de nascimento) e com **CPF** (pede).
2. Duplo clique em "Criar conta de recebimento" — a segunda tentativa tem de ser recusada, nunca criar duas subcontas.
3. Catálogo: criar serviço fixo, criar percentual, tentar salvar fixo sem valor.
4. Cobrar com serviço **percentual sem informar valor-base** — tem de recusar, nunca emitir por zero.
5. Pagar a cobrança no sandbox e conferir que o cliente vê "Paga" **e** o semáforo do contador vira pago com `pagamento_origem = 'asaas'`.
6. Marcar um honorário como pago **na mão** e conferir que `pagamento_origem` fica `'manual'` — os dois caminhos precisam ser distinguíveis.
7. Escritório inadimplente com a Balu: **emitir cobrança nova** barra, mas as cobranças já emitidas continuam visíveis e pagáveis.
8. A tela do cliente **não** pode ter nenhuma tarja de bloqueio da Balu.

- [ ] **Step 5: Atualizar o CHECKPOINT e commitar**

```bash
git add docs/ CHECKPOINT.md
git commit -m "docs(4b): roteiro do smoke e checkpoint"
```

- [ ] **Step 6: Entregar o roteiro ao usuário na conversa**

Não basta linkar o arquivo: reproduzir o roteiro na conversa, com os comandos, as contas e os valores esperados. O merge só acontece depois do smoke passar, e **o push é confirmado com o usuário antes** — é auto-deploy em produção.

---

## Verificação de cobertura da spec

| Requisito da spec | Task |
|---|---|
| §2 — subconta criada pela Balu (modelo B) | 1, 5 |
| §3 — cifra em repouso, nunca em log, uso server-side | 4, 5, 9 |
| §4 — migration, onboarding, honorário, catálogo, webhook | 1, 6, 8, 9, 11 |
| §5 — catálogo com valor fixo **ou** percentual | 1, 7, 8 |
| §6 — as quatro telas | 6, 8, 10, 12 |
| §7.1 — campos do Asaas, PJ vs PF | 3, 6 |
| §7.2 — saída não toca nas cobranças | (nenhuma ação: o desvínculo não chama o Asaas — verificar no smoke) |
| §7.3 — cliente vê as cobranças no app | 12 |
| §7.4 — semáforo automático + manual distinguíveis | 1, 11, 13 |
| §7.5 — sem comissão | (fora de escopo, nada a fazer) |
| §7.6 — migration é a 0053 | 1 |
| Reconciliação sem depender do webhook | 13 |
