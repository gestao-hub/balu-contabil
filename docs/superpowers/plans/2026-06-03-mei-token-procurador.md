# Migrar MEI (DAS) pro token_procurador + drop colunas órfãs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reescrever `gerarDasMeiAction` no fluxo procurador (PGMEI/GERARDASPDF21 via `emitirComProcurador` + `parseDasMei`), remover o caminho trial/demo, e dropar as 3 colunas órfãs `certificado_*`.

**Architecture:** Espelha a emissão Simples já mergeada. Extrai `isNadaDevido` p/ um módulo comum (DRY), cria `gerarDasMei` (orquestrador server-only), reescreve a action, ajusta o `GerarDasButton` (1 branch), deleta o módulo trial órfão e dropa as colunas.

**Tech Stack:** Next.js 15 (Server Actions, client island), Supabase, Vitest. Spec: `docs/superpowers/specs/2026-06-03-mei-token-procurador-design.md`.

**Convenções:** trabalhar de `app/`. `npx vitest run <arquivo>` / `npx tsc --noEmit`. NÃO rodar `npm run build` com `next dev` ativo. Commits sem trailer Co-Authored-By. Schema real é `docs/reference/db_atual.sql` (atualizar junto com a migration).

---

## File Structure

**Criar:**
- `app/src/lib/fiscal/serpro-das-comum.ts` — `isNadaDevido(resp)` (puro, compartilhado)
- `app/src/lib/fiscal/serpro-das-comum.test.ts`
- `app/src/lib/fiscal/serpro-das-mei.ts` — orquestrador `gerarDasMei` (server-only)
- `app/supabase/migrations/0018_drop_certificado_columns.sql`

**Modificar:**
- `app/src/lib/fiscal/serpro-das-simples-parse.ts` — usar `isNadaDevido` do módulo comum (DRY)
- `app/src/app/(auth)/impostos/actions.ts` — reescrever `gerarDasMeiAction` + remover imports mortos
- `app/src/app/(auth)/impostos/GerarDasButton.tsx` — branch `semValor`
- `app/src/types/database.ts` — remover os 3 tipos `certificado_*`
- `docs/reference/db_atual.sql` — remover as 3 linhas `certificado_*`

**Deletar:**
- `app/src/lib/fiscal/serpro-env.ts`
- `app/src/lib/fiscal/serpro-env.test.ts`

---

## Task 1: Helper compartilhado isNadaDevido + refactor parseDasSimples

**Files:**
- Create: `app/src/lib/fiscal/serpro-das-comum.ts`
- Test: `app/src/lib/fiscal/serpro-das-comum.test.ts`
- Modify: `app/src/lib/fiscal/serpro-das-simples-parse.ts`

- [ ] **Step 1: Escrever o teste (falhando)**

Create `app/src/lib/fiscal/serpro-das-comum.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isNadaDevido } from './serpro-das-comum';

describe('isNadaDevido', () => {
  it('dados vazio → true', () => {
    expect(isNadaDevido({ dados: '' })).toBe(true);
    expect(isNadaDevido({ dados: null })).toBe(true);
    expect(isNadaDevido({})).toBe(true);
  });

  it('mensagem MSG_E0139 → true', () => {
    expect(isNadaDevido({ dados: 'qualquer', mensagens: [{ codigo: '[Aviso-PGDASD-MSG_E0139]', texto: '...' }] })).toBe(true);
  });

  it('dados populado sem MSG_E0139 → false', () => {
    expect(isNadaDevido({ dados: '{"x":1}', mensagens: [] })).toBe(false);
    expect(isNadaDevido({ dados: '[{"a":1}]' })).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd app && npx vitest run src/lib/fiscal/serpro-das-comum.test.ts`
Expected: FAIL (import não resolve).

- [ ] **Step 3: Implementar o helper**

Create `app/src/lib/fiscal/serpro-das-comum.ts`:

```ts
// Helper puro compartilhado entre as emissões de DAS (Simples e MEI).
// Detecta "nada devido": a Serpro responde 200 com dados vazio e/ou mensagem MSG_E0139
// ("Não foi gerado DAS por não haver valor devido para o período informado.").

export function isNadaDevido(resp: unknown): boolean {
  const env = (resp ?? {}) as { dados?: unknown; mensagens?: unknown };
  const msgs = Array.isArray(env.mensagens) ? env.mensagens : [];
  const temE0139 = msgs.some(
    (m) => typeof (m as { codigo?: unknown })?.codigo === 'string' && (m as { codigo: string }).codigo.includes('MSG_E0139'),
  );
  const dadosVazio = env.dados == null || (typeof env.dados === 'string' && env.dados.trim() === '');
  return temE0139 || dadosVazio;
}
```

- [ ] **Step 4: Refatorar parseDasSimples p/ usar o helper**

Em `app/src/lib/fiscal/serpro-das-simples-parse.ts`:
(a) adicione o import no topo: `import { isNadaDevido } from './serpro-das-comum';`
(b) substitua o bloco inline de detecção (as linhas que calculam `msgs`/`temE0139`/`dadosVazio` e fazem `if (temE0139 || dadosVazio) return { semValor: true };`) por:
```ts
  if (isNadaDevido(resp)) return { semValor: true };
```
(c) remova quaisquer variáveis agora não usadas (`msgs`/`temE0139`/`dadosVazio`). Mantenha o resto do parser (extração de valores) intacto.

- [ ] **Step 5: Rodar e ver passar**

Run: `cd app && npx vitest run src/lib/fiscal/serpro-das-comum.test.ts src/lib/fiscal/serpro-das-simples-parse.test.ts`
Expected: PASS (ambos; o parser do Simples não regrediu).

- [ ] **Step 6: Commit**

```bash
cd /home/allan/Projetos/claude/balu
git add app/src/lib/fiscal/serpro-das-comum.ts app/src/lib/fiscal/serpro-das-comum.test.ts app/src/lib/fiscal/serpro-das-simples-parse.ts
git commit -m "refactor(impostos): extrai isNadaDevido p/ módulo comum (DRY Simples/MEI)"
```

---

## Task 2: Orquestrador server-only gerarDasMei

**Files:**
- Create: `app/src/lib/fiscal/serpro-das-mei.ts`

- [ ] **Step 1: Implementar**

Create `app/src/lib/fiscal/serpro-das-mei.ts`:

```ts
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { garantirAuthContratante } from '@/lib/fiscal/serpro-contratante';
import { garantirTokenProcurador } from '@/lib/fiscal/serpro-procurador';
import { emitirComProcurador, Tipo } from '@/lib/clients/serpro';
import { parseDasMei, type DasMeiResult } from '@/lib/fiscal/das-mei-parse';
import { isNadaDevido } from '@/lib/fiscal/serpro-das-comum';

export type DasMeiOutcome = { semValor: true } | { semValor: false; das: DasMeiResult };
type Result = { ok: true; result: DasMeiOutcome } | { ok: false; error: string };

/**
 * Gera o DAS-MEI (PGMEI / GERARDASPDF21) de um período via o token do procurador.
 * Período sem valor devido → { semValor: true }. Espelha gerarDasSimples.
 */
export async function gerarDasMei(
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
      idSistema: 'PGMEI',
      idServico: 'GERARDASPDF21',
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
    if (isNadaDevido(resp)) return { ok: true, result: { semValor: true } };
    return { ok: true, result: { semValor: false, das: parseDasMei(resp) } };
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (/ICGERENCIADOR-022|procura(c|ç)[aã]o/i.test(msg)) {
      return { ok: false, error: 'A empresa ainda não autorizou a Balu (Termo/procuração) na SERPRO.' };
    }
    return { ok: false, error: `Falha ao gerar o DAS-MEI na SERPRO: ${msg.slice(0, 160)}` };
  }
}
```

- [ ] **Step 2: Verificar deps + tipos**

Run: `cd app && grep -nE "export const Tipo|export function emitirComProcurador" src/lib/clients/serpro.ts` — confirme exportados.
Run: `cd app && grep -nE "export type DasMeiResult|export function parseDasMei" src/lib/fiscal/das-mei-parse.ts` — confirme exportados.
Run: `cd app && npx tsc --noEmit 2>&1 | grep "serpro-das-mei.ts" || echo "ok"` → `ok`.

- [ ] **Step 3: Commit**

```bash
cd /home/allan/Projetos/claude/balu
git add app/src/lib/fiscal/serpro-das-mei.ts
git commit -m "feat(impostos): orquestrador gerarDasMei (PGMEI via token_procurador)"
```

