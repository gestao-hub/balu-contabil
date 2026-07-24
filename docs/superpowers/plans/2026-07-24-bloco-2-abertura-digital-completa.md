# Bloco 2 — Abertura Digital completa · Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar a abertura de empresa: checklist de docs com status, notificação ao cliente na transição de etapa, status em tempo real e minuta do ato constitutivo por tipo.

**Architecture:** Coluna JSONB `docs_revisao` em `abertura_empresas` guarda o estado de revisão por doc. As actions do contador (revisão + avanço de etapa) inserem notificações na tabela `notifications` do Bloco 1. A visão do cliente assina Realtime. A minuta é gerada por template server-side conforme `empresa_tipo`.

**Tech Stack:** Next.js 15, Supabase (Postgres + RLS + Realtime), Vitest, Playwright, geração de PDF (pdf-lib ou HTML→PDF), TypeScript.

**Spec:** `docs/superpowers/specs/2026-07-24-bloco-2-abertura-digital-completa-design.md`

**Dependência:** o **Bloco 1 deve estar implementado** (a Frente B usa a tabela `notifications` e o tipo `abertura_etapa`, já incluído no CHECK da migration `0045`). Frentes A/C/D não dependem do Bloco 1.

**Convenções:** iguais ao plano do Bloco 1 (rodar de `balu/`; migrations aplicadas pelo usuário via runner; schema real = `db_atual.sql`/migrations 0025+, nunca `0001`; commits em pt com o `Co-Authored-By`).

**Branch:** `feat/bloco-2-abertura` a partir de `main` (após o merge do Bloco 1).

---

## Estrutura de arquivos

| Arquivo | Responsabilidade | Ação |
|---|---|---|
| `app/supabase/migrations/0046_abertura_checklist.sql` | Coluna `docs_revisao` jsonb + Realtime | Criar |
| `scratchpad/apply-0046.mjs` | Runner (usuário roda) | Criar |
| `app/src/lib/abertura/checklist.ts` | `docsExigidos()`, estado derivado por doc (testável) | Criar |
| `app/src/lib/abertura/minuta/index.ts` | Seletor de template + `minutaPronta()` | Criar |
| `app/src/lib/abertura/minuta/templates.ts` | Textos por tipo (MEI/EI/LTDA) | Criar |
| `app/src/app/(auth)/(gated)/contador/aberturas/actions.ts` | `revisarDocumentoAction`, `gerarMinutaAction`, hook de notificação | Modificar |
| `app/src/app/(auth)/(gated)/contador/aberturas/[aberturaId]/DetalheAbertura.tsx` | UI checklist + revisão + download minuta | Modificar |
| `app/src/app/(auth)/(gated)/configuracoes/AberturaInfoView.tsx` | Checklist read-only + reenvio + Realtime | Modificar |
| `app/src/lib/abertura/notificar.ts` | Helper que insere notificação de etapa (guarda user_id null) | Criar |
| `app/src/lib/abertura/*.test.ts` | Testes unitários | Criar |

---

## Task 0: Branch

- [ ] **Step 1:** `cd balu && git checkout main && git checkout -b feat/bloco-2-abertura`

---

## Task 1: Helper de checklist (estado derivado + exigência por tipo)

**Files:**
- Create: `app/src/lib/abertura/checklist.ts`
- Test: `app/src/lib/abertura/checklist.test.ts`

- [ ] **Step 1: Teste que falha**

```ts
// app/src/lib/abertura/checklist.test.ts
import { describe, it, expect } from 'vitest';
import { docsExigidos, estadoDoc } from './checklist';

describe('checklist de abertura', () => {
  it('MEI exige menos docs que LTDA', () => {
    expect(docsExigidos('MEI').length).toBeLessThan(docsExigidos('LTDA').length);
  });
  it('doc sem path = pendente_envio', () => {
    expect(estadoDoc(null, undefined)).toBe('pendente_envio');
  });
  it('doc com path e sem revisao = aguardando_analise', () => {
    expect(estadoDoc('s3://x', undefined)).toBe('aguardando_analise');
  });
  it('doc recusado', () => {
    expect(estadoDoc('s3://x', { status: 'recusado' })).toBe('recusado');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd app && npx vitest run src/lib/abertura/checklist.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implementar**

```ts
// app/src/lib/abertura/checklist.ts
import { DOC_KEYS, type DocKey } from '@/types/abertura';

