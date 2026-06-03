# Emissão de DAS (Simples) para meses em aberto — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Botão "Gerar DAS" em qualquer mês não-pago da página `/impostos` (Simples) → `GERARDAS12` via `token_procurador` traz valor+vencimento+código de barras+PDF, persiste em `guias_fiscais` e exibe o boleto.

**Architecture:** Refactor do `serpro.ts` para compartilhar o mTLS-com-procurador entre `/Consultar` e `/Emitir`; parser puro do `GERARDAS12` (detecta "nada devido" vs com-valor); orquestrador server-only; server action com gate Simples + upsert; botão client island fiado na listagem e no card da competência.

**Tech Stack:** Next.js 15 (Server Actions, client islands), Supabase, `node:https` (mTLS), Vitest. Spec: `docs/superpowers/specs/2026-06-03-emissao-das-simples-design.md`.

**Convenções:** trabalhar de `app/`. `npx vitest run <arquivo>` / `npx tsc --noEmit`. NÃO rodar `npm run build` com `next dev` ativo. Commits sem trailer Co-Authored-By. `competencia_referencia` = YYYYMM. `useToast()` aceita `'success'|'error'|'info'|'warning'`.

---

## File Structure

**Criar:**
- `app/src/lib/fiscal/serpro-das-simples-parse.ts` — parser puro do GERARDAS12
- `app/src/lib/fiscal/serpro-das-simples-parse.test.ts`
- `app/src/lib/fiscal/serpro-das-simples.ts` — orquestrador server-only
- `app/src/app/(auth)/impostos/GerarDasSimplesButton.tsx` — client island

**Modificar:**
- `app/src/lib/clients/serpro.ts` — refactor: `requestComProcurador` + `emitirComProcurador` (mantém `consultarComProcurador`)
- `app/src/app/(auth)/impostos/actions.ts` — `+ gerarDasSimplesAction()`
- `app/src/app/(auth)/impostos/HistoricoGuias.tsx` — botão por linha não-paga (prop `isSimples`)
- `app/src/app/(auth)/impostos/CompetenciaAtualCard.tsx` — botão (Simples) quando não pago (prop `isSimples`)
- `app/src/app/(auth)/impostos/page.tsx` — passa `isSimples` aos dois

---

## Task 1: Refactor serpro.ts (DRY do mTLS procurador) + emitirComProcurador

**Files:**
- Modify: `app/src/lib/clients/serpro.ts`

- [ ] **Step 1: Refatorar**

Em `app/src/lib/clients/serpro.ts`, localize a função `export async function consultarComProcurador(params: {...}): Promise<unknown> { ... }` (faz `https.request` mTLS POST `/integra-contador/v1/Consultar` com headers Bearer/jwt_token/autenticar_procurador_token). **Substitua a função inteira** por este trio (helper privado + duas funções públicas finas):

```ts
type ProcuradorRequest = {
  pfx: Buffer;
  passphrase: string;
  accessToken: string;
  jwt: string;
  procuradorToken: string;
  envelope: Envelope;
};

/**
 * mTLS POST com o cert do CONTRATANTE + token do procurador (headers Bearer, jwt_token e
 * autenticar_procurador_token). Compartilhado por /Consultar e /Emitir. Lança em status >= 400.
 * Devolve o envelope de resposta já parseado (objeto).
 */
async function requestComProcurador(
  path: '/integra-contador/v1/Consultar' | '/integra-contador/v1/Emitir',
  params: ProcuradorRequest,
): Promise<unknown> {
  const body = JSON.stringify(params.envelope);
  const { status, body: respBody } = await new Promise<{ status: number; body: string }>(
    (resolve, reject) => {
      const req = https.request(
        {
          host: 'gateway.apiserpro.serpro.gov.br',
          path,
          method: 'POST',
          pfx: params.pfx,
          passphrase: params.passphrase,
          headers: {
            Authorization: `Bearer ${params.accessToken}`,
            jwt_token: params.jwt,
            autenticar_procurador_token: params.procuradorToken,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          let d = '';
          res.on('data', (c) => (d += c));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: d }));
        },
      );
      req.setTimeout(25_000, () => req.destroy(new Error(`SERPRO ${path}: timeout (25s).`)));
      req.on('error', reject);
      req.write(body);
      req.end();
    },
  );
  if (status >= 400) throw new Error(`SERPRO ${path} → ${status}: ${respBody.slice(0, 200)}`);
  try {
    return JSON.parse(respBody);
  } catch {
    throw new Error(`SERPRO ${path} retornou não-JSON: ${respBody.slice(0, 200)}`);
  }
}

/** POST /Consultar (produção) via mTLS + token do procurador. */
export function consultarComProcurador(params: ProcuradorRequest): Promise<unknown> {
  return requestComProcurador('/integra-contador/v1/Consultar', params);
}

/** POST /Emitir (produção) via mTLS + token do procurador. */
export function emitirComProcurador(params: ProcuradorRequest): Promise<unknown> {
  return requestComProcurador('/integra-contador/v1/Emitir', params);
}
```

