# Bloco 4A — Assinatura da Balu · Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar à Balu cobrança de assinatura recorrente via Asaas, com um gate de acesso que bloqueia escrita comercial do inadimplente e **nunca** alcança obrigação fiscal com prazo nem direito do titular (LGPD art. 18).

**Architecture:** Espelho local (`planos`/`assinaturas`/`cobrancas`) alimentado por webhook do Asaas, com reconciliação diária como rede de segurança. O status é **derivado na leitura**, nunca lido cru da coluna — cron que falha não pode liberar quem devia bloquear nem bloquear quem pagou. O gate é uma função chamada no topo das actions comerciais, no formato do `assertAceitesEmDia` do Bloco E; nunca middleware nem layout.

**Tech Stack:** Next.js 15 (App Router, Server Actions) · TypeScript · Supabase (Postgres + RLS) · vitest 2 · Asaas (sandbox → prod por env).

**Spec:** `docs/superpowers/specs/2026-07-27-bloco-4a-assinatura-balu-design.md`
**Branch:** `bloco-4-billing-asaas`

---

## Convenções deste repo (ler antes da Task 1)

- **Diretório de trabalho:** os comandos `npm`/`npx` rodam de `D:\balu-app-v2\balu\app`. Os scripts `node app/scratchpad/...` rodam de `D:\balu-app-v2\balu`.
- **Testes:** vitest, arquivos **colocados ao lado do fonte** (`x.ts` + `x.test.ts`). Não existe `vitest.config.*`; o script é `npm test` (watch) — em CI/verificação use `npx vitest run`.
- **Alias:** `@/` aponta para `app/src/`.
- **Verificação:** `npx tsc --noEmit` + `npx vitest run` + `npx next build`. **`npm run lint` NÃO funciona neste repo** (não há config de ESLint; `next lint` abre wizard interativo). É pré-existente — não introduza config, não é escopo deste bloco.
- **⚠️ Nunca rodar `next build` com o `npm run dev` no ar** — os dois disputam `.next/` e o dev server passa a dar `Cannot find module './XXXX.js'`. Pare o dev, `rm -rf .next`, suba de novo.
- **Migrations:** aplicadas por runner Node+`pg` que lê `SUPABASE_PASSWORD` de `app/.env.local`. O classifier bloqueia escrita por MCP — **o usuário roda os scripts** com `! node app/scratchpad/...`.
- **`ActionResult` é declarado por arquivo**, não importado de um lugar comum. Siga a convenção do arquivo que você está editando.
- **Commits:** mensagens em português, sem acento (o histórico do repo é assim), prefixo `feat(bloco-4a):` / `test(bloco-4a):` / `fix(bloco-4a):` / `docs(bloco-4a):`.

## Estrutura de arquivos

**Criar:**

| Arquivo | Responsabilidade |
|---|---|
| `app/supabase/migrations/0050_billing.sql` | Tabelas, RLS, triggers de criação de assinatura, cortesia, CHECK de `notifications` |
| `app/src/lib/billing/status.ts` + `.test.ts` | Status efetivo — puro |
| `app/src/lib/billing/titular.ts` + `.test.ts` | Quem responde pela assinatura — puro |
| `app/src/lib/billing/faixa.ts` + `.test.ts` | Plano do escritório por nº de clientes — puro |
| `app/src/lib/billing/eventos.ts` + `.test.ts` | Tradução do vocabulário do Asaas — puro |
| `app/src/lib/billing/gate.ts` | As duas portas do gate — faz I/O |
| `app/src/lib/billing/gate.smoke.test.ts` | Smoke do gate contra o banco real |
| `app/src/app/api/webhooks/segredo.ts` + `.test.ts` | Segredo por query e por header — compartilhado |
| `app/src/lib/clients/asaas.ts` | Cliente HTTP do Asaas |
| `app/src/app/api/webhooks/asaas/route.ts` | Webhook |
| `app/src/app/(auth)/(gated)/admin/assinaturas/page.tsx` + `PlanosAdmin.tsx` + `actions.ts` | Tela de admin dos planos |
| `app/src/app/(auth)/(gated)/conta/assinatura/page.tsx` | Assinatura do empresário |
| `app/src/app/(auth)/(gated)/contador/assinatura/page.tsx` | Assinatura do escritório |
| `app/src/app/(auth)/(gated)/_components/AvisoCobranca.tsx` | Faixa de aviso |
| `app/src/app/api/cron/billing/route.ts` | Reconciliação + faixa + avisos |

**Modificar:**

| Arquivo | O quê |
|---|---|
| `app/src/app/api/webhooks/focus/segredo.ts` | Passa a delegar ao módulo compartilhado |
| `app/src/lib/clients/index.ts` | Exporta `asaas` |
| `app/src/lib/admin/guard.ts` | Recebe `requireAdminBaluAction()` extraído |
| `app/src/app/(auth)/(gated)/admin/contabilidades/actions.ts` | Passa a importar o guard extraído |
| `app/src/types/database.ts` | Tipos das 3 tabelas novas |
| 6 arquivos de actions | Chamada do gate |
| `app/vercel.json` | Cron novo (**só se** o tier permitir — Task 13) |

---

## Task 1: Migration 0050 — schema de billing

**Files:**
- Create: `app/supabase/migrations/0050_billing.sql`
- Create: `app/scratchpad/apply-0050.mjs` (não versionado)
- Create: `app/scratchpad/_verify-0050.mjs` (não versionado)

- [ ] **Step 1: Escrever a migration**

Crie `app/supabase/migrations/0050_billing.sql`:

```sql
-- 0050_billing.sql — Bloco 4A: assinatura da Balu.
-- Aditiva e idempotente: pode rodar 2x sem erro.

-- ---------------------------------------------------------------- planos
CREATE TABLE IF NOT EXISTS public.planos (
  id             text PRIMARY KEY,
  nome           text NOT NULL,
  publico        text NOT NULL CHECK (publico IN ('empresa','escritorio')),
  valor_centavos int  NOT NULL CHECK (valor_centavos >= 0),
  ciclo          text NOT NULL DEFAULT 'MONTHLY' CHECK (ciclo IN ('MONTHLY','YEARLY')),
  clientes_min   int,
  clientes_max   int,
  trial_dias     int  NOT NULL DEFAULT 7 CHECK (trial_dias >= 0),
  ativo          boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Seed inicial. Valores provisorios: o AdminBalu edita em /admin/assinaturas.
INSERT INTO public.planos (id, nome, publico, valor_centavos, clientes_min, clientes_max) VALUES
  ('empresario_mensal',   'Empresario — mensal',        'empresa',     4990, NULL, NULL),
  ('escritorio_ate_50',   'Escritorio — ate 50 clientes','escritorio', 19900,    0,   50),
  ('escritorio_51_200',   'Escritorio — 51 a 200',      'escritorio',  39900,   51,  200),
  ('escritorio_201_mais', 'Escritorio — 201 ou mais',   'escritorio',  79900,  201, NULL)
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------- assinaturas
CREATE TABLE IF NOT EXISTS public.assinaturas (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contabilidade_id      uuid REFERENCES public.contabilidades(id) ON DELETE CASCADE,
  company_id            uuid REFERENCES public.companies(id)      ON DELETE CASCADE,
  plano_id              text REFERENCES public.planos(id),
  status                text NOT NULL CHECK (status IN
                          ('trial','ativa','inadimplente','cancelada','cortesia')),
  trial_termina_em      date,
  proxima_cobranca_em   date,
  asaas_customer_id     text,
  asaas_subscription_id text,
  cancelada_em          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assinaturas_titular_chk CHECK (
    (contabilidade_id IS NOT NULL AND company_id IS NULL) OR
    (contabilidade_id IS NULL AND company_id IS NOT NULL)
  )
);

-- Uma assinatura por titular. Sem isto, dois webhooks concorrentes criam
-- linhas duplicadas e o gate le a errada.
CREATE UNIQUE INDEX IF NOT EXISTS assinaturas_contabilidade_uidx
  ON public.assinaturas(contabilidade_id) WHERE contabilidade_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS assinaturas_company_uidx
  ON public.assinaturas(company_id) WHERE company_id IS NOT NULL;

-- ------------------------------------------------------------- cobrancas
CREATE TABLE IF NOT EXISTS public.cobrancas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assinatura_id   uuid NOT NULL REFERENCES public.assinaturas(id) ON DELETE CASCADE,
  asaas_charge_id text NOT NULL UNIQUE,
  status          text NOT NULL,
  valor_centavos  int  NOT NULL,
  vencimento      date NOT NULL,
  pago_em         date,
  link_fatura     text,
  pix_copia_cola  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cobrancas_assinatura_idx ON public.cobrancas(assinatura_id);

-- ------------------------------------------------------------------- RLS
ALTER TABLE public.planos      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assinaturas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cobrancas   ENABLE ROW LEVEL SECURITY;

-- planos: catalogo legivel por qualquer autenticado (a tela de assinatura
-- precisa mostrar as opcoes). Escrita so pelo service role (tela de admin).
DROP POLICY IF EXISTS planos_select_auth ON public.planos;
CREATE POLICY planos_select_auth ON public.planos
  FOR SELECT TO authenticated USING (true);

-- assinaturas: o titular le a propria. Sem policy de INSERT/UPDATE —
-- mesma forma de notifications (0045): so a trigger e o service role escrevem.
DROP POLICY IF EXISTS assinaturas_select_titular ON public.assinaturas;
CREATE POLICY assinaturas_select_titular ON public.assinaturas
  FOR SELECT USING (
    (company_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.companies c
        WHERE c.id = assinaturas.company_id AND c.user_id = auth.uid()))
    OR
    (contabilidade_id IS NOT NULL AND contabilidade_id = public.minha_contabilidade_membro())
  );

DROP POLICY IF EXISTS cobrancas_select_titular ON public.cobrancas;
CREATE POLICY cobrancas_select_titular ON public.cobrancas
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.assinaturas a
     WHERE a.id = cobrancas.assinatura_id
       AND (
         (a.company_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.companies c
             WHERE c.id = a.company_id AND c.user_id = auth.uid()))
         OR
         (a.contabilidade_id IS NOT NULL
          AND a.contabilidade_id = public.minha_contabilidade_membro())
       )
  ));

-- -------------------------------------------- assinatura ao criar titular
-- Trigger, e nao chamada nas actions: company nasce em varios caminhos
-- (onboarding, contador cria cliente, stub de abertura). Uma trigger cobre
-- todos; espalhar a criacao pelas actions garantiria esquecer um.
CREATE OR REPLACE FUNCTION public.criar_assinatura_trial()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_dias int;
BEGIN
  IF TG_TABLE_NAME = 'companies' AND NEW.contabilidade_id IS NOT NULL THEN
    RETURN NEW;  -- coberta pela assinatura do escritorio
  END IF;

  SELECT trial_dias INTO v_dias FROM public.planos
   WHERE publico = CASE TG_TABLE_NAME WHEN 'companies' THEN 'empresa' ELSE 'escritorio' END
     AND ativo ORDER BY valor_centavos LIMIT 1;
  v_dias := COALESCE(v_dias, 7);

  IF TG_TABLE_NAME = 'companies' THEN
    INSERT INTO public.assinaturas (company_id, status, trial_termina_em)
      VALUES (NEW.id, 'trial', (now() AT TIME ZONE 'America/Sao_Paulo')::date + v_dias)
      ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO public.assinaturas (contabilidade_id, status, trial_termina_em)
      VALUES (NEW.id, 'trial', (now() AT TIME ZONE 'America/Sao_Paulo')::date + v_dias)
      ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_assinatura_company      ON public.companies;
CREATE TRIGGER trg_assinatura_company      AFTER INSERT ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.criar_assinatura_trial();
DROP TRIGGER IF EXISTS trg_assinatura_contabilidade ON public.contabilidades;
CREATE TRIGGER trg_assinatura_contabilidade AFTER INSERT ON public.contabilidades
  FOR EACH ROW EXECUTE FUNCTION public.criar_assinatura_trial();

-- ------------------------------------- cortesia para o que JA existe hoje
-- Sem isto o deploy bloqueia todo mundo, inclusive os pilotos e as contas
-- de teste. Cortesia nao tem vinculo Asaas nem vencimento: nunca bloqueia.
INSERT INTO public.assinaturas (contabilidade_id, status)
  SELECT id, 'cortesia' FROM public.contabilidades
  ON CONFLICT DO NOTHING;
INSERT INTO public.assinaturas (company_id, status)
  SELECT id, 'cortesia' FROM public.companies
   WHERE contabilidade_id IS NULL AND deleted_at IS NULL
  ON CONFLICT DO NOTHING;

-- ---------------------------------- ampliar o CHECK de notifications.tipo
-- ARMADILHA: a lista e fechada (0045:10-12). Inserir tipo novo sem este
-- ALTER falha com check_violation em RUNTIME, nao em compilacao. A lista
-- antiga tem de ser repetida INTEIRA — omitir um valor quebra linhas ja
-- gravadas.
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_tipo_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_tipo_check CHECK (tipo IN (
  'das_a_vencer','das_vencido','pgdas_pendente','dasn_pendente','defis_pendente',
  'cert_a_vencer','cert_vencido','limite_faturamento','honorario_a_vencer','abertura_etapa',
  'assinatura_trial_acabando','assinatura_cobranca_vencida'));
```

- [ ] **Step 2: Escrever o runner e pedir ao usuário que aplique**

Crie `app/scratchpad/apply-0050.mjs`:

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
const sql = readFileSync(join(appDir, 'supabase/migrations/0050_billing.sql'), 'utf8');
await c.query(sql);
console.log('0050 aplicada');
await c.end();
```

Se `pg` não estiver instalado no scratchpad: `npm i pg` a partir de `D:\balu-app-v2\balu`.

**Peça ao usuário que rode**, a partir de `D:\balu-app-v2\balu`:
`! node app/scratchpad/apply-0050.mjs`

Esperado: `0050 aplicada`

- [ ] **Step 3: Verificar no banco**

Crie `app/scratchpad/_verify-0050.mjs` com o mesmo cabeçalho de conexão do Step 2 e o corpo:

```js
const t = await c.query(`SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND table_name IN ('planos','assinaturas','cobrancas') ORDER BY 1`);
console.log('tabelas:', t.rows.map((r) => r.table_name).join(', '));