export type DocEstado = 'pendente_envio' | 'aguardando_analise' | 'aprovado' | 'recusado';
export type DocRevisao = { status: 'aprovado' | 'recusado'; observacao?: string; revisado_por?: string; revisado_em?: string };

export function estadoDoc(path: string | null | undefined, rev: DocRevisao | undefined): DocEstado {
  if (!path) return 'pendente_envio';
  if (rev?.status === 'aprovado') return 'aprovado';
  if (rev?.status === 'recusado') return 'recusado';
  return 'aguardando_analise';
}

// Exigencia minima por tipo. RG OU CNH (o front ja trata a alternativa); aqui marcamos o conjunto obrigatorio.
export function docsExigidos(empresaTipo: 'MEI' | 'EI' | 'LTDA' | string): DocKey[] {
  const comuns: DocKey[] = ['doc_cpf', 'doc_comprovante_titular', 'doc_comprovante_sede'];
  const identidade: DocKey[] = ['doc_rg_frente']; // ou CNH — validado no front
  if (empresaTipo === 'MEI') return [...identidade, 'doc_cpf', 'doc_comprovante_titular'];
  if (empresaTipo === 'EI') return [...identidade, ...comuns];
  return [...identidade, ...comuns, 'doc_declaracao_uso']; // LTDA/SLU
}

export const TODOS_DOCS = DOC_KEYS;
```

> Confirmar os valores reais de `DOC_KEYS` em `src/types/abertura.ts:5` e ajustar os conjuntos por tipo se necessário.

- [ ] **Step 4: Rodar e ver passar** — Run: `cd app && npx vitest run src/lib/abertura/checklist.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd balu && git add app/src/lib/abertura/checklist.ts app/src/lib/abertura/checklist.test.ts
git commit -m "feat(abertura): helper de checklist (estado por doc + exigencia por tipo)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Migration 0046 — docs_revisao + Realtime

**Files:**
- Create: `app/supabase/migrations/0046_abertura_checklist.sql`
- Create: `scratchpad/apply-0046.mjs` (clone do runner do Bloco 1)

- [ ] **Step 1: Confirmar schema real de `abertura_empresas`**

Verificar em `docs/reference/db_atual.sql` (linhas ~223-286) que as colunas `doc_*` (8), `processo_etapa`, `user_id`, `company_id` existem no schema moderno. (Confirmado na auditoria 2026-07-24.)

- [ ] **Step 2: Escrever a migration**

```sql
-- app/supabase/migrations/0046_abertura_checklist.sql
-- Parte do schema REAL de abertura_empresas (db_atual.sql), nao do 0001.
ALTER TABLE public.abertura_empresas
  ADD COLUMN IF NOT EXISTS docs_revisao jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Realtime para a visao do cliente acompanhar a etapa (respeita RLS existente).
ALTER PUBLICATION supabase_realtime ADD TABLE public.abertura_empresas;
```

> O tipo `'abertura_etapa'` já está no CHECK de `notifications` (migration `0045` do Bloco 1). Se por algum motivo não estiver, adicionar aqui: `ALTER TABLE public.notifications DROP CONSTRAINT notifications_tipo_check, ADD CONSTRAINT ... (lista + 'abertura_etapa')`.

- [ ] **Step 3: Usuário aplica** — Peça: **`! node scratchpad/apply-0046.mjs`** — Expected: aplica sem erro.

- [ ] **Step 4: Commit**

```bash
cd balu && git add app/supabase/migrations/0046_abertura_checklist.sql
git commit -m "feat(abertura): migration 0046 — docs_revisao + realtime

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Helper de notificação de etapa

**Files:**
- Create: `app/src/lib/abertura/notificar.ts`

- [ ] **Step 1: Implementar** (insere na tabela `notifications` do Bloco 1; guarda `user_id` null)

```ts
// app/src/lib/abertura/notificar.ts
import type { SupabaseClient } from '@supabase/supabase-js';