Mantém a assinatura pública de `consultarComProcurador` (mesmo shape de params) — `serpro-consulta.ts` continua funcionando sem mudança.

- [ ] **Step 2: Conferir tipos + suíte (sem regressão)**

Run: `cd app && npx tsc --noEmit 2>&1 | grep "clients/serpro.ts" || echo "ok"` → `ok`.
Run: `cd app && npx vitest run` → todos passam (a consulta não pode regredir).

- [ ] **Step 3: Commit**

```bash
cd /home/allan/Projetos/claude/balu
git add app/src/lib/clients/serpro.ts
git commit -m "refactor(serpro): requestComProcurador compartilhado + emitirComProcurador (/Emitir)"
```

---

## Task 2: Parser puro do GERARDAS12

**Files:**
- Create: `app/src/lib/fiscal/serpro-das-simples-parse.ts`
- Test: `app/src/lib/fiscal/serpro-das-simples-parse.test.ts`

- [ ] **Step 1: Escrever o teste (falhando)**

Create `app/src/lib/fiscal/serpro-das-simples-parse.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseDasSimples } from './serpro-das-simples-parse';

// "Nada devido" — resposta REAL capturada (GERARDAS12 em período pago).
const NADA_DEVIDO = {
  status: 200,
  dados: '',
  mensagens: [{ codigo: '[Aviso-PGDASD-MSG_E0139]', texto: 'Não foi gerado DAS por não haver valor devido para o período informado.' }],
};

// "Com valor" — fixture modelada no parseDasMei (mesma família; confirmar no smoke).
const COM_VALOR = {
  status: 200,
  dados: JSON.stringify([
    {
      detalhamento: [
        {
          numeroDocumento: '07202599999999999',
          dataVencimento: '20250220',
          valores: { principal: 1000.5, multa: 0, juros: 0, total: 1000.5 },
          codigoDeBarras: ['85800000010', '00501234567'],
        },
      ],
      pdf: 'JVBERi0xLjQK',
    },
  ]),
};

describe('parseDasSimples', () => {
  it('período pago → { semValor: true } (MSG_E0139)', () => {
    expect(parseDasSimples(NADA_DEVIDO)).toEqual({ semValor: true });
  });

  it('com valor → extrai valores/vencimento/barras/pdf', () => {
    const r = parseDasSimples(COM_VALOR);
    expect(r.semValor).toBe(false);
    if (r.semValor) return; // narrow
    expect(r.numeroDas).toBe('07202599999999999');
    expect(r.dataVencimento).toBe('2025-02-20');
    expect(r.valores.total).toBe(1000.5);
    expect(r.valores.principal).toBe(1000.5);
    expect(r.codigoDeBarras).toEqual(['85800000010', '00501234567']);
    expect(r.pdfBase64).toBe('JVBERi0xLjQK');
  });

  it('defensivo: dados ausente/ inválido → { semValor: true }', () => {
    expect(parseDasSimples({})).toEqual({ semValor: true });
    expect(parseDasSimples({ dados: 'não-json' })).toEqual({ semValor: true });
    expect(parseDasSimples(null)).toEqual({ semValor: true });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd app && npx vitest run src/lib/fiscal/serpro-das-simples-parse.test.ts` → FAIL (import).

- [ ] **Step 3: Implementar**

Create `app/src/lib/fiscal/serpro-das-simples-parse.ts`:

