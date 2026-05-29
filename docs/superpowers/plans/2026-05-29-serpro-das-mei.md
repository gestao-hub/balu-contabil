# Geração de DAS-MEI via Serpro — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gerar o DAS do MEI via Serpro Integra Contador (PGMEI/GERARDASPDF21), persistir em `guias_fiscais` e exibir em `/impostos` — testável contra o Trial, com produção gated.

**Architecture:** Parser puro da resposta Serpro + resolvedor de ambiente (trial/prod) + extensão do client `serpro.ts` (serviço PGMEI, caminho prod gated) + server action `gerarDasMeiAction` que monta envelope, chama Serpro, persiste a guia e liga à apuração + botão "Gerar DAS" no card de competência (a exibição da guia já existe).

**Tech Stack:** Next.js 15 (Server Actions), Supabase, vitest, TypeScript, Serpro Integra Contador.

**Spec:** `docs/superpowers/specs/2026-05-29-serpro-das-mei-design.md`

---

## Decisões fixadas (do spec + código real)

- **Trial** usa entradas de demonstração fixas: CNPJ `00000000000100` (3 campos), `periodoApuracao "201901"`. A guia é **persistida sob a competência que o usuário pediu** (ex. `202605`), com os **valores retornados pelo Serpro**.
- **PDF inline**: `guias_fiscais.url_pdf = "data:application/pdf;base64,<pdf>"`.
- **Prod gated**: `call()` no modo prod exige token mTLS (`accessToken` + `jwt`); a action lê de `empresas_fiscais.certificado_access_token/certificado_jwt/certificado_token_expiration` e, se ausente/expirado, retorna erro claro (não dispara). Renovação mTLS on-demand fica para depois (documentado no spec §8).
- **Idempotência**: UNIQUE `(company_id, competencia_referencia)` em `guias_fiscais` (índice **não-parcial**, p/ o `onConflict` do PostgREST funcionar — lição da apuração).
- Competência canônica = `YYYYMM` (helpers em `lib/fiscal/guia.ts`).
- A exibição da guia (valor, vencimento, Baixar PDF, copiar linha) **já existe** em `CompetenciaAtualCard` + `GuiaActions`. Só falta o botão "Gerar DAS".

## File Structure

- Create: `src/lib/fiscal/das-mei-parse.ts` — parser puro da resposta Serpro PGMEI.
- Create: `src/lib/fiscal/serpro-env.ts` — resolve env trial/prod + inputs de demonstração.
- Modify: `src/lib/clients/serpro.ts` — `PGMEI_SERVICES`, `emitirDasMei`, caminho prod gated em `call()`.
- Create: `supabase/migrations/0008_guias_unique.sql` — unique index.
- Modify: `src/app/(auth)/impostos/actions.ts` — `gerarDasMeiAction`.
- Create: `src/app/(auth)/impostos/GerarDasButton.tsx` — client island do botão.
- Modify: `src/app/(auth)/impostos/CompetenciaAtualCard.tsx` — render do botão (MEI, sem guia).
- Modify: `src/app/(auth)/impostos/page.tsx` — passar `isMei` ao card.
- Test: `*.test.ts` ao lado dos módulos puros.

Comandos (de `balu-next/`): teste único `npx vitest run <path>` (o `npm run test` é watch). Typecheck: `npm run typecheck`.

---

## Task 1: Parser puro da resposta Serpro (`das-mei-parse.ts`)

