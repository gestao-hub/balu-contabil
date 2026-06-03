# Consulta de listagem de DAS (Simples) na página de impostos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar um botão "Consultar na SERPRO" na página `/impostos` (só Simples) que consulta o PGDAS-D (`CONSDECLARACAO13`) do ano-calendário atual via o `token_procurador`, e faz upsert da **situação** (declaração transmitida / DAS gerado / pago) em `guias_fiscais` — reusando a listagem existente.

**Architecture:** Parser puro sobre a resposta real do `CONSDECLARACAO13` (índice por período, sem valores) → orquestrador server-only que junta `garantirAuthContratante` + `garantirTokenProcurador` + um novo método mTLS `consultarComProcurador` → server action com gate de regime + upsert → client island que dispara a action.

**Tech Stack:** Next.js 15 (Server Actions, client islands), Supabase, `node:https` (mTLS), Vitest. Spec: `docs/superpowers/specs/2026-06-03-consulta-listagem-das-simples-design.md`.

**Convenções:** trabalhar de `app/`. `npx vitest run <arquivo>` / `npx tsc --noEmit`. NÃO rodar `npm run build` com `next dev` ativo. Commits sem trailer Co-Authored-By. `competencia_referencia` é **YYYYMM** (6 dígitos).

---

## File Structure

**Criar:**
- `app/src/lib/fiscal/serpro-consulta-parse.ts` — parser puro do CONSDECLARACAO13
- `app/src/lib/fiscal/serpro-consulta-parse.test.ts`
- `app/src/lib/fiscal/serpro-consulta.ts` — orquestrador server-only `consultarDeclaracoesSimples`
- `app/src/app/(auth)/impostos/ConsultarSerproButton.tsx` — client island

**Modificar:**
- `app/src/lib/clients/serpro.ts` — `+ consultarComProcurador()` (mTLS /Consultar + header procurador)
- `app/src/app/(auth)/impostos/actions.ts` — `+ consultarDeclaracoesAction()`
- `app/src/app/(auth)/impostos/page.tsx` — renderiza o botão quando Simples

---

## Task 1: Parser puro do CONSDECLARACAO13

**Files:**
- Create: `app/src/lib/fiscal/serpro-consulta-parse.ts`
- Test: `app/src/lib/fiscal/serpro-consulta-parse.test.ts`

- [ ] **Step 1: Escrever o teste (falhando)**