```ts
// Parser puro da resposta do PGDAS-D / GERARDAS12 (gerar DAS de um período).
// Distingue "nada devido" (período sem débito em aberto) de "com valor".
// A estrutura "com valor" é modelada no parseDasMei (mesma família) e deve ser
// confirmada contra o primeiro DAS real em aberto (smoke). Puro/testável.

export type DasSimplesResult =
  | { semValor: true }
  | {
      semValor: false;
      numeroDas: string | null;
      dataVencimento: string | null; // ISO 'YYYY-MM-DD'
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

export function parseDasSimples(resp: unknown): DasSimplesResult {
  const env = (resp ?? {}) as { dados?: unknown; mensagens?: unknown };

  // "Nada devido": dados vazio OU mensagem MSG_E0139.
  const msgs = Array.isArray(env.mensagens) ? env.mensagens : [];
  const temE0139 = msgs.some(
    (m) => typeof (m as { codigo?: unknown })?.codigo === 'string' && (m as { codigo: string }).codigo.includes('MSG_E0139'),
  );
  const dadosVazio =
    env.dados == null || (typeof env.dados === 'string' && env.dados.trim() === '');
  if (temE0139 || dadosVazio) return { semValor: true };

  let dados: unknown = env.dados;
  if (typeof dados === 'string') {
    try {
      dados = JSON.parse(dados);
    } catch {
      return { semValor: true };
    }
  }
  const first = Array.isArray(dados) ? dados[0] : dados;
  const obj = (first ?? {}) as { detalhamento?: unknown; pdf?: unknown };
  const det = Array.isArray(obj.detalhamento) ? obj.detalhamento[0] : undefined;
  if (!det) return { semValor: true };

  const d = det as {
    numeroDocumento?: unknown;
    dataVencimento?: unknown;
    valores?: { principal?: unknown; multa?: unknown; juros?: unknown; total?: unknown };
    codigoDeBarras?: unknown;
  };
  const v = d.valores ?? {};
  return {
    semValor: false,
    numeroDas: typeof d.numeroDocumento === 'string' ? d.numeroDocumento : null,
    dataVencimento: isoFromAaaammdd(d.dataVencimento),
    valores: { principal: num(v.principal), multa: num(v.multa), juros: num(v.juros), total: num(v.total) },
    codigoDeBarras: Array.isArray(d.codigoDeBarras) ? d.codigoDeBarras.map(String) : [],
    pdfBase64: typeof obj.pdf === 'string' ? obj.pdf : null,
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd app && npx vitest run src/lib/fiscal/serpro-das-simples-parse.test.ts` → PASS (3).

- [ ] **Step 5: Commit**

```bash
cd /home/allan/Projetos/claude/balu
git add app/src/lib/fiscal/serpro-das-simples-parse.ts app/src/lib/fiscal/serpro-das-simples-parse.test.ts
git commit -m "feat(impostos): parser puro do GERARDAS12 (nada devido vs com valor)"
```

---

## Task 3: Orquestrador server-only gerarDasSimples

**Files:**
- Create: `app/src/lib/fiscal/serpro-das-simples.ts`

- [ ] **Step 1: Implementar**

Create `app/src/lib/fiscal/serpro-das-simples.ts`:

```ts
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { garantirAuthContratante } from '@/lib/fiscal/serpro-contratante';
import { garantirTokenProcurador } from '@/lib/fiscal/serpro-procurador';
import { emitirComProcurador, Tipo } from '@/lib/clients/serpro';
import { parseDasSimples, type DasSimplesResult } from '@/lib/fiscal/serpro-das-simples-parse';

type Result = { ok: true; result: DasSimplesResult } | { ok: false; error: string };

/**
 * Gera o DAS (PGDAS-D / GERARDAS12) de um período de uma empresa do Simples, via o token do
 * procurador. Período pago → parseDasSimples devolve { semValor: true } (sem efeito de pagamento).
 */
export async function gerarDasSimples(
  supabase: SupabaseClient,
  companyId: string,
  competencia: string, // 'YYYYMM'
): Promise<Result> {
  const { data: company } = await supabase.from('companies').select('cnpj').eq('id', companyId).single();
  const empresaCnpj = String(company?.cnpj ?? '').replace(/\D+/g, '');
  if (!empresaCnpj) return { ok: false, error: 'CNPJ da empresa ausente.' };

  const auth = await garantirAuthContratante();
  if (!auth) return { ok: false, error: 'Configure o certificado do contratante (SERPRO) para gerar DAS.' };
  const tk = await garantirTokenProcurador(supabase, companyId);
  if (!tk.ok) return { ok: false, error: tk.warning };

  const envelope = {
    contratante: { numero: auth.cnpj, tipo: Tipo.CNPJ },
    autorPedidoDados: { numero: empresaCnpj, tipo: Tipo.CNPJ },
    contribuinte: { numero: empresaCnpj, tipo: Tipo.CNPJ },
    pedidoDados: {
      idSistema: 'PGDASD',
      idServico: 'GERARDAS12',
      versaoSistema: '1.0',
      dados: JSON.stringify({ periodoApuracao: competencia }),
    },
  };

  try {
    const resp = await emitirComProcurador({
      pfx: auth.pfx,
      passphrase: auth.passphrase,
      accessToken: auth.accessToken,
      jwt: auth.jwt,
      procuradorToken: tk.token,
      envelope,
    });
    return { ok: true, result: parseDasSimples(resp) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (/ICGERENCIADOR-022|procura(c|ç)[aã]o/i.test(msg)) {
      return { ok: false, error: 'A empresa ainda não autorizou a Balu (Termo/procuração) na SERPRO.' };
    }
    return { ok: false, error: `Falha ao gerar o DAS na SERPRO: ${msg.slice(0, 160)}` };
  }
}
```