---

## Task 3: Reescrever gerarDasMeiAction + GerarDasButton + deletar serpro-env

**Files:**
- Modify: `app/src/app/(auth)/impostos/actions.ts`
- Modify: `app/src/app/(auth)/impostos/GerarDasButton.tsx`
- Delete: `app/src/lib/fiscal/serpro-env.ts`, `app/src/lib/fiscal/serpro-env.test.ts`

- [ ] **Step 1: Ajustar imports em actions.ts**

No topo de `actions.ts`:
(a) **remova** estas 3 linhas (só o `gerarDasMeiAction` as usava):
```ts
import { serpro, buildEnvelope, PGMEI_SERVICES, type ProdAuth } from '@/lib/clients/serpro';
import { parseDasMei } from '@/lib/fiscal/das-mei-parse';
import { resolveSerproEnv, demoInputs } from '@/lib/fiscal/serpro-env';
```
(b) **adicione**:
```ts
import { gerarDasMei } from '@/lib/fiscal/serpro-das-mei';
```

- [ ] **Step 2: Reescrever o tipo + a action**

Substitua a declaração `export type GerarDasResult = { ok: true } | { ok: false; error: string };` por:
```ts
export type GerarDasResult = { ok: true; semValor: boolean } | { ok: false; error: string };
```

Substitua a função `gerarDasMeiAction` **inteira** (do `export async function gerarDasMeiAction` até o `return { ok: true };` final dela) por:

```ts
export async function gerarDasMeiAction(competencia: string): Promise<GerarDasResult> {
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
  if (fiscal.Code_regime_tributario !== '4') {
    return { ok: false, error: 'Geração de DAS-MEI cobre só MEI; Simples usa o fluxo próprio.' };
  }

  const r = await gerarDasMei(supabase, companyId, competencia);
  if (!r.ok) return r;
  if (r.result.semValor) return { ok: true, semValor: true };

  const d = r.result.das;
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
        numero_das: d.numeroDocumento,
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
  return { ok: true, semValor: false };
}
```

(Note: `DasMeiResult.numeroDocumento` é o número do DAS — mapeado p/ `numero_das`, como no código original.)

- [ ] **Step 3: Ajustar o GerarDasButton (branch semValor)**

Em `app/src/app/(auth)/impostos/GerarDasButton.tsx`, no handler, substitua:
```ts
      const r = await gerarDasMeiAction(competencia);
      if (r.ok) {
        toast('success', 'DAS gerado.');
        router.refresh();
      } else {
        toast('error', r.error);
      }
```
por:
```ts
      const r = await gerarDasMeiAction(competencia);
      if (r.ok && r.semValor) {
        toast('info', 'Sem débito em aberto para esta competência.');
        router.refresh();
      } else if (r.ok) {
        toast('success', 'DAS gerado.');
        router.refresh();
      } else {
        toast('error', r.error);
      }
```

- [ ] **Step 4: Deletar o módulo trial órfão**

```bash
cd /home/allan/Projetos/claude/balu
rm app/src/lib/fiscal/serpro-env.ts app/src/lib/fiscal/serpro-env.test.ts
```
Confirme que ninguém mais importa: `cd app && grep -rn "serpro-env" src 2>/dev/null || echo "sem refs"` → `sem refs`.

- [ ] **Step 5: Conferir tipos (projeto inteiro)**

Run: `cd app && npx tsc --noEmit` → zero erros. (Garante que nenhum import morto sobrou em `actions.ts` e que o `GerarDasButton` casa com o novo `GerarDasResult`.)

- [ ] **Step 6: Commit**

```bash
cd /home/allan/Projetos/claude/balu
git add "app/src/app/(auth)/impostos/actions.ts" "app/src/app/(auth)/impostos/GerarDasButton.tsx" app/src/lib/fiscal/serpro-env.ts app/src/lib/fiscal/serpro-env.test.ts
git commit -m "feat(impostos): gerarDasMeiAction no fluxo procurador; remove caminho trial"
```

---

## Task 4: Drop das colunas órfãs (migration + dump + tipos)

**Files:**
- Create: `app/supabase/migrations/0018_drop_certificado_columns.sql`
- Modify: `docs/reference/db_atual.sql`
- Modify: `app/src/types/database.ts`