**Files:**
- Create: `src/lib/fiscal/das-mei-parse.ts`
- Test: `src/lib/fiscal/das-mei-parse.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { parseDasMei } from './das-mei-parse';

// Envelope real do Serpro: dados é STRING JSON.
const detalhe = {
  periodoApuracao: '201901',
  numeroDocumento: '07.0.00000-00',
  dataVencimento: '20190220',
  valores: { principal: 55.9, multa: 11.18, juros: 10.71, total: 77.79 },
  codigoDeBarras: ['8166', '0000', '0779', '1234'],
};
const envelopeComPdf = {
  status: 200,
  mensagens: [{ codigo: 'Sucesso', texto: 'Requisição efetuada com sucesso' }],
  dados: JSON.stringify([{ cnpjCompleto: '00000000000100', detalhamento: [detalhe], pdf: 'JVBERi0xLjQK' }]),
};

describe('parseDasMei', () => {
  it('extrai número, vencimento ISO, valores, código de barras e pdf', () => {
    const r = parseDasMei(envelopeComPdf);
    expect(r.numeroDocumento).toBe('07.0.00000-00');
    expect(r.dataVencimento).toBe('2019-02-20');
    expect(r.valores.total).toBe(77.79);
    expect(r.valores.principal).toBe(55.9);
    expect(r.codigoDeBarras).toEqual(['8166', '0000', '0779', '1234']);
    expect(r.pdfBase64).toBe('JVBERi0xLjQK');
  });

  it('pdf ausente (variante código de barras) → pdfBase64 null', () => {
    const env = { ...envelopeComPdf, dados: JSON.stringify([{ detalhamento: [detalhe] }]) };
    expect(parseDasMei(env).pdfBase64).toBeNull();
  });

  it('aceita dados já como objeto (não-string)', () => {
    const env = { status: 200, dados: [{ detalhamento: [detalhe], pdf: 'x' }] };
    expect(parseDasMei(env).valores.total).toBe(77.79);
  });

  it('lança quando não há detalhamento', () => {
    const env = { status: 200, dados: JSON.stringify([{ detalhamento: [] }]) };
    expect(() => parseDasMei(env)).toThrow(/não retornou DAS/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/fiscal/das-mei-parse.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Write minimal implementation**

```ts
// @custom — Parser puro da resposta do Serpro PGMEI / GERARDASPDF21.
// O envelope traz `dados` como STRING JSON (às vezes já objeto). Sem rede.

export type DasMeiResult = {
  numeroDocumento: string | null;
  dataVencimento: string | null; // ISO "YYYY-MM-DD"
  valores: { principal: number; multa: number; juros: number; total: number };
  codigoDeBarras: string[];
  pdfBase64: string | null;
};

