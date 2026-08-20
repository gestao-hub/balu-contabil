# Bloco 5 — produção fiscal: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tirar a emissão fiscal do `env: FocusEnv = 'hom'` fixo e torná-la decidida **por empresa**, com credencial cifrada, guarda de quatro critérios e o ambiente carimbado em cada nota.

**Architecture:** A origem da credencial (`propria` | `balu`) decide o que a plataforma pode fazer na Focus. Um helper único (`resolverCredencialEmissao`) é o único lugar que escolhe ambiente e token; ele só devolve `prod` com os quatro critérios verdadeiros e, falhando, produz erro nomeado — nunca queda silenciosa para homologação. A nota carimba o ambiente em que nasceu, e todas as leituras posteriores (status, download, cancelamento) usam o ambiente **da nota**, não o da empresa.

**Tech Stack:** Next.js 15 (Server Actions, App Router) · Supabase/Postgres com RLS · `node-forge` (PKCS#12) · envelope AES-256-GCM (`lib/crypto/envelope.ts`) · Vitest · Playwright.

**Spec:** `docs/superpowers/specs/2026-08-20-bloco-5-producao-fiscal-design.md`
**Escrito em:** 2026-08-20 · **Lançamento:** 24/08 (segunda) — ver §"Ordem de corte" no fim.

**Regra do projeto:** cada task termina com verificação **executada**. Rodar `tsc`, `vitest` e `next build` **a partir de `app/`**, nunca da raiz. Migrations por `node app/scratchpad/apply-migration.mjs <arquivo>`, a partir de `balu/`.

---

## Estrutura de arquivos

| arquivo | responsabilidade |
|---|---|
| `app/supabase/migrations/0096_bloco5_credencial_por_empresa.sql` | schema: origem, ambiente, tokens cifrados, ambiente da nota, rastro |
| `app/src/lib/fiscal/credencial-empresa.ts` | **novo** — cifra/decifra dos tokens DA EMPRESA (puro + leitura) |
| `app/src/lib/fiscal/resolver-credencial.ts` | **novo** — a guarda dos quatro critérios; único ponto que escolhe ambiente |
| `app/src/app/(auth)/(gated)/notas_fiscais/actions.ts` | emissão, polling e cancelamento passam a usar o helper |
| `app/src/app/(auth)/(gated)/notas_fiscais/[id]/download/route.ts` | download usa o ambiente da nota |
| `app/src/lib/fiscal/cert-upload.ts` | espelho na Focus só quando `origem = 'balu'` |
| `app/src/lib/fiscal/focus-empresa-sync.ts` | não sobrescreve credencial de origem própria |
| `app/src/app/(auth)/(gated)/contador/clientes/[companyId]/focus-actions.ts` | **novo** — contador cadastra a credencial do cliente |
| `app/src/app/(auth)/(gated)/contador/clientes/[companyId]/CredencialFocusCard.tsx` | **novo** — a tela |

---

## Fase 0 — o que fica caro depois do lançamento

### Task 1: Migration 0096 — schema da credencial por empresa

**Files:**
- Create: `app/supabase/migrations/0096_bloco5_credencial_por_empresa.sql`

**Hoje:** `companies.focus_token` guarda um token só, em texto puro. `empresas_fiscais` não sabe origem nem ambiente. `notas_fiscais` não sabe em que ambiente nasceu.

**Por quê agora:** o banco tem **2 notas**. O backfill de `ambiente` é o DEFAULT. Depois do lançamento deixa de ser.

- [ ] **Step 1: Escrever a migration**

```sql
-- 0096 — Bloco 5: a credencial da Focus passa a ser por empresa.
--
-- Spec: docs/superpowers/specs/2026-08-20-bloco-5-producao-fiscal-design.md
--
-- MODELO HÍBRIDO (decisão D1): cada empresa ou TRAZ a própria conta Focus, ou
-- COMPRA da Balu (cadastrada na conta da plataforma via /v2/empresas). A origem
-- decide o que a plataforma pode fazer: com 'propria' ela NÃO cadastra, NÃO
-- atualiza e NÃO sobe certificado na Focus — o token da empresa não abre
-- /v2/empresas (401 provado em 20/08/2026).
--
-- Aditiva e idempotente: pode rodar 2x sem erro.

ALTER TABLE public.empresas_fiscais
  -- Default 'balu' porque é o que as empresas existentes SÃO: foram cadastradas
  -- pela API de Empresas. Default 'propria' mentiria sobre elas.
  ADD COLUMN IF NOT EXISTS focus_origem text NOT NULL DEFAULT 'balu',
  -- Feature-flag POR EMPRESA, nunca global (decisão D3). Enquanto ninguém
  -- gravar 'prod' à mão, o comportamento é byte a byte o de hoje.
  ADD COLUMN IF NOT EXISTS focus_ambiente text NOT NULL DEFAULT 'hom',
  -- Para origem='propria' a habilitação NÃO é verificável: o snapshot vem de
  -- GET /v2/empresas, bloqueado. Ela é DECLARADA por quem cadastrou. Guardar
  -- declaração na mesma coluna do fato conferido apagaria a diferença.
  ADD COLUMN IF NOT EXISTS focus_producao_declarada boolean NOT NULL DEFAULT false;

ALTER TABLE public.empresas_fiscais
  DROP CONSTRAINT IF EXISTS empresas_fiscais_focus_origem_check,
  ADD CONSTRAINT empresas_fiscais_focus_origem_check
    CHECK (focus_origem IN ('propria', 'balu'));

ALTER TABLE public.empresas_fiscais
  DROP CONSTRAINT IF EXISTS empresas_fiscais_focus_ambiente_check,
  ADD CONSTRAINT empresas_fiscais_focus_ambiente_check
    CHECK (focus_ambiente IN ('hom', 'prod'));

ALTER TABLE public.companies
  -- Cifrados (prefixo enc:v1:). A Focus emite DOIS tokens por empresa e eles
  -- são valores diferentes: o de homologação leva 401 na base de produção e
  -- vice-versa (provado em 20/08/2026). Guardar um campo só foi o erro que
  -- `focus_token` já carrega — não repetir.
  ADD COLUMN IF NOT EXISTS focus_token_hom_cifrado  text,
  ADD COLUMN IF NOT EXISTS focus_token_prod_cifrado text,
  -- Rastro: a tela do empresário mostra que o escritório cadastrou e quando.
  -- Mesmo princípio de cert_enviado_por/em da 0085.
  ADD COLUMN IF NOT EXISTS focus_token_por uuid,
  ADD COLUMN IF NOT EXISTS focus_token_em  timestamptz;

ALTER TABLE public.notas_fiscais
  -- O ambiente em que a nota NASCEU. Sem isto, o dia em que uma empresa virar
  -- 'prod' transforma toda nota antiga de homologação em 404 no PDF, no XML e
  -- no cancelamento — porque a base é escolhida pelo ambiente do MOMENTO.
  ADD COLUMN IF NOT EXISTS ambiente text NOT NULL DEFAULT 'hom';

ALTER TABLE public.notas_fiscais
  DROP CONSTRAINT IF EXISTS notas_fiscais_ambiente_check,
  ADD CONSTRAINT notas_fiscais_ambiente_check
    CHECK (ambiente IN ('hom', 'prod'));

-- As colunas de token NÃO recebem GRANT para anon/authenticated. A tabela
-- companies já tem grants amplos de coluna herdados do default do Supabase; as
-- colunas novas nascem sem eles porque GRANT de coluna não é herdado por
-- coluna criada depois. Conferido na Task 2.

COMMENT ON COLUMN public.empresas_fiscais.focus_origem IS
  'propria = o cliente traz a conta Focus dele; balu = cadastrada na conta da plataforma.';
COMMENT ON COLUMN public.empresas_fiscais.focus_producao_declarada IS
  'Habilitação de NFS-e produção DECLARADA por quem cadastrou (origem propria). Nao e fato conferido na Focus.';
COMMENT ON COLUMN public.notas_fiscais.ambiente IS
  'Ambiente em que a nota foi emitida. Manda nas leituras posteriores (status, download, cancelamento).';
```

- [ ] **Step 2: Aplicar**

Run (a partir de `balu/`):
```bash
node app/scratchpad/apply-migration.mjs app/supabase/migrations/0096_bloco5_credencial_por_empresa.sql
```
Expected: `OK: ... aplicada via conexão direta.`

- [ ] **Step 3: Conferir no banco vivo — colunas, constraints e grants**

Run (a partir de `balu/app`):
```bash
node -e "
const fs=require('fs');const{Client}=require('pg');
const env={};for(const l of fs.readFileSync('.env.local','utf8').split('\n')){const t=l.trim();if(!t||t.startsWith('#'))continue;const i=t.indexOf('=');if(i<0)continue;env[t.slice(0,i).trim()]=t.slice(i+1).trim();}
const ref=new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
(async()=>{const c=new Client({host:'db.'+ref+'.supabase.co',port:5432,user:'postgres',password:env.SUPABASE_PASSWORD,database:'postgres',ssl:{rejectUnauthorized:false}});await c.connect();
const cols=await c.query(\"select table_name,column_name from information_schema.columns where table_schema='public' and column_name in ('focus_origem','focus_ambiente','focus_producao_declarada','focus_token_hom_cifrado','focus_token_prod_cifrado','ambiente') order by 1,2\");
console.log(cols.rows.map(r=>r.table_name+'.'+r.column_name).join('\n'));
const g=await c.query(\"select column_name,grantee from information_schema.column_privileges where table_schema='public' and table_name='companies' and column_name like 'focus_token_%' and grantee in ('anon','authenticated')\");
console.log('grants nas colunas novas:', g.rows.length ? JSON.stringify(g.rows) : 'NENHUM (correto)');
await c.end();})();
"
```
Expected: as 6 colunas listadas e `grants nas colunas novas: NENHUM (correto)`.

**Se aparecer grant**, revogar antes de seguir:
```sql
REVOKE ALL (focus_token_hom_cifrado, focus_token_prod_cifrado) ON public.companies FROM anon, authenticated;
```

- [ ] **Step 4: Commit**

```bash
git add app/supabase/migrations/0096_bloco5_credencial_por_empresa.sql
git commit -m "feat(db): 0096 -- credencial da Focus por empresa, com origem e ambiente"
```

---

### Task 2: Migrar o token em texto puro para a coluna cifrada

**Files:**
- Create: `app/scripts/_migra-focus-token-cifrado.mjs`

**Hoje:** 2 tokens gravados, **0 cifrados** (medido em 20/08). `authenticated` tem `SELECT/UPDATE` na coluna `focus_token`.

**O que o script faz:** para cada `companies.focus_token` não nulo, grava o valor cifrado em `empresa_credenciais_focus.token_hom_cifrado` (é o de homologação — `focus-empresa-sync.ts:97` grava `token_homologacao ?? token_producao`) e **esvazia** `companies.focus_token`.

⚠️ **A tabela alvo é `empresa_credenciais_focus`, criada pela 0097** — não as colunas em `companies`, que a 0097 derrubou. Motivo no cabeçalho daquela migration: ACL de coluna não restringe o grant de tabela do Supabase, e texto cifrado vale como credencial ao portador.

- [ ] **Step 1: Escrever o script**

```javascript
// Migra companies.focus_token (texto puro) para focus_token_hom_cifrado.
// Idempotente: pula quem já tem a coluna nova preenchida.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCipheriv, randomBytes } from 'node:crypto';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = {};
for (const l of fs.readFileSync(path.resolve(__dirname, '../.env.local'), 'utf8').split('\n')) {
  const t = l.trim(); if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('='); if (i < 0) continue;
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}

const chave = Buffer.from(env.CERT_ENC_KEY, 'base64');
if (chave.length !== 32) throw new Error('CERT_ENC_KEY nao decodifica para 32 bytes');

/** Idêntico a cifrarCampo de lib/crypto/envelope.ts. */
function cifrarCampo(v) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', chave, iv);
  const enc = Buffer.concat([c.update(v, 'utf8'), c.final()]);
  return 'enc:v1:' + Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}

const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
const client = new pg.Client({
  host: `db.${ref}.supabase.co`, port: 5432, user: 'postgres',
  password: env.SUPABASE_PASSWORD, database: 'postgres', ssl: { rejectUnauthorized: false },
});
await client.connect();

const { rows } = await client.query(
  `select c.id, c.nome, c.focus_token
     from public.companies c
     left join public.empresa_credenciais_focus e on e.empresa_id = c.id
    where c.focus_token is not null and c.focus_token <> ''
      and e.token_hom_cifrado is null`,
);
console.log(`empresas a migrar: ${rows.length}`);

for (const r of rows) {
  // Numa transacao: gravar a credencial e esvaziar a coluna velha tem de ser
  // atomico. Se o segundo falhasse sozinho, o token ficaria em DOIS lugares —
  // um deles legivel por authenticated, que e exatamente o que a 0097 fecha.
  await client.query('begin');
  try {
    await client.query(
      `insert into public.empresa_credenciais_focus (empresa_id, token_hom_cifrado, atualizado_em)
       values ($1, $2, now())
       on conflict (empresa_id) do update
         set token_hom_cifrado = excluded.token_hom_cifrado, atualizado_em = now()`,
      [r.id, cifrarCampo(r.focus_token)],
    );
    await client.query('update public.companies set focus_token = null where id = $1', [r.id]);
    await client.query('commit');
    console.log(`  ${r.nome}: migrado`);
  } catch (e) {
    await client.query('rollback');
    throw e;
  }
}

const conf = await client.query(
  `select (select count(*) from public.companies
            where focus_token is not null and focus_token <> '')::int as em_claro,
          (select count(*) from public.empresa_credenciais_focus
            where token_hom_cifrado like 'enc:v1:%')::int as cifrados`,
);
console.log('\napos migrar → em claro:', conf.rows[0].em_claro, '| cifrados:', conf.rows[0].cifrados);
await client.end();
if (conf.rows[0].em_claro > 0) process.exit(1);
```

- [ ] **Step 2: Rodar**

Run (a partir de `balu/app`): `node scripts/_migra-focus-token-cifrado.mjs`
Expected: `apos migrar → em claro: 0 | cifrados: 2`

- [ ] **Step 3: Commit**

```bash
git add app/scripts/_migra-focus-token-cifrado.mjs
git commit -m "chore(seguranca): token da Focus por empresa sai do texto puro"
```

---

## Fase 1 — a credencial e a guarda

### Task 3: `credencial-empresa.ts` — cifra dos tokens da empresa

**Files:**
- Create: `app/src/lib/fiscal/credencial-empresa.ts`
- Test: `app/src/lib/fiscal/credencial-empresa.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```typescript
// Bloco 5 — os tokens DA EMPRESA, cifrados em repouso.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const CHAVE_B64 = Buffer.alloc(32, 7).toString('base64');
const ENV_ANTES = { ...process.env };
let mod: typeof import('./credencial-empresa');

beforeEach(async () => {
  process.env.CERT_ENC_KEY = CHAVE_B64;
  vi.resetModules();
  mod = await import('./credencial-empresa');
});
afterEach(() => { process.env = { ...ENV_ANTES }; });

describe('credencial da empresa', () => {
  it('guarda cifrado e le de volta', () => {
    const c = mod.guardarTokenEmpresa('tok-empresa-1');
    expect(c).toMatch(/^enc:v1:/);
    expect(c).not.toContain('tok-empresa-1');
    expect(mod.lerTokenEmpresa(c)).toBe('tok-empresa-1');
  });

  it('recusa guardar vazio', () => {
    expect(() => mod.guardarTokenEmpresa('')).toThrow(/vazio/);
  });

  it('recusa LER valor sem cifra — gravacao em claro e defeito', () => {
    expect(() => mod.lerTokenEmpresa('em-claro')).toThrow(/corrompida/);
  });

  it('null entra, null sai', () => {
    expect(mod.lerTokenEmpresa(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/fiscal/credencial-empresa.test.ts`
Expected: FAIL — `Cannot find module './credencial-empresa'`

- [ ] **Step 3: Implementar**

```typescript
// Bloco 5 — os tokens DA EMPRESA (emissão), cifrados em repouso.
//
// NÃO confundir com `config-focus.ts`, que guarda a credencial da PLATAFORMA
// (a que cadastra empresas em /v2/empresas). São níveis diferentes: esta aqui
// emite nota em nome de UM CNPJ; aquela age em nome de todos.
//
// Módulos separados de propósito, como `config-ia` e `config-focus` já são: uma
// mudança de regra em um não pode alcançar o outro.
import 'server-only';
import { cifrarCampo, decifrarCampo, PREFIXO } from '@/lib/crypto/envelope';

export function guardarTokenEmpresa(token: string): string {
  if (!token) throw new Error('guardarTokenEmpresa: token vazio');
  const cifrado = cifrarCampo(token);
  if (cifrado === token) throw new Error('guardarTokenEmpresa: cifra nao aplicada');
  return cifrado;
}

export function lerTokenEmpresa(cifrado: string | null): string | null {
  if (!cifrado) return null;
  // As colunas nascem na 0096 e `guardarTokenEmpresa` recusa gravar sem cifra:
  // valor sem prefixo só pode ser gravação corrompida. O fallback silencioso de
  // `decifrarCampo` (que existe para certificado legado) esconderia isso.
  if (!cifrado.startsWith(PREFIXO)) {
    throw new Error('lerTokenEmpresa: token da empresa sem cifra — gravacao corrompida');
  }
  return decifrarCampo(cifrado);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/fiscal/credencial-empresa.test.ts`
Expected: PASS, 4 testes.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/fiscal/credencial-empresa.ts app/src/lib/fiscal/credencial-empresa.test.ts
git commit -m "feat(fiscal): tokens de emissao da empresa, cifrados em repouso"
```

---

### Task 4: `resolver-credencial.ts` — a guarda dos quatro critérios

**Files:**
- Create: `app/src/lib/fiscal/resolver-credencial.ts`
- Test: `app/src/lib/fiscal/resolver-credencial.test.ts`

**A regra (spec §4):** devolve `prod` **somente** com as quatro verdadeiras — ambiente `prod`, token de produção presente, certificado A1 válido, e habilitação de produção (conferida na Focus para `origem='balu'`, **declarada** para `origem='propria'`). Falhando qualquer uma: erro que **nomeia** a que falhou.

- [ ] **Step 1: Escrever o teste que falha**

```typescript
// Bloco 5 — a guarda de producao. O teste central do bloco.
import { describe, it, expect } from 'vitest';
import { decidirCredencial, type EstadoFiscal } from './resolver-credencial';

const AMANHA = new Date(Date.now() + 86_400_000).toISOString();
const ONTEM = new Date(Date.now() - 86_400_000).toISOString();

const PRONTA: EstadoFiscal = {
  origem: 'balu',
  ambiente: 'prod',
  tokenHom: 'tok-hom',
  tokenProd: 'tok-prod',
  certNotAfter: AMANHA,
  habilitaProducaoFocus: true,
  producaoDeclarada: false,
};

describe('decidirCredencial', () => {
  it('as quatro verdadeiras → producao', () => {
    expect(decidirCredencial(PRONTA)).toEqual({ ok: true, ambiente: 'prod', token: 'tok-prod' });
  });

  it('ambiente hom → homologacao, sem exigir nada de producao', () => {
    const r = decidirCredencial({ ...PRONTA, ambiente: 'hom', tokenProd: null, certNotAfter: null });
    expect(r).toEqual({ ok: true, ambiente: 'hom', token: 'tok-hom' });
  });

  // NUNCA cair em homologacao quando pediram producao (decisao D5).
  it('sem token de producao → ERRO nomeado, nao queda para hom', () => {
    const r = decidirCredencial({ ...PRONTA, tokenProd: null });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.motivo).toBe('sem_token_producao');
  });

  it('certificado vencido → erro nomeado', () => {
    const r = decidirCredencial({ ...PRONTA, certNotAfter: ONTEM });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.motivo).toBe('certificado_invalido');
  });

  it('sem certificado nenhum → erro nomeado', () => {
    const r = decidirCredencial({ ...PRONTA, certNotAfter: null });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.motivo).toBe('certificado_invalido');
  });

  it('origem balu sem habilitacao na Focus → erro', () => {
    const r = decidirCredencial({ ...PRONTA, habilitaProducaoFocus: false });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.motivo).toBe('producao_nao_habilitada');
  });

  // Para origem propria a habilitacao NAO e verificavel (GET /v2/empresas
  // bloqueado). Vale a DECLARACAO de quem cadastrou.
  it('origem propria aceita a declaracao no lugar do snapshot', () => {
    const r = decidirCredencial({
      ...PRONTA, origem: 'propria', habilitaProducaoFocus: false, producaoDeclarada: true,
    });
    expect(r).toEqual({ ok: true, ambiente: 'prod', token: 'tok-prod' });
  });

  it('origem propria sem declaracao → erro', () => {
    const r = decidirCredencial({
      ...PRONTA, origem: 'propria', habilitaProducaoFocus: false, producaoDeclarada: false,
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.motivo).toBe('producao_nao_habilitada');
  });

  it('homologacao sem token de homologacao → erro, nao token de producao', () => {
    const r = decidirCredencial({ ...PRONTA, ambiente: 'hom', tokenHom: null });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.motivo).toBe('sem_token_homologacao');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/fiscal/resolver-credencial.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar a decisão pura**

```typescript
// Bloco 5 — a guarda de emissão. O ÚNICO lugar que decide ambiente e token.
//
// Puro (sem server-only, sem I/O) porque é a regra que mais precisa de teste:
// os 4 critérios de produção e o que acontece quando cada um falha.
//
// DECISÃO D5: falhar a guarda é ERRO NOMEADO, nunca `?? 'hom'`. Emitir em
// homologação achando que é produção é pior que não emitir — a nota não existe
// para a prefeitura e ninguém percebe até a fiscalização.
export type AmbienteFiscal = 'hom' | 'prod';
export type OrigemFocus = 'propria' | 'balu';

export type EstadoFiscal = {
  origem: OrigemFocus;
  ambiente: AmbienteFiscal;
  tokenHom: string | null;
  tokenProd: string | null;
  /** ISO do `arquivos_auxiliares.cert_not_after` vivo, ou null. */
  certNotAfter: string | null;
  /** Snapshot da Focus (`focus_habilita_nfsen_producao`). Só vale para 'balu'. */
  habilitaProducaoFocus: boolean;
  /** Declaração de quem cadastrou. Só vale para 'propria'. */
  producaoDeclarada: boolean;
};

export type MotivoRecusa =
  | 'sem_token_homologacao'
  | 'sem_token_producao'
  | 'certificado_invalido'
  | 'producao_nao_habilitada';

export type Credencial =
  | { ok: true; ambiente: AmbienteFiscal; token: string }
  | { ok: false; motivo: MotivoRecusa };

export const MENSAGEM_RECUSA: Record<MotivoRecusa, string> = {
  sem_token_homologacao:
    'Esta empresa não tem token de homologação da Focus cadastrado.',
  sem_token_producao:
    'Esta empresa está marcada para emitir em produção, mas não tem o token de produção da Focus cadastrado.',
  certificado_invalido:
    'Emissão em produção exige certificado A1 válido. O certificado está vencido ou não foi enviado.',
  producao_nao_habilitada:
    'A Focus ainda não confirmou a habilitação de NFS-e em produção para esta empresa.',
};

export function decidirCredencial(e: EstadoFiscal, agora: Date = new Date()): Credencial {
  if (e.ambiente === 'hom') {
    // Homologação não exige certificado nem habilitação: é o ambiente de teste,
    // e exigir os dois aqui travaria o fluxo que funciona hoje.
    if (!e.tokenHom) return { ok: false, motivo: 'sem_token_homologacao' };
    return { ok: true, ambiente: 'hom', token: e.tokenHom };
  }

  if (!e.tokenProd) return { ok: false, motivo: 'sem_token_producao' };

  const vence = e.certNotAfter ? new Date(e.certNotAfter).getTime() : 0;
  if (!vence || vence <= agora.getTime()) {
    return { ok: false, motivo: 'certificado_invalido' };
  }

  // Para 'balu' o fato vem do snapshot da Focus. Para 'propria' o snapshot não
  // existe (GET /v2/empresas está bloqueado desde 23/07/2026), e o que vale é a
  // declaração de quem cadastrou — registrada em coluna própria justamente para
  // não se disfarçar de fato conferido.
  const habilitada = e.origem === 'propria' ? e.producaoDeclarada : e.habilitaProducaoFocus;
  if (!habilitada) return { ok: false, motivo: 'producao_nao_habilitada' };

  return { ok: true, ambiente: 'prod', token: e.tokenProd };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/fiscal/resolver-credencial.test.ts`
Expected: PASS, 9 testes.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/fiscal/resolver-credencial.ts app/src/lib/fiscal/resolver-credencial.test.ts
git commit -m "feat(fiscal): guarda de emissao -- quatro criterios e recusa nomeada"
```

---

### Task 5: O leitor que monta o `EstadoFiscal` do banco

**Files:**
- Modify: `app/src/lib/fiscal/resolver-credencial.ts` (acrescentar leitura)
- Test: `app/src/lib/fiscal/resolver-credencial.test.ts` (acrescentar bloco)

- [ ] **Step 1: Escrever o teste que falha**

```typescript
// ...acrescentar ao final do arquivo de teste
import { vi } from 'vitest';

describe('resolverCredencialEmissao (leitura)', () => {
  function supabaseFake(dados: Record<string, unknown[]>) {
    return {
      from: (tabela: string) => ({
        select: () => ({
          eq: function () { return this; },
          is: function () { return this; },
          order: function () { return this; },
          limit: function () { return this; },
          maybeSingle: async () => ({ data: dados[tabela]?.[0] ?? null, error: null }),
        }),
      }),
    };
  }

  it('monta o estado e devolve a credencial decifrada', async () => {
    const { resolverCredencialEmissao } = await import('./resolver-credencial');
    process.env.CERT_ENC_KEY = Buffer.alloc(32, 7).toString('base64');
    const { guardarTokenEmpresa } = await import('./credencial-empresa');

    const sb = supabaseFake({
      empresas_fiscais: [{
        focus_origem: 'balu', focus_ambiente: 'hom',
        focus_habilita_nfsen_producao: false, focus_producao_declarada: false,
      }],
      companies: [{
        focus_token_hom_cifrado: guardarTokenEmpresa('tok-hom'),
        focus_token_prod_cifrado: null,
      }],
      arquivos_auxiliares: [{ cert_not_after: null }],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await resolverCredencialEmissao(sb as any, 'empresa-1');
    expect(r).toEqual({ ok: true, ambiente: 'hom', token: 'tok-hom' });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/fiscal/resolver-credencial.test.ts -t "leitura"`
Expected: FAIL — `resolverCredencialEmissao is not a function`

- [ ] **Step 3: Implementar a leitura**

```typescript
// ...acrescentar ao final de resolver-credencial.ts
//
// A leitura mora aqui, junto da regra, porque separar produziria um módulo com
// uma função só e um import a mais em cada chamador. O que importa é que
// `decidirCredencial` continue puro e testável sem banco.
import type { SupabaseClient } from '@supabase/supabase-js';
import { lerTokenEmpresa } from './credencial-empresa';

/**
 * Monta o `EstadoFiscal` da empresa e aplica a guarda.
 *
 * O certificado é lido de `arquivos_auxiliares` — a tabela usa `company_id`
 * (não `unique_id_empresa`), armadilha já registrada no plano do Bloco A.
 */
export async function resolverCredencialEmissao(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, 'public', any>,
  companyId: string,
  agora: Date = new Date(),
): Promise<Credencial> {
  const [fiscal, company, cert] = await Promise.all([
    supabase.from('empresas_fiscais')
      .select('focus_origem, focus_ambiente, focus_habilita_nfsen_producao, focus_producao_declarada')
      .eq('empresa_id', companyId).maybeSingle(),
    // `empresa_credenciais_focus` e fechada para anon/authenticated (0097).
    // Quem chama esta funcao tem de estar com client de service role, ou a
    // leitura volta vazia e a emissao morre com "sem token" sem dizer por que.
    supabase.from('empresa_credenciais_focus')
      .select('token_hom_cifrado, token_prod_cifrado')
      .eq('empresa_id', companyId).maybeSingle(),
    supabase.from('arquivos_auxiliares')
      .select('cert_not_after')
      .eq('company_id', companyId).is('deleted_at', null)
      .order('cert_not_after', { ascending: false }).limit(1).maybeSingle(),
  ]);

  // Decifra dentro do try: `lerTokenEmpresa` LANÇA em gravação corrompida, e
  // derrubar a action inteira por isso esconderia qual empresa está quebrada.
  let tokenHom: string | null = null;
  let tokenProd: string | null = null;
  try {
    tokenHom = lerTokenEmpresa((company.data?.token_hom_cifrado ?? null) as string | null);
    tokenProd = lerTokenEmpresa((company.data?.token_prod_cifrado ?? null) as string | null);
  } catch (e) {
    console.error('[bloco5] credencial corrompida em', companyId, e instanceof Error ? e.message : e);
  }

  // ⚠️ REVISADO NA REVISAO DAS TASKS 3-4: os dois `??` abaixo disparam apenas
  // quando a linha de `empresas_fiscais` NAO EXISTE. Nesse caso cair em
  // 'balu'/'hom' e o desfecho conservador certo (empresa sem configuracao
  // fiscal nao emite em producao), mas o `?? 'hom'` e literalmente a expressao
  // que a §4 proibe — entao ele precisa vir com este comentario, e o
  // implementador deve acrescentar um teste que fixe o comportamento:
  // linha ausente => decide 'hom', nunca 'prod'.
  //
  // Segundo ponto herdado da mesma revisao: o `catch` da decifra logo acima
  // zera OS DOIS tokens, e o resultado vira `sem_token_producao` — recusa
  // correta (nao cai para hom), mas com a mensagem errada: diz "nao tem o token
  // cadastrado" quando na verdade TEM, corrompido. Avaliar um motivo proprio
  // (`credencial_corrompida`) em vez de deixar o usuario procurar um token que
  // ja esta la.
  return decidirCredencial({
    origem: ((fiscal.data?.focus_origem ?? 'balu') as OrigemFocus),
    ambiente: ((fiscal.data?.focus_ambiente ?? 'hom') as AmbienteFiscal),
    tokenHom,
    tokenProd,
    certNotAfter: (cert.data?.cert_not_after ?? null) as string | null,
    habilitaProducaoFocus: Boolean(fiscal.data?.focus_habilita_nfsen_producao),
    producaoDeclarada: Boolean(fiscal.data?.focus_producao_declarada),
  }, agora);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/fiscal/resolver-credencial.test.ts`
Expected: PASS, 10 testes.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/fiscal/resolver-credencial.ts app/src/lib/fiscal/resolver-credencial.test.ts
git commit -m "feat(fiscal): resolverCredencialEmissao le o estado da empresa"
```

---

## Fase 2 — o ambiente manda nas leituras

### Task 6: Emissão de NFS-e usa o helper e carimba o ambiente

**Files:**
- Modify: `app/src/app/(auth)/(gated)/notas_fiscais/actions.ts:274-300` (`emitirNotaAction`)

**Hoje (linhas 274-284):** um comentário de MVP explicando que sempre emite em homologação, `_flagIgnoradaPorEnquanto` e `const env: FocusEnv = 'hom'`.

- [ ] **Step 1: Substituir o bloco do env fixo**

Remover as linhas do comentário MVP, o `_flagIgnoradaPorEnquanto` e o `const env: FocusEnv = 'hom';`. No lugar:

```typescript
  // Bloco 5: quem decide ambiente e token é `resolverCredencialEmissao` — o
  // único lugar do produto que faz essa escolha. Antes daqui havia um
  // `const env: FocusEnv = 'hom'` fixo, com dois bugs documentados no lugar:
  // o default de `emitir_nota_homol_antes_producao` mandava empresa nova para
  // produção, e o token salvo era o de homologação. Os dois deixam de existir:
  // o ambiente é coluna da empresa e os tokens são dois campos separados.
  const credencial = await resolverCredencialEmissao(supabase, companyId);
  if (!credencial.ok) {
    // A nota JÁ foi inserida acima. Marcar como erro em vez de deixar
    // 'pendente' para sempre — pendente é o estado de "esperando a Focus", e
    // aqui a Focus nem foi chamada.
    await supabase.from('notas_fiscais')
      .update({ status: 'erro', payload_focusnfe: { erro: credencial.motivo } })
      .eq('id', notaId).eq('company_id', companyId);
    return { ok: false, error: MENSAGEM_RECUSA[credencial.motivo] };
  }
  const env: FocusEnv = credencial.ambiente;
```

- [ ] **Step 2: Trocar o token e carimbar o ambiente**

Na chamada de emissão, trocar `company.focus_token as string` por `credencial.token`:

```typescript
    const resp = await focus.emitirNfse(ref, payload, credencial.token, env);
```

E no `update` seguinte, acrescentar o carimbo:

```typescript
      .update({
        ambiente: env,
        payload_focusnfe: { request: payload, response: resp },
      })
```

- [ ] **Step 3: Acrescentar os imports**

```typescript
import { resolverCredencialEmissao, MENSAGEM_RECUSA } from '@/lib/fiscal/resolver-credencial';
```

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit`
Expected: 0 erros.

- [ ] **Step 5: Commit**

```bash
git add "app/src/app/(auth)/(gated)/notas_fiscais/actions.ts"
git commit -m "feat(fiscal): emissao de NFS-e decide ambiente por empresa e carimba a nota"
```

---

### Task 7: NF-e e NFC-e usam o mesmo helper

**Files:**
- Modify: `app/src/app/(auth)/(gated)/notas_fiscais/actions.ts:679` (`emitirNfeAction`, NF-e)
- Modify: `app/src/app/(auth)/(gated)/notas_fiscais/actions.ts:792` (NFC-e)

- [ ] **Step 1: Aplicar o mesmo bloco da Task 6 nos dois pontos**

Em cada um, antes da chamada `focus.emitirNfe(...)` / `focus.emitirNfce(...)`:

```typescript
  const credencial = await resolverCredencialEmissao(supabase, companyId);
  if (!credencial.ok) {
    await supabase.from('notas_fiscais')
      .update({ status: 'erro', payload_focusnfe: { erro: credencial.motivo } })
      .eq('id', notaId).eq('company_id', companyId);
    return { ok: false, error: MENSAGEM_RECUSA[credencial.motivo] };
  }
```

E as chamadas passam a:

```typescript
    const resp = await focus.emitirNfe(ref, payload, credencial.token, credencial.ambiente);
```
```typescript
    const resp = await focus.emitirNfce(ref, payload, credencial.token, credencial.ambiente);
```

Os `update` de resposta ganham `ambiente: credencial.ambiente`.

- [ ] **Step 2: Verificar que não sobrou `'hom'` fixo neste arquivo**

Run: `grep -n "= 'hom'" "app/src/app/(auth)/(gated)/notas_fiscais/actions.ts"`
Expected: nenhuma linha.

- [ ] **Step 3: Commit**

```bash
git add "app/src/app/(auth)/(gated)/notas_fiscais/actions.ts"
git commit -m "feat(fiscal): NF-e e NFC-e usam a mesma guarda de ambiente"
```

---

### Task 8: Polling de status usa o ambiente DA NOTA

**Files:**
- Modify: `app/src/app/(auth)/(gated)/notas_fiscais/actions.ts:340-362` (`atualizarStatusNotaAction`)

**Por quê:** consultar em `prod` uma nota emitida em `hom` devolve 404 e o status da nota nunca mais atualiza.

- [ ] **Step 1: Ler o ambiente junto da nota**

```typescript
  const { data: nota } = await supabase
    .from('notas_fiscais')
    .select('id, tipo_documento, referencia, payload_focusnfe, ambiente')
    .eq('id', id).eq('company_id', companyId).maybeSingle();
```

- [ ] **Step 2: Trocar a origem do token e do ambiente**

Substituir o bloco que lê `companies.focus_token` por:

```typescript
  // O AMBIENTE VEM DA NOTA, não da empresa. Se a empresa virou 'prod' depois,
  // as notas antigas continuam vivendo em homologação — consultá-las na base de
  // produção devolve 404 e o status congela para sempre.
  // NÃO passa por `resolverCredencialEmissao` de propósito: a guarda de
  // produção decide onde uma nota NOVA nasce. Aplicá-la aqui impediria de
  // consultar o status de uma nota já emitida só porque o certificado venceu
  // depois — e o status é justamente o que diz se ela foi autorizada.
  const ambienteNota = ((nota.ambiente ?? 'hom') as FocusEnv);
  const tokenDaNota = await tokenParaAmbiente(supabase, companyId, ambienteNota);
  if (!tokenDaNota) {
    return { ok: false, error: `Esta nota foi emitida em ${ambienteNota === 'prod' ? 'produção' : 'homologação'} e não há token desse ambiente cadastrado.` };
  }
```

- [ ] **Step 3: Acrescentar `tokenParaAmbiente` a `resolver-credencial.ts`**

```typescript
/**
 * O token de UM ambiente específico, sem passar pela guarda.
 *
 * Existe para as leituras de nota já emitida (status, download, cancelamento):
 * ali o ambiente não se decide, ele já foi decidido na emissão e está carimbado
 * na linha. Aplicar a guarda de produção aqui impediria de baixar o PDF de uma
 * nota antiga só porque o certificado venceu depois.
 */
export async function tokenParaAmbiente(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, 'public', any>,
  companyId: string,
  ambiente: AmbienteFiscal,
): Promise<string | null> {
  const { data } = await supabase.from('empresa_credenciais_focus')
    .select('token_hom_cifrado, token_prod_cifrado')
    .eq('empresa_id', companyId).maybeSingle();
  if (!data) return null;
  const col = ambiente === 'prod' ? data.token_prod_cifrado : data.token_hom_cifrado;
  try {
    return lerTokenEmpresa((col ?? null) as string | null);
  } catch (e) {
    console.error('[bloco5] token corrompido em', companyId, e instanceof Error ? e.message : e);
    return null;
  }
}
```

- [ ] **Step 4: Trocar as três chamadas de consulta**

```typescript
    if (tipoDoc === 'NFe') {
      resp = await focus.consultarStatusNfe(ref, tokenDaNota, ambienteNota);
    } else if (tipoDoc === 'NFCe') {
      resp = await focus.consultarStatusNfce(ref, tokenDaNota, ambienteNota);
    } else {
      resp = await focus.consultarStatusNfse(ref, tokenDaNota, ambienteNota);
    }
```

- [ ] **Step 5: Verificar**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 0 erros, suíte verde.

- [ ] **Step 6: Commit**

```bash
git add "app/src/app/(auth)/(gated)/notas_fiscais/actions.ts" app/src/lib/fiscal/resolver-credencial.ts
git commit -m "fix(fiscal): status da nota consulta o ambiente em que ela nasceu"
```

---

### Task 9: Download de PDF/XML usa o ambiente da nota

**Files:**
- Modify: `app/src/app/(auth)/(gated)/notas_fiscais/[id]/download/route.ts:21` e o corpo

**Hoje:** `const ENV: FocusEnv = 'hom';` no topo do módulo — o mesmo para toda nota de todo cliente.

- [ ] **Step 1: Remover a constante de módulo**

Apagar `const ENV: FocusEnv = 'hom';`.

- [ ] **Step 2: Ler o ambiente e o token da nota**

```typescript
  const { data: nota } = await supabase
    .from('notas_fiscais')
    .select('tipo_documento, referencia, pdf_url, xml_url, ambiente')
    .eq('id', id).eq('company_id', companyId).maybeSingle();
  if (!nota) return new Response('nota não encontrada', { status: 404 });

  // O ambiente é o DA NOTA. Uma nota de homologação baixada da base de produção
  // devolve 404 no PDF e no XML.
  const ENV = ((nota.ambiente ?? 'hom') as FocusEnv);
  const focusToken = await tokenParaAmbiente(supabase, companyId, ENV);
  if (!focusToken) {
    return new Response('empresa sem token Focus para o ambiente desta nota', { status: 409 });
  }
```

Remover o bloco antigo que lia `companies.focus_token`.

- [ ] **Step 3: Import**

```typescript
import { tokenParaAmbiente } from '@/lib/fiscal/resolver-credencial';
```

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit`
Expected: 0 erros. As referências a `ENV` no corpo (`focusBase(ENV)`, `focus.baixarXmlNfe(ref, focusToken, ENV)`, etc.) continuam válidas — a variável passou de módulo para local.

- [ ] **Step 5: Commit**

```bash
git add "app/src/app/(auth)/(gated)/notas_fiscais/[id]/download/route.ts"
git commit -m "fix(fiscal): download usa o ambiente em que a nota foi emitida"
```

---

### Task 10: Cancelamento usa o ambiente da nota

**Files:**
- Modify: `app/src/app/(auth)/(gated)/notas_fiscais/actions.ts:447-458` (`cancelarNotaAction`)

- [ ] **Step 1: Ler `ambiente` no select da nota e trocar o bloco do token**

Substituir o bloco `companyForCancel` + `const env: FocusEnv = 'hom';` por:

```typescript
  // Cancelar uma nota de produção pela base de homologação devolve 404 — e o
  // usuário leria "nota não encontrada" para uma nota que existe.
  const ambienteNota = ((nota.ambiente ?? 'hom') as FocusEnv);
  const focusToken = await tokenParaAmbiente(supabase, companyId, ambienteNota);
  if (!focusToken) {
    return { ok: false, error: 'Empresa sem token Focus para o ambiente desta nota.' };
  }
  const env: FocusEnv = ambienteNota;
```

Garantir que o `select` da nota (linha ~410) inclua `ambiente`.

- [ ] **Step 2: Verificar**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 0 erros, verde.

- [ ] **Step 3: Commit**

```bash
git add "app/src/app/(auth)/(gated)/notas_fiscais/actions.ts"
git commit -m "fix(fiscal): cancelamento usa o ambiente da nota"
```

---

## Fase 3 — origem manda no certificado e na sincronização

### Task 11: Certificado só espelha na Focus quando a origem é `balu`

**Files:**
- Modify: `app/src/lib/fiscal/cert-upload.ts:147-165`
- Test: `app/src/lib/fiscal/cert-upload.test.ts`

**Hoje:** chama `atualizarEmpresaNaFocus(...)` **sempre**. Para `origem = 'propria'` isso é `PUT /v2/empresas/:id`, que o token da empresa não abre — 401 garantido, e o usuário veria um aviso de falha em toda tentativa.

- [ ] **Step 1: Escrever o teste que falha**

```typescript
it('origem propria NAO tenta espelhar o certificado na Focus', async () => {
  // O PUT /v2/empresas e da credencial da PLATAFORMA. Com origem propria a
  // Balu nao tem como faze-lo: o cliente sobe no painel dele.
  const sb = supabaseFakeComOrigem('propria');
  const r = await processarUploadCertificado(sb, 'empresa-1', { bytes: PFX, senha: 'x' }, 'user-1');
  expect(r.ok).toBe(true);
  expect(atualizarEmpresaNaFocusMock).not.toHaveBeenCalled();
  expect(r.ok && r.warnings.join(' ')).toMatch(/painel da Focus/i);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/fiscal/cert-upload.test.ts -t "origem propria"`
Expected: FAIL — `atualizarEmpresaNaFocus` foi chamado.

- [ ] **Step 3: Implementar**

O bloco atual (linhas 152-165) lê `focus_empresa_id` e, se houver, chama a Focus.
Acrescentar `focus_origem` ao MESMO select — sem consulta nova — e ramificar:

```typescript
  const { data: fiscalForFocus } = await supabase
    .from('empresas_fiscais')
    .select('focus_empresa_id, focus_origem')
    .eq('empresa_id', companyId)
    .is('deleted_at', null)
    .maybeSingle();

  // Bloco 5: o espelho na Focus é do caminho `balu`. Com origem 'propria' o
  // PUT /v2/empresas/:id não está ao nosso alcance — é a credencial da
  // PLATAFORMA que o abre, e o token da empresa leva 401 (provado 20/08/2026).
  // Sem esta ramificação, toda empresa que traz a própria conta receberia um
  // aviso de falha em todo upload de certificado.
  if ((fiscalForFocus?.focus_origem ?? 'balu') === 'propria') {
    warnings.push(
      'Certificado guardado no Balu. Como esta empresa usa a própria conta na Focus, '
      + 'envie o mesmo certificado no painel da Focus dela — não conseguimos fazer isso por você.',
    );
  } else if (fiscalForFocus?.focus_empresa_id != null) {
    // Chamada EXISTENTE, inalterada — só movida para dentro do `else if`.
    const focusResult = await atualizarEmpresaNaFocus(supabase, companyId, 'hom', {
      certificado: { base64: entrada.bytes.toString('base64'), senha: entrada.senha },
    });
    if (!focusResult.ok) {
      warnings.push(`Certificado salvo localmente, mas falhou ao enviar pra Focus: ${focusResult.error.slice(0, 200)}`);
    }
  }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/fiscal/cert-upload.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/fiscal/cert-upload.ts app/src/lib/fiscal/cert-upload.test.ts
git commit -m "fix(fiscal): certificado nao tenta espelhar na Focus quando a conta e do cliente"
```

---

### Task 12: `focus-empresa-sync` não sobrescreve credencial própria

**Files:**
- Modify: `app/src/lib/fiscal/focus-empresa-sync.ts:96-110`
- Test: `app/src/lib/fiscal/focus-empresa-sync.test.ts`

**Por quê:** hoje o sync grava `focus_token` a partir da resposta do POST. Para `origem = 'propria'` não há POST a fazer — e se houvesse, sobrescreveria o token que o contador cadastrou.

- [ ] **Step 1: Escrever o teste que falha**

```typescript
it('origem propria: o sync recusa e nao chama a Focus', async () => {
  const sb = supabaseFakeComOrigem('propria');
  const r = await sincronizarEmpresaNaFocus(sb, 'empresa-1');
  expect(r.ok).toBe(false);
  expect(!r.ok && r.error).toMatch(/propria conta/i);
  expect(criarEmpresaMock).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/fiscal/focus-empresa-sync.test.ts -t "origem propria"`
Expected: FAIL.

- [ ] **Step 3: Implementar — guarda no topo de `sincronizarEmpresaNaFocus`**

```typescript
  // Bloco 5: empresa que usa a própria conta na Focus não é cadastrada por nós.
  // Sem esta guarda, o sync sobrescreveria com o token da conta da plataforma o
  // token que o contador cadastrou — e o cliente passaria a emitir com a
  // credencial errada, em silêncio.
  const { data: fiscalOrigem } = await supabase
    .from('empresas_fiscais').select('focus_origem').eq('empresa_id', companyId).maybeSingle();
  if ((fiscalOrigem?.focus_origem ?? 'balu') === 'propria') {
    return {
      ok: false,
      error: 'Esta empresa usa a própria conta na Focus. O cadastro é feito no painel dela, não por aqui.',
    };
  }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/fiscal/focus-empresa-sync.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/fiscal/focus-empresa-sync.ts app/src/lib/fiscal/focus-empresa-sync.test.ts
git commit -m "fix(fiscal): sync nao sobrescreve a credencial de quem traz a propria conta"
```

---

## Fase 4 — a tela do contador

### Task 13: Action do contador para cadastrar a credencial do cliente

**Files:**
- Create: `app/src/app/(auth)/(gated)/contador/clientes/[companyId]/focus-actions.ts`
- Test: `app/src/app/(auth)/(gated)/contador/clientes/[companyId]/focus-actions.test.ts`

**Padrão obrigatório** (spec §7), copiado de `cert-actions.ts` do mesmo diretório: `requireEscritorioAprovado` → `companyDaCarteira` (anti-IDOR) → escrita por service role → auditoria. **A RLS do contador segue sem policy de escrita.**

- [ ] **Step 1: Escrever o teste que falha**

```typescript
// Bloco 5 — invariantes da credencial cadastrada pelo contador.
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { lerTokenEmpresa } from '@/lib/fiscal/credencial-empresa';

const h = vi.hoisted(() => {
  const updates: Array<{ tabela: string; valores: Record<string, unknown> }> = [];
  const auditorias: Array<{ acao: string; meta?: Record<string, unknown> }> = [];
  const estado = {
    guard: { ok: true, id: 'escritorio-1', userId: 'user-1' } as unknown,
    daCarteira: { id: 'empresa-1' } as unknown,
  };
  const from = vi.fn((tabela: string) => ({
    update: (valores: Record<string, unknown>) => {
      updates.push({ tabela, valores });
      const b = {
        eq: () => b,
        select: () => Promise.resolve({ data: [{ id: 'empresa-1' }], error: null }),
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok),
      };
      return b;
    },
    upsert: (valores: Record<string, unknown>) => {
      updates.push({ tabela, valores });
      return { select: () => Promise.resolve({ data: [{ empresa_id: 'empresa-1' }], error: null }) };
    },
  }));
  const registrarAuditoria = vi.fn(async (e: { acao: string; meta?: Record<string, unknown> }) => {
    auditorias.push(e);
  });
  return { updates, auditorias, estado, from, registrarAuditoria };
});

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: h.from }) }));
vi.mock('@/lib/contador/guards', () => ({ requireEscritorioAprovado: async () => h.estado.guard }));
vi.mock('@/lib/contador/carteira', () => ({ companyDaCarteira: async () => h.estado.daCarteira }));
vi.mock('@/lib/security/audit', () => ({ registrarAuditoria: h.registrarAuditoria }));

import { salvarCredencialFocusClienteAction } from './focus-actions';

beforeAll(() => { process.env.CERT_ENC_KEY ??= Buffer.alloc(32, 7).toString('base64'); });
beforeEach(() => {
  h.updates.length = 0; h.auditorias.length = 0;
  h.estado.guard = { ok: true, id: 'escritorio-1', userId: 'user-1' };
  h.estado.daCarteira = { id: 'empresa-1' };
});

const base = { companyId: 'empresa-1', token_hom: 'tok-hom', token_prod: '', autorizacao: true };

describe('salvarCredencialFocusClienteAction', () => {
  it('ANTI-IDOR: empresa fora da carteira nao grava', async () => {
    h.estado.daCarteira = null;
    const r = await salvarCredencialFocusClienteAction(base);
    expect(r.ok).toBe(false);
    expect(h.updates).toHaveLength(0);
  });

  it('sem declaracao de custodia, recusa', async () => {
    const r = await salvarCredencialFocusClienteAction({ ...base, autorizacao: false });
    expect(r.ok).toBe(false);
    expect(h.updates).toHaveLength(0);
  });

  it('grava CIFRADO na tabela fechada, e decifra de volta', async () => {
    const r = await salvarCredencialFocusClienteAction(base);
    expect(r).toEqual({ ok: true });
    const up = h.updates.find((u) => u.tabela === 'empresa_credenciais_focus')!;
    expect(String(up.valores.token_hom_cifrado)).toMatch(/^enc:v1:/);
    expect(lerTokenEmpresa(up.valores.token_hom_cifrado as string)).toBe('tok-hom');
  });

  it('o segredo NAO vai para companies — so o rastro', async () => {
    // Se voltar a escrever token em `companies`, o transplante entre empresas
    // que a 0097 fechou volta a ser possivel. Ver o cabecalho daquela migration.
    await salvarCredencialFocusClienteAction(base);
    const emCompanies = h.updates.filter((u) => u.tabela === 'companies');
    for (const u of emCompanies) {
      expect(Object.keys(u.valores).join(',')).not.toMatch(/token_hom_cifrado|token_prod_cifrado/);
    }
  });

  it('campo vazio = nao trocar', async () => {
    const r = await salvarCredencialFocusClienteAction(base);
    expect(r.ok).toBe(true);
    const up = h.updates.find((u) => u.tabela === 'empresa_credenciais_focus')!;
    expect(Object.keys(up.valores)).not.toContain('token_prod_cifrado');
  });

  it('a auditoria nao carrega o token', async () => {
    await salvarCredencialFocusClienteAction(base);
    expect(JSON.stringify(h.auditorias[0])).not.toContain('tok-hom');
    expect(h.auditorias[0].meta).toMatchObject({ trocou_hom: true, trocou_prod: false });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run "src/app/(auth)/(gated)/contador/clientes/[companyId]/focus-actions.test.ts"`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

```typescript
'use server';
// Bloco 5 — a credencial da Focus do CLIENTE, cadastrada pelo contador.
//
// EXCEÇÃO DELIBERADA (decisão D2) ao "painel do contador é somente
// visualização". Ela NÃO derruba a garantia: a RLS do contador em `companies`
// segue SELECT-only; a escrita é service role com a permissão PROVADA aqui —
// mesmo padrão de `cert-actions.ts`, no mesmo diretório.
//
// CUSTÓDIA: com este token se emite nota fiscal em nome do CNPJ do cliente.
// Quem cadastra declara que o titular autorizou, e o rastro fica em três
// lugares: `audit_log`, as colunas `focus_token_por`/`focus_token_em`, e a tela
// do próprio empresário.
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireEscritorioAprovado } from '@/lib/contador/guards';
import { companyDaCarteira } from '@/lib/contador/carteira';
import { registrarAuditoria } from '@/lib/security/audit';
import { guardarTokenEmpresa } from '@/lib/fiscal/credencial-empresa';

export type SalvarCredencialInput = {
  companyId: string;
  token_hom?: string;
  token_prod?: string;
  autorizacao: boolean;
  /** Só faz sentido com origem 'propria' — ver spec §4. */
  producao_declarada?: boolean;
};

type Resultado = { ok: true } | { ok: false; error: string };

export async function salvarCredencialFocusClienteAction(
  input: SalvarCredencialInput,
): Promise<Resultado> {
  const ctx = await requireEscritorioAprovado();
  if (!ctx.ok) return { ok: false, error: ctx.error };

  const companyId = String(input.companyId ?? '');
  if (!companyId) return { ok: false, error: 'Cliente não informado.' };
  if (!input.autorizacao) {
    return { ok: false, error: 'Confirme que o titular autorizou o uso da credencial fiscal dele.' };
  }

  const hom = (input.token_hom ?? '').trim();
  const prod = (input.token_prod ?? '').trim();
  if (!hom && !prod) return { ok: false, error: 'Cole ao menos um dos dois tokens.' };

  const admin = createAdminClient();

  // ANTI-IDOR: o admin client ignora RLS — sem esta checagem um companyId
  // qualquer instalaria credencial numa empresa de outro escritório.
  const alvo = await companyDaCarteira(admin, ctx.id, companyId);
  if (!alvo) return { ok: false, error: 'Empresa fora da sua carteira.' };

  // O SEGREDO vai para `empresa_credenciais_focus`, fechada para as roles do
  // cliente (0097). O RASTRO fica em `companies`, onde o titular consegue ler —
  // é o que faz a declaracao de custodia valer alguma coisa.
  const credencial: Record<string, unknown> = {
    empresa_id: companyId,
    atualizado_por: ctx.userId,
    atualizado_em: new Date().toISOString(),
  };
  try {
    // CAMPO VAZIO = NÃO TROCAR — é o caminho comum (trocar só um dos dois).
    if (hom) credencial.token_hom_cifrado = guardarTokenEmpresa(hom);
    if (prod) credencial.token_prod_cifrado = guardarTokenEmpresa(prod);
  } catch {
    return { ok: false, error: 'Não foi possível proteger a credencial. Nada foi salvo.' };
  }

  // UPSERT com `onConflict` explicito, e NAO `.update()`: a linha pode nao
  // existir (primeira credencial da empresa). Diferente do caso de `config_ia`,
  // aqui o upsert e seguro porque o payload NUNCA carrega a coluna que nao se
  // quer trocar — ela simplesmente nao entra no objeto acima.
  const { data, error } = await admin
    .from('empresa_credenciais_focus')
    .upsert(credencial, { onConflict: 'empresa_id' })
    .select('empresa_id');
  if (error) {
    console.error('[bloco5] credencial do cliente nao gravada:', error.message);
    return { ok: false, error: 'Não foi possível salvar. Tente de novo.' };
  }
  if ((data?.length ?? 0) === 0) {
    return { ok: false, error: 'Empresa não encontrada. Recarregue a página.' };
  }

  await admin.from('companies')
    .update({ focus_token_por: ctx.userId, focus_token_em: new Date().toISOString() })
    .eq('id', companyId);

  if (typeof input.producao_declarada === 'boolean') {
    await admin.from('empresas_fiscais')
      .update({ focus_producao_declarada: input.producao_declarada })
      .eq('empresa_id', companyId);
  }

  await registrarAuditoria({
    actorUserId: ctx.userId,
    acao: 'focus.credencial_cliente_salvar',
    alvoTipo: 'company', alvoId: companyId,
    contabilidadeId: ctx.id,
    // NUNCA o token, nem mascarado.
    meta: { trocou_hom: Boolean(hom), trocou_prod: Boolean(prod) },
  });

  revalidatePath(`/contador/clientes/${companyId}`);
  return { ok: true };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run "src/app/(auth)/(gated)/contador/clientes/[companyId]/focus-actions.test.ts"`
Expected: PASS, 5 testes.

- [ ] **Step 5: Commit**

```bash
git add "app/src/app/(auth)/(gated)/contador/clientes/[companyId]/focus-actions.ts" "app/src/app/(auth)/(gated)/contador/clientes/[companyId]/focus-actions.test.ts"
git commit -m "feat(contador): credencial da Focus do cliente, com custodia e anti-IDOR"
```

---

### Task 14: O card na tela do cliente

**Files:**
- Create: `app/src/app/(auth)/(gated)/contador/clientes/[companyId]/CredencialFocusCard.tsx`
- Modify: `app/src/app/(auth)/(gated)/contador/clientes/[companyId]/page.tsx`

- [ ] **Step 1: Escrever o componente**

```tsx
'use client';
// Bloco 5 — o card da credencial Focus do cliente (visão do contador).
//
// SÓ IMPORTA DAS ACTIONS. `credencial-empresa.ts` é server-only e decifra
// segredo: importado daqui passaria no `tsc --noEmit` e quebraria no runtime.
//
// OS CAMPOS NASCEM VAZIOS. Vazio = não trocar. O token gravado nunca volta para
// a tela, nem mascarado.
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Loader2 } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { salvarCredencialFocusClienteAction } from './focus-actions';

const rotulo = 'text-xs font-medium text-muted-foreground-2';
const campo = 'rounded-md border border-border bg-surface-2 text-foreground px-3 py-2 text-sm';

type Props = {
  companyId: string;
  origem: 'propria' | 'balu';
  temHom: boolean;
  temProd: boolean;
  producaoDeclarada: boolean;
};

export default function CredencialFocusCard(p: Props) {
  const [hom, setHom] = useState('');
  const [prod, setProd] = useState('');
  const [declarada, setDeclarada] = useState(p.producaoDeclarada);
  const [autorizou, setAutorizou] = useState(false);
  const [pendente, iniciar] = useTransition();
  const toast = useToast();
  const router = useRouter();

  if (p.origem !== 'propria') {
    return (
      <section className="rounded-md border border-border bg-surface p-4">
        <h2 className="text-sm font-medium text-foreground">Credencial da Focus</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Esta empresa usa a conta da Balu na Focus. A credencial é gerada no cadastro
          e não é digitada aqui.
        </p>
      </section>
    );
  }

  function salvar(e: React.FormEvent) {
    e.preventDefault();
    iniciar(async () => {
      const r = await salvarCredencialFocusClienteAction({
        companyId: p.companyId, token_hom: hom, token_prod: prod,
        autorizacao: autorizou, producao_declarada: declarada,
      });
      if (!r.ok) { toast('error', r.error); return; }
      setHom(''); setProd(''); setAutorizou(false);
      toast('success', 'Credencial salva.');
      router.refresh();
    });
  }

  return (
    <form onSubmit={salvar} className="space-y-4 rounded-md border border-border bg-surface p-4">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
          <KeyRound className="size-4 shrink-0 text-primary" />
          Credencial da Focus (conta do cliente)
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Os dois tokens que a Focus fornece para esta empresa. São valores diferentes:
          o de homologação não vale em produção e vice-versa.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className={rotulo}>Token de homologação</span>
          <input type="password" value={hom} onChange={(e) => setHom(e.target.value)}
            placeholder={p.temHom ? '•••••••• (guardado — em branco mantém)' : 'cole o token'}
            autoComplete="off" className={campo} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={rotulo}>Token de produção</span>
          <input type="password" value={prod} onChange={(e) => setProd(e.target.value)}
            placeholder={p.temProd ? '•••••••• (guardado — em branco mantém)' : 'cole o token'}
            autoComplete="off" className={campo} />
        </label>
      </div>

      <label className="flex items-start gap-2 text-sm text-muted-foreground">
        <input type="checkbox" checked={declarada} onChange={(e) => setDeclarada(e.target.checked)}
          className="mt-1" />
        <span>
          A Focus habilitou <strong>NFS-e em produção</strong> para esta empresa.
          {' '}Como a conta é do cliente, não conseguimos conferir isso — fica registrado
          como <strong>declaração sua</strong>, e é ela que libera a emissão em produção.
        </span>
      </label>

      <label className="flex items-start gap-2 text-sm text-muted-foreground">
        <input type="checkbox" checked={autorizou} onChange={(e) => setAutorizou(e.target.checked)}
          className="mt-1" />
        <span>
          Confirmo que o titular autorizou o uso desta credencial. Com ela, notas fiscais
          são emitidas em nome do CNPJ dele.
        </span>
      </label>

      <button type="submit" disabled={pendente}
        className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60">
        {pendente && <Loader2 className="size-4 animate-spin" />}
        Salvar credencial
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Montar na página, lendo só booleanos**

Em `page.tsx`, acrescentar à consulta existente e renderizar:

```tsx
  // `empresa_credenciais_focus` e fechada para authenticated (0097): esta
  // leitura EXIGE client de service role. Com o client de sessao ela volta
  // vazia e a tela mentiria dizendo "nenhum token guardado".
  const { data: cred } = await createAdminClient()
    .from('empresa_credenciais_focus')
    .select('token_hom_cifrado, token_prod_cifrado')
    .eq('empresa_id', companyId).maybeSingle();
  const { data: fis } = await sb
    .from('empresas_fiscais')
    .select('focus_origem, focus_producao_declarada')
    .eq('empresa_id', companyId).maybeSingle();
```
```tsx
  {/* AS COLUNAS CIFRADAS NÃO SAEM DAQUI: só "tem ou não tem". */}
  <CredencialFocusCard
    companyId={companyId}
    origem={(fis?.focus_origem ?? 'balu') as 'propria' | 'balu'}
    temHom={Boolean(cred?.token_hom_cifrado)}
    temProd={Boolean(cred?.token_prod_cifrado)}
    producaoDeclarada={Boolean(fis?.focus_producao_declarada)}
  />
```

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit && npm run build`
Expected: 0 erros, build limpo.

- [ ] **Step 4: Commit**

```bash
git add "app/src/app/(auth)/(gated)/contador/clientes/[companyId]/"
git commit -m "feat(contador): card da credencial Focus do cliente"
```

---

### Task 15: O empresário vê quem cadastrou

**Files:**
- Modify: `app/src/app/(auth)/(gated)/configuracoes/page.tsx`

**Por quê (spec §7):** a custódia só vale se o titular consegue ver que o escritório cadastrou a credencial dele. Mesmo princípio de `cert_enviado_por` da 0085.

- [ ] **Step 1: Ler o rastro e mostrar**

```tsx
  const { data: rastro } = await supabase
    .from('companies')
    .select('focus_token_em, focus_token_por')
    .eq('id', companyId).maybeSingle();
```
```tsx
  {rastro?.focus_token_em && (
    <p className="text-xs text-muted-foreground">
      A credencial fiscal desta empresa foi cadastrada pelo seu escritório de
      contabilidade em {new Date(rastro.focus_token_em).toLocaleDateString('pt-BR')}.
    </p>
  )}
```

- [ ] **Step 2: Verificar**

Run: `npx tsc --noEmit`
Expected: 0 erros.

- [ ] **Step 3: Commit**

```bash
git add "app/src/app/(auth)/(gated)/configuracoes/page.tsx"
git commit -m "feat(lgpd): o empresario ve que o escritorio cadastrou a credencial dele"
```

---

## Fase 5 — auditoria e fechamento

### Task 16: Emissão em produção vai para o `audit_log`

**Files:**
- Modify: `app/src/app/(auth)/(gated)/notas_fiscais/actions.ts` (os três pontos de emissão)

- [ ] **Step 1: Após cada emissão bem-sucedida com `ambiente === 'prod'`**

```typescript
    if (credencial.ambiente === 'prod') {
      // Só produção. Homologação é teste e encheria a trilha de ruído — e
      // trilha com ruído é trilha que ninguém lê.
      await registrarAuditoria({
        actorUserId: userId,
        acao: 'nota.emitida_producao',
        alvoTipo: 'notas_fiscais', alvoId: notaId,
        meta: { ref, tipo_documento: tipoDoc, company_id: companyId },
      });
    }
```

- [ ] **Step 2: Verificar**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 0 erros, verde.

- [ ] **Step 3: Commit**

```bash
git add "app/src/app/(auth)/(gated)/notas_fiscais/actions.ts"
git commit -m "feat(auditoria): emissao em producao registrada no audit_log"
```

---

### Task 17: Não-regressão e gate final

- [ ] **Step 1: Provar que empresa sem nada configurado não mudou de comportamento**

Escrever em `resolver-credencial.test.ts`:

```typescript
it('empresa sem NADA configurado continua em homologacao, como antes da 0096', () => {
  // Os defaults da migration são exatamente este caso: origem 'balu',
  // ambiente 'hom'. Se este teste quebrar, o deploy muda o comportamento de
  // toda empresa existente.
  const r = decidirCredencial({
    origem: 'balu', ambiente: 'hom', tokenHom: 'tok', tokenProd: null,
    certNotAfter: null, habilitaProducaoFocus: false, producaoDeclarada: false,
  });
  expect(r).toEqual({ ok: true, ambiente: 'hom', token: 'tok' });
});
```

- [ ] **Step 2: Rodar o gate completo, a partir de `app/`**

```bash
npx tsc --noEmit && npx vitest run && npm run build
```
Expected: 0 erros · suíte verde (≥ 1914 + os novos) · build limpo.

- [ ] **Step 3: Conferir que sumiu o ambiente fixo do produto**

```bash
grep -rn ": FocusEnv = 'hom'\|ENV: FocusEnv" app/src/ | grep -v ".test."
```
Expected: nenhuma linha.

- [ ] **Step 4: Conferir que nenhum select traz a coluna velha (spec §8)**

```bash
grep -rn "focus_token" app/src/ | grep -v ".test." | grep -v "focus_token_por" | grep -v "focus_token_em"
```
Expected: nenhuma linha. Qualquer sobra é um caminho que continuaria lendo
`companies.focus_token`, esvaziada na Task 2 — e falharia em silêncio com token
nulo. As duas exceções (`focus_token_por` / `focus_token_em`) são o rastro, que
fica em `companies` de propósito.

- [ ] **Step 5: Conferir que a tabela de credencial segue fechada**

```bash
node -e "
const fs=require('fs');const{Client}=require('pg');
const env={};for(const l of fs.readFileSync('.env.local','utf8').split('
')){const t=l.trim();if(!t||t.startsWith('#'))continue;const i=t.indexOf('=');if(i<0)continue;env[t.slice(0,i).trim()]=t.slice(i+1).trim();}
const ref=new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
(async()=>{const c=new Client({host:'db.'+ref+'.supabase.co',port:5432,user:'postgres',password:env.SUPABASE_PASSWORD,database:'postgres',ssl:{rejectUnauthorized:false}});await c.connect();
const r=await c.query(\"select has_table_privilege('authenticated','public.empresa_credenciais_focus','SELECT') as le\");
console.log('authenticated le a credencial?', r.rows[0].le); await c.end();})();
"
```
Expected: `authenticated le a credencial? false`. Se virar `true`, alguém
reconcedeu o grant e o buraco da 0096 voltou.

- [ ] **Step 4: Commit e atualização do CHECKPOINT**

```bash
git add CHECKPOINT.md app/src/lib/fiscal/resolver-credencial.test.ts
git commit -m "docs(checkpoint): bloco 5 -- ambiente por empresa e credencial cifrada"
```

---

### Task 18: Playwright — a RLS do contador segue sem escrita

**Files:**
- Modify: `app/tests/rls-contador.spec.ts` (acrescentar um caso à matriz)

**Por quê (spec §7 e §10):** a Task 13 prova o anti-IDOR com mock. Mock prova a
intenção do código; só o banco real prova a fronteira. A afirmação que precisa
de prova é: *"a RLS do contador em `companies` segue SELECT-only"* — se ela cair,
um contador grava credencial fiscal direto pela sessão dele, sem passar pela
action e sem auditoria.

**Reusar o spec existente, não criar outro.** `rls-contador.spec.ts` já monta
dois escritórios (C1/C2), duas empresas (X vinculada, Y solta), tem teardown e
a `guarda-ambiente` que impede rodar contra produção. Duplicar esse setup em
arquivo novo seria 300 linhas repetidas.

- [ ] **Step 1: Acrescentar o caso, junto dos outros de `companies` (após a linha ~210)**

```typescript
  // Bloco 5: a credencial fiscal do cliente NÃO pode ser gravada pela sessão do
  // contador. A escrita legítima existe (`focus-actions.ts`), mas passa por
  // service role com anti-IDOR e auditoria. Se a RLS deixar escrever direto,
  // aquele caminho vira decoração.
  test('contador NÃO grava credencial Focus do cliente vinculado', async () => {
    const c1 = await signIn(emailC1);
    const { data, error } = await c1
      .from('companies')
      .update({ focus_token_hom_cifrado: 'enc:v1:invasao' })
      .eq('id', xId)
      .select('id');

    // Dois desfechos aceitáveis, e os dois são recusa: erro de permissão, ou
    // zero linhas afetadas (RLS filtra a linha antes do UPDATE). O que NÃO pode
    // acontecer é voltar linha gravada.
    expect(data ?? [], 'contador conseguiu gravar credencial via RLS').toHaveLength(0);
    if (error) expect(error.message).toMatch(/permission|policy|denied/i);
  });
```

> Conferir o nome da variável do e-mail de C1 no arquivo (o setup do spec já o
> define para os testes de `signIn` existentes) e usar o mesmo — não criar outro.

- [ ] **Step 2: Rodar**

Run (a partir de `app/`):
```bash
set -a; . ./.env.local; set +a; npx playwright test rls-contador --reporter=line
```
Expected: PASS — ou o skip da `guarda-ambiente`, que é resultado honesto e não
falso verde.

- [ ] **Step 3: Commit**

```bash
git add app/tests/rls-contador.spec.ts
git commit -m "test(seguranca): RLS do contador nao grava credencial fiscal do cliente"
```

---

## Ordem de corte

Decidida agora, não no meio da execução. Se o tempo apertar antes de 24/08, sai de baixo para cima:

| ordem de corte | tasks | o que se perde |
|---|---|---|
| 1º a sair | 15 (rastro para o empresário) | transparência para o titular; a custódia segue no `audit_log` |
| 2º | 16 (auditoria de produção) | trilha da emissão real — suportável enquanto não há emissão real |
| 3º | 18 (Playwright) | a prova da fronteira contra o banco real; o anti-IDOR da Task 13 continua coberto por teste unitário. **Se a 13–14 cair, esta cai junto** — não sobra escrita a proteger |
| 4º | 13–14 (tela do contador) | cadastro de credencial passa a ser por script até a tela existir |
| **nunca sai** | **1, 2, 8, 9, 10** | schema, cifra e o ambiente da nota. São os que ficam **caros depois do lançamento** — hoje o banco tem 2 notas |

Tasks 3–7, 11 e 12 são o miolo funcional: sem elas o bloco não entrega nada.

## O que este plano NÃO entrega

Repetido da spec §9, para não virar promessa no meio da execução:

- **Emissão em produção com `origem = 'balu'`** — depende da Focus liberar a API de Empresas (401 `permissao_negada` desde 23/07/2026).
- **Habilitar NFS-e produção pela plataforma** — mesmo `PUT` bloqueado.
- **Provar uma emissão real em produção** — gera documento fiscal de verdade. Só com autorização explícita do titular, empresa e competência escolhidas a dedo.

**Entrada externa — RESPONDIDA em 20/08/2026.** O par de tokens do `.env.local` é
da **PIPER AUTOMACOES E INTEGRACOES LTDA**, CNPJ `61061690000183`
(Apucarana/PR, Simples Nacional, ativa) — a empresa do próprio operador da
plataforma, conta `gestao@excluvia.com.br`, que permanece depois do lançamento.
É a mesma empresa do certificado A1 que já é o **contratante do SERPRO**.

Consequências para este plano:

- PIPER **não está em `companies`** hoje. Ela é operadora, não cliente.
- Como seria `focus_origem = 'propria'`, cadastrá-la **não passa pelo
  `/v2/empresas`** — o endpoint bloqueado desde 23/07. O caminho existe.
- ⛔ **DECIDIDO EM 20/08/2026 — a PIPER NÃO entra como empresa neste bloco.**
  Ela é **administradora do ecossistema Balu**, e permanece só nesse papel. O
  cadastro dela como empresa fica para depois de a revenda estar destravada.
  Consequência direta: **a emissão em produção não é provada de ponta a ponta
  neste bloco**, e o §9 da spec vale exatamente como escrito. As Tasks 13-14
  entregam a tela e as invariantes provadas por teste; o primeiro sujeito real
  de `origem = 'propria'` será um cliente que traga a propria conta na Focus.

- (Registro do que seria possível, caso a decisão mude no futuro.) Ela **seria**
  o sujeito ideal para provar as Tasks 13–14 e a **emissão em produção de ponta
  a ponta**: os dois tokens autenticam
  (404 em `/v2/nfsen` no ambiente de cada um), o certificado A1 já existe, e a
  nota sairia no CNPJ do próprio operador — decisão dele, sem titular terceiro
  envolvido.
- Isso NÃO muda o §9: emitir de verdade gera documento fiscal e continua fora do
  que este plano executa por conta própria. Mudou de "impossível" para
  "disponível mediante decisão explícita".