- [ ] **Step 1: Migration**

Create `app/supabase/migrations/0018_drop_certificado_columns.sql`:

```sql
-- 0018: remove colunas órfãs do modelo de auth antigo do SERPRO.
-- Substituídas pelo token_procurador (serpro_contratante + serpro_token_procurador*).
-- Nenhum código lê estas colunas após a migração do MEI pro fluxo procurador.

ALTER TABLE public.empresas_fiscais
  DROP COLUMN IF EXISTS certificado_jwt,
  DROP COLUMN IF EXISTS certificado_access_token,
  DROP COLUMN IF EXISTS certificado_token_expiration;
```

- [ ] **Step 2: Atualizar o dump**

Em `docs/reference/db_atual.sql`, no bloco `CREATE TABLE public.empresas_fiscais (...)`, **remova** as 3 linhas:
```sql
    certificado_jwt text,
    certificado_access_token text,
    certificado_token_expiration timestamp with time zone,
```
(Cuidado com vírgulas: a linha anterior às removidas deve continuar com vírgula e o restante do bloco intacto. Leia o arquivo antes pra fazer a remoção exata.)

- [ ] **Step 3: Remover os tipos**

Em `app/src/types/database.ts`, remova as 3 linhas:
```ts
    certificado_jwt: string | null;
    certificado_access_token: string | null;
    certificado_token_expiration: string | null;
```

- [ ] **Step 4: Conferir tipos**

Run: `cd app && npx tsc --noEmit 2>&1 | grep -E "certificado_(jwt|access_token|token_expiration)|database.ts" || echo "ok"` → `ok` (nenhuma referência sobrando ao remover os tipos).

- [ ] **Step 5: Aplicar no banco hospedado (MANUAL)**

A 0018 é aplicada manualmente no SQL editor do Supabase (DB é a fonte da verdade). Marcar pra rodar; não bloqueia o código (que já não lê as colunas).

- [ ] **Step 6: Commit**

```bash
cd /home/allan/Projetos/claude/balu
git add app/supabase/migrations/0018_drop_certificado_columns.sql docs/reference/db_atual.sql app/src/types/database.ts
git commit -m "chore(db): migration 0018 dropa colunas órfãs certificado_* + remove tipos"
```

---

## Task 5: Verificação final

**Files:** nenhum (verificação)

- [ ] **Step 1: TypeScript limpo** — `cd app && npx tsc --noEmit` → zero erros.
- [ ] **Step 2: Suíte unit** — `cd app && npx vitest run` → PASS (inclui `serpro-das-comum`; `serpro-das-simples-parse` sem regressão; `serpro-env.test` removido; demais intactos).
- [ ] **Step 3: Confirmar limpeza** — `cd app && grep -rn "resolveSerproEnv\|demoInputs\|certificado_jwt\|certificado_access_token\|certificado_token_expiration" src 2>/dev/null || echo "limpo"` → `limpo`.
- [ ] **Step 4: Smoke (PENDENTE — sem ambiente)** — A emissão de DAS-MEI via procurador **não é testável agora** (sem e-CNPJ MEI + MEI com débito; Trial bloqueado). Deixar como item pendente: confirmar no 1º MEI real (cert enviado), clicando "Gerar DAS" no card da competência. `parseDasMei` é defensivo; ajustar se a estrutura real divergir.
- [ ] **Step 5: Commit final (se houve ajuste)** — `git add -A && git commit -m "test(impostos): verificação final da migração MEI" || echo "nada a commitar"`.

---

## Self-review (cobertura do spec)
- ✅ gerarDasMei (PGMEI via token_procurador) → Task 2
- ✅ gerarDasMeiAction reescrito (remove certificado_*/trial/demo/ProdAuth) → Task 3
- ✅ isNadaDevido compartilhado (DRY) → Task 1
- ✅ GerarDasButton +branch semValor (UI mantida) → Task 3
- ✅ serpro-env.ts/test deletados → Task 3
- ✅ Drop 0018 + db_atual.sql + database.ts → Task 4
- ✅ Smoke MEI documentado como pendente → Task 5
- ✅ Fora de escopo respeitado (sem botão por linha MEI; exports velhos de serpro.ts deixados como nota)
```