Create `app/src/lib/fiscal/serpro-consulta-parse.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseConsultaDeclaracoes } from './serpro-consulta-parse';

// Envelope SERPRO real: { ..., dados: "<json string>" }. Fixture baseada na resposta capturada
// (scripts/test-serpro-procurador-al-piscinas.mjs), + 2 meses sintéticos p/ cobrir 'gerada' e 'pendente'.
function envelope(periodos: unknown[]): unknown {
  return {
    status: 200,
    responseDateTime: '2026-06-03T10:00:13.373Z',
    dados: JSON.stringify({ anoCalendario: 2025, periodos }),
  };
}

const PAGA = {
  periodoApuracao: 202501,
  operacoes: [
    { tipoOperacao: 'Original', indiceDeclaracao: { numeroDeclaracao: '10358425202501001', dataHoraTransmissao: '20250214101623', malha: '' }, indiceDas: null },
    { tipoOperacao: 'Geração de DAS', indiceDeclaracao: null, indiceDas: { numeroDas: '07202504580937145', datahoraEmissaoDas: '20250214101627', dasPago: true } },
  ],
};
const GERADA = {
  periodoApuracao: 202502,
  operacoes: [
    { tipoOperacao: 'Original', indiceDeclaracao: { numeroDeclaracao: '10358425202502001', dataHoraTransmissao: '20250312105231', malha: '' }, indiceDas: null },
    { tipoOperacao: 'Geração de DAS', indiceDeclaracao: null, indiceDas: { numeroDas: '07202507153208526', datahoraEmissaoDas: '20250312105234', dasPago: false } },
  ],
};
const PENDENTE = {
  periodoApuracao: 202503,
  operacoes: [
    { tipoOperacao: 'Original', indiceDeclaracao: { numeroDeclaracao: '10358425202503001', dataHoraTransmissao: '20250409162156', malha: '' }, indiceDas: null },
  ],
};

describe('parseConsultaDeclaracoes', () => {
  it('mapeia período por período com competência YYYYMM', () => {
    const out = parseConsultaDeclaracoes(envelope([PAGA, GERADA, PENDENTE]));
    expect(out.map((s) => s.competencia)).toEqual(['202501', '202502', '202503']);
  });

  it('status: dasPago→paga, DAS não pago→gerada, só declaração→pendente', () => {
    const out = parseConsultaDeclaracoes(envelope([PAGA, GERADA, PENDENTE]));
    expect(out[0].status).toBe('paga');
    expect(out[0].numeroDas).toBe('07202504580937145');
    expect(out[0].dasPago).toBe(true);
    expect(out[1].status).toBe('gerada');
    expect(out[1].dasPago).toBe(false);
    expect(out[2].status).toBe('pendente');
    expect(out[2].numeroDas).toBeNull();
  });

  it('extrai numeroDeclaracao e parseia dataTransmissao (YYYYMMDDHHmmss → ISO)', () => {
    const out = parseConsultaDeclaracoes(envelope([PAGA]));
    expect(out[0].numeroDeclaracao).toBe('10358425202501001');
    expect(out[0].dataTransmissao?.startsWith('2025-02-14')).toBe(true);
  });

  it('defensivo: envelope sem dados / dados inválido → []', () => {
    expect(parseConsultaDeclaracoes({})).toEqual([]);
    expect(parseConsultaDeclaracoes({ dados: 'não-json' })).toEqual([]);
    expect(parseConsultaDeclaracoes(null)).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd app && npx vitest run src/lib/fiscal/serpro-consulta-parse.test.ts`
Expected: FAIL — import não resolve.

- [ ] **Step 3: Implementar**

Create `app/src/lib/fiscal/serpro-consulta-parse.ts`:

```ts
// Parser puro da resposta do PGDAS-D / CONSDECLARACAO13 (listagem de declarações/DAS do ano).
// O serviço é um ÍNDICE de situação: por período traz a declaração transmitida e o DAS gerado
// (+ dasPago). NÃO traz valor/vencimento. Puro/testável — sem deps de rede/Supabase.

export type SituacaoPeriodo = {
  competencia: string;            // 'YYYYMM' (= String(periodoApuracao))
  numeroDeclaracao: string | null;
  dataTransmissao: string | null; // ISO; null se ausente
  numeroDas: string | null;
  dasPago: boolean | null;        // null quando não há DAS gerado
  status: 'paga' | 'gerada' | 'pendente';
};

/** 'YYYYMMDDHHmmss' → ISO com offset de Brasília. null se inválido. */
function parseDataHora(s: unknown): string | null {
  if (typeof s !== 'string' || !/^\d{14}$/.test(s)) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}-03:00`;
}

function statusDe(numeroDas: string | null, dasPago: boolean | null): SituacaoPeriodo['status'] {
  if (dasPago === true) return 'paga';
  if (numeroDas) return 'gerada';
  return 'pendente';
}

type Operacao = {
  indiceDeclaracao?: { numeroDeclaracao?: unknown; dataHoraTransmissao?: unknown } | null;
  indiceDas?: { numeroDas?: unknown; dasPago?: unknown } | null;
};
type Periodo = { periodoApuracao?: unknown; operacoes?: Operacao[] };