- [ ] **Step 2: Verificar deps + tipos**

Run: `cd app && grep -nE "export const Tipo|export function emitirComProcurador" src/lib/clients/serpro.ts` — confirme `Tipo` e `emitirComProcurador` exportados (Task 1).
Run: `cd app && npx tsc --noEmit 2>&1 | grep "serpro-das-simples.ts" || echo "ok"` → `ok`.

- [ ] **Step 3: Commit**

```bash
cd /home/allan/Projetos/claude/balu
git add app/src/lib/fiscal/serpro-das-simples.ts
git commit -m "feat(impostos): orquestrador gerarDasSimples (auth+token+emitir+parse)"
```

---

## Task 4: Server action gerarDasSimplesAction

**Files:**
- Modify: `app/src/app/(auth)/impostos/actions.ts`

- [ ] **Step 1: Adicionar import**

No topo de `actions.ts`, adicione (sem duplicar o que já houver — `tipoFromCode` já foi importado de `@/lib/fiscal/regime` numa feature anterior; reuse):

```ts
import { gerarDasSimples } from '@/lib/fiscal/serpro-das-simples';
```

- [ ] **Step 2: Adicionar a action no fim do arquivo**

```ts
export type GerarDasSimplesResult =
  | { ok: true; semValor: boolean }
  | { ok: false; error: string };

/**
 * Gera o DAS (PGDAS-D / GERARDAS12) de uma competência via o token do procurador e persiste
 * em guias_fiscais. Só Simples. Período pago → { ok:true, semValor:true } (não persiste valor).
 */
export async function gerarDasSimplesAction(competencia: string): Promise<GerarDasSimplesResult> {
  if (!/^\d{6}$/.test(competencia)) return { ok: false, error: 'Competência inválida (YYYYMM).' };

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Não autenticado.' };

  const { data: profile } = await supabase
    .from('profiles').select('current_company').eq('user_id', user.id).single();
  const companyId = (profile?.current_company ?? null) as string | null;
  if (!companyId) return { ok: false, error: 'Nenhuma empresa ativa selecionada.' };

  const { data: fiscal } = await supabase
    .from('empresas_fiscais')
    .select('Code_regime_tributario')
    .eq('empresa_id', companyId).is('deleted_at', null).maybeSingle();
  if (!fiscal) return { ok: false, error: 'Empresa fiscal não configurada.' };
  if (tipoFromCode((fiscal.Code_regime_tributario ?? '') as string) !== 'simples') {
    return { ok: false, error: 'Geração de DAS por aqui cobre Simples (PGDAS-D); MEI usa o fluxo próprio.' };
  }

  const r = await gerarDasSimples(supabase, companyId, competencia);
  if (!r.ok) return r;
  if (r.result.semValor) return { ok: true, semValor: true };

  const d = r.result;
  const mes = Number(competencia.slice(4, 6));
  const ano = Number(competencia.slice(0, 4));
  const { error } = await supabase
    .from('guias_fiscais')
    .upsert(
      {
        company_id: companyId,
        owner_user_id: user.id,
        competencia_referencia: competencia,
        competencia_mes: mes,
        competencia_ano: ano,
        numero_das: d.numeroDas,
        valor_principal: d.valores.principal,
        valor_multa: d.valores.multa,
        valor_juros: d.valores.juros,
        valor_total: d.valores.total,
        data_vencimento: d.dataVencimento,
        linha_digitavel: d.codigoDeBarras.join(' '),
        codigo_barras: d.codigoDeBarras.join(''),
        url_pdf: d.pdfBase64 ? `data:application/pdf;base64,${d.pdfBase64}` : null,
        status: 'gerada',
        origem: 'serpro',
        updated_at: new Date().toISOString(),
        deleted_at: null,
      },
      { onConflict: 'company_id,competencia_referencia' },
    );
  if (error) return { ok: false, error: `Falha ao salvar a guia: ${error.message}` };

  revalidatePath('/impostos');
  return { ok: true, semValor: false };
}
```