export async function notificarEtapaAbertura(admin: SupabaseClient, args: {
  aberturaId: string; ownerUserId: string | null; companyId: string | null;
  etapa: string; titulo: string; corpo: string; severidade?: 'info' | 'warning' | 'danger';
}) {
  if (!args.ownerUserId) return; // abertura sem dono (office-initiated) — sem destinatario
  await admin.from('notifications').insert({
    owner_user_id: args.ownerUserId,
    company_id: args.companyId,
    tipo: 'abertura_etapa',
    severidade: args.severidade ?? 'info',
    titulo: args.titulo,
    corpo: args.corpo,
    action_href: '/configuracoes',
    entidade_ref: args.aberturaId,
    chave: `abertura_etapa:${args.aberturaId}:${args.etapa}`,
  }); // erro de unique (mesma etapa) e ignorado — idempotente por chave; capturar e engolir 23505
}
```

> A tabela tem UNIQUE `(owner_user_id, chave)`; reavançar para a mesma etapa gera `23505` — capturar e ignorar (ou usar `upsert ... onConflict ignoreDuplicates`). Ajustar para o padrão do supabase-js: `.upsert(row, { onConflict: 'owner_user_id,chave', ignoreDuplicates: true })`.

- [ ] **Step 2: Verificar tipos** — Run: `cd app && npx tsc --noEmit` — Expected: 0 erros.

- [ ] **Step 3: Commit**

```bash
cd balu && git add app/src/lib/abertura/notificar.ts
git commit -m "feat(abertura): helper de notificacao de etapa (usa notifications do Bloco 1)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Action de revisão de documento + hook de notificação

**Files:**
- Modify: `app/src/app/(auth)/(gated)/contador/aberturas/actions.ts`

- [ ] **Step 1: Ler o arquivo** para reusar os guards `requireEscritorio()` / `aberturaDaCarteira()` / `registrarAuditoria` e o client `createAdminClient()`.

- [ ] **Step 2: `revisarDocumentoAction`** (merge JSONB da chave do doc; recusa → etapa `pendente_documentos` + notificação)

```ts
export async function revisarDocumentoAction(input: {
  aberturaId: string; docKey: string; status: 'aprovado' | 'recusado'; observacao?: string;
}) {
  const g = await requireEscritorio();
  if (!g.ok) return g;
  const admin = createAdminClient();
  const ab = await aberturaDaCarteira(admin, g.ctx, input.aberturaId); // guard anti-IDOR (padrao existente)
  if (!ab.ok) return ab;

  // Merge apenas a chave do doc (nao sobrescrever docs_revisao inteiro).
  const patch = { [input.docKey]: { status: input.status, observacao: input.observacao ?? null,
    revisado_por: g.ctx.userId, revisado_em: new Date().toISOString() } };
  const novo = { ...(ab.data.docs_revisao ?? {}), ...patch };
  const upd: Record<string, unknown> = { docs_revisao: novo };
  if (input.status === 'recusado' && !['concluido', 'cancelado'].includes(ab.data.processo_etapa))
    upd.processo_etapa = 'pendente_documentos';

  const { error } = await admin.from('abertura_empresas').update(upd).eq('id', input.aberturaId);
  if (error) return { ok: false as const, error: error.message };
  await registrarAuditoria(admin, { acao: 'abertura.revisar_doc', ... }); // seguir a assinatura real
  if (input.status === 'recusado') {
    await notificarEtapaAbertura(admin, { aberturaId: input.aberturaId, ownerUserId: ab.data.user_id,
      companyId: ab.data.company_id, etapa: 'doc_recusado_' + input.docKey,
      titulo: 'Um documento precisa de ajuste', corpo: `O documento enviado foi recusado. Motivo: ${input.observacao ?? 'ver detalhes'}.`, severidade: 'warning' });
  }
  revalidatePath(`/contador/aberturas/${input.aberturaId}`);
  return { ok: true as const };
}
```

> Ajustar aos nomes/assinaturas reais (`requireEscritorio`, `aberturaDaCarteira`, `registrarAuditoria`, `g.ctx.userId`) lendo o arquivo. Importar `notificarEtapaAbertura`.

- [ ] **Step 3: Hook de notificação nas actions existentes**