export function parseConsultaDeclaracoes(resp: unknown): SituacaoPeriodo[] {
  // Desempacota o envelope SERPRO: dados é uma string JSON.
  const env = resp as { dados?: unknown } | null;
  let dados: unknown;
  try {
    dados = typeof env?.dados === 'string' ? JSON.parse(env.dados) : env?.dados;
  } catch {
    return [];
  }
  const periodos = (dados as { periodos?: unknown })?.periodos;
  if (!Array.isArray(periodos)) return [];

  const out: SituacaoPeriodo[] = [];
  for (const p of periodos as Periodo[]) {
    if (p?.periodoApuracao == null) continue;
    const competencia = String(p.periodoApuracao);
    let numeroDeclaracao: string | null = null;
    let dataTransmissao: string | null = null;
    let numeroDas: string | null = null;
    let dasPago: boolean | null = null;

    for (const op of Array.isArray(p.operacoes) ? p.operacoes : []) {
      if (op?.indiceDeclaracao) {
        const nd = op.indiceDeclaracao.numeroDeclaracao;
        if (typeof nd === 'string') numeroDeclaracao = nd;
        dataTransmissao = parseDataHora(op.indiceDeclaracao.dataHoraTransmissao) ?? dataTransmissao;
      }
      if (op?.indiceDas) {
        const nDas = op.indiceDas.numeroDas;
        if (typeof nDas === 'string') numeroDas = nDas;
        if (typeof op.indiceDas.dasPago === 'boolean') dasPago = op.indiceDas.dasPago;
      }
    }

    out.push({
      competencia,
      numeroDeclaracao,
      dataTransmissao,
      numeroDas,
      dasPago,
      status: statusDe(numeroDas, dasPago),
    });
  }
  return out;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd app && npx vitest run src/lib/fiscal/serpro-consulta-parse.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
cd /home/allan/Projetos/claude/balu
git add app/src/lib/fiscal/serpro-consulta-parse.ts app/src/lib/fiscal/serpro-consulta-parse.test.ts
git commit -m "feat(impostos): parser puro do CONSDECLARACAO13 (situação por período)"
```

---

## Task 2: serpro.ts — consultarComProcurador (mTLS /Consultar)

**Files:**
- Modify: `app/src/lib/clients/serpro.ts`

- [ ] **Step 1: Implementar o método**

Em `app/src/lib/clients/serpro.ts`, adicione (perto do `enviarTermoApoiar`, reusando o `import https from 'node:https'` já presente e o tipo `Envelope` exportado):

```ts
/**
 * POST /Consultar (produção) via mTLS com o cert do CONTRATANTE + token do procurador.
 * Headers: Authorization Bearer, jwt_token e autenticar_procurador_token. Lança em status >= 400.
 * Devolve o envelope de resposta já parseado (objeto).
 */
export async function consultarComProcurador(params: {
  pfx: Buffer;
  passphrase: string;
  accessToken: string;
  jwt: string;
  procuradorToken: string;
  envelope: Envelope;
}): Promise<unknown> {
  const body = JSON.stringify(params.envelope);
  const { status, body: respBody } = await new Promise<{ status: number; body: string }>(
    (resolve, reject) => {
      const req = https.request(
        {
          host: 'gateway.apiserpro.serpro.gov.br',
          path: '/integra-contador/v1/Consultar',
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
      req.setTimeout(25_000, () => req.destroy(new Error('SERPRO /Consultar: timeout (25s).')));
      req.on('error', reject);
      req.write(body);
      req.end();
    },
  );
  if (status >= 400) throw new Error(`SERPRO /Consultar → ${status}: ${respBody.slice(0, 200)}`);
  try {
    return JSON.parse(respBody);
  } catch {
    throw new Error(`SERPRO /Consultar retornou não-JSON: ${respBody.slice(0, 200)}`);
  }
}
```

- [ ] **Step 2: Conferir tipos**

Run: `cd app && npx tsc --noEmit 2>&1 | grep "clients/serpro.ts" || echo "ok"`
Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
cd /home/allan/Projetos/claude/balu
git add app/src/lib/clients/serpro.ts
git commit -m "feat(serpro): consultarComProcurador (mTLS /Consultar + token procurador)"
```

---

## Task 3: Orquestrador server-only consultarDeclaracoesSimples

**Files:**
- Create: `app/src/lib/fiscal/serpro-consulta.ts`

- [ ] **Step 1: Implementar**

Create `app/src/lib/fiscal/serpro-consulta.ts`:

```ts
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { garantirAuthContratante } from '@/lib/fiscal/serpro-contratante';
import { garantirTokenProcurador } from '@/lib/fiscal/serpro-procurador';
import { consultarComProcurador, Tipo } from '@/lib/clients/serpro';
import { parseConsultaDeclaracoes, type SituacaoPeriodo } from '@/lib/fiscal/serpro-consulta-parse';

type Result = { ok: true; situacoes: SituacaoPeriodo[] } | { ok: false; error: string };

/**
 * Consulta as declarações/DAS do ano (PGDAS-D / CONSDECLARACAO13) de uma empresa do Simples,
 * via o token do procurador. Read-only — não persiste (quem chama decide o upsert).
 */
export async function consultarDeclaracoesSimples(
  supabase: SupabaseClient,
  companyId: string,
  ano: number,
): Promise<Result> {
  // CNPJ da empresa (contribuinte).
  const { data: company } = await supabase.from('companies').select('cnpj').eq('id', companyId).single();
  const empresaCnpj = String(company?.cnpj ?? '').replace(/\D+/g, '');
  if (!empresaCnpj) return { ok: false, error: 'CNPJ da empresa ausente.' };

  // Auth do contratante (mTLS, cache) + token do procurador (lê o cert da empresa do Storage).
  const auth = await garantirAuthContratante();
  if (!auth) return { ok: false, error: 'Configure o certificado do contratante (SERPRO) para consultar.' };
  const tk = await garantirTokenProcurador(supabase, companyId);
  if (!tk.ok) return { ok: false, error: tk.warning };

  const envelope = {
    contratante: { numero: auth.cnpj, tipo: Tipo.CNPJ },
    autorPedidoDados: { numero: empresaCnpj, tipo: Tipo.CNPJ },
    contribuinte: { numero: empresaCnpj, tipo: Tipo.CNPJ },
    pedidoDados: {
      idSistema: 'PGDASD',
      idServico: 'CONSDECLARACAO13',
      versaoSistema: '1.0',
      dados: JSON.stringify({ anoCalendario: String(ano) }),
    },
  };

  try {
    const resp = await consultarComProcurador({
      pfx: auth.pfx,
      passphrase: auth.passphrase,
      accessToken: auth.accessToken,
      jwt: auth.jwt,
      procuradorToken: tk.token,
      envelope,
    });
    return { ok: true, situacoes: parseConsultaDeclaracoes(resp) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (/ICGERENCIADOR-022|procura(c|ç)[aã]o/i.test(msg)) {
      return { ok: false, error: 'A empresa ainda não autorizou a Balu (Termo/procuração) na SERPRO.' };
    }
    return { ok: false, error: `Falha ao consultar a SERPRO: ${msg.slice(0, 160)}` };
  }
}
```

- [ ] **Step 2: Verificar dependências (grep, não assuma)**

Run: `cd app && grep -nE "export (async )?function garantirAuthContratante|export (async )?function garantirTokenProcurador|export const Tipo|export async function consultarComProcurador" src/lib/fiscal/serpro-contratante.ts src/lib/fiscal/serpro-procurador.ts src/lib/clients/serpro.ts`
Confirme: `garantirAuthContratante()` retorna `{accessToken, jwt, pfx, passphrase, cnpj, nome} | null`; `garantirTokenProcurador(supabase, companyId)` retorna `{ok:true, token, expiration} | {ok:false, warning}`; `Tipo.CNPJ === 2`. Se algo divergir, ajuste e reporte.

- [ ] **Step 3: Conferir tipos**

Run: `cd app && npx tsc --noEmit 2>&1 | grep "serpro-consulta.ts" || echo "ok"`
Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
cd /home/allan/Projetos/claude/balu
git add app/src/lib/fiscal/serpro-consulta.ts
git commit -m "feat(impostos): orquestrador consultarDeclaracoesSimples (auth+token+consult+parse)"
```

---

## Task 4: Server action consultarDeclaracoesAction (gate + upsert)

**Files:**
- Modify: `app/src/app/(auth)/impostos/actions.ts`

- [ ] **Step 1: Adicionar imports**

No topo de `app/src/app/(auth)/impostos/actions.ts`, adicione:

```ts
import { competenciaReferenciaBrt } from '@/lib/fiscal/guia';
import { tipoFromCode } from '@/lib/fiscal/regime';
import { consultarDeclaracoesSimples } from '@/lib/fiscal/serpro-consulta';
```

(Se `competenciaReferenciaBrt` já estiver importado de `@/lib/fiscal/guia` em outro ponto, não duplique — junte no mesmo import.)

- [ ] **Step 2: Adicionar a action no fim do arquivo**

```ts
export type ConsultaDasResult = { ok: true; count: number } | { ok: false; error: string };

/**
 * Consulta na SERPRO (PGDAS-D / CONSDECLARACAO13) as declarações/DAS do ano-calendário atual
 * e faz upsert da SITUAÇÃO em guias_fiscais. Só Simples. Read-only na SERPRO (não emite/declara).
 */
export async function consultarDeclaracoesAction(ano?: number): Promise<ConsultaDasResult> {
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
    return { ok: false, error: 'A consulta de listagem cobre Simples (PGDAS-D); MEI virá depois.' };
  }

  const year = ano ?? Number(competenciaReferenciaBrt(new Date()).slice(0, 4));

  const r = await consultarDeclaracoesSimples(supabase, companyId, year);
  if (!r.ok) return r;

  const rows = r.situacoes.map((s) => ({
    company_id: companyId,
    owner_user_id: user.id,
    competencia_referencia: s.competencia,
    competencia_mes: Number(s.competencia.slice(4, 6)),
    competencia_ano: Number(s.competencia.slice(0, 4)),
    numero_das: s.numeroDas,
    status: s.status,
    origem: 'serpro',
    updated_at: new Date().toISOString(),
    deleted_at: null,
  }));

  if (rows.length > 0) {
    const { error } = await supabase
      .from('guias_fiscais')
      .upsert(rows, { onConflict: 'company_id,competencia_referencia' });
    if (error) return { ok: false, error: `Falha ao salvar a listagem: ${error.message}` };
  }

  revalidatePath('/impostos');
  return { ok: true, count: rows.length };
}
```

- [ ] **Step 3: Conferir tipos**

Run: `cd app && npx tsc --noEmit 2>&1 | grep "impostos/actions" || echo "ok"`
Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
cd /home/allan/Projetos/claude/balu
git add "app/src/app/(auth)/impostos/actions.ts"
git commit -m "feat(impostos): consultarDeclaracoesAction (gate Simples + upsert situação em guias_fiscais)"
```

---

## Task 5: Botão client island + fiação no page.tsx

**Files:**
- Create: `app/src/app/(auth)/impostos/ConsultarSerproButton.tsx`
- Modify: `app/src/app/(auth)/impostos/page.tsx`

- [ ] **Step 1: Criar o botão**

Create `app/src/app/(auth)/impostos/ConsultarSerproButton.tsx`:

```tsx
'use client';
// @custom — Botão "Consultar na SERPRO" (Simples). Chama consultarDeclaracoesAction e recarrega.
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, Loader2 } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { consultarDeclaracoesAction } from './actions';

export default function ConsultarSerproButton() {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  function handle() {
    if (pending) return;
    startTransition(async () => {
      const r = await consultarDeclaracoesAction();
      if (r.ok) {
        toast('success', `Listagem atualizada (${r.count} ${r.count === 1 ? 'período' : 'períodos'}).`);
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
      className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-2 disabled:opacity-50"
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
      {pending ? 'Consultando…' : 'Consultar na SERPRO'}
    </button>
  );
}
```

- [ ] **Step 2: Fiar no page.tsx (só Simples)**

Em `app/src/app/(auth)/impostos/page.tsx`:

(a) adicione os imports:
```ts
import { tipoFromCode } from '@/lib/fiscal/regime';
import ConsultarSerproButton from './ConsultarSerproButton';
```

(b) onde hoje calcula `isMei` (após carregar `fiscal`), adicione:
```ts
  const isSimples = tipoFromCode((fiscal?.Code_regime_tributario ?? '') as string) === 'simples';
```

(c) na seção "Histórico de guias", troque o header `<h2>` por um header com o botão à direita (só Simples). Localize:
```tsx
          <section>
            <h2 className="text-xs uppercase tracking-wide text-muted-foreground mb-3">Histórico de guias</h2>
            <HistoricoGuias initial={historico} />
          </section>
```
por:
```tsx
          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Histórico de guias</h2>
              {isSimples && <ConsultarSerproButton />}
            </div>
            <HistoricoGuias initial={historico} />
          </section>
```

- [ ] **Step 3: Conferir tipos + lint de import**

Run: `cd app && npx tsc --noEmit 2>&1 | grep -E "impostos/page|ConsultarSerproButton" || echo "ok"`
Expected: `ok`. Confirme que `tipoFromCode` é exportado em `src/lib/fiscal/regime.ts` (grep) e aceita string.

- [ ] **Step 4: Commit**

```bash
cd /home/allan/Projetos/claude/balu
git add "app/src/app/(auth)/impostos/ConsultarSerproButton.tsx" "app/src/app/(auth)/impostos/page.tsx"
git commit -m "feat(impostos): botão Consultar na SERPRO na listagem (só Simples)"
```

---

## Task 6: Verificação final

**Files:** nenhum (verificação)

- [ ] **Step 1: TypeScript limpo**

Run: `cd app && npx tsc --noEmit`
Expected: zero erros.

- [ ] **Step 2: Suíte unit**

Run: `cd app && npx vitest run`
Expected: PASS — incluindo `serpro-consulta-parse` e os testes pré-existentes (não devem regredir).

- [ ] **Step 3: Smoke manual (opcional, ambiente real)**

Com a empresa AL PISCINAS selecionada (Simples) e o cert A1 dela enviado em Configurações: abrir `/impostos`, clicar "Consultar na SERPRO" → toast de sucesso e os meses de 2026 (ou ano atual) aparecendo no histórico com badge de status. (Se ainda não houver declarações no ano atual na SERPRO, a listagem pode vir vazia — o parser devolve `[]` e o `count` é 0.)

- [ ] **Step 4: Commit final (se houve ajuste na verificação)**

```bash
cd /home/allan/Projetos/claude/balu
git add -A && git commit -m "test(impostos): verificação final da consulta de listagem de DAS" || echo "nada a commitar"
```

---

## Self-review (cobertura do spec)

- ✅ Consulta PGDASD/CONSDECLARACAO13 via token_procurador → Task 2 (consultarComProcurador) + Task 3 (orquestrador)
- ✅ Parser do índice (sem valores), status paga/gerada/pendente → Task 1
- ✅ Upsert da situação em guias_fiscais sem zerar valor (campos ausentes preservados) → Task 4
- ✅ Botão explícito só p/ Simples + reuso de HistoricoGuias → Task 5
- ✅ Gate de regime (tipoFromCode) → Task 4
- ✅ Erros amigáveis (cert ausente / procuração / falha consulta) → Task 3 (propaga) + Task 4
- ✅ Período = ano-calendário atual (default), competência YYYYMM → Task 4
- ✅ Fora de escopo respeitado: não toca gerarDasMeiAction, não mexe em valores/PDF, não cobre MEI
```