- [ ] **Step 3: Conferir tipos (projeto inteiro)**

Run: `cd app && npx tsc --noEmit` → zero erros.

- [ ] **Step 4: Commit**

```bash
cd /home/allan/Projetos/claude/balu
git add "app/src/app/(auth)/impostos/actions.ts"
git commit -m "feat(impostos): gerarDasSimplesAction (gate Simples + upsert do DAS gerado)"
```

---

## Task 5: Botão client island + fiação (HistoricoGuias, CompetenciaAtualCard, page)

**Files:**
- Create: `app/src/app/(auth)/impostos/GerarDasSimplesButton.tsx`
- Modify: `app/src/app/(auth)/impostos/HistoricoGuias.tsx`
- Modify: `app/src/app/(auth)/impostos/CompetenciaAtualCard.tsx`
- Modify: `app/src/app/(auth)/impostos/page.tsx`

- [ ] **Step 1: Criar o botão**

Create `app/src/app/(auth)/impostos/GerarDasSimplesButton.tsx`:

```tsx
'use client';
// @custom — Botão "Gerar DAS" (Simples). Chama gerarDasSimplesAction e recarrega.
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FileDown, Loader2 } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { gerarDasSimplesAction } from './actions';

export default function GerarDasSimplesButton({
  competencia,
  variant = 'inline',
}: {
  competencia: string;
  variant?: 'inline' | 'primary';
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  function handle() {
    if (pending || !competencia) return;
    startTransition(async () => {
      const r = await gerarDasSimplesAction(competencia);
      if (r.ok && r.semValor) {
        toast('info', 'Sem débito em aberto para esta competência.');
        router.refresh();
      } else if (r.ok) {
        toast('success', 'DAS gerado.');
        router.refresh();
      } else {
        toast('error', r.error);
      }
    });
  }

  const cls =
    variant === 'primary'
      ? 'inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50'
      : 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1 text-xs font-medium text-foreground hover:bg-surface-2 disabled:opacity-50';

  return (
    <button type="button" onClick={handle} disabled={pending} className={cls}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />}
      {pending ? 'Gerando…' : 'Gerar DAS'}
    </button>
  );
}
```

- [ ] **Step 2: Fiar no HistoricoGuias (linha não-paga)**

Em `HistoricoGuias.tsx`:
(a) adicione o import: `import GerarDasSimplesButton from './GerarDasSimplesButton';`
(b) troque a assinatura do componente:
```ts
export default function HistoricoGuias({ initial }: { initial: GuiaRow[] }) {
```
por:
```ts
export default function HistoricoGuias({ initial, isSimples = false }: { initial: GuiaRow[]; isSimples?: boolean }) {
```
(c) na célula de ações da linha, troque:
```tsx
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <GuiaActions guia={g} variant="inline" />
                  </div>
```
por:
```tsx
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {isSimples && g.statusVisual !== 'paga' && g.competencia && (
                      <GerarDasSimplesButton competencia={g.competencia} variant="inline" />
                    )}
                    <GuiaActions guia={g} variant="inline" />
                  </div>
```

- [ ] **Step 3: Fiar no CompetenciaAtualCard (não pago)**