Em `avancarProcessoAction` e `concluirAberturaAction`, após o `UPDATE` bem-sucedido, chamar `notificarEtapaAbertura(...)`:
- `avancarProcessoAction`: `etapa` = nova etapa; título/corpo pelo `ETAPA_LABEL` (ex.: "Sua abertura avançou para: Enviado à Receita").
- `concluirAberturaAction`: `etapa='concluido'`, título "Sua empresa foi aberta!", corpo com o CNPJ.

- [ ] **Step 4: Verificar tipos** — Run: `cd app && npx tsc --noEmit` — Expected: 0 erros.

- [ ] **Step 5: Commit**

```bash
cd balu && git add "app/src/app/(auth)/(gated)/contador/aberturas/actions.ts"
git commit -m "feat(abertura): revisao de documento + notificacao na transicao de etapa

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Minuta do ato constitutivo por tipo

**Files:**
- Create: `app/src/lib/abertura/minuta/templates.ts`
- Create: `app/src/lib/abertura/minuta/index.ts`
- Test: `app/src/lib/abertura/minuta/minuta.test.ts`
- Modify: `app/src/app/(auth)/(gated)/contador/aberturas/actions.ts` (`gerarMinutaAction`)

- [ ] **Step 1: Teste que falha** (`minutaPronta` lista faltantes; template por tipo)

```ts
// app/src/lib/abertura/minuta/minuta.test.ts
import { describe, it, expect } from 'vitest';
import { minutaPronta, tipoDocumento } from './index';