const p = await c.query(`SELECT count(*)::int n FROM public.planos`);
console.log('planos semeados:', p.rows[0].n);

const a = await c.query(`SELECT status, count(*)::int n FROM public.assinaturas GROUP BY 1 ORDER BY 1`);
console.log('assinaturas:', a.rows.map((r) => `${r.status}=${r.n}`).join(' '));

const orfas = await c.query(`
  SELECT count(*)::int n FROM public.contabilidades c
   WHERE NOT EXISTS (SELECT 1 FROM public.assinaturas a WHERE a.contabilidade_id = c.id)`);
console.log('contabilidades SEM assinatura (tem de ser 0):', orfas.rows[0].n);

const orfasEmp = await c.query(`
  SELECT count(*)::int n FROM public.companies co
   WHERE co.contabilidade_id IS NULL AND co.deleted_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.assinaturas a WHERE a.company_id = co.id)`);
console.log('empresas autosservico SEM assinatura (tem de ser 0):', orfasEmp.rows[0].n);

const chk = await c.query(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint
  WHERE conname='notifications_tipo_check'`);
console.log('CHECK aceita assinatura_*:', /assinatura_trial_acabando/.test(chk.rows[0].d));
```

**Peça ao usuário:** `! node app/scratchpad/_verify-0050.mjs`

Esperado:
```
tabelas: assinaturas, cobrancas, planos
planos semeados: 4
assinaturas: cortesia=<N>
contabilidades SEM assinatura (tem de ser 0): 0
empresas autosservico SEM assinatura (tem de ser 0): 0
CHECK aceita assinatura_*: true
```

Se algum "SEM assinatura" for maior que 0, **pare**: a cortesia não cobriu tudo e o deploy bloquearia essas contas.

- [ ] **Step 4: Tipar as tabelas novas**

Em `app/src/types/database.ts`, adicione ao mesmo objeto onde vivem `contabilidades` e `companies`:

```ts
  planos: {
    id: string;
    nome: string;
    publico: 'empresa' | 'escritorio';
    valor_centavos: number;
    ciclo: 'MONTHLY' | 'YEARLY';
    clientes_min: number | null;
    clientes_max: number | null;
    trial_dias: number;
    ativo: boolean;
    created_at: string;
    updated_at: string;
  };
  assinaturas: {
    id: string;
    contabilidade_id: string | null;
    company_id: string | null;
    plano_id: string | null;
    status: 'trial' | 'ativa' | 'inadimplente' | 'cancelada' | 'cortesia';
    trial_termina_em: string | null;
    proxima_cobranca_em: string | null;
    asaas_customer_id: string | null;
    asaas_subscription_id: string | null;
    cancelada_em: string | null;
    created_at: string;
    updated_at: string;
  };
  cobrancas: {
    id: string;
    assinatura_id: string;
    asaas_charge_id: string;
    status: string;
    valor_centavos: number;
    vencimento: string;
    pago_em: string | null;
    link_fatura: string | null;
    pix_copia_cola: string | null;
    created_at: string;
    updated_at: string;
  };
```

- [ ] **Step 5: Verificar e commitar**

```bash
npx tsc --noEmit
git add app/supabase/migrations/0050_billing.sql app/src/types/database.ts
git commit -m "feat(bloco-4a): migration 0050 — planos, assinaturas, cobrancas

Trigger cria assinatura em trial no INSERT de company/contabilidade —
company nasce em varios caminhos e espalhar a criacao pelas actions
garantiria esquecer um. Cortesia para o que ja existe, senao o deploy
bloqueia os pilotos e as contas de teste.

ARMADILHA: notifications.tipo tem CHECK de lista fechada (0045:10-12);
o ALTER repete a lista inteira porque omitir um valor quebraria linhas
ja gravadas."
```

---

## Task 2: `status.ts` — status efetivo (puro)

**Files:**
- Create: `app/src/lib/billing/status.ts`
- Test: `app/src/lib/billing/status.test.ts`

> **Desvio deliberado da spec §6.1:** a assinatura da função lá listava `proxima_cobranca_em`, mas ela **não participa da decisão** — `inadimplente` já codifica o vencimento, e usar as duas fontes criaria duas verdades que podem divergir. A coluna continua existindo para exibição e reconciliação. Registre isso no commit.

- [ ] **Step 1: Escrever o teste que falha**

Crie `app/src/lib/billing/status.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { statusEfetivo } from './status';

describe('statusEfetivo', () => {
  it('cortesia sempre libera, mesmo sem trial nem plano', () => {
    expect(statusEfetivo({ status: 'cortesia', trial_termina_em: null }, '2026-07-27')).toBe('liberado');
  });

  it('ativa libera', () => {
    expect(statusEfetivo({ status: 'ativa', trial_termina_em: null }, '2026-07-27')).toBe('liberado');
  });

  it('trial libera no ULTIMO dia (inclusive)', () => {
    expect(statusEfetivo({ status: 'trial', trial_termina_em: '2026-07-27' }, '2026-07-27')).toBe('liberado');
  });

  it('trial bloqueia no dia seguinte ao fim, sem depender de cron', () => {
    expect(statusEfetivo({ status: 'trial', trial_termina_em: '2026-07-26' }, '2026-07-27')).toBe('bloqueado');
  });

  it('trial sem data de fim bloqueia — estado incoerente nao pode liberar', () => {
    expect(statusEfetivo({ status: 'trial', trial_termina_em: null }, '2026-07-27')).toBe('bloqueado');
  });

  it('inadimplente bloqueia', () => {
    expect(statusEfetivo({ status: 'inadimplente', trial_termina_em: null }, '2026-07-27')).toBe('bloqueado');
  });

  it('cancelada bloqueia', () => {
    expect(statusEfetivo({ status: 'cancelada', trial_termina_em: null }, '2026-07-27')).toBe('bloqueado');
  });

  // DISCRIMINANTE: sem este caso, uma implementacao que ignorasse a data e
  // sempre liberasse 'trial' passaria em todos os testes de liberacao acima.
  it('trial vencido ha muito tempo continua bloqueado', () => {
    expect(statusEfetivo({ status: 'trial', trial_termina_em: '2020-01-01' }, '2026-07-27')).toBe('bloqueado');
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npx vitest run src/lib/billing/status.test.ts`
Expected: FAIL — `Failed to resolve import "./status"`

- [ ] **Step 3: Implementar**

Crie `app/src/lib/billing/status.ts`:

```ts
// Bloco 4A — status efetivo da assinatura.
// Puro (sem server-only, sem I/O) para ser testavel sem banco.
//
// POR QUE DERIVAR NA LEITURA: uma coluna que so esta correta se um cron
// rodou e uma bomba — o cron falha e o app libera quem devia bloquear, ou
// pior, bloqueia quem pagou. Aqui o trial vence sozinho, na hora da
// pergunta, sem depender de job nenhum.

export type StatusAssinatura = 'trial' | 'ativa' | 'inadimplente' | 'cancelada' | 'cortesia';

export type AssinaturaParaStatus = {
  status: StatusAssinatura;
  /** YYYY-MM-DD em BRT. Só relevante quando status === 'trial'. */
  trial_termina_em: string | null;
};

/**
 * @param hoje data corrente em BRT no formato YYYY-MM-DD (use `ymdBrt()`).
 *
 * Comparação de strings YYYY-MM-DD é ordenação lexicográfica correta para
 * datas — não converta para Date, que reintroduz fuso.
 */
export function statusEfetivo(a: AssinaturaParaStatus, hoje: string): 'liberado' | 'bloqueado' {
  switch (a.status) {
    case 'cortesia':
    case 'ativa':
      return 'liberado';
    case 'trial':
      // Sem data de fim o estado e incoerente. Bloquear e o lado seguro:
      // liberar por omissao daria trial eterno a quem tivesse a linha torta.
      if (!a.trial_termina_em) return 'bloqueado';
      return hoje <= a.trial_termina_em ? 'liberado' : 'bloqueado';
    case 'inadimplente':
    case 'cancelada':
      return 'bloqueado';
  }
}
```

- [ ] **Step 4: Rodar para ver passar**

Run: `npx vitest run src/lib/billing/status.test.ts`
Expected: PASS — 8 passed

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/billing/status.ts app/src/lib/billing/status.test.ts
git commit -m "feat(bloco-4a): statusEfetivo derivado na leitura

Nao le a coluna crua: o trial vence sozinho na hora da pergunta, entao
cron que falha nao libera quem devia bloquear nem bloqueia quem pagou.

Desvio deliberado da spec 6.1: proxima_cobranca_em saiu da assinatura da
funcao — 'inadimplente' ja codifica o vencimento e usar as duas fontes
criaria duas verdades divergentes. A coluna segue para exibicao."
```

---

## Task 3: `titular.ts` — quem responde pela assinatura (puro)

**Files:**
- Create: `app/src/lib/billing/titular.ts`
- Test: `app/src/lib/billing/titular.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Crie `app/src/lib/billing/titular.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { titularDaEmpresa } from './titular';

describe('titularDaEmpresa', () => {
  it('empresa sem contabilidade responde pela propria assinatura', () => {
    expect(titularDaEmpresa({ id: 'c1', contabilidade_id: null }))
      .toEqual({ tipo: 'company', id: 'c1' });
  });

  it('empresa de carteira e coberta pelo escritorio', () => {
    expect(titularDaEmpresa({ id: 'c1', contabilidade_id: 'e9' }))
      .toEqual({ tipo: 'coberta_por_escritorio', id: 'e9' });
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npx vitest run src/lib/billing/titular.test.ts`
Expected: FAIL — `Failed to resolve import "./titular"`

- [ ] **Step 3: Implementar**

Crie `app/src/lib/billing/titular.ts`:

```ts
// Bloco 4A — quem responde pela assinatura de uma empresa. Puro, sem I/O.
//
// A regra le o multitenant que o Bloco A ja construiu: nenhum campo novo
// diz "quem paga por quem".

export type Titular =
  | { tipo: 'company'; id: string }
  | { tipo: 'coberta_por_escritorio'; id: string };

export function titularDaEmpresa(c: { id: string; contabilidade_id: string | null }): Titular {
  return c.contabilidade_id
    ? { tipo: 'coberta_por_escritorio', id: c.contabilidade_id }
    : { tipo: 'company', id: c.id };
}
```

- [ ] **Step 4: Rodar para ver passar**

Run: `npx vitest run src/lib/billing/titular.test.ts`
Expected: PASS — 2 passed

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/billing/titular.ts app/src/lib/billing/titular.test.ts
git commit -m "feat(bloco-4a): resolucao de titular por origem da empresa"
```

---

## Task 4: `faixa.ts` — plano do escritório por nº de clientes (puro)

**Files:**
- Create: `app/src/lib/billing/faixa.ts`
- Test: `app/src/lib/billing/faixa.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Crie `app/src/lib/billing/faixa.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { planoPorQtdClientes, type PlanoFaixa } from './faixa';

const PLANOS: PlanoFaixa[] = [
  { id: 'ate_50',   clientes_min: 0,   clientes_max: 50,   ativo: true },
  { id: 'f51_200',  clientes_min: 51,  clientes_max: 200,  ativo: true },
  { id: 'f201_up',  clientes_min: 201, clientes_max: null, ativo: true },
];

describe('planoPorQtdClientes', () => {
  it('zero cliente cai na primeira faixa', () => {
    expect(planoPorQtdClientes(0, PLANOS)).toEqual({ ok: true, planoId: 'ate_50' });
  });

  it('borda inferior da faixa', () => {
    expect(planoPorQtdClientes(51, PLANOS)).toEqual({ ok: true, planoId: 'f51_200' });
  });

  it('borda superior da faixa', () => {
    expect(planoPorQtdClientes(50, PLANOS)).toEqual({ ok: true, planoId: 'ate_50' });
  });

  it('faixa aberta no topo aceita qualquer quantidade', () => {
    expect(planoPorQtdClientes(99999, PLANOS)).toEqual({ ok: true, planoId: 'f201_up' });
  });

  it('ignora plano inativo e cai na faixa seguinte que sirva', () => {
    const comInativo: PlanoFaixa[] = [
      { id: 'ate_50', clientes_min: 0, clientes_max: 50, ativo: false },
      { id: 'tudo',   clientes_min: 0, clientes_max: null, ativo: true },
    ];
    expect(planoPorQtdClientes(10, comInativo)).toEqual({ ok: true, planoId: 'tudo' });
  });

  // O admin edita faixas em runtime (/admin/assinaturas), entao o buraco
  // passou a ser possivel. Sem este caso a funcao devolveria undefined
  // silencioso e o cron gravaria plano_id null sem ninguem perceber.
  it('buraco entre faixas devolve erro nomeado, nao undefined', () => {
    const comBuraco: PlanoFaixa[] = [
      { id: 'a', clientes_min: 0,   clientes_max: 10,   ativo: true },
      { id: 'b', clientes_min: 100, clientes_max: null, ativo: true },
    ];
    expect(planoPorQtdClientes(50, comBuraco)).toEqual({ ok: false, motivo: 'sem_faixa' });
  });

  it('lista vazia devolve erro nomeado', () => {
    expect(planoPorQtdClientes(10, [])).toEqual({ ok: false, motivo: 'sem_faixa' });
  });

  it('quantidade negativa e entrada invalida', () => {
    expect(planoPorQtdClientes(-1, PLANOS)).toEqual({ ok: false, motivo: 'qtd_invalida' });
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npx vitest run src/lib/billing/faixa.test.ts`
Expected: FAIL — `Failed to resolve import "./faixa"`

- [ ] **Step 3: Implementar**

Crie `app/src/lib/billing/faixa.ts`:

```ts
// Bloco 4A — escolha do plano de escritorio pela quantidade de clientes.
// Puro, sem I/O.

export type PlanoFaixa = {
  id: string;
  clientes_min: number | null;
  clientes_max: number | null;   // null = faixa aberta no topo
  ativo: boolean;
};

export type ResultadoFaixa =
  | { ok: true; planoId: string }
  | { ok: false; motivo: 'sem_faixa' | 'qtd_invalida' };

/**
 * Nunca devolve undefined implicito: o AdminBalu edita as faixas em runtime,
 * entao um buraco entre elas e um estado alcancavel. Falhar com motivo
 * nomeado deixa o chamador registrar o problema em vez de gravar plano nulo.
 */
export function planoPorQtdClientes(qtd: number, planos: PlanoFaixa[]): ResultadoFaixa {
  if (!Number.isInteger(qtd) || qtd < 0) return { ok: false, motivo: 'qtd_invalida' };

  const achado = planos.find((p) =>
    p.ativo &&
    qtd >= (p.clientes_min ?? 0) &&
    (p.clientes_max === null || qtd <= p.clientes_max),
  );

  return achado ? { ok: true, planoId: achado.id } : { ok: false, motivo: 'sem_faixa' };
}
```

- [ ] **Step 4: Rodar para ver passar**

Run: `npx vitest run src/lib/billing/faixa.test.ts`
Expected: PASS — 8 passed

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/billing/faixa.ts app/src/lib/billing/faixa.test.ts
git commit -m "feat(bloco-4a): escolha de faixa de plano do escritorio

Trata buraco entre faixas com motivo nomeado em vez de undefined: o
admin edita faixas em runtime, entao o buraco e alcancavel."
```

---

## Task 5: `eventos.ts` — tradução do vocabulário do Asaas (puro)

**Files:**
- Create: `app/src/lib/billing/eventos.ts`
- Test: `app/src/lib/billing/eventos.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Crie `app/src/lib/billing/eventos.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { traduzirEvento } from './eventos';

const pagamento = (event: string) => ({
  event,
  payment: {
    id: 'pay_123',
    subscription: 'sub_9',
    value: 49.9,
    dueDate: '2026-08-10',
    status: 'RECEIVED',
    invoiceUrl: 'https://asaas/i/123',
  },
});

describe('traduzirEvento', () => {
  it('PAYMENT_RECEIVED vira pagamento confirmado', () => {
    expect(traduzirEvento(pagamento('PAYMENT_RECEIVED'))).toEqual({
      tipo: 'pagamento_confirmado', chargeId: 'pay_123', subscriptionId: 'sub_9',
    });
  });

  it('PAYMENT_CONFIRMED tambem vira pagamento confirmado', () => {
    expect(traduzirEvento(pagamento('PAYMENT_CONFIRMED'))).toEqual({
      tipo: 'pagamento_confirmado', chargeId: 'pay_123', subscriptionId: 'sub_9',
    });
  });

  it('PAYMENT_OVERDUE vira cobranca vencida', () => {
    expect(traduzirEvento(pagamento('PAYMENT_OVERDUE'))).toEqual({
      tipo: 'cobranca_vencida', chargeId: 'pay_123', subscriptionId: 'sub_9',
    });
  });

  it('PAYMENT_CREATED vira cobranca criada', () => {
    expect(traduzirEvento(pagamento('PAYMENT_CREATED'))).toEqual({
      tipo: 'cobranca_criada', chargeId: 'pay_123', subscriptionId: 'sub_9',
    });
  });

  it('PAYMENT_REFUNDED vira estorno', () => {
    expect(traduzirEvento(pagamento('PAYMENT_REFUNDED'))).toEqual({
      tipo: 'estorno', chargeId: 'pay_123', subscriptionId: 'sub_9',
    });
  });

  // DISCRIMINANTE DE SEGURANCA: um vocabulario novo do provedor NAO pode
  // virar bloqueio silencioso de cliente adimplente nem liberacao de
  // inadimplente. Sem este caso, um `default: cobranca_vencida` passaria.
  it('evento desconhecido e ignorado, nunca interpretado', () => {
    expect(traduzirEvento(pagamento('PAYMENT_ANTICIPATED_XYZ')))
      .toEqual({ tipo: 'ignorado', motivo: 'evento_desconhecido' });
  });

  it('payload sem event e ignorado', () => {
    expect(traduzirEvento({ foo: 'bar' }))
      .toEqual({ tipo: 'ignorado', motivo: 'payload_invalido' });
  });

  it('payload nao-objeto e ignorado', () => {
    expect(traduzirEvento(null)).toEqual({ tipo: 'ignorado', motivo: 'payload_invalido' });
  });

  it('evento de pagamento sem id de cobranca e ignorado', () => {
    expect(traduzirEvento({ event: 'PAYMENT_RECEIVED', payment: { subscription: 'sub_9' } }))
      .toEqual({ tipo: 'ignorado', motivo: 'payload_invalido' });
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npx vitest run src/lib/billing/eventos.test.ts`
Expected: FAIL — `Failed to resolve import "./eventos"`

- [ ] **Step 3: Implementar**

Crie `app/src/lib/billing/eventos.ts`:

```ts
// Bloco 4A — traducao do vocabulario do Asaas para o nosso. Puro, sem I/O.
//
// POR QUE TRADUZIR NA BORDA: espelhar cru o vocabulario do provedor faria
// uma mudanca de nomenclatura dele virar mudanca de regra de negocio no app
// inteiro. Aqui o resto do sistema so conhece os nossos nomes.

export type EfeitoEvento =
  | { tipo: 'pagamento_confirmado'; chargeId: string; subscriptionId: string | null }
  | { tipo: 'cobranca_vencida';     chargeId: string; subscriptionId: string | null }
  | { tipo: 'cobranca_criada';      chargeId: string; subscriptionId: string | null }
  | { tipo: 'estorno';              chargeId: string; subscriptionId: string | null }
  | { tipo: 'ignorado'; motivo: 'evento_desconhecido' | 'payload_invalido' };

const MAPA: Record<string, EfeitoEvento['tipo']> = {
  PAYMENT_CREATED:   'cobranca_criada',
  PAYMENT_RECEIVED:  'pagamento_confirmado',
  PAYMENT_CONFIRMED: 'pagamento_confirmado',
  PAYMENT_OVERDUE:   'cobranca_vencida',
  PAYMENT_REFUNDED:  'estorno',
};

export function traduzirEvento(payload: unknown): EfeitoEvento {
  if (typeof payload !== 'object' || payload === null) {
    return { tipo: 'ignorado', motivo: 'payload_invalido' };
  }
  const p = payload as { event?: unknown; payment?: { id?: unknown; subscription?: unknown } };
  if (typeof p.event !== 'string') return { tipo: 'ignorado', motivo: 'payload_invalido' };

  const tipo = MAPA[p.event];
  // Nunca cair num default que interprete: vocabulario novo do provedor nao
  // pode bloquear cliente adimplente nem liberar inadimplente.
  if (!tipo) return { tipo: 'ignorado', motivo: 'evento_desconhecido' };

  const chargeId = p.payment?.id;
  if (typeof chargeId !== 'string' || !chargeId) {
    return { tipo: 'ignorado', motivo: 'payload_invalido' };
  }
  const sub = p.payment?.subscription;
  const subscriptionId = typeof sub === 'string' && sub ? sub : null;

  return { tipo, chargeId, subscriptionId } as EfeitoEvento;
}
```

- [ ] **Step 4: Rodar para ver passar**

Run: `npx vitest run src/lib/billing/eventos.test.ts`
Expected: PASS — 9 passed

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/billing/eventos.ts app/src/lib/billing/eventos.test.ts
git commit -m "feat(bloco-4a): traducao dos eventos do Asaas

Evento desconhecido e ignorado, nunca interpretado: vocabulario novo do
provedor nao pode virar bloqueio silencioso de cliente adimplente."
```

---

## Task 6: Extrair o módulo de segredo dos webhooks

**Files:**
- Create: `app/src/app/api/webhooks/segredo.ts`
- Create: `app/src/app/api/webhooks/segredo.test.ts`
- Modify: `app/src/app/api/webhooks/focus/segredo.ts` (arquivo inteiro)

> O `segredoOk` de hoje lê da query `?s=` e tem `FOCUS_WEBHOOK_SECRET` **hardcoded por dentro**. O Asaas manda no header `asaas-access-token`. O teste que já existe (`focus/segredo.test.ts`) é a rede de segurança desta refatoração — **não o altere**.

- [ ] **Step 1: Escrever o teste do módulo compartilhado**

Crie `app/src/app/api/webhooks/segredo.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { segredoDaQuery, segredoDoHeader } from './segredo';

function req(url: string, headers?: Record<string, string>): Request {
  return new Request(url, { method: 'POST', headers });
}

describe('segredoDaQuery', () => {
  it('ausente → false', () => {
    expect(segredoDaQuery(req('https://x/w'), 's', 'esperado')).toBe(false);
  });
  it('errado, mesmo comprimento → false', () => {
    expect(segredoDaQuery(req('https://x/w?s=erradoo'), 's', 'esperad')).toBe(false);
  });
  it('certo → true', () => {
    expect(segredoDaQuery(req('https://x/w?s=abc123'), 's', 'abc123')).toBe(true);
  });
  it('esperado vazio → false (nunca liberar por falta de config)', () => {
    expect(segredoDaQuery(req('https://x/w?s='), 's', '')).toBe(false);
  });
  // timingSafeEqual LANCA em tamanhos diferentes — a checagem de
  // comprimento tem de vir antes, senao isto vira 500 no webhook.
  it('comprimento diferente → false, sem lancar', () => {
    expect(() => segredoDaQuery(req('https://x/w?s=curto'), 's', 'muito-mais-longo')).not.toThrow();
    expect(segredoDaQuery(req('https://x/w?s=curto'), 's', 'muito-mais-longo')).toBe(false);
  });
});

describe('segredoDoHeader', () => {
  it('ausente → false', () => {
    expect(segredoDoHeader(req('https://x/w'), 'asaas-access-token', 'esperado')).toBe(false);
  });
  it('certo → true', () => {
    expect(segredoDoHeader(req('https://x/w', { 'asaas-access-token': 'tok' }), 'asaas-access-token', 'tok')).toBe(true);
  });
  it('errado → false', () => {
    expect(segredoDoHeader(req('https://x/w', { 'asaas-access-token': 'xxx' }), 'asaas-access-token', 'tok')).toBe(false);
  });
  it('comprimento diferente → false, sem lancar', () => {
    expect(segredoDoHeader(req('https://x/w', { 'asaas-access-token': 'a' }), 'asaas-access-token', 'aaaa')).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npx vitest run src/app/api/webhooks/segredo.test.ts`
Expected: FAIL — `Failed to resolve import "./segredo"`

- [ ] **Step 3: Implementar o módulo compartilhado**

Crie `app/src/app/api/webhooks/segredo.ts`:

```ts
// Validacao de segredo de webhook — modulo puro (sem `server-only`, sem
// imports de Next) pra poder ser importado tanto pelas routes quanto pelos
// testes unitarios sem disparar a validacao de exports do App Router.
//
// Duas formas porque os provedores diferem: a Focus manda na query (?s=),
// o Asaas manda no header (asaas-access-token).
import { timingSafeEqual } from 'node:crypto';

/** Comparacao em tempo constante. A checagem de comprimento vem ANTES
 *  porque `timingSafeEqual` LANCA quando os buffers tem tamanhos
 *  diferentes — sem isso o webhook viraria 500 em vez de rejeitar. */
function iguais(recebido: string, esperado: string): boolean {
  if (!esperado || recebido.length !== esperado.length) return false;
  return timingSafeEqual(Buffer.from(recebido), Buffer.from(esperado));
}

export function segredoDaQuery(req: Request, param: string, esperado: string): boolean {
  const recebido = new URL(req.url).searchParams.get(param) ?? '';
  return iguais(recebido, esperado);
}

export function segredoDoHeader(req: Request, header: string, esperado: string): boolean {
  const recebido = req.headers.get(header) ?? '';
  return iguais(recebido, esperado);
}
```

- [ ] **Step 4: Rodar para ver passar**

Run: `npx vitest run src/app/api/webhooks/segredo.test.ts`
Expected: PASS — 9 passed

- [ ] **Step 5: Fazer a Focus delegar, sem mudar o comportamento dela**

Substitua **todo** o conteúdo de `app/src/app/api/webhooks/focus/segredo.ts` por:

```ts
// Validacao do segredo do webhook Focus. A logica de comparacao mora em
// `../segredo` (compartilhada com o webhook do Asaas); este arquivo so fixa
// de onde vem o valor (query `?s=`) e qual env o guarda. Assinatura e
// comportamento preservados — `segredo.test.ts` ao lado prova isso.
import { segredoDaQuery } from '../segredo';

export function segredoOk(req: Request): boolean {
  return segredoDaQuery(req, 's', process.env.FOCUS_WEBHOOK_SECRET ?? '');
}
```

- [ ] **Step 6: Provar que a Focus não quebrou**

Run: `npx vitest run src/app/api/webhooks/`
Expected: PASS — os 3 casos de `focus/segredo.test.ts` (que você **não** alterou) continuam verdes, mais os 9 novos.

- [ ] **Step 7: Commit**

```bash
git add app/src/app/api/webhooks/segredo.ts app/src/app/api/webhooks/segredo.test.ts app/src/app/api/webhooks/focus/segredo.ts
git commit -m "refactor(bloco-4a): extrai validacao de segredo de webhook

O Asaas manda o segredo no header, a Focus na query — o segredoOk atual
tinha FOCUS_WEBHOOK_SECRET hardcoded por dentro e nao dava pra reusar.
Duas funcoes agora; focus/segredo.ts delega, com a mesma assinatura.

O teste da Focus nao foi tocado de proposito: e ele que prova que a
extracao nao mudou comportamento."
```

---

## Task 7: Cliente Asaas

**Files:**
- Create: `app/src/lib/clients/asaas.ts`
- Modify: `app/src/lib/clients/index.ts`

- [ ] **Step 1: Implementar o cliente**

Crie `app/src/lib/clients/asaas.ts`:

```ts
// Bloco 4A — Cliente Asaas (assinaturas e cobrancas da propria Balu).
// Secrets NUNCA vao pro frontend. Este modulo so e importavel no server.
//
// Espelha o padrao de focus-nfe.ts: base por env e retry exponencial.
// Diferenca: o Asaas autentica por header `access_token`, nao Basic.
import 'server-only';

const PROD    = 'https://api.asaas.com';
const SANDBOX = 'https://api-sandbox.asaas.com';

function base(): string {
  return process.env.ASAAS_ENV === 'prod' ? PROD : SANDBOX;
}

/** Falha na CHAMADA, nunca no import: o app tem de subir e funcionar
 *  inteiro sem billing enquanto a chave nao chega. Mesmo espirito do
 *  sendEmail, que ja e no-op logado sem chave. */
function apiKey(): string {
  const k = process.env.ASAAS_API_KEY;
  if (!k) throw new Error('ASAAS_API_KEY nao configurado');
  return k;
}

const RETRYABLE = new Set([502, 503, 504]);
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${base()}${path}`, {
        method,
        headers: { access_token: apiKey(), 'Content-Type': 'application/json' },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        cache: 'no-store',
      });
      if (!res.ok) {
        if (RETRYABLE.has(res.status) && attempt < MAX_RETRIES - 1) {
          await sleep(BASE_DELAY_MS * 2 ** attempt);
          continue;
        }
        // Nunca ecoe o corpo inteiro em producao sem cuidado: pode trazer
        // dado do cliente. Aqui vai truncado, so pra diagnostico.
        const txt = (await res.text()).slice(0, 500);
        throw new Error(`Asaas ${method} ${path} → ${res.status}: ${txt}`);
      }
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err;
      const isTimeout =
        err instanceof Error &&
        (err.name === 'AbortError' || /timeout|ETIMEDOUT|ECONNRESET/i.test(err.message));
      if (isTimeout && attempt < MAX_RETRIES - 1) {
        await sleep(BASE_DELAY_MS * 2 ** attempt);
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error(`Asaas ${method} ${path} → falhou apos ${MAX_RETRIES} tentativas`);
}

export type AsaasCliente = { id: string; name: string; cpfCnpj: string };
export type AsaasAssinatura = {
  id: string; customer: string; value: number; cycle: string;
  status: string; nextDueDate: string;
};
export type AsaasCobranca = {
  id: string; subscription?: string; value: number; dueDate: string;
  status: string; invoiceUrl?: string; billingType?: string;
};

export const asaas = {
  criarCliente: (d: { name: string; cpfCnpj: string; email?: string }) =>
    call<AsaasCliente>('POST', '/v3/customers', d),

  criarAssinatura: (d: {
    customer: string; billingType: 'BOLETO' | 'PIX' | 'CREDIT_CARD' | 'UNDEFINED';
    value: number; nextDueDate: string; cycle: 'MONTHLY' | 'YEARLY'; description?: string;
  }) => call<AsaasAssinatura>('POST', '/v3/subscriptions', d),

  atualizarAssinatura: (id: string, d: { value?: number; description?: string }) =>
    call<AsaasAssinatura>('POST', `/v3/subscriptions/${id}`, d),

  cancelarAssinatura: (id: string) =>
    call<{ deleted: boolean; id: string }>('DELETE', `/v3/subscriptions/${id}`),

  consultarAssinatura: (id: string) =>
    call<AsaasAssinatura>('GET', `/v3/subscriptions/${id}`),

  consultarCobranca: (id: string) =>
    call<AsaasCobranca>('GET', `/v3/payments/${id}`),

  listarCobrancas: (subscriptionId: string) =>
    call<{ data: AsaasCobranca[] }>('GET', `/v3/subscriptions/${subscriptionId}/payments`),

  pixDaCobranca: (id: string) =>
    call<{ payload?: string; encodedImage?: string }>('GET', `/v3/payments/${id}/pixQrCode`),
};
```

> **Conferir contra o sandbox quando a chave chegar:** rotas e nomes de campo do Asaas foram escritos a partir da documentação; a Task 15 valida ao vivo. Se divergir, o ponto de correção é **só este arquivo** — nada mais conhece o vocabulário do provedor.

- [ ] **Step 2: Exportar no barrel**

Substitua `app/src/lib/clients/index.ts` por:

```ts
export { focus } from './focus-nfe';
export { serpro, SERPRO_SERVICES } from './serpro';
export { n8n } from './n8n';
export { asaas } from './asaas';
export { ENDPOINTS } from './_endpoints';
```

- [ ] **Step 3: Registrar as env novas**

Em `app/.env.example`, adicione ao fim:

```
# Asaas (Bloco 4A — billing). 'sandbox' ou 'prod'.
ASAAS_ENV=sandbox
ASAAS_API_KEY=
ASAAS_WEBHOOK_SECRET=
```

> **⚠️ ARMADILHA DESTE REPO:** o `.env.example` no disco já foi uma cópia do `.env.local` **com segredos reais** e foi commitado por engano em 22/07. **Abra e leia o arquivo inteiro antes do `git add`.** Se houver qualquer valor real, sanitize antes de commitar.

- [ ] **Step 4: Verificar e commitar**

```bash
npx tsc --noEmit
git add app/src/lib/clients/asaas.ts app/src/lib/clients/index.ts app/.env.example
git commit -m "feat(bloco-4a): cliente Asaas

Espelha focus-nfe.ts (base por env, retry em 502/503/504). Falha na
chamada e nao no import: o app sobe inteiro sem billing enquanto a
chave nao chega."
```

---

## Task 8: Webhook do Asaas

**Files:**
- Create: `app/src/app/api/webhooks/asaas/route.ts`

- [ ] **Step 1: Implementar a route**

Crie `app/src/app/api/webhooks/asaas/route.ts`:

```ts
// Bloco 4A — Webhook do Asaas. Mesma forma do webhook da Focus:
// rate-limit → segredo → SEMPRE HTTP 200 (o Asaas reenfileira em 4xx/5xx,
// e nao queremos loop).
import 'server-only';
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { limitar, ipDe } from '@/lib/security/rate-limit';
import { segredoDoHeader } from '../segredo';
import { traduzirEvento } from '@/lib/billing/eventos';
import { ymdBrt } from '@/lib/fiscal/tempo-brt';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Status local da assinatura conforme o efeito do evento. */
const EFEITO_STATUS: Record<string, 'ativa' | 'inadimplente' | null> = {
  pagamento_confirmado: 'ativa',
  cobranca_vencida: 'inadimplente',
  cobranca_criada: null,
  estorno: null,
};

export async function POST(req: Request) {
  if (!(await limitar(`asaas-webhook:${ipDe(req.headers)}`, 300, 60))) {
    return NextResponse.json({ ok: false, reason: 'rate_limited' }, { status: 200 });
  }
  if (!segredoDoHeader(req, 'asaas-access-token', process.env.ASAAS_WEBHOOK_SECRET ?? '')) {
    console.warn('[webhook asaas] segredo invalido/ausente');
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 200 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: 'invalid_json' }, { status: 200 });
  }

  const efeito = traduzirEvento(body);
  if (efeito.tipo === 'ignorado') {
    console.warn('[webhook asaas] ignorado:', efeito.motivo);
    return NextResponse.json({ ok: true, ignored: efeito.motivo }, { status: 200 });
  }

  try {
    const sb = createAdminClient();
    const pay = (body as { payment: { value?: number; dueDate?: string; status?: string;
      invoiceUrl?: string; paymentDate?: string } }).payment;

    // A assinatura e achada pelo id do Asaas. Sem subscriptionId nao ha o
    // que atualizar — cobranca avulsa nao existe neste bloco.
    if (!efeito.subscriptionId) {
      return NextResponse.json({ ok: true, ignored: 'sem_assinatura' }, { status: 200 });
    }
    const { data: assinatura } = await sb
      .from('assinaturas').select('id')
      .eq('asaas_subscription_id', efeito.subscriptionId)
      .maybeSingle();
    if (!assinatura) {
      console.warn('[webhook asaas] assinatura desconhecida', efeito.subscriptionId);
      return NextResponse.json({ ok: true, ignored: 'assinatura_desconhecida' }, { status: 200 });
    }

    // Idempotencia: asaas_charge_id e UNIQUE, entao reprocessar o mesmo
    // evento e upsert, nunca linha nova.
    await sb.from('cobrancas').upsert({
      assinatura_id: assinatura.id,
      asaas_charge_id: efeito.chargeId,
      status: pay?.status ?? 'DESCONHECIDO',
      valor_centavos: Math.round((pay?.value ?? 0) * 100),
      vencimento: pay?.dueDate ?? ymdBrt(),
      pago_em: efeito.tipo === 'pagamento_confirmado' ? (pay?.paymentDate ?? ymdBrt()) : null,
      link_fatura: pay?.invoiceUrl ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'asaas_charge_id' });

    const novoStatus = EFEITO_STATUS[efeito.tipo];
    if (novoStatus) {
      await sb.from('assinaturas')
        .update({ status: novoStatus, updated_at: new Date().toISOString() })
        .eq('id', assinatura.id);
    }
  } catch (err) {
    console.error('[webhook asaas] erro inesperado', err);
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
```

- [ ] **Step 2: Verificar e commitar**

```bash
npx tsc --noEmit
git add app/src/app/api/webhooks/asaas/route.ts
git commit -m "feat(bloco-4a): webhook do Asaas

Rate-limit, segredo por header e SEMPRE 200 — o Asaas reenfileira em
4xx/5xx. Idempotencia por asaas_charge_id UNIQUE: reprocessar o mesmo
evento e upsert, nunca linha nova."
```

---

## Task 9: O gate — as duas portas

**Files:**
- Create: `app/src/lib/billing/gate.ts`
- Test: `app/src/lib/billing/gate.smoke.test.ts`

- [ ] **Step 1: Implementar o gate**

Crie `app/src/lib/billing/gate.ts`:

```ts
// Bloco 4A — Gate de assinatura para ACOES DE ESCRITA COMERCIAL.
//
// Mesmo formato do assertAceitesEmDia (lib/lgpd/pendencia-aceite.ts): funcao
// chamada no topo da action, devolvendo {ok:false,error}. NAO e middleware
// nem layout — "o layout so cobre navegacao de pagina; server actions e
// route handlers nao passam pelo layout" (licao do Bloco E), e gate em
// middleware ja causou loop de redirect na sessao 3.
//
// DUAS FRONTEIRAS INEGOCIAVEIS — nunca chame estas funcoes em:
//  1. Acao de OBRIGACAO LEGAL com prazo (gerar DAS, registrar declaracao,
//     transmitir PGDAS-D). Bloquear vira multa da Receita para o usuario:
//     dano de terceiro, desproporcional a divida, e exposicao pelo CDC 39.
//  2. Acao de DIREITO DO TITULAR (LGPD art. 18: acesso, correcao,
//     portabilidade, eliminacao). O §5º obriga atendimento SEM CUSTO, e
//     inadimplencia nao e hipotese legal de suspensao desses direitos.
import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { ymdBrt } from '@/lib/fiscal/tempo-brt';
import { statusEfetivo, type AssinaturaParaStatus } from './status';

export type GateResult = { ok: true } | { ok: false; error: string };

const MSG =
  'Sua assinatura está com pendência. Regularize em Conta → Assinatura para voltar a usar esta função.';

/** Fail-open deliberado, igual ao `limitar` do rate-limit: erro de infra
 *  nao pode bloquear cliente que pagou. O risco inverso (um inadimplente
 *  passar durante uma falha de banco) e muito menor que barrar quem esta
 *  em dia. Toda ocorrencia vai pro log. */
function liberadoPorFalha(motivo: string, ref: string): GateResult {
  console.warn(`[billing gate] liberando por falha: ${motivo} (${ref})`);
  return { ok: true };
}

async function avaliar(
  coluna: 'contabilidade_id' | 'company_id',
  valor: string,
): Promise<GateResult> {
  try {
    const sb = createAdminClient();
    const { data, error } = await sb
      .from('assinaturas')
      .select('status, trial_termina_em')
      .eq(coluna, valor)
      .maybeSingle();

    if (error) return liberadoPorFalha('erro de consulta', valor);
    // Ausencia e bug (a trigger da 0050 cria a linha no INSERT do titular),
    // mas nao e motivo pra barrar quem talvez esteja em dia.
    if (!data) return liberadoPorFalha('assinatura ausente', valor);

    const efetivo = statusEfetivo(data as AssinaturaParaStatus, ymdBrt());
    return efetivo === 'liberado' ? { ok: true } : { ok: false, error: MSG };
  } catch {
    return liberadoPorFalha('excecao inesperada', valor);
  }
}

/** Gate das actions do escritorio (contador). */
export async function assertAssinaturaEscritorio(contabilidadeId: string): Promise<GateResult> {
  if (!contabilidadeId) return { ok: true };
  return avaliar('contabilidade_id', contabilidadeId);
}

/**
 * Gate das actions do empresario.
 *
 * Empresa de carteira (`contabilidade_id` preenchido) responde SEMPRE
 * liberada: quem paga e o escritorio, e a inadimplencia dele nao alcanca a
 * carteira (decisao de produto nº 3.3). Consequencia aceita e registrada:
 * escritorio que nunca assinou ou cancelou NAO trava os clientes dele.
 */
export async function assertAssinaturaEmpresa(companyId: string): Promise<GateResult> {
  if (!companyId) return { ok: true };
  try {
    const sb = createAdminClient();
    const { data: company, error } = await sb
      .from('companies').select('contabilidade_id').eq('id', companyId).maybeSingle();
    if (error || !company) return liberadoPorFalha('empresa nao encontrada', companyId);
    if (company.contabilidade_id) return { ok: true };
  } catch {
    return liberadoPorFalha('excecao ao ler empresa', companyId);
  }
  return avaliar('company_id', companyId);
}
```

- [ ] **Step 2: Escrever o smoke contra o banco real**

Crie `app/src/lib/billing/gate.smoke.test.ts`:

```ts
// Smoke do gate contra o banco REAL. Pula inteiro quando faltam as env
// (mesmo padrao de registrar.smoke.test.ts do Bloco 3): sem isso, `npm
// test` em main quebraria para quem nao tem .env.local.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const temEnv = Boolean(URL && KEY);

let sb: SupabaseClient;
let companyId = '';
let assinaturaId = '';

describe.skipIf(!temEnv)('gate de assinatura (banco real)', () => {
  beforeAll(async () => {
    sb = createClient(URL!, KEY!, { auth: { persistSession: false } });
    const { data } = await sb.from('companies')
      .select('id').is('contabilidade_id', null).is('deleted_at', null).limit(1).maybeSingle();
    companyId = data?.id ?? '';
    if (companyId) {
      const { data: a } = await sb.from('assinaturas')
        .select('id').eq('company_id', companyId).maybeSingle();
      assinaturaId = a?.id ?? '';
    }
  });

  afterAll(async () => {
    // Devolve a assinatura ao estado de cortesia — o smoke nao pode deixar
    // uma empresa real bloqueada.
    if (assinaturaId) {
      await sb.from('assinaturas')
        .update({ status: 'cortesia', trial_termina_em: null }).eq('id', assinaturaId);
    }
  });

  it('achou uma empresa autosservico com assinatura', () => {
    expect(companyId).not.toBe('');
    expect(assinaturaId).not.toBe('');
  });

  it('cortesia libera', async () => {
    await sb.from('assinaturas').update({ status: 'cortesia' }).eq('id', assinaturaId);
    const { assertAssinaturaEmpresa } = await import('./gate');
    expect(await assertAssinaturaEmpresa(companyId)).toEqual({ ok: true });
  });

  it('inadimplente bloqueia', async () => {
    await sb.from('assinaturas').update({ status: 'inadimplente' }).eq('id', assinaturaId);
    const { assertAssinaturaEmpresa } = await import('./gate');
    const r = await assertAssinaturaEmpresa(companyId);
    expect(r.ok).toBe(false);
  });

  // DISCRIMINANTE: sem este caso, um gate que barrasse TUDO passaria nos
  // dois testes acima.
  it('trial vigente libera', async () => {
    const amanha = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    await sb.from('assinaturas')
      .update({ status: 'trial', trial_termina_em: amanha }).eq('id', assinaturaId);
    const { assertAssinaturaEmpresa } = await import('./gate');
    expect(await assertAssinaturaEmpresa(companyId)).toEqual({ ok: true });
  });

  // DISCRIMINANTE da decisao 3.3: empresa de carteira nunca consulta
  // assinatura propria. Sem ele, um gate que ignorasse a carteira passaria.
  it('empresa de carteira libera mesmo com o escritorio inadimplente', async () => {
    const { data: comCarteira } = await sb.from('companies')
      .select('id, contabilidade_id').not('contabilidade_id', 'is', null).limit(1).maybeSingle();
    if (!comCarteira) return;  // ambiente sem empresa de carteira
    const { data: aEsc } = await sb.from('assinaturas')
      .select('id, status').eq('contabilidade_id', comCarteira.contabilidade_id).maybeSingle();
    const original = aEsc?.status;
    if (aEsc) await sb.from('assinaturas').update({ status: 'inadimplente' }).eq('id', aEsc.id);

    const { assertAssinaturaEmpresa } = await import('./gate');
    expect(await assertAssinaturaEmpresa(comCarteira.id)).toEqual({ ok: true });

    if (aEsc && original) await sb.from('assinaturas').update({ status: original }).eq('id', aEsc.id);
  });
});
```

- [ ] **Step 3: Rodar**

Run: `npx vitest run src/lib/billing/gate.smoke.test.ts`
Expected: PASS (5 casos) — ou **skipped** se `.env.local` não estiver carregado no ambiente de teste. Se pular, rode com as variáveis exportadas.

- [ ] **Step 4: Commit**

```bash
git add app/src/lib/billing/gate.ts app/src/lib/billing/gate.smoke.test.ts
git commit -m "feat(bloco-4a): gate de assinatura em duas portas

Fail-open deliberado em erro de infra (igual ao limitar do rate-limit):
barrar quem pagou por causa de falha de banco e pior que deixar passar
um inadimplente por instantes.

Empresa de carteira responde sempre liberada — quem paga e o escritorio
e a inadimplencia dele nao alcanca os clientes (decisao 3.3).

O smoke pula sem env (describe.skipIf), senao npm test quebraria em main."
```

---

## Task 10: Aplicar o gate nas actions comerciais

**Files:**
- Modify: `app/src/app/(auth)/(gated)/notas_fiscais/actions.ts`
- Modify: `app/src/app/(auth)/(gated)/clientes/actions.ts`
- Modify: `app/src/app/(auth)/(gated)/contador/aberturas/actions.ts`
- Modify: `app/src/app/(auth)/(gated)/contador/honorarios/actions.ts`
- Modify: `app/src/app/(auth)/(gated)/contador/actions.ts`
- Modify: `app/src/app/(onboarding)/onboarding/abertura/actions.ts`
- Test: `app/src/lib/billing/cobertura-gate.test.ts`

- [ ] **Step 1: Escrever o teste de cobertura**

Este teste lê os arquivos-fonte e verifica quem chama o gate. Ele é a proteção contra o esquecimento numa action futura.

Crie `app/src/lib/billing/cobertura-gate.test.ts`:

```ts
// Teste de cobertura do gate. Le os fontes e confere QUEM chama o gate.
//
// Existe por causa da licao do Bloco 3: sem discriminante, os testes de
// bloqueio passariam mesmo com um gate que barra tudo. Aqui ele falha nos
// DOIS sentidos — action comercial que perdeu o gate, e action fiscal ou
// de direito do titular que ganhou gate por engano.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'src', 'app');
const ler = (p: string) => readFileSync(join(SRC, p), 'utf8');

/** Extrai o corpo de uma action exportada, do `export async function NOME`
 *  ate o proximo `export async function` (ou fim do arquivo). */
function corpoDaAction(fonte: string, nome: string): string {
  const i = fonte.indexOf(`export async function ${nome}`);
  if (i < 0) throw new Error(`action nao encontrada: ${nome}`);
  const resto = fonte.slice(i + 1);
  const j = resto.indexOf('\nexport async function ');
  return j < 0 ? resto : resto.slice(0, j);
}

const CHAMA_GATE = /assertAssinatura(Empresa|Escritorio)\s*\(/;

const DEVE_TER_GATE: Array<[string, string[]]> = [
  ['(auth)/(gated)/notas_fiscais/actions.ts', [
    'emitirNotaAction', 'emitirNfeAction', 'emitirNfceAction',
    'cancelarNotaAction', 'lancarNotaManualAction', 'criarProdutoAction',
  ]],
  ['(auth)/(gated)/clientes/actions.ts', [
    'createClienteAction', 'updateClienteAction', 'softDeleteClienteAction',
  ]],
  ['(auth)/(gated)/contador/aberturas/actions.ts', [
    'avancarProcessoAction', 'concluirAberturaAction', 'decidirAlteracaoAction',
    'gerarMinutaAction', 'revisarDocumentoAction',
  ]],
  ['(auth)/(gated)/contador/honorarios/actions.ts', [
    'createHonorarioV2Action', 'updateHonorarioV2Action', 'marcarPagoV2Action',
    'desmarcarPagoV2Action', 'deleteHonorarioV2Action',
  ]],
  ['(onboarding)/onboarding/abertura/actions.ts', ['submitAberturaAction']],
];

const NUNCA_PODE_TER_GATE: Array<[string, string[]]> = [
  // Obrigacao legal com prazo — bloquear vira multa da Receita.
  ['(auth)/(gated)/impostos/actions.ts', [
    'gerarDasMeiAction', 'gerarDasSimplesAction', 'iniciarApuracaoAction',
    'consultarDeclaracoesAction', 'consultarDasnSimeiAction', 'previewDeclaracaoAction',
    'registrarDeclaracaoAnualAction', 'marcarGuiaPagaAction', 'salvarFolhaAction',
    'marcarSincronizacaoInicialAction',
  ]],
  ['(auth)/(gated)/contador/clientes/actions.ts', ['registrarDeclaracaoAnualContadorAction']],
  // Direito do titular — LGPD art. 18 e §5º (atendimento sem custo).
  ['(auth)/(gated)/conta/actions.ts', [
    'updateNomeAction', 'updateEmailAction', 'updateSenhaAction', 'deleteAccountAction',
    'salvarPreferenciasNotificacaoAction', 'exportarMeusDadosAction',
  ]],
  ['(auth)/(gated)/notas_fiscais/actions.ts', ['exportNotasCsvAction']],
];

describe('cobertura do gate de assinatura', () => {
  for (const [arquivo, actions] of DEVE_TER_GATE) {
    const fonte = ler(arquivo);
    for (const nome of actions) {
      it(`${nome} chama o gate`, () => {
        expect(CHAMA_GATE.test(corpoDaAction(fonte, nome))).toBe(true);
      });
    }
  }

  for (const [arquivo, actions] of NUNCA_PODE_TER_GATE) {
    const fonte = ler(arquivo);
    for (const nome of actions) {
      it(`${nome} NAO pode ter gate`, () => {
        expect(CHAMA_GATE.test(corpoDaAction(fonte, nome))).toBe(false);
      });
    }
  }
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npx vitest run src/lib/billing/cobertura-gate.test.ts`
Expected: FAIL — os 20 casos de `DEVE_TER_GATE` falham (o gate ainda não foi aplicado); os de `NUNCA_PODE_TER_GATE` já passam.

- [ ] **Step 3: Aplicar o gate nas actions do empresário**

Em `app/src/app/(auth)/(gated)/notas_fiscais/actions.ts`, adicione o import junto dos outros:

```ts
import { assertAssinaturaEmpresa } from '@/lib/billing/gate';
```

Em **cada** uma de `emitirNotaAction`, `emitirNfeAction`, `emitirNfceAction`, `cancelarNotaAction`, `lancarNotaManualAction`, `criarProdutoAction`, insira o bloco abaixo **logo depois** da linha que resolve `companyId` (o padrão do arquivo é `const companyId = (profile?.current_company ?? null) as string | null;` seguido do guard de `!companyId`):

```ts
  const assinatura = await assertAssinaturaEmpresa(companyId);
  if (!assinatura.ok) return { ok: false, error: assinatura.error };
```

> Ordem importa: **depois** do `assertAceitesEmDia` e **depois** de `companyId` existir. Se alguma dessas actions resolver a empresa por outro caminho, use a variável que ela já tem — não introduza uma segunda leitura de `current_company` (foi assim que o Bloco 3 gravou na empresa errada).

Em `app/src/app/(auth)/(gated)/clientes/actions.ts`, mesmo import, e o mesmo bloco em `createClienteAction`, `updateClienteAction` e `softDeleteClienteAction` depois de a empresa corrente ser resolvida.

Em `app/src/app/(onboarding)/onboarding/abertura/actions.ts`, `submitAberturaAction` cria empresa nova — não há `companyId` ainda. Use a empresa corrente do perfil quando existir; quando não existir (primeiro acesso), **libere**:

```ts
  const { data: prof } = await supabase
    .from('profiles').select('current_company').eq('user_id', user.id).maybeSingle();
  if (prof?.current_company) {
    const assinatura = await assertAssinaturaEmpresa(prof.current_company as string);
    if (!assinatura.ok) return { ok: false, error: assinatura.error };
  }
```

- [ ] **Step 4: Aplicar o gate nas actions do escritório**

Em `contador/aberturas/actions.ts`, `contador/honorarios/actions.ts` e `contador/actions.ts`, adicione:

```ts
import { assertAssinaturaEscritorio } from '@/lib/billing/gate';
```

Nas actions listadas, insira **logo depois** do guard de escritório (o padrão é `const ctx = await requireEscritorioAprovado(); if ('ok' in ctx) return ctx;` em `honorarios`, e `requireEscritorio()` nos demais):

```ts
  const assinatura = await assertAssinaturaEscritorio(ctx.id);
  if (!assinatura.ok) return { ok: false, error: assinatura.error };
```

> Em `contador/aberturas/actions.ts` e `contador/actions.ts` o contexto pode se chamar diferente (`g.contabilidadeId`, `ctx.contabilidadeId`). **Use o nome que o arquivo já usa** — não renomeie nada.

- [ ] **Step 5: Rodar para ver passar**

Run: `npx vitest run src/lib/billing/cobertura-gate.test.ts`
Expected: PASS — todos os casos, nos dois sentidos.

- [ ] **Step 6: Verificar o conjunto**

```bash
npx tsc --noEmit
npx vitest run
```
Expected: `tsc` 0 erros; suíte verde (568 anteriores + os novos).

- [ ] **Step 7: Commit**

```bash
git add app/src/app/ app/src/lib/billing/cobertura-gate.test.ts
git commit -m "feat(bloco-4a): aplica o gate nas 20 actions comerciais

O teste de cobertura falha nos DOIS sentidos: action comercial que perde
o gate, e action fiscal ou de direito do titular que ganha gate por
engano. Sem o segundo sentido, os testes passariam com um gate que barra
tudo — licao do Bloco 3."
```

---

## Task 11: Tela de admin dos planos

**Files:**
- Modify: `app/src/lib/admin/guard.ts`
- Modify: `app/src/app/(auth)/(gated)/admin/contabilidades/actions.ts`
- Create: `app/src/app/(auth)/(gated)/admin/assinaturas/page.tsx`
- Create: `app/src/app/(auth)/(gated)/admin/assinaturas/PlanosAdmin.tsx`
- Create: `app/src/app/(auth)/(gated)/admin/assinaturas/actions.ts`
- Test: `app/src/lib/billing/validar-planos.test.ts`
- Create: `app/src/lib/billing/validar-planos.ts`

- [ ] **Step 1: Escrever o teste das validações**

Crie `app/src/lib/billing/validar-planos.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validarFaixas } from './validar-planos';

describe('validarFaixas', () => {
  it('faixas contiguas passam', () => {
    expect(validarFaixas([
      { id: 'a', clientes_min: 0,   clientes_max: 50 },
      { id: 'b', clientes_min: 51,  clientes_max: 200 },
      { id: 'c', clientes_min: 201, clientes_max: null },
    ])).toEqual({ ok: true });
  });

  it('sobreposicao e recusada, nomeando os planos', () => {
    expect(validarFaixas([
      { id: 'a', clientes_min: 0,  clientes_max: 100 },
      { id: 'b', clientes_min: 50, clientes_max: 200 },
    ])).toEqual({ ok: false, erro: 'As faixas de "a" e "b" se sobrepoem.' });
  });

  it('buraco e recusado, nomeando os planos', () => {
    expect(validarFaixas([
      { id: 'a', clientes_min: 0,   clientes_max: 10 },
      { id: 'b', clientes_min: 100, clientes_max: null },
    ])).toEqual({ ok: false, erro: 'Ha um buraco entre "a" e "b": ninguem cobre 11 a 99.' });
  });

  it('min maior que max e recusado', () => {
    expect(validarFaixas([{ id: 'a', clientes_min: 100, clientes_max: 10 }]))
      .toEqual({ ok: false, erro: 'O plano "a" tem inicio maior que o fim.' });
  });

  it('lista vazia passa (nao ha o que validar)', () => {
    expect(validarFaixas([])).toEqual({ ok: true });
  });

  it('duas faixas abertas no topo sao recusadas', () => {
    expect(validarFaixas([
      { id: 'a', clientes_min: 0,  clientes_max: null },
      { id: 'b', clientes_min: 50, clientes_max: null },
    ])).toEqual({ ok: false, erro: 'As faixas de "a" e "b" se sobrepoem.' });
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npx vitest run src/lib/billing/validar-planos.test.ts`
Expected: FAIL — `Failed to resolve import "./validar-planos"`

- [ ] **Step 3: Implementar**

Crie `app/src/lib/billing/validar-planos.ts`:

```ts
// Bloco 4A — validacao das faixas de plano de escritorio. Puro, sem I/O.
//
// Existe porque o AdminBalu edita as faixas em runtime: e ele quem pode
// criar o buraco ou a sobreposicao. Validar ANTES de salvar e mais barato
// que descobrir no cron de recalculo.

export type FaixaPlano = { id: string; clientes_min: number | null; clientes_max: number | null };
export type ResultadoValidacao = { ok: true } | { ok: false; erro: string };

export function validarFaixas(planos: FaixaPlano[]): ResultadoValidacao {
  if (planos.length === 0) return { ok: true };

  for (const p of planos) {
    const min = p.clientes_min ?? 0;
    if (p.clientes_max !== null && min > p.clientes_max) {
      return { ok: false, erro: `O plano "${p.id}" tem inicio maior que o fim.` };
    }
  }

  const ord = [...planos].sort((a, b) => (a.clientes_min ?? 0) - (b.clientes_min ?? 0));

  for (let i = 1; i < ord.length; i++) {
    const ant = ord[i - 1];
    const cur = ord[i];
    const fimAnt = ant.clientes_max;          // null = aberta no topo
    const iniCur = cur.clientes_min ?? 0;

    if (fimAnt === null || iniCur <= fimAnt) {
      return { ok: false, erro: `As faixas de "${ant.id}" e "${cur.id}" se sobrepoem.` };
    }
    if (iniCur > fimAnt + 1) {
      return {
        ok: false,
        erro: `Ha um buraco entre "${ant.id}" e "${cur.id}": ninguem cobre ${fimAnt + 1} a ${iniCur - 1}.`,
      };
    }
  }
  return { ok: true };
}
```

- [ ] **Step 4: Rodar para ver passar**

Run: `npx vitest run src/lib/billing/validar-planos.test.ts`
Expected: PASS — 6 passed

- [ ] **Step 5: Extrair o guard de admin para action**

Adicione ao fim de `app/src/lib/admin/guard.ts`:

```ts
/** Guard de AÇÃO do AdminBalu. Diferente do `requireAdminBaluPage`, que
 *  redireciona: aqui devolvemos erro, porque Server Actions não podem
 *  redirecionar de dentro sem perder a mensagem. Extraído de
 *  `admin/contabilidades/actions.ts`, onde nasceu local ao arquivo. */
export async function requireAdminBaluAction(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Sessão inválida.' };
  const { data: role } = await supabase
    .from('role_types').select('type').eq('user_id', user.id).maybeSingle();
  if (role?.type !== 'AdminBalu') return { error: 'Acesso restrito.' };
  return { userId: user.id };
}
```

Em `app/src/app/(auth)/(gated)/admin/contabilidades/actions.ts`, **apague** a função local `requireAdminBalu` (linhas 13–21) e adicione o import:

```ts
import { requireAdminBaluAction } from '@/lib/admin/guard';
```

Depois troque as chamadas `requireAdminBalu()` por `requireAdminBaluAction()` no arquivo inteiro.

- [ ] **Step 6: Actions da tela de planos**

Crie `app/src/app/(auth)/(gated)/admin/assinaturas/actions.ts`:

```ts
'use server';
// Bloco 4A — o AdminBalu gerencia os planos. Mudar preco e ato
// administrativo com consequencia financeira: tudo vai pro audit_log.
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdminBaluAction } from '@/lib/admin/guard';
import { registrarAuditoria } from '@/lib/security/audit';
import { validarFaixas } from '@/lib/billing/validar-planos';

export type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

export type PlanoInput = {
  id: string;
  nome: string;
  publico: 'empresa' | 'escritorio';
  valor_centavos: number;
  ciclo: 'MONTHLY' | 'YEARLY';
  clientes_min: number | null;
  clientes_max: number | null;
  trial_dias: number;
  ativo: boolean;
};

export async function salvarPlanoAction(input: PlanoInput): Promise<ActionResult> {
  const ctx = await requireAdminBaluAction();
  if ('error' in ctx) return { ok: false, error: ctx.error };

  if (!input.id || !input.nome) return { ok: false, error: 'Id e nome sao obrigatorios.' };
  if (!Number.isInteger(input.valor_centavos) || input.valor_centavos < 0) {
    return { ok: false, error: 'Valor invalido.' };
  }
  if (!Number.isInteger(input.trial_dias) || input.trial_dias < 0) {
    return { ok: false, error: 'Dias de trial invalido.' };
  }

  const admin = createAdminClient();

  // Faixas so fazem sentido para escritorio; e validar ANTES de salvar
  // evita que o admin crie o buraco que o cron de recalculo so descobriria
  // no mes seguinte.
  if (input.publico === 'escritorio') {
    const { data: outros } = await admin
      .from('planos').select('id, clientes_min, clientes_max')
      .eq('publico', 'escritorio').eq('ativo', true).neq('id', input.id);
    const conjunto = [
      ...(outros ?? []),
      ...(input.ativo
        ? [{ id: input.id, clientes_min: input.clientes_min, clientes_max: input.clientes_max }]
        : []),
    ];
    const v = validarFaixas(conjunto);
    if (!v.ok) return { ok: false, error: v.erro };
  }

  const { error } = await admin.from('planos').upsert({
    ...input, updated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: error.message };

  await registrarAuditoria({
    actorUserId: ctx.userId, acao: 'plano.salvar',
    alvoTipo: 'plano', alvoId: input.id,
    meta: { valor_centavos: input.valor_centavos, trial_dias: input.trial_dias, ativo: input.ativo },
  });

  revalidatePath('/admin/assinaturas');
  return { ok: true };
}

export async function desativarPlanoAction(id: string): Promise<ActionResult> {
  const ctx = await requireAdminBaluAction();
  if ('error' in ctx) return { ok: false, error: ctx.error };

  const admin = createAdminClient();

  // Desativar plano com assinatura viva deixaria orfaos que ninguem
  // conseguiria cobrar nem exibir. Recusar dizendo QUANTAS sao.
  const { count } = await admin
    .from('assinaturas').select('id', { count: 'exact', head: true })
    .eq('plano_id', id).in('status', ['trial', 'ativa', 'inadimplente']);
  if ((count ?? 0) > 0) {
    return { ok: false, error: `Nao da pra desativar: ${count} assinatura(s) usam este plano.` };
  }

  const { error } = await admin.from('planos')
    .update({ ativo: false, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) return { ok: false, error: error.message };

  await registrarAuditoria({
    actorUserId: ctx.userId, acao: 'plano.desativar', alvoTipo: 'plano', alvoId: id,
  });

  revalidatePath('/admin/assinaturas');
  return { ok: true };
}
```

- [ ] **Step 7: Página e componente**

Crie `app/src/app/(auth)/(gated)/admin/assinaturas/page.tsx`:

```tsx
import { requireAdminBaluPage } from '@/lib/admin/guard';
import { createAdminClient } from '@/lib/supabase/admin';
import PlanosAdmin from './PlanosAdmin';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requireAdminBaluPage();
  const admin = createAdminClient();

  const { data: planos } = await admin
    .from('planos').select('*').order('publico').order('valor_centavos');

  const { data: assinaturas } = await admin
    .from('assinaturas').select('plano_id, status');

  const usoPorPlano: Record<string, number> = {};
  for (const a of assinaturas ?? []) {
    if (a.plano_id && ['trial', 'ativa', 'inadimplente'].includes(a.status)) {
      usoPorPlano[a.plano_id] = (usoPorPlano[a.plano_id] ?? 0) + 1;
    }
  }

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-1">Assinaturas</h1>
      <p className="text-sm text-neutral-500 mb-6">
        Preços, faixas e período de teste. Alterações valem para as próximas cobranças.
      </p>
      <PlanosAdmin planos={planos ?? []} usoPorPlano={usoPorPlano} />
    </div>
  );
}
```

Crie `app/src/app/(auth)/(gated)/admin/assinaturas/PlanosAdmin.tsx`:

```tsx
'use client';
import { useState, useTransition } from 'react';
import { salvarPlanoAction, desativarPlanoAction, type PlanoInput } from './actions';

type Plano = PlanoInput & { created_at?: string; updated_at?: string };

const reais = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function PlanosAdmin({
  planos, usoPorPlano,
}: { planos: Plano[]; usoPorPlano: Record<string, number> }) {
  const [edit, setEdit] = useState<Plano | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function salvar(p: Plano) {
    setMsg(null);
    start(async () => {
      const r = await salvarPlanoAction(p);
      setMsg(r.ok ? 'Salvo.' : r.error);
      if (r.ok) setEdit(null);
    });
  }

  function desativar(id: string) {
    setMsg(null);
    start(async () => {
      const r = await desativarPlanoAction(id);
      setMsg(r.ok ? 'Plano desativado.' : r.error);
    });
  }

  return (
    <div className="space-y-4">
      {msg && <p className="text-sm rounded border px-3 py-2">{msg}</p>}

      <table className="w-full text-sm">
        <thead className="text-left text-neutral-500">
          <tr>
            <th className="py-2">Plano</th><th>Público</th><th>Valor</th>
            <th>Faixa</th><th>Teste</th><th>Em uso</th><th></th>
          </tr>
        </thead>
        <tbody>
          {planos.map((p) => (
            <tr key={p.id} className="border-t">
              <td className="py-2">
                {p.nome}{!p.ativo && <span className="ml-2 text-xs text-neutral-400">(inativo)</span>}
              </td>
              <td>{p.publico === 'empresa' ? 'Empresário' : 'Escritório'}</td>
              <td>{reais(p.valor_centavos)}</td>
              <td>
                {p.publico === 'escritorio'
                  ? `${p.clientes_min ?? 0} a ${p.clientes_max ?? '∞'}`
                  : '—'}
              </td>
              <td>{p.trial_dias} dias</td>
              <td>{usoPorPlano[p.id] ?? 0}</td>
              <td className="text-right">
                <button className="underline mr-3" onClick={() => setEdit(p)}>Editar</button>
                {p.ativo && (
                  <button className="underline" disabled={pending} onClick={() => desativar(p.id)}>
                    Desativar
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {edit && (
        <form
          className="border rounded p-4 space-y-3 max-w-md"
          onSubmit={(e) => { e.preventDefault(); salvar(edit); }}
        >
          <h2 className="font-medium">Editar {edit.nome}</h2>

          <label className="block text-sm">Nome
            <input className="mt-1 w-full border rounded px-2 py-1" value={edit.nome}
              onChange={(e) => setEdit({ ...edit, nome: e.target.value })} />
          </label>

          <label className="block text-sm">Valor (R$)
            <input type="number" step="0.01" min="0" className="mt-1 w-full border rounded px-2 py-1"
              value={(edit.valor_centavos / 100).toFixed(2)}
              onChange={(e) => setEdit({
                ...edit, valor_centavos: Math.round(parseFloat(e.target.value || '0') * 100),
              })} />
          </label>

          <label className="block text-sm">Dias de teste
            <input type="number" min="0" className="mt-1 w-full border rounded px-2 py-1"
              value={edit.trial_dias}
              onChange={(e) => setEdit({ ...edit, trial_dias: parseInt(e.target.value || '0', 10) })} />
          </label>

          {edit.publico === 'escritorio' && (
            <div className="flex gap-3">
              <label className="block text-sm flex-1">De (clientes)
                <input type="number" min="0" className="mt-1 w-full border rounded px-2 py-1"
                  value={edit.clientes_min ?? 0}
                  onChange={(e) => setEdit({ ...edit, clientes_min: parseInt(e.target.value || '0', 10) })} />
              </label>
              <label className="block text-sm flex-1">Até (vazio = sem limite)
                <input type="number" min="0" className="mt-1 w-full border rounded px-2 py-1"
                  value={edit.clientes_max ?? ''}
                  onChange={(e) => setEdit({
                    ...edit, clientes_max: e.target.value === '' ? null : parseInt(e.target.value, 10),
                  })} />
              </label>
            </div>
          )}

          <div className="flex gap-2">
            <button type="submit" disabled={pending}
              className="border rounded px-3 py-1">Salvar</button>
            <button type="button" onClick={() => setEdit(null)}
              className="underline px-3 py-1">Cancelar</button>
          </div>
        </form>
      )}
    </div>
  );
}
```

- [ ] **Step 8: Link no menu do admin**

O NAV vive em `app/src/components/MenuLateral.tsx:58-77`. Adicione `CreditCard` ao import de `lucide-react` no topo do arquivo, e insira a linha abaixo **logo após** `{ href: '/admin/usuarios', ... }` (linha 75):

```tsx
  { href: '/admin/assinaturas',     label: 'Assinaturas',    Icon: CreditCard, roles: ['adminbalu'] },
```

> Isto não é opcional: a sessão 3 encontrou `/contador/honorarios` **órfã**, sem link em menu nenhum. Página sem caminho é página que não existe.

- [ ] **Step 9: Verificar e commitar**

```bash
npx tsc --noEmit
npx vitest run
git add app/src/lib/admin/guard.ts app/src/lib/billing/validar-planos.ts app/src/lib/billing/validar-planos.test.ts "app/src/app/(auth)/(gated)/admin/"
git commit -m "feat(bloco-4a): tela de admin dos planos

Preco, faixa e dias de teste editaveis pelo AdminBalu — mudar preco
virou operacao, nao deploy. Validacao de faixa acontece ANTES de salvar
porque agora e o admin quem pode criar buraco ou sobreposicao.

Desativar plano com assinatura viva e recusado dizendo quantas sao.

requireAdminBalu de action era local a admin/contabilidades/actions.ts;
extraido para lib/admin/guard.ts em vez de duplicado."
```

---

## Task 12: Telas do assinante e faixa de aviso

**Files:**
- Create: `app/src/app/(auth)/(gated)/conta/assinatura/page.tsx`
- Create: `app/src/app/(auth)/(gated)/contador/assinatura/page.tsx`
- Create: `app/src/app/(auth)/(gated)/conta/assinatura/AssinaturaView.tsx`
- Create: `app/src/app/(auth)/(gated)/conta/assinatura/actions.ts`

- [ ] **Step 1: Action de cancelamento**

Crie `app/src/app/(auth)/(gated)/conta/assinatura/actions.ts`:

```ts
'use server';
// Bloco 4A — cancelamento da assinatura.
//
// CDC art. 39: cancelar e UM CLIQUE, nunca um contato com suporte, nunca
// uma tela de retencao que esconda o botao.
import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { registrarAuditoria } from '@/lib/security/audit';
import { asaas } from '@/lib/clients';

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function cancelarAssinaturaAction(assinaturaId: string): Promise<ActionResult> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  // A leitura passa pela SESSAO: a policy assinaturas_select_titular ja
  // garante que so o titular enxerga a linha. Anti-IDOR de graca.
  const { data: assinatura } = await supabase
    .from('assinaturas').select('id, asaas_subscription_id').eq('id', assinaturaId).maybeSingle();
  if (!assinatura) return { ok: false, error: 'Assinatura não encontrada.' };

  if (assinatura.asaas_subscription_id) {
    try {
      await asaas.cancelarAssinatura(assinatura.asaas_subscription_id);
    } catch (err) {
      console.error('[assinatura] falha ao cancelar no Asaas', err);
      return { ok: false, error: 'Não foi possível cancelar agora. Tente novamente em instantes.' };
    }
  }

  const admin = createAdminClient();
  const { error } = await admin.from('assinaturas').update({
    status: 'cancelada', cancelada_em: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', assinatura.id);
  if (error) return { ok: false, error: error.message };

  await registrarAuditoria({
    actorUserId: user.id, acao: 'assinatura.cancelar',
    alvoTipo: 'assinatura', alvoId: assinatura.id,
  });

  revalidatePath('/conta/assinatura');
  revalidatePath('/contador/assinatura');
  return { ok: true };
}
```

- [ ] **Step 2: Componente de visualização**

Crie `app/src/app/(auth)/(gated)/conta/assinatura/AssinaturaView.tsx`:

```tsx
'use client';
import { useState, useTransition } from 'react';
import { cancelarAssinaturaAction } from './actions';

export type CobrancaVm = {
  id: string; status: string; valor_centavos: number;
  vencimento: string; link_fatura: string | null; pix_copia_cola: string | null;
};
export type AssinaturaVm = {
  id: string; status: string; trial_termina_em: string | null;
  proxima_cobranca_em: string | null; planoNome: string | null; valor_centavos: number | null;
};

const reais = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (d: string) => d.split('-').reverse().join('/');

const ROTULO: Record<string, string> = {
  trial: 'Período de teste',
  ativa: 'Ativa',
  inadimplente: 'Pagamento pendente',
  cancelada: 'Cancelada',
  cortesia: 'Cortesia',
};

export default function AssinaturaView({
  assinatura, cobrancas,
}: { assinatura: AssinaturaVm; cobrancas: CobrancaVm[] }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [pending, start] = useTransition();

  function cancelar() {
    start(async () => {
      const r = await cancelarAssinaturaAction(assinatura.id);
      setMsg(r.ok ? 'Assinatura cancelada.' : r.error);
      setConfirmando(false);
    });
  }

  return (
    <div className="space-y-6">
      {msg && <p className="text-sm rounded border px-3 py-2">{msg}</p>}

      <section className="border rounded p-4">
        <h2 className="font-medium mb-2">{assinatura.planoNome ?? 'Sem plano'}</h2>
        <p className="text-sm">Situação: <strong>{ROTULO[assinatura.status] ?? assinatura.status}</strong></p>
        {assinatura.valor_centavos !== null && (
          <p className="text-sm">Valor: {reais(assinatura.valor_centavos)} por mês</p>
        )}
        {assinatura.status === 'trial' && assinatura.trial_termina_em && (
          <p className="text-sm">Teste até {dataBr(assinatura.trial_termina_em)}</p>
        )}
        {assinatura.proxima_cobranca_em && (
          <p className="text-sm">Próxima cobrança em {dataBr(assinatura.proxima_cobranca_em)}</p>
        )}
      </section>

      <section>
        <h2 className="font-medium mb-2">Cobranças</h2>
        {cobrancas.length === 0 ? (
          <p className="text-sm text-neutral-500">Nenhuma cobrança ainda.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-neutral-500">
              <tr><th className="py-2">Vencimento</th><th>Valor</th><th>Situação</th><th></th></tr>
            </thead>
            <tbody>
              {cobrancas.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="py-2">{dataBr(c.vencimento)}</td>
                  <td>{reais(c.valor_centavos)}</td>
                  <td>{c.status}</td>
                  <td className="text-right">
                    {c.link_fatura && (
                      <a className="underline" href={c.link_fatura} target="_blank" rel="noreferrer">
                        Abrir fatura
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* CDC art. 39: cancelar e um clique. Uma confirmacao simples, sem
          tela de retencao, sem "fale com o suporte". */}
      {!['cancelada', 'cortesia'].includes(assinatura.status) && (
        <section className="border-t pt-4">
          {confirmando ? (
            <div className="flex items-center gap-3">
              <span className="text-sm">Cancelar a assinatura?</span>
              <button className="border rounded px-3 py-1" disabled={pending} onClick={cancelar}>
                Sim, cancelar
              </button>
              <button className="underline" onClick={() => setConfirmando(false)}>Voltar</button>
            </div>
          ) : (
            <button className="underline text-sm" onClick={() => setConfirmando(true)}>
              Cancelar assinatura
            </button>
          )}
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Página do empresário**

Crie `app/src/app/(auth)/(gated)/conta/assinatura/page.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import AssinaturaView, { type AssinaturaVm, type CobrancaVm } from './AssinaturaView';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles').select('current_company').eq('user_id', user.id).maybeSingle();
  const companyId = profile?.current_company as string | null;
  if (!companyId) {
    return <div className="p-6"><p className="text-sm">Nenhuma empresa selecionada.</p></div>;
  }

  const { data: company } = await supabase
    .from('companies').select('contabilidade_id').eq('id', companyId).maybeSingle();

  // Empresa de carteira NAO paga — quem paga e o escritorio. Mostrar
  // cobranca a quem nao deve nada e bug de produto (decisao 3.2).
  if (company?.contabilidade_id) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold mb-2">Assinatura</h1>
        <p className="text-sm text-neutral-600">
          Sua empresa é atendida por um escritório de contabilidade, e o acesso à Balu está
          incluído no serviço dele. Não há cobrança para você aqui.
        </p>
      </div>
    );
  }

  const { data: a } = await supabase
    .from('assinaturas')
    .select('id, status, trial_termina_em, proxima_cobranca_em, plano_id, planos ( nome, valor_centavos )')
    .eq('company_id', companyId).maybeSingle();

  if (!a) return <div className="p-6"><p className="text-sm">Assinatura não encontrada.</p></div>;

  const plano = (a.planos ?? null) as { nome: string; valor_centavos: number } | null;
  const assinatura: AssinaturaVm = {
    id: a.id, status: a.status,
    trial_termina_em: a.trial_termina_em, proxima_cobranca_em: a.proxima_cobranca_em,
    planoNome: plano?.nome ?? null, valor_centavos: plano?.valor_centavos ?? null,
  };

  const { data: cobrancas } = await supabase
    .from('cobrancas')
    .select('id, status, valor_centavos, vencimento, link_fatura, pix_copia_cola')
    .eq('assinatura_id', a.id).order('vencimento', { ascending: false }).limit(24);

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-6">Assinatura</h1>
      <AssinaturaView assinatura={assinatura} cobrancas={(cobrancas ?? []) as CobrancaVm[]} />
    </div>
  );
}
```

- [ ] **Step 4: Página do escritório**

Crie `app/src/app/(auth)/(gated)/contador/assinatura/page.tsx` — igual à anterior, trocando a resolução do titular:

```tsx
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { getContabilidadeCtx } from '@/lib/contador/guards';
import AssinaturaView, { type AssinaturaVm, type CobrancaVm }
  from '../../conta/assinatura/AssinaturaView';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const ctx = await getContabilidadeCtx();
  if ('error' in ctx) redirect('/login');
  if (!ctx.contabilidade) {
    return <div className="p-6"><p className="text-sm">Você não faz parte de um escritório.</p></div>;
  }

  const supabase = await createServerClient();
  const { data: a } = await supabase
    .from('assinaturas')
    .select('id, status, trial_termina_em, proxima_cobranca_em, plano_id, planos ( nome, valor_centavos )')
    .eq('contabilidade_id', ctx.contabilidade.id).maybeSingle();

  if (!a) return <div className="p-6"><p className="text-sm">Assinatura não encontrada.</p></div>;

  const plano = (a.planos ?? null) as { nome: string; valor_centavos: number } | null;
  const assinatura: AssinaturaVm = {
    id: a.id, status: a.status,
    trial_termina_em: a.trial_termina_em, proxima_cobranca_em: a.proxima_cobranca_em,
    planoNome: plano?.nome ?? null, valor_centavos: plano?.valor_centavos ?? null,
  };

  const { data: cobrancas } = await supabase
    .from('cobrancas')
    .select('id, status, valor_centavos, vencimento, link_fatura, pix_copia_cola')
    .eq('assinatura_id', a.id).order('vencimento', { ascending: false }).limit(24);

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-6">Assinatura do escritório</h1>
      <AssinaturaView assinatura={assinatura} cobrancas={(cobrancas ?? []) as CobrancaVm[]} />
    </div>
  );
}
```

- [ ] **Step 5: Links nos menus**

No mesmo `app/src/components/MenuLateral.tsx`, insira **antes** de `{ href: '/conta', ... }` (linha 76):

```tsx
  { href: '/contador/assinatura',   label: 'Assinatura',     Icon: CreditCard, roles: ['contador'] },
  { href: '/conta/assinatura',      label: 'Assinatura',     Icon: CreditCard, precisaEmpresa: true },
```

> `precisaEmpresa: true` no item do empresário é deliberado: sem empresa corrente a tela termina em "Nenhuma empresa selecionada", e o docblock do `NavItem` (linhas 51-55) diz que nesse caso o item é escondido em vez de virar beco.

- [ ] **Step 6: Verificar e commitar**

```bash
npx tsc --noEmit
npx vitest run
git add "app/src/app/(auth)/(gated)/conta/assinatura/" "app/src/app/(auth)/(gated)/contador/assinatura/" app/src/components
git commit -m "feat(bloco-4a): telas de assinatura do empresario e do escritorio

Cancelar e um clique, sem tela de retencao (CDC art. 39). Empresa de
carteira ve uma explicacao de que nao paga, nao um formulario de
cobranca — mostrar cobranca a quem nao deve nada e bug de produto."
```

---

## Task 13: Crons — reconciliação, faixa e avisos

**Files:**
- Create: `app/src/app/api/cron/billing/route.ts`
- Modify: `app/vercel.json` (**condicional** — ver Step 1)

- [ ] **Step 1: Confirmar o tier da Vercel ANTES de escrever o cron**

⚠️ `app/vercel.json` já tem **dois** crons e o plano **Hobby permite exatamente dois**. Descobrir isso no deploy seria tarde.

```bash
cd app && npx vercel project ls --scope gestao-9664s-projects
```

Ou peça ao usuário para conferir em `vercel.com/gestao-9664s-projects` → Settings → Billing.

- **Se Pro (3+ crons permitidos):** crie `/api/cron/billing` e adicione ao `vercel.json`:
  ```json
  { "path": "/api/cron/billing", "schedule": "0 12 * * *" }
  ```
- **Se Hobby:** **não crie cron novo.** Exporte a função `rodarBilling()` do arquivo abaixo e chame-a de dentro de `app/src/app/api/cron/obrigacoes/route.ts`, que já roda diário. Registre a decisão no commit.

- [ ] **Step 2: Implementar a rotina**

Crie `app/src/app/api/cron/billing/route.ts`:

```ts
// Bloco 4A — rotina diaria de billing.
//
// NADA AQUI E REQUISITO DE CORRECAO: o status efetivo e derivado na leitura
// (lib/billing/status.ts). Este cron e conveniencia e rede de seguranca —
// fecha em 24h a janela de um webhook perdido.
import 'server-only';
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { asaas } from '@/lib/clients';
import { planoPorQtdClientes, type PlanoFaixa } from '@/lib/billing/faixa';
import { ymdBrt } from '@/lib/fiscal/tempo-brt';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function rodarBilling() {
  const sb = createAdminClient();
  const hoje = ymdBrt();
  const resumo = { reconciliadas: 0, faixasAtualizadas: 0, avisos: 0, erros: 0 };

  // ---------------------------------------------- 1. reconciliacao
  const { data: comAsaas } = await sb
    .from('assinaturas').select('id, status, asaas_subscription_id')
    .not('asaas_subscription_id', 'is', null);

  for (const a of comAsaas ?? []) {
    try {
      const remota = await asaas.consultarAssinatura(a.asaas_subscription_id!);
      // ACTIVE no Asaas e a unica situacao que garante 'ativa' aqui. Qualquer
      // outra coisa NAO vira inadimplente automaticamente: quem declara
      // inadimplencia e o evento PAYMENT_OVERDUE, nao a ausencia de ACTIVE.
      const esperado = remota.status === 'ACTIVE' ? 'ativa' : null;
      if (esperado && a.status !== esperado && a.status !== 'cortesia') {
        await sb.from('assinaturas')
          .update({ status: esperado, updated_at: new Date().toISOString() }).eq('id', a.id);
        resumo.reconciliadas++;
      }
    } catch (err) {
      resumo.erros++;
      console.error('[cron billing] reconciliacao falhou', a.id, err);
    }
  }

  // ------------------------------------- 2. faixa do escritorio
  const { data: planosEsc } = await sb
    .from('planos').select('id, clientes_min, clientes_max, ativo')
    .eq('publico', 'escritorio');

  const { data: assEsc } = await sb
    .from('assinaturas').select('id, contabilidade_id, plano_id')
    .not('contabilidade_id', 'is', null).in('status', ['trial', 'ativa', 'inadimplente']);

  for (const a of assEsc ?? []) {
    const { count } = await sb
      .from('companies').select('id', { count: 'exact', head: true })
      .eq('contabilidade_id', a.contabilidade_id!).is('deleted_at', null);

    const r = planoPorQtdClientes(count ?? 0, (planosEsc ?? []) as PlanoFaixa[]);
    if (!r.ok) {
      // Buraco entre faixas criado pelo admin. NAO adivinhar um plano:
      // registrar e seguir, para alguem consertar em /admin/assinaturas.
      console.warn('[cron billing] sem faixa para', a.contabilidade_id, count, r.motivo);
      resumo.erros++;
      continue;
    }
    if (r.planoId !== a.plano_id) {
      await sb.from('assinaturas')
        .update({ plano_id: r.planoId, updated_at: new Date().toISOString() }).eq('id', a.id);
      resumo.faixasAtualizadas++;
    }
  }

  // --------------------------------------------------- 3. avisos
  // Trial terminando em 2 dias. Chave de idempotencia inclui a data-alvo,
  // entao rodar 2x no mesmo dia nao duplica (indice notifications_owner_chave_uidx).
  const { data: trials } = await sb
    .from('assinaturas').select('id, company_id, contabilidade_id, trial_termina_em')
    .eq('status', 'trial').not('trial_termina_em', 'is', null).lte('trial_termina_em',
      new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10));

  for (const t of trials ?? []) {
    const ownerId = await donoDaAssinatura(sb, t);
    if (!ownerId) continue;
    const { error } = await sb.from('notifications').upsert({
      owner_user_id: ownerId,
      company_id: t.company_id,
      tipo: 'assinatura_trial_acabando',
      severidade: 'warning',
      titulo: 'Seu período de teste está acabando',
      corpo: `O teste termina em ${t.trial_termina_em!.split('-').reverse().join('/')}. Assine para continuar usando.`,
      action_href: t.contabilidade_id ? '/contador/assinatura' : '/conta/assinatura',
      chave: `trial_acabando:${t.id}:${t.trial_termina_em}`,
    }, { onConflict: 'owner_user_id,chave', ignoreDuplicates: true });
    if (!error) resumo.avisos++;
  }

  return { ...resumo, hoje };
}

/** Dono a notificar: o titular da empresa, ou o primeiro membro do escritorio. */
async function donoDaAssinatura(
  sb: ReturnType<typeof createAdminClient>,
  a: { company_id: string | null; contabilidade_id: string | null },
): Promise<string | null> {
  if (a.company_id) {
    const { data } = await sb.from('companies').select('user_id').eq('id', a.company_id).maybeSingle();
    return (data?.user_id as string | null) ?? null;
  }
  if (a.contabilidade_id) {
    const { data } = await sb.from('contabilidade_membros')
      .select('user_id').eq('contabilidade_id', a.contabilidade_id)
      .order('created_at').limit(1).maybeSingle();
    return (data?.user_id as string | null) ?? null;
  }
  return null;
}

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await rodarBilling()) });
  } catch (err) {
    console.error('[cron billing] falhou', err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 3: Verificar e commitar**

```bash
npx tsc --noEmit
git add app/src/app/api/cron/billing/route.ts app/vercel.json
git commit -m "feat(bloco-4a): rotina diaria de billing

Reconciliacao, recalculo de faixa e aviso de trial. Nada aqui e
requisito de correcao — o status efetivo e derivado na leitura; o cron
so fecha em 24h a janela de um webhook perdido.

Reconciliacao NAO declara inadimplencia: so PAYMENT_OVERDUE faz isso.
Ausencia de ACTIVE no Asaas pode ser mil coisas."
```

---

## Task 14: Faixa de aviso na navegação

**Files:**
- Create: `app/src/app/(auth)/(gated)/_components/AvisoCobranca.tsx`
- Modify: o layout de `(gated)`

- [ ] **Step 1: Componente**

Crie `app/src/app/(auth)/(gated)/_components/AvisoCobranca.tsx`:

```tsx
// Bloco 4A — faixa de aviso de cobranca. AVISA, nunca bloqueia: o bloqueio
// mora na action (lib/billing/gate.ts).
//
// NAO renderizar em telas de direito do titular (exportar dados, excluir
// conta, dados pessoais). Ali a faixa sugeriria que o exercicio do direito
// depende de pagamento — exatamente o condicionamento que a LGPD art. 18 §5º
// proibe.
import Link from 'next/link';

export default function AvisoCobranca({
  status, trialTerminaEm, href,
}: { status: string; trialTerminaEm: string | null; href: string }) {
  if (status === 'inadimplente') {
    return (
      <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-sm text-amber-900">
        Há uma cobrança em aberto.{' '}
        <Link href={href} className="underline font-medium">Ver assinatura</Link>
      </div>
    );
  }
  if (status === 'trial' && trialTerminaEm) {
    const dias = Math.ceil(
      (new Date(`${trialTerminaEm}T12:00:00-03:00`).getTime() - Date.now()) / 86400000,
    );
    if (dias <= 3) {
      return (
        <div className="bg-sky-50 border-b border-sky-200 px-4 py-2 text-sm text-sky-900">
          {dias <= 0 ? 'Seu período de teste terminou.' : `Seu período de teste termina em ${dias} dia(s).`}{' '}
          <Link href={href} className="underline font-medium">Assinar</Link>
        </div>
      );
    }
  }
  return null;
}
```

- [ ] **Step 2: Helper que resolve o aviso do contexto**

Crie `app/src/lib/billing/resumo.ts`:

```ts
// Bloco 4A — resumo da assinatura para a faixa de aviso do layout.
// Devolve null quando nao ha o que avisar (inclusive para empresa de
// carteira, que nao paga).
import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

export type ResumoAviso = { status: string; trialTerminaEm: string | null; href: string };

export async function resumoAssinatura(
  companyId: string | null,
  normalizedRole: string,
): Promise<ResumoAviso | null> {
  try {
    const sb = createAdminClient();

    if (normalizedRole === 'contador') {
      const { data: c } = await sb.from('contabilidade_membros')
        .select('contabilidade_id').limit(1).maybeSingle();
      if (!c) return null;
      const { data: a } = await sb.from('assinaturas')
        .select('status, trial_termina_em').eq('contabilidade_id', c.contabilidade_id).maybeSingle();
      return a ? { status: a.status, trialTerminaEm: a.trial_termina_em, href: '/contador/assinatura' } : null;
    }

    if (!companyId) return null;
    const { data: emp } = await sb.from('companies')
      .select('contabilidade_id').eq('id', companyId).maybeSingle();
    // Empresa de carteira nao paga — nada a avisar.
    if (!emp || emp.contabilidade_id) return null;

    const { data: a } = await sb.from('assinaturas')
      .select('status, trial_termina_em').eq('company_id', companyId).maybeSingle();
    return a ? { status: a.status, trialTerminaEm: a.trial_termina_em, href: '/conta/assinatura' } : null;
  } catch {
    // A faixa e informativa: falhar em silencio e melhor que derrubar o layout.
    return null;
  }
}
```

- [ ] **Step 3: Plugar no layout**

Em `app/src/app/(auth)/(gated)/layout.tsx`, adicione os imports:

```ts
import { resumoAssinatura } from '@/lib/billing/resumo';
import AvisoCobranca from './_components/AvisoCobranca';
```

e substitua o `return <>{children}</>;` (linha 30) por:

```tsx
  const aviso = await resumoAssinatura(currentCompany, normalizedRole);

  return (
    <>
      {aviso && (
        <AvisoCobranca status={aviso.status} trialTerminaEm={aviso.trialTerminaEm} href={aviso.href} />
      )}
      {children}
    </>
  );
```

> Não mexa nos dois redirects acima (aceite LGPD e onboarding). A ordem deles foi acertada na sessão 3 depois do loop de redirect da tela preta, e o docblock do arquivo (linhas 1-7) explica por quê.

- [ ] **Step 4: Verificar e commitar**

```bash
npx tsc --noEmit
npx next build
git add "app/src/app/(auth)/(gated)/" app/src/lib/billing/resumo.ts
git commit -m "feat(bloco-4a): faixa de aviso de cobranca

Avisa, nunca bloqueia. Nao aparece nas telas de direito do titular: ali
sugeriria que o exercicio do direito depende de pagamento, o
condicionamento que a LGPD art. 18 §5º proibe."
```

---

## Task 15: Fechamento

- [ ] **Step 1: Verificação completa (com o dev server PARADO)**

```bash
npx tsc --noEmit
npx vitest run
npx next build
```
Expected: 0 erros de tipo; suíte verde; build limpo.

> Se o build reclamar `Cannot find module './XXXX.js'`, o `npm run dev` ficou no ar: pare, `rm -rf .next`, rode de novo.

- [ ] **Step 2: Conferir que nada ficou órfão**

```bash
grep -rn "assinatura" app/src/components --include=*.tsx | head
```
Cada página nova tem de ter link em menu. A sessão 3 achou `/contador/honorarios` órfã.

- [ ] **Step 3: Rodar a suíte SEM as env de banco**

O smoke da Task 9 tem de **pular**, não falhar:

```bash
env -u NEXT_PUBLIC_SUPABASE_URL -u SUPABASE_SERVICE_ROLE_KEY npx vitest run
```
Expected: verde, com os casos do `gate.smoke.test.ts` marcados como skipped.

> Isto é o que impede `npm test` de quebrar em `main` para quem não tem `.env.local` — a mesma armadilha desarmada no Bloco 3.

- [ ] **Step 4: Roteiro de smoke manual para o usuário**

Escreva um roteiro passo a passo com valores esperados, cobrindo o que os testes **não** percorrem:
1. Virar uma assinatura de teste para `inadimplente` no banco (anotando o valor original) e conferir que **emitir nota barra** com mensagem que leva à tela de assinatura.
2. Com a mesma assinatura inadimplente, conferir que **gerar DAS funciona** e que **exportar dados funciona** — as duas fronteiras.
3. Editar preço e dias de teste em `/admin/assinaturas`; tentar criar faixa sobreposta e ver a recusa.
4. Tentar desativar um plano em uso e ver a recusa dizendo quantas assinaturas.
5. Conferir que a empresa de carteira **não vê** tela de cobrança.
6. Restaurar a assinatura ao valor original.

> **Enquanto o usuário testa: não rode a suíte** — o `afterAll` do smoke mexe em assinaturas.

- [ ] **Step 5: Atualizar o CHECKPOINT**

Adicione a seção da sessão em `balu/CHECKPOINT.md` com: o que entrou, as decisões (as duas fronteiras do gate), as armadilhas encontradas na execução, e o estado do 4B.

- [ ] **Step 6: Merge**

Só após o smoke manual do usuário passar:

```bash
git checkout main
git merge --no-ff bloco-4-billing-asaas
git push
```

> **Confirme com o usuário antes do push** — é auto-deploy em produção.

---

## Validação do plano contra a spec

| Seção da spec | Task |
|---|---|
| §4.1–4.6 modelo de dados, cortesia, CHECK | 1 |
| §6.1 status efetivo | 2 |
| §6.2 titular | 3 |
| §6.3 faixa (com buraco) | 4 |
| §6.4 eventos | 5 |
| §7.3 extração do segredo | 6 |
| §7.1 cliente Asaas | 7 |
| §7.2, §7.4 webhook e idempotência | 8 |
| §5.1, §5.2 gate | 9 |
| §5.3, §5.4 alcance e cobertura | 10 |
| §9.1 admin de planos | 11 |
| §9.2 telas do assinante | 12 |
| §8.1–8.4 crons e tier da Vercel | 13 |
| §9.2 faixa de aviso | 14 |
| §10 verificação e smoke | 15 |