Em `CompetenciaAtualCard.tsx`:
(a) adicione o import: `import GerarDasSimplesButton from './GerarDasSimplesButton';`
(b) adicione `isSimples: boolean` ao type `Props` e ao destructuring:
```ts
type Props = { apuracao: ApuracaoRow | null; guia: GuiaRow | null; competencia: string; isMei: boolean; isSimples: boolean };

export default function CompetenciaAtualCard({ apuracao, guia, competencia, isMei, isSimples }: Props) {
```
(c) propague pra EmptyCompetencia no early-return:
```tsx
  if (!apuracao && !guia) {
    return <EmptyCompetencia competencia={competencia} isMei={isMei} isSimples={isSimples} />;
  }
```
(d) troque o bloco de ações:
```tsx
        <div className="sm:w-56 flex flex-col gap-2 shrink-0">
          {guia ? (
            <GuiaActions guia={guia} variant="primary" />
          ) : isMei ? (
            <GerarDasButton competencia={competencia} />
          ) : null}
        </div>
```
por:
```tsx
        <div className="sm:w-56 flex flex-col gap-2 shrink-0">
          {guia && <GuiaActions guia={guia} variant="primary" />}
          {isSimples && (guia?.status ?? '').toLowerCase() !== 'paga' && (
            <GerarDasSimplesButton competencia={competencia} variant="primary" />
          )}
          {!guia && isMei && <GerarDasButton competencia={competencia} />}
        </div>
```
(e) atualize `EmptyCompetencia` pra aceitar e usar `isSimples`:
```tsx
function EmptyCompetencia({ competencia, isMei, isSimples }: { competencia: string; isMei: boolean; isSimples: boolean }) {
```
e, logo após o bloco `{isMei && (... GerarDasButton ...)}`, adicione:
```tsx
      {isSimples && (
        <div className="mt-3">
          <GerarDasSimplesButton competencia={competencia} variant="primary" />
        </div>
      )}
```

- [ ] **Step 4: Passar isSimples no page.tsx**

Em `page.tsx`, na renderização:
- troque `<CompetenciaAtualCard apuracao={...} guia={...} competencia={competenciaAtual} isMei={isMei} />` por incluir `isSimples={isSimples}`.
- troque `<HistoricoGuias initial={historico} />` por `<HistoricoGuias initial={historico} isSimples={isSimples} />`.

(`isSimples` já é calculado no `page.tsx` desde a feature de consulta — confirme com `grep -n "isSimples" "src/app/(auth)/impostos/page.tsx"`; se por algum motivo não existir, adicione `const isSimples = tipoFromCode((fiscal?.Code_regime_tributario ?? '') as string) === 'simples';` junto ao `isMei`, garantindo o import de `tipoFromCode`.)

- [ ] **Step 5: Conferir tipos (projeto inteiro)**

Run: `cd app && npx tsc --noEmit` → zero erros.

- [ ] **Step 6: Commit**

```bash
cd /home/allan/Projetos/claude/balu
git add "app/src/app/(auth)/impostos/GerarDasSimplesButton.tsx" "app/src/app/(auth)/impostos/HistoricoGuias.tsx" "app/src/app/(auth)/impostos/CompetenciaAtualCard.tsx" "app/src/app/(auth)/impostos/page.tsx"
git commit -m "feat(impostos): botão Gerar DAS (Simples) em meses não-pagos"
```

---

## Task 6: Verificação final

**Files:** nenhum (verificação)

- [ ] **Step 1: TypeScript limpo** — `cd app && npx tsc --noEmit` → zero erros.
- [ ] **Step 2: Suíte unit** — `cd app && npx vitest run` → PASS (inclui `serpro-das-simples-parse` + pré-existentes sem regressão).
- [ ] **Step 3: Smoke manual (ambiente real, IMPORTANTE p/ confirmar a estrutura "com valor")** — com uma empresa Simples e o cert dela enviado, num mês **em aberto** real: clicar "Gerar DAS" → conferir que o valor/vencimento/PDF aparecem e que a linha persiste. **Se a estrutura do `GERARDAS12` divergir do `parseDasMei`, ajustar `parseDasSimples` conforme a resposta real** (e atualizar o teste com a fixture real). Em mês pago: toast "Sem débito em aberto", sem persistir.
- [ ] **Step 4: Commit final (se houve ajuste)** — `git add -A && git commit -m "test(impostos): ajuste do parser GERARDAS12 conforme resposta real" || echo "nada a commitar"`.

---

## Self-review (cobertura do spec)
- ✅ GERARDAS12 via token_procurador, gate Simples → Task 3 + 4
- ✅ Refactor DRY do mTLS (Consultar/Emitir) → Task 1
- ✅ Parser nada-devido vs com-valor (real + modelado) → Task 2
- ✅ Persistência com valores em guias_fiscais (inline PDF) → Task 4
- ✅ Botão em qualquer mês não-pago (listagem + card) → Task 5
- ✅ "Nada devido" = info, não erro → Task 4 (semValor) + Task 5 (toast info)
- ✅ Ressalva da estrutura "com valor" confirmada no smoke → Task 6 Step 3
- ✅ Fora de escopo respeitado (MEI, parse PDF, drop colunas órfãs intactos)
```