describe('minuta', () => {
  it('MEI gera roteiro, nao contrato', () => {
    expect(tipoDocumento('MEI')).toBe('roteiro_mei');
  });
  it('EI gera requerimento de empresario', () => {
    expect(tipoDocumento('EI')).toBe('requerimento_empresario');
  });
  it('LTDA gera ato constitutivo', () => {
    expect(tipoDocumento('LTDA')).toBe('ato_constitutivo_slu');
  });
  it('faltando capital social bloqueia LTDA', () => {
    const r = minutaPronta({ empresa_tipo: 'LTDA', empresa_capital_social: null } as any);
    expect(r.ok).toBe(false);
    expect(r.faltando).toContain('empresa_capital_social');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — Run: `cd app && npx vitest run src/lib/abertura/minuta/minuta.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implementar `index.ts`** (seletor + validação)

```ts
// app/src/lib/abertura/minuta/index.ts
export type TipoDocMinuta = 'roteiro_mei' | 'requerimento_empresario' | 'ato_constitutivo_slu';

export function tipoDocumento(empresaTipo: string): TipoDocMinuta {
  if (empresaTipo === 'MEI') return 'roteiro_mei';
  if (empresaTipo === 'EI') return 'requerimento_empresario';
  return 'ato_constitutivo_slu'; // LTDA / SLU
}

export function minutaPronta(ab: { empresa_tipo: string; empresa_razao_social_1?: string | null;
  empresa_capital_social?: number | null; empresa_objeto_social?: string | null; titular_nome_completo?: string | null }) {
  const faltando: string[] = [];
  if (!ab.titular_nome_completo) faltando.push('titular_nome_completo');
  if (!ab.empresa_razao_social_1) faltando.push('empresa_razao_social_1');
  if (!ab.empresa_objeto_social) faltando.push('empresa_objeto_social');
  if (ab.empresa_tipo !== 'MEI' && (ab.empresa_capital_social == null)) faltando.push('empresa_capital_social');
  return { ok: faltando.length === 0, faltando };
}
```

- [ ] **Step 4: Implementar `templates.ts`** (função por tipo que devolve o HTML/texto preenchido — rodapé "Minuta — sujeita a revisão do contador"). Reusar os campos de `AberturaData` (`src/types/abertura.ts`). Manter o texto legal enxuto e marcado como rascunho.

- [ ] **Step 5: `gerarMinutaAction`** em `contador/aberturas/actions.ts` (guards padrão; valida `minutaPronta`; renderiza PDF; retorna base64/URL para download; `audit_log`). Escolher a lib de PDF no primeiro uso (preferir `pdf-lib`; se HTML→PDF, usar a solução compatível com o runtime Node da rota). Registrar a decisão no CHECKPOINT.

- [ ] **Step 6: Rodar testes** — Run: `cd app && npx vitest run src/lib/abertura/minuta/minuta.test.ts` — Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd balu && git add app/src/lib/abertura/minuta/ "app/src/app/(auth)/(gated)/contador/aberturas/actions.ts"
git commit -m "feat(abertura): minuta do ato constitutivo por tipo (MEI/EI/LTDA)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: UI — checklist e minuta (contador) + reenvio e Realtime (cliente)

**Files:**
- Modify: `app/src/app/(auth)/(gated)/contador/aberturas/[aberturaId]/DetalheAbertura.tsx`
- Modify: `app/src/app/(auth)/(gated)/configuracoes/AberturaInfoView.tsx`

- [ ] **Step 1: Contador — checklist + botões**

Em `DetalheAbertura.tsx`, para cada `DOC_KEY`, mostrar o estado (`estadoDoc`) + link de download (path) + botões **Aprovar**/**Recusar** (com campo de observação) chamando `revisarDocumentoAction`. Botão **Gerar minuta** chamando `gerarMinutaAction` (download do PDF). Tratar `cancelado` na timeline (`indexOf === -1`).

- [ ] **Step 2: Cliente — checklist read-only + reenvio**

Em `AberturaInfoView.tsx`, listar os docs com estado; docs `recusado` destacam a observação e oferecem reenvio (reusar o fluxo de alteração/`AlteracaoDialog` existente).

- [ ] **Step 3: Cliente — Realtime**

Em `AberturaInfoView.tsx` (ou um wrapper client), assinar `sb.channel(...).on('postgres_changes', { event:'UPDATE', schema:'public', table:'abertura_empresas', filter:'id=eq.'+aberturaId }, () => router.refresh())`. `createBrowserClient()`.

- [ ] **Step 4: Build** — Run: `cd app && npx tsc --noEmit && npx next build` — Expected: 0 erros.

- [ ] **Step 5: Commit**

```bash
cd balu && git add "app/src/app/(auth)/(gated)/contador/aberturas/[aberturaId]/DetalheAbertura.tsx" "app/src/app/(auth)/(gated)/configuracoes/AberturaInfoView.tsx"
git commit -m "feat(abertura): UI de checklist/minuta (contador) + reenvio/realtime (cliente)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: E2E + verificação final + merge

- [ ] **Step 1: E2E** (`app/e2e/abertura-checklist.spec.ts`): contador recusa doc → cliente vê "recusado" + motivo; contador avança etapa → notificação aparece no sino (Bloco 1); download da minuta gera PDF. Seguir o padrão dos E2E existentes.

- [ ] **Step 2: Suite** — Run: `cd app && npx tsc --noEmit && npx vitest run && npx next build` — Expected: verde/limpo.

- [ ] **Step 3: RLS** — confirmar que escritório alheio não altera a abertura; Realtime respeita a policy de SELECT do cliente.

- [ ] **Step 4: Atualizar CHECKPOINT** com o Bloco 2 entregue + migration 0046 + decisão da lib de PDF.

- [ ] **Step 5: Merge**

```bash
cd balu && git checkout main && git merge --no-ff feat/bloco-2-abertura && git push origin main
```

---

## Self-review (cobertura da spec)

- Frente A (checklist) → Tasks 1,2,4,6 ✅ · Frente B (notificação) → Tasks 3,4 ✅ · Frente C (Realtime) → Tasks 2,6 ✅ · Frente D (minuta por tipo) → Task 5 ✅.
- Dependência do Bloco 1 (tabela `notifications` + tipo `abertura_etapa`) registrada no header e na Task 2.
- Landmines da spec cobertas: merge JSONB parcial (Task 4), `user_id` null (Task 3), `cancelado` na timeline (Task 6), nuance legal por tipo (Task 5), CHECK do tipo (Task 2).
- A confirmar na execução (checagens contra código real, não placeholders): assinaturas de `requireEscritorio`/`aberturaDaCarteira`/`registrarAuditoria`; valores reais de `DOC_KEYS`; lib de PDF; fluxo de reenvio (`AlteracaoDialog`).