function isoFromAaaammdd(s: unknown): string | null {
  if (typeof s !== 'string' || !/^\d{8}$/.test(s)) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export function parseDasMei(envelope: unknown): DasMeiResult {
  const env = (envelope ?? {}) as { dados?: unknown };
  let dados: unknown = env.dados;
  if (typeof dados === 'string') {
    try {
      dados = JSON.parse(dados);
    } catch {
      throw new Error('Serpro retornou `dados` em formato inválido.');
    }
  }
  const first = Array.isArray(dados) ? dados[0] : dados;
  const obj = (first ?? {}) as { detalhamento?: unknown; pdf?: unknown };
  const det = Array.isArray(obj.detalhamento) ? obj.detalhamento[0] : undefined;
  if (!det) throw new Error('Serpro não retornou DAS para a competência.');

  const d = det as {
    numeroDocumento?: unknown;
    dataVencimento?: unknown;
    valores?: { principal?: unknown; multa?: unknown; juros?: unknown; total?: unknown };
    codigoDeBarras?: unknown;
  };
  const v = d.valores ?? {};
  return {
    numeroDocumento: typeof d.numeroDocumento === 'string' ? d.numeroDocumento : null,
    dataVencimento: isoFromAaaammdd(d.dataVencimento),
    valores: { principal: num(v.principal), multa: num(v.multa), juros: num(v.juros), total: num(v.total) },
    codigoDeBarras: Array.isArray(d.codigoDeBarras) ? d.codigoDeBarras.map(String) : [],
    pdfBase64: typeof obj.pdf === 'string' ? obj.pdf : null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/fiscal/das-mei-parse.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/fiscal/das-mei-parse.ts src/lib/fiscal/das-mei-parse.test.ts
git commit -m "feat(das): parser puro da resposta Serpro PGMEI (das-mei-parse)"
```

---

## Task 2: Resolver de ambiente Serpro (`serpro-env.ts`)

**Files:**
- Create: `src/lib/fiscal/serpro-env.ts`
- Test: `src/lib/fiscal/serpro-env.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { resolveSerproEnv, demoInputs } from './serpro-env';

const original = process.env.SERPRO_ENV;
afterEach(() => { process.env.SERPRO_ENV = original; });

describe('resolveSerproEnv', () => {
  it('default é trial quando não setado', () => {
    delete process.env.SERPRO_ENV;
    expect(resolveSerproEnv()).toBe('trial');
  });
  it('respeita prod', () => {
    process.env.SERPRO_ENV = 'prod';
    expect(resolveSerproEnv()).toBe('prod');
  });
  it('valor inválido cai em trial', () => {
    process.env.SERPRO_ENV = 'xpto';
    expect(resolveSerproEnv()).toBe('trial');
  });
});

describe('demoInputs', () => {
  it('CNPJ e período de demonstração do Serpro', () => {
    expect(demoInputs()).toEqual({ cnpj: '00000000000100', periodo: '201901' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/fiscal/serpro-env.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Write minimal implementation**

```ts
// @custom — Resolve ambiente Serpro (trial|prod) e inputs de demonstração do Trial.
import type { SerproEnv } from '@/lib/clients/serpro';

export function resolveSerproEnv(): SerproEnv {
  return process.env.SERPRO_ENV === 'prod' ? 'prod' : 'trial';
}

/** Entradas de demonstração aceitas pelo Trial do Serpro (PGMEI). */
export function demoInputs(): { cnpj: string; periodo: string } {
  return { cnpj: '00000000000100', periodo: '201901' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/fiscal/serpro-env.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/fiscal/serpro-env.ts src/lib/fiscal/serpro-env.test.ts
git commit -m "feat(das): resolveSerproEnv + demoInputs (trial/prod)"
```

---

## Task 3: PGMEI + emitirDasMei + caminho prod gated em `serpro.ts`

**Files:**
- Modify: `src/lib/clients/serpro.ts`

Contexto: `serpro.ts` hoje tem `call(env, action, envelope)` que usa `bearer()` (token consumer key/secret = trial). Vamos: (a) adicionar `PGMEI_SERVICES`; (b) permitir um 4º arg `prodAuth` em `call()` que, no modo prod, injeta `Authorization: Bearer <accessToken>` + header `jwt_token`; (c) helper `emitirDasMei`.

- [ ] **Step 1: Add PGMEI services + types (no test — verified by typecheck + Task 5 usage)**

Adicionar perto de `SERPRO_SERVICES`:

```ts
/** Serviços PGMEI (MEI). */
export const PGMEI_SERVICES = {
  GERAR_DAS_PDF: 'GERARDASPDF21',
} as const;

/** Token mTLS do procurador (produção). */
export type ProdAuth = { accessToken: string; jwt: string };
```

- [ ] **Step 2: Wire prod path into `call()`**

Substituir a assinatura e o corpo do `call()` por (mantendo a base URL trial/prod existente):

```ts
async function call<T>(
  env: SerproEnv,
  action: 'Declarar' | 'Emitir' | 'Consultar',
  envelope: Envelope,
  prodAuth?: ProdAuth,
): Promise<T> {
  const baseUrl = env === 'prod' ? PROD : TRIAL;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (env === 'prod') {
    if (!prodAuth) throw new Error('Serpro produção exige token mTLS (accessToken + jwt).');
    headers.Authorization = `Bearer ${prodAuth.accessToken}`;
    headers.jwt_token = prodAuth.jwt;
  } else {
    headers.Authorization = `Bearer ${await bearer()}`;
  }

  const res = await fetch(`${baseUrl}/v1/${action}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(envelope),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Serpro ${action} → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}
```

- [ ] **Step 3: Update the `serpro` export to thread `prodAuth` + add `emitirDasMei`**

Substituir o objeto `export const serpro = {...}` por:

```ts
export const serpro = {
  transmitirDeclaracao: (env: SerproEnv, envelope: Envelope, prodAuth?: ProdAuth) =>
    call(env, 'Declarar', envelope, prodAuth),
  emitirDas: (env: SerproEnv, envelope: Envelope, prodAuth?: ProdAuth) =>
    call(env, 'Emitir', envelope, prodAuth),
  emitirDasMei: (env: SerproEnv, envelope: Envelope, prodAuth?: ProdAuth) =>
    call(env, 'Emitir', envelope, prodAuth),
  consultarDeclaracao: (env: SerproEnv, envelope: Envelope, prodAuth?: ProdAuth) =>
    call(env, 'Consultar', envelope, prodAuth),
};
```

- [ ] **Step 4: Verify it compiles**

Run: `npm run typecheck`
Expected: PASS. Run `npx vitest run src/lib/clients/serpro.test.ts` if it exists — Expected: still PASS (não quebramos a assinatura trial; `prodAuth` é opcional).

- [ ] **Step 5: Commit**

```bash
git add src/lib/clients/serpro.ts
git commit -m "feat(das): serpro.ts — PGMEI service, emitirDasMei e caminho prod gated (jwt_token)"
```

---

## Task 4: Migration — unique index em `guias_fiscais`

**Files:**
- Create: `supabase/migrations/0008_guias_unique.sql`

- [ ] **Step 1: Create the migration**

```sql
-- Idempotência: 1 guia por empresa+competência. Habilita upsert idempotente em gerarDasMeiAction.
-- Índice NÃO-parcial: o onConflict do PostgREST não resolve índice parcial (WHERE ...).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_guias_company_competencia
  ON public.guias_fiscais (company_id, competencia_referencia);
```

- [ ] **Step 2: Aplicar no Supabase (manual — não automatizar)**

Aplicar via SQL Editor do Supabase. Confirmar:
Run (SQL Editor): `select indexname from pg_indexes where indexname = 'uniq_guias_company_competencia';`
Expected: 1 linha. (Se houver duplicatas em `guias_fiscais`, resolver antes.)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0008_guias_unique.sql
git commit -m "feat(db): unique index guias_fiscais (company_id, competencia_referencia)"
```

---

## Task 5: Server action `gerarDasMeiAction`

**Files:**
- Modify: `src/app/(auth)/impostos/actions.ts`

Contexto: o arquivo já tem `createServerClient` (async), `revalidatePath`, e o padrão auth → `profiles.current_company`. A competência canônica é `YYYYMM`; `competencia_mes`/`competencia_ano` derivam dela.

- [ ] **Step 1: Add the action (append ao arquivo)**

```ts
import { serpro, buildEnvelope, PGMEI_SERVICES, type ProdAuth } from '@/lib/clients/serpro';
import { parseDasMei } from '@/lib/fiscal/das-mei-parse';
import { resolveSerproEnv, demoInputs } from '@/lib/fiscal/serpro-env';

export type GerarDasResult = { ok: true } | { ok: false; error: string };

export async function gerarDasMeiAction(competencia: string): Promise<GerarDasResult> {
  if (!/^\d{6}$/.test(competencia)) return { ok: false, error: 'Competência inválida (YYYYMM).' };

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado.' };

  const { data: profile } = await supabase
    .from('profiles').select('current_company').eq('user_id', user.id).single();
  const companyId = (profile?.current_company ?? null) as string | null;
  if (!companyId) return { ok: false, error: 'Nenhuma empresa ativa selecionada.' };

  const { data: company } = await supabase
    .from('companies').select('cnpj').eq('id', companyId).single();
  const { data: fiscal } = await supabase
    .from('empresas_fiscais')
    .select('Code_regime_tributario, certificado_access_token, certificado_jwt, certificado_token_expiration')
    .eq('empresa_id', companyId).is('deleted_at', null).maybeSingle();
  if (!fiscal) return { ok: false, error: 'Empresa fiscal não configurada.' };
  if (fiscal.Code_regime_tributario !== '4') {
    return { ok: false, error: 'Geração de DAS via Serpro na v1 cobre só MEI; Simples virá depois.' };
  }

  const env = resolveSerproEnv();

  // Trial: usa CNPJ/período de demonstração. Prod: CNPJ real + competência pedida.
  const cnpjReal = String(company?.cnpj ?? '').replace(/\D+/g, '');
  const cnpj = env === 'trial' ? demoInputs().cnpj : cnpjReal;
  const periodo = env === 'trial' ? demoInputs().periodo : competencia;

  let prodAuth: ProdAuth | undefined;
  if (env === 'prod') {
    const at = fiscal.certificado_access_token as string | null;
    const jwt = fiscal.certificado_jwt as string | null;
    const exp = fiscal.certificado_token_expiration as string | null;
    if (!at || !jwt || !exp || new Date(exp).getTime() <= Date.now()) {
      return { ok: false, error: 'Produção exige certificado autenticado + procuração (token Serpro ausente/expirado).' };
    }
    prodAuth = { accessToken: at, jwt };
  }

  let parsed;
  try {
    const envelope = buildEnvelope({
      cnpjContratante: cnpj,
      cnpjContribuinte: cnpj,
      idSistema: 'PGMEI',
      idServico: PGMEI_SERVICES.GERAR_DAS_PDF,
      versaoSistema: '1.0',
      dados: { periodoApuracao: periodo },
    });
    const resp = await serpro.emitirDasMei(env, envelope, prodAuth);
    parsed = parseDasMei(resp);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Falha ao gerar DAS no Serpro.' };
  }

  const mes = Number(competencia.slice(4, 6));
  const ano = Number(competencia.slice(0, 4));
  const { data: guia, error: upErr } = await supabase
    .from('guias_fiscais')
    .upsert(
      {
        company_id: companyId,
        owner_user_id: user.id,
        competencia_referencia: competencia,
        competencia_mes: mes,
        competencia_ano: ano,
        numero_das: parsed.numeroDocumento,
        valor_principal: parsed.valores.principal,
        valor_multa: parsed.valores.multa,
        valor_juros: parsed.valores.juros,
        valor_total: parsed.valores.total,
        data_vencimento: parsed.dataVencimento,
        linha_digitavel: parsed.codigoDeBarras.join(' '),
        codigo_barras: parsed.codigoDeBarras.join(''),
        url_pdf: parsed.pdfBase64 ? `data:application/pdf;base64,${parsed.pdfBase64}` : null,
        status: 'gerada',
        origem: 'serpro',
        updated_at: new Date().toISOString(),
        deleted_at: null,
      },
      { onConflict: 'company_id,competencia_referencia' },
    )
    .select('id')
    .single();
  if (upErr || !guia) return { ok: false, error: `Falha ao salvar guia: ${upErr?.message ?? 'desconhecido'}` };

  // Liga a apuração da mesma competência à guia (se existir).
  await supabase
    .from('apuracoes_fiscais')
    .update({ guia_fiscal_id: guia.id, updated_at: new Date().toISOString() })
    .eq('company_id', companyId).eq('competencia_referencia', competencia).is('deleted_at', null);

  revalidatePath('/impostos');
  return { ok: true };
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run typecheck`
Expected: PASS. (`companies.cnpj` confirmado em `db_atual.sql` — varchar(20).)

- [ ] **Step 3: Commit**

```bash
git add "src/app/(auth)/impostos/actions.ts"
git commit -m "feat(das): gerarDasMeiAction (Serpro PGMEI → guias_fiscais, prod gated)"
```

---

## Task 6: Botão "Gerar DAS" no card de competência

**Files:**
- Create: `src/app/(auth)/impostos/GerarDasButton.tsx`
- Modify: `src/app/(auth)/impostos/CompetenciaAtualCard.tsx`
- Modify: `src/app/(auth)/impostos/page.tsx`

- [ ] **Step 1: Create the client button**

`src/app/(auth)/impostos/GerarDasButton.tsx`:

```tsx
'use client';
// @custom — Botão "Gerar DAS" (MEI). Chama gerarDasMeiAction e atualiza a página.
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FileDown, Loader2 } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { gerarDasMeiAction } from './actions';

export default function GerarDasButton({ competencia }: { competencia: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  function handle() {
    if (pending) return;
    startTransition(async () => {
      const r = await gerarDasMeiAction(competencia);
      if (r.ok) {
        toast('success', 'DAS gerado.');
        router.refresh();
      } else {
        toast('error', r.error);
      }
    });
  }

  return (
    <button
      type="button"
      onClick={handle}
      disabled={pending}
      className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />}
      {pending ? 'Gerando…' : 'Gerar DAS'}
    </button>
  );
}
```

- [ ] **Step 2: Render the button in `CompetenciaAtualCard.tsx`**

(a) Adicionar `isMei` às props e ao destructuring:

```tsx
type Props = {
  apuracao: ApuracaoRow | null;
  guia: GuiaRow | null;
  competencia: string;
  isMei: boolean;
};

export default function CompetenciaAtualCard({ apuracao, guia, competencia, isMei }: Props) {
```

(b) Importar o botão no topo:

```tsx
import GerarDasButton from './GerarDasButton';
```

(c) No bloco de ações (onde hoje só renderiza `{guia && (<GuiaActions .../>)}`), trocar por: guia existente → ações; senão, se MEI → botão gerar. Substituir esse bloco por:

```tsx
        <div className="sm:w-56 flex flex-col gap-2 shrink-0">
          {guia ? (
            <GuiaActions guia={guia} variant="primary" />
          ) : isMei ? (
            <GerarDasButton competencia={competencia} />
          ) : null}
        </div>
```

(d) No `EmptyCompetencia` (nenhuma apuração nem guia), oferecer também o "Gerar DAS" para MEI. Mudar a assinatura e o uso:

```tsx
  if (!apuracao && !guia) {
    return <EmptyCompetencia competencia={competencia} isMei={isMei} />;
  }
```

e na função `EmptyCompetencia`, após o `<Link href="/impostos/novo">…Calcular agora</Link>`, adicionar (e ajustar a assinatura para receber `isMei`):

```tsx
function EmptyCompetencia({ competencia, isMei }: { competencia: string; isMei: boolean }) {
```
```tsx
      {isMei && (
        <div className="mt-3">
          <GerarDasButton competencia={competencia} />
        </div>
      )}
```

- [ ] **Step 3: Pass `isMei` from `page.tsx`**

Em `src/app/(auth)/impostos/page.tsx`: o fetch já existe como `const [{ data: company }, { data: fiscal }, …] = await Promise.all([...])` e o `.select('Code_regime_tributario, anexo_simples')` de `empresas_fiscais` **já traz o regime** (confirmado). Só computar, antes do `return`:

```tsx
  const isMei = (fiscal?.Code_regime_tributario ?? null) === '4';
```

E no JSX do `<CompetenciaAtualCard ... />`, adicionar a prop:

```tsx
            <CompetenciaAtualCard
              apuracao={apuracaoAtual ? toApuracaoRow(apuracaoAtual) : null}
              guia={guiaAtual ? toGuiaRow(guiaAtual) : null}
              competencia={competenciaAtual}
              isMei={isMei}
            />
```

> Nota: confirme o nome da variável do registro de `empresas_fiscais` no `page.tsx` (pode ser `fiscal`). Se o select dela ainda não existir/!trouxer o regime, ajuste o `.select()` para incluir `Code_regime_tributario`.

- [ ] **Step 4: Verify it compiles**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(auth)/impostos/GerarDasButton.tsx" "src/app/(auth)/impostos/CompetenciaAtualCard.tsx" "src/app/(auth)/impostos/page.tsx"
git commit -m "feat(das): botão Gerar DAS no card de competência (MEI)"
```

---

## Task 7: Smoke runtime (Trial)

**Files:** nenhum (verificação manual).

- [ ] **Step 1: Garantir env**

Confirmar em `.env.local`: `SERPRO_CONSUMER_KEY`/`SECRET` presentes e `SERPRO_ENV` ausente ou `trial`. Migration 0008 aplicada no Supabase.

- [ ] **Step 2: Pré-condição de regime**

Para testar o botão, a empresa ativa precisa estar como **MEI** (`Code_regime_tributario = '4'`). Se a empresa de teste for Simples, trocar o regime em `/configuracoes?tab=regime` para MEI (ou usar uma empresa MEI).

- [ ] **Step 3: Rodar o fluxo**

Com `npm run dev`: logar → `/impostos` → na competência atual, clicar **"Gerar DAS"** → confirmar toast de sucesso → a guia aparece no card com **valor total do Serpro**, vencimento e **"Baixar PDF"** (abre o data URI). Conferir no log do dev que `POST` da action retornou 200 (sem erro Serpro).

- [ ] **Step 4: Idempotência**

Clicar "Gerar DAS" de novo na mesma competência → sem erro, sem duplicar (a guia atualiza). Conferir que `/impostos` mostra uma única guia para a competência.

---

## Self-review (preenchido)

**Spec coverage:** parser (T1), serpro-env (T2), PGMEI+emitirDasMei+prod gated (T3), migration UNIQUE (T4), gerarDasMeiAction (T5), botão UI (T6), smoke Trial (T7). Exibição da guia já existia (CompetenciaAtualCard/GuiaActions). Prod gated + §8 gap documentado no spec. Cobre todas as seções do spec.

**Placeholders:** nenhum — todo passo tem código/comandos completos. Duas notas de verificação contra o código real (nome da coluna de CNPJ em `companies`; nome da variável/select de `empresas_fiscais` no `page.tsx`) são checagens, não placeholders.

**Type consistency:** `DasMeiResult` (T1) consumido em T5. `SerproEnv`/`ProdAuth`/`PGMEI_SERVICES`/`buildEnvelope` (T3) usados em T5. `demoInputs`/`resolveSerproEnv` (T2) em T5. `GerarDasResult`/`gerarDasMeiAction` (T5) em T6. `isMei` (T6) consistente entre page→card→EmptyCompetencia. Competência `YYYYMM` em todo o fluxo.
