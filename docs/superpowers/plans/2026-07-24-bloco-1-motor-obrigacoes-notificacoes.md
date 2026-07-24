# Bloco 1 — Motor de Obrigações + Notificações · Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Materializar as obrigações fiscais de cada empresa diariamente e notificar o titular (in-app + e-mail co-branded), com opt-out, sino no menu e correção da pendência de certificado A1.

**Architecture:** Uma RPC Postgres `SECURITY DEFINER` computa as obrigações (reusando as expressões de `painel_contador` e os limiares de `semaforo.ts`) e insere notificações idempotentes em `notifications`. Um cron diário chama a RPC e despacha e-mails pendentes (retryável, respeita opt-out). UI: sino no `MenuLateral`, página `/notificacoes`, aba de preferências em `/conta`.

**Tech Stack:** Next.js 15 (App Router, RSC + server actions), Supabase (Postgres + RLS + Realtime), Resend (via `sendEmail`), Vitest, Playwright, TypeScript.

**Spec:** `docs/superpowers/specs/2026-07-24-bloco-1-motor-obrigacoes-notificacoes-design.md`

**Convenções deste repo (ler antes de começar):**
- Rodar tudo a partir de `balu/` (raiz do git). App em `balu/app/`.
- **Migrations aplicadas manualmente pelo usuário** via runner `node+pg` (o classifier bloqueia escrita por MCP). O padrão: o plano gera `app/supabase/migrations/00XX_*.sql` + um script runner em `scratchpad/`; o usuário roda `! node scratchpad/apply-00XX.mjs` (lê `SUPABASE_PASSWORD` de `app/.env.local`). Ver memória `balu-migrations-e-env`.
- **Regra das 3 fontes de schema** (Master §3.1): o schema real é o banco / `docs/reference/db_atual.sql` + migrations 0025+, **nunca** o `0001`. Confirmar colunas antes de aplicar SQL.
- Commits frequentes, mensagem em pt, terminar com `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Verificação padrão do repo: `cd app && npx vitest run` · `npx tsc --noEmit` · `npx next build`.

**Branch:** criar `feat/bloco-1-obrigacoes` a partir de `main` antes da Task 1.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade | Ação |
|---|---|---|
| `app/supabase/migrations/0045_notificacoes.sql` | Tabelas `notifications` + `notification_preferences`, RLS, RPCs | Criar |
| `scratchpad/apply-0045.mjs` | Runner de aplicação (usuário roda) | Criar |
| `app/src/lib/notifications/tipos.ts` | Enum de tipos, severidade, labels, buckets (fonte única, testável) | Criar |
| `app/src/lib/notifications/email-template.ts` | `renderNotificacaoEmail()` (HTML escapado, co-branding) | Criar |
| `app/src/app/api/cron/obrigacoes/route.ts` | Cron diário: RPC + despacho de e-mail | Criar |
| `app/vercel.json` | Registrar o cron | Modificar |
| `app/src/app/(auth)/(gated)/notificacoes/page.tsx` | Página de listagem | Criar |
| `app/src/app/(auth)/(gated)/notificacoes/actions.ts` | `marcarNotificacaoLidaAction`, `marcarTodasLidasAction` | Criar |
| `app/src/components/notificacoes/SinoNotificacoes.tsx` | Sino + dropdown (client) | Criar |
| `app/src/components/MenuLateral.tsx` | Montar o sino no header/sidebar | Modificar |
| `app/src/app/(auth)/(gated)/conta/page.tsx` | Nova aba `notificacoes` | Modificar |
| `app/src/app/(auth)/(gated)/conta/PreferenciasNotificacao.tsx` | Form de opt-out | Criar |
| `app/src/app/(auth)/(gated)/conta/actions.ts` | `salvarPreferenciasNotificacaoAction` | Modificar |
| `app/src/lib/dashboard/queries.ts` | Pendência de cert A1 (corrige TODO) | Modificar |
| `app/src/lib/notifications/*.test.ts` | Testes unitários | Criar |

---

## Task 0: Branch

- [ ] **Step 1: Criar a branch**

```bash
cd balu && git checkout -b feat/bloco-1-obrigacoes
```

Expected: `Switched to a new branch 'feat/bloco-1-obrigacoes'`.

---

## Task 1: Helper de tipos (fonte única, testável)

Extrair para TS a tabela §5 da spec — tipos, severidade e buckets — para (a) o cron/UI consumirem e (b) ser testável. A RPC replica esses valores em SQL, mas o TS é a referência canônica documentada.

**Files:**
- Create: `app/src/lib/notifications/tipos.ts`
- Test: `app/src/lib/notifications/tipos.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// app/src/lib/notifications/tipos.test.ts
import { describe, it, expect } from 'vitest';
import { NOTIFICACAO_TIPOS, severidadePadrao, TIPOS_VALIDOS } from './tipos';

describe('notificacao tipos', () => {
  it('inclui abertura_etapa (usado pelo Bloco 2)', () => {
    expect(TIPOS_VALIDOS).toContain('abertura_etapa');
  });
  it('das_vencido é danger', () => {
    expect(severidadePadrao('das_vencido')).toBe('danger');
  });
  it('das_a_vencer é warning', () => {
    expect(severidadePadrao('das_a_vencer')).toBe('warning');
  });
  it('todo tipo tem label', () => {
    for (const t of TIPOS_VALIDOS) {
      expect(NOTIFICACAO_TIPOS[t].label.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd app && npx vitest run src/lib/notifications/tipos.test.ts`
Expected: FAIL (`Cannot find module './tipos'`).

- [ ] **Step 3: Implementar**

```ts
// app/src/lib/notifications/tipos.ts
export type Severidade = 'info' | 'warning' | 'danger';

export type NotificacaoTipo =
  | 'das_a_vencer' | 'das_vencido'
  | 'pgdas_pendente' | 'dasn_pendente' | 'defis_pendente'
  | 'cert_a_vencer' | 'cert_vencido'
  | 'limite_faturamento'
  | 'honorario_a_vencer'
  | 'abertura_etapa'; // Bloco 2

export const NOTIFICACAO_TIPOS: Record<NotificacaoTipo, { label: string; severidade: Severidade }> = {
  das_a_vencer:       { label: 'DAS a vencer', severidade: 'warning' },
  das_vencido:        { label: 'DAS vencido', severidade: 'danger' },
  pgdas_pendente:     { label: 'Declaração mensal (PGDAS-D) pendente', severidade: 'warning' },
  dasn_pendente:      { label: 'Declaração anual do MEI (DASN-SIMEI) pendente', severidade: 'warning' },
  defis_pendente:     { label: 'Declaração anual do Simples (DEFIS) pendente', severidade: 'warning' },
  cert_a_vencer:      { label: 'Certificado digital A1 vencendo', severidade: 'warning' },
  cert_vencido:       { label: 'Certificado digital A1 vencido', severidade: 'danger' },
  limite_faturamento: { label: 'Limite de faturamento', severidade: 'warning' },
  honorario_a_vencer: { label: 'Honorário a vencer', severidade: 'info' },
  abertura_etapa:     { label: 'Andamento da abertura', severidade: 'info' },
};

export const TIPOS_VALIDOS = Object.keys(NOTIFICACAO_TIPOS) as NotificacaoTipo[];

export function severidadePadrao(tipo: NotificacaoTipo): Severidade {
  return NOTIFICACAO_TIPOS[tipo].severidade;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd app && npx vitest run src/lib/notifications/tipos.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
cd balu && git add app/src/lib/notifications/tipos.ts app/src/lib/notifications/tipos.test.ts
git commit -m "feat(notif): helper de tipos de notificacao (fonte unica)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Template de e-mail (HTML escapado + co-branding)

**Files:**
- Create: `app/src/lib/notifications/email-template.ts`
- Test: `app/src/lib/notifications/email-template.test.ts`

- [ ] **Step 1: Teste que falha**

```ts
// app/src/lib/notifications/email-template.test.ts
import { describe, it, expect } from 'vitest';
import { renderNotificacaoEmail } from './email-template';

describe('renderNotificacaoEmail', () => {
  const base = { titulo: 'DAS vence em 3 dias', corpo: 'Seu DAS de 07/2026 vence dia 20.', actionUrl: 'https://x/impostos' };

  it('escapa HTML do corpo (anti-injection)', () => {
    const html = renderNotificacaoEmail({ ...base, corpo: '<script>alert(1)</script>' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
  it('mostra a norma quando presente', () => {
    const html = renderNotificacaoEmail({ ...base, norma: 'Res. CGSN 140/2018, art. 38' });
    expect(html).toContain('Res. CGSN 140/2018, art. 38');
  });
  it('inclui o link de ação', () => {
    expect(renderNotificacaoEmail(base)).toContain('https://x/impostos');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd app && npx vitest run src/lib/notifications/email-template.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar**

Reusar o padrão de escape dos callers existentes de `sendEmail` (ex.: `contador/convites-actions.ts`). Se já existir um `escapeHtml` em `src/lib`, importar; senão, incluir local.

```ts
// app/src/lib/notifications/email-template.ts
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

export function renderNotificacaoEmail(opts: {
  titulo: string;
  corpo: string;
  norma?: string | null;
  actionUrl: string;
  escritorioNome?: string | null;
}): string {
  const { titulo, corpo, norma, actionUrl, escritorioNome } = opts;
  const rodapeMarca = escritorioNome
    ? `Enviado por ${escapeHtml(escritorioNome)} via Balu`
    : 'Balu — gestão fiscal para MEI e Simples';
  return `
  <div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a">
    <h2 style="font-size:18px;margin:0 0 12px">${escapeHtml(titulo)}</h2>
    <p style="font-size:15px;line-height:1.5;margin:0 0 16px">${escapeHtml(corpo)}</p>
    ${norma ? `<p style="font-size:12px;color:#666;margin:0 0 16px">Base legal: ${escapeHtml(norma)}</p>` : ''}
    <a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#1a1a1a;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-size:14px">Ver no Balu</a>
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0 12px">
    <p style="font-size:12px;color:#999;margin:0">${rodapeMarca}. Você pode ajustar seus avisos em Conta → Notificações.</p>
  </div>`;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd app && npx vitest run src/lib/notifications/email-template.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
cd balu && git add app/src/lib/notifications/email-template.ts app/src/lib/notifications/email-template.test.ts
git commit -m "feat(notif): template de e-mail com escape + co-branding

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Migration 0045 — tabelas + RLS

**Files:**
- Create: `app/supabase/migrations/0045_notificacoes.sql`
- Create: `scratchpad/apply-0045.mjs`

- [ ] **Step 1: Confirmar o schema real das fontes**

Antes de escrever, verificar (via `docs/reference/db_atual.sql` + migrations 0030/0031/0036) que existem: `companies.user_id`, `companies.contabilidade_id`, `companies.status`, `companies.deleted_at`; `contabilidades.nome`, `contabilidades.email_remetente_nome`; `guias_fiscais(company_id, data_vencimento, data_pagamento, status, deleted_at)`; `declaracoes_fiscais(company_id, competencia_referencia, tipo, data_transmissao)`; `arquivos_auxiliares(company_id, cert_not_after, deleted_at)`; `empresas_fiscais."Code_regime_tributario"`. (Todas confirmadas na auditoria de 2026-07-24.)

- [ ] **Step 2: Escrever a migration**

```sql
-- app/supabase/migrations/0045_notificacoes.sql
-- Bloco 1 — Motor de Obrigacoes + Notificacoes.
-- Parte do schema REAL (db_atual.sql + migrations 0025+), NAO do 0001.

CREATE TABLE IF NOT EXISTS public.notifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  company_id    uuid,
  tipo          text NOT NULL CHECK (tipo IN (
    'das_a_vencer','das_vencido','pgdas_pendente','dasn_pendente','defis_pendente',
    'cert_a_vencer','cert_vencido','limite_faturamento','honorario_a_vencer','abertura_etapa')),
  severidade    text NOT NULL DEFAULT 'info' CHECK (severidade IN ('info','warning','danger')),
  titulo        text NOT NULL,
  corpo         text NOT NULL,
  norma         text,
  entidade_ref  text,
  action_href   text,
  chave         text NOT NULL,
  agendada_para date,
  lida_em       timestamptz,
  enviada_email_em timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS notifications_owner_chave_uidx
  ON public.notifications(owner_user_id, chave);
CREATE INDEX IF NOT EXISTS notifications_owner_unread_idx
  ON public.notifications(owner_user_id) WHERE lida_em IS NULL;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notifications_select_own ON public.notifications;
CREATE POLICY notifications_select_own ON public.notifications
  FOR SELECT USING (owner_user_id = auth.uid());
DROP POLICY IF EXISTS notifications_update_own ON public.notifications;
CREATE POLICY notifications_update_own ON public.notifications
  FOR UPDATE USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid());
-- Sem policy de INSERT: so a RPC (SECURITY DEFINER) e o service role inserem.

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  owner_user_id uuid NOT NULL,
  tipo          text NOT NULL,
  email_enabled boolean NOT NULL DEFAULT true,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_user_id, tipo)
);
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notif_prefs_all_own ON public.notification_preferences;
CREATE POLICY notif_prefs_all_own ON public.notification_preferences
  FOR ALL USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid());

-- Realtime para o sino (opcional; respeita RLS).
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
```

- [ ] **Step 3: Escrever o runner**

```js
// scratchpad/apply-0045.mjs
import { readFileSync } from 'node:fs';
import pg from 'pg';
const env = Object.fromEntries(
  readFileSync('app/.env.local', 'utf8').split('\n')
    .filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const pw = env.SUPABASE_PASSWORD;
const ref = (env.NEXT_PUBLIC_SUPABASE_URL || '').match(/https:\/\/([^.]+)\./)?.[1];
const client = new pg.Client({
  host: `aws-0-sa-east-1.pooler.supabase.com`, port: 5432,
  user: `postgres.${ref}`, password: pw, database: 'postgres', ssl: { rejectUnauthorized: false },
});
const sql = readFileSync('app/supabase/migrations/0045_notificacoes.sql', 'utf8');
await client.connect();
await client.query(sql);
const { rows } = await client.query("select count(*) from public.notifications");
console.log('OK 0045 aplicada. notifications count =', rows[0].count);
await client.end();
```

> Nota: confirmar host/porta do pooler contra o runner que a sessão 4 usou (a memória `balu-migrations-e-env` tem o padrão exato). Ajustar se o projeto usar conexão direta.

- [ ] **Step 4: Usuário aplica**

Peça ao usuário: **`! node scratchpad/apply-0045.mjs`**
Expected: `OK 0045 aplicada. notifications count = 0`.

- [ ] **Step 5: Commit**

```bash
cd balu && git add app/supabase/migrations/0045_notificacoes.sql
git commit -m "feat(notif): migration 0045 — notifications + preferences + RLS

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: RPC `materializar_obrigacoes`

**Files:**
- Create: `app/supabase/migrations/0045b_rpc_materializar.sql`
- Create: `scratchpad/apply-0045b.mjs` (clonar `apply-0045.mjs`, trocar o nome do arquivo SQL)
- Create: `scratchpad/test-materializar.mjs` (verificação)

- [ ] **Step 1: Escrever a RPC**

A RPC computa as obrigações e insere notificações idempotentes. Usa as expressões de `painel_contador` (0036:71-116). `p_hoje` default em BRT.

```sql
-- app/supabase/migrations/0045b_rpc_materializar.sql
CREATE OR REPLACE FUNCTION public.materializar_obrigacoes(
  p_hoje date DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inseridas integer := 0;
BEGIN
  -- DAS a vencer / vencido (buckets 7,3,1 e vencido)
  WITH guias AS (
    SELECT g.id, c.user_id AS owner_user_id, c.id AS company_id,
           g.data_vencimento, (g.data_vencimento - p_hoje) AS dias
    FROM public.guias_fiscais g
    JOIN public.companies c ON c.id = g.company_id
    WHERE g.deleted_at IS NULL AND g.status <> 'erro' AND g.data_pagamento IS NULL
      AND c.deleted_at IS NULL AND c.user_id IS NOT NULL
      AND g.data_vencimento IS NOT NULL
  ),
  cand AS (
    SELECT owner_user_id, company_id, id AS entidade_ref, dias,
      CASE WHEN dias < 0 THEN 'das_vencido' ELSE 'das_a_vencer' END AS tipo,
      CASE WHEN dias < 0 THEN 'V'
           WHEN dias <= 1 THEN 'D1' WHEN dias <= 3 THEN 'D3'
           WHEN dias <= 7 THEN 'D7' ELSE NULL END AS bucket,
      data_vencimento
    FROM guias
  ),
  ins AS (
    INSERT INTO public.notifications
      (owner_user_id, company_id, tipo, severidade, titulo, corpo, norma, entidade_ref, action_href, chave, agendada_para)
    SELECT owner_user_id, company_id, tipo,
      CASE WHEN tipo = 'das_vencido' THEN 'danger' ELSE 'warning' END,
      CASE WHEN tipo = 'das_vencido' THEN 'Você tem DAS vencido'
           ELSE 'Seu DAS está próximo do vencimento' END,
      CASE WHEN tipo = 'das_vencido'
           THEN 'Há guia(s) de DAS vencida(s) sem pagamento registrado. Pague para evitar juros e multa.'
           ELSE 'Seu DAS vence em ' || dias || ' dia(s). Pague pelo app para ficar em dia.' END,
      'LC 123/2006, art. 21',
      entidade_ref::text, '/impostos',
      tipo || ':' || entidade_ref::text || ':' || bucket,
      data_vencimento
    FROM cand WHERE bucket IS NOT NULL
    ON CONFLICT (owner_user_id, chave) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_inseridas FROM ins;

  -- Certificado A1 (< 30 dias => a_vencer; < 0 => vencido)
  WITH certs AS (
    SELECT c.user_id AS owner_user_id, c.id AS company_id,
           max(a.cert_not_after) AS not_after
    FROM public.companies c
    JOIN public.arquivos_auxiliares a ON a.company_id = c.id AND a.deleted_at IS NULL
    WHERE c.deleted_at IS NULL AND c.user_id IS NOT NULL AND a.cert_not_after IS NOT NULL
    GROUP BY c.user_id, c.id
  ),
  cand AS (
    SELECT owner_user_id, company_id, (not_after::date - p_hoje) AS dias, not_after
    FROM certs
  ),
  ins AS (
    INSERT INTO public.notifications
      (owner_user_id, company_id, tipo, severidade, titulo, corpo, norma, action_href, chave, agendada_para)
    SELECT owner_user_id, company_id,
      CASE WHEN dias < 0 THEN 'cert_vencido' ELSE 'cert_a_vencer' END,
      CASE WHEN dias < 0 THEN 'danger' ELSE 'warning' END,
      CASE WHEN dias < 0 THEN 'Certificado A1 vencido' ELSE 'Certificado A1 vencendo' END,
      CASE WHEN dias < 0 THEN 'Seu certificado digital A1 venceu — a emissão de notas para até renovar.'
           ELSE 'Seu certificado digital A1 vence em ' || dias || ' dia(s). Renove para não parar a emissão.' END,
      'ICP-Brasil (MP 2.200-2/2001)', '/configuracoes',
      (CASE WHEN dias < 0 THEN 'cert_vencido' ELSE 'cert_a_vencer' END) || ':' || company_id::text || ':' ||
      (CASE WHEN dias < 0 THEN 'V' WHEN dias <= 7 THEN 'D7' WHEN dias <= 15 THEN 'D15' ELSE 'D30' END),
      not_after::date
    FROM cand WHERE dias < 30
    ON CONFLICT (owner_user_id, chave) DO NOTHING
    RETURNING 1
  )
  SELECT v_inseridas + count(*) INTO v_inseridas FROM ins;

  -- PGDAS-D do mes anterior (Simples: Code 1/2) nao transmitida
  WITH base AS (
    SELECT c.user_id AS owner_user_id, c.id AS company_id,
           ef."Code_regime_tributario" AS code,
           to_char((p_hoje - interval '1 month'), 'YYYYMM') AS comp
    FROM public.companies c
    JOIN public.empresas_fiscais ef ON ef.empresa_id = c.id AND ef.deleted_at IS NULL
    WHERE c.deleted_at IS NULL AND c.user_id IS NOT NULL
  ),
  pend AS (
    SELECT b.owner_user_id, b.company_id, b.comp
    FROM base b
    WHERE b.code IN (1,2)
      AND NOT EXISTS (
        SELECT 1 FROM public.declaracoes_fiscais d
        WHERE d.company_id = b.company_id AND d.tipo = 'PGDAS-D'
          AND d.data_transmissao IS NOT NULL AND d.competencia_referencia = b.comp)
  ),
  ins AS (
    INSERT INTO public.notifications
      (owner_user_id, company_id, tipo, severidade, titulo, corpo, norma, action_href, chave, agendada_para)
    SELECT owner_user_id, company_id, 'pgdas_pendente',
      CASE WHEN extract(day from p_hoje) > 20 THEN 'danger' ELSE 'warning' END,
      'Declaração mensal (PGDAS-D) pendente',
      'A declaração do mês ' || comp || ' ainda não foi transmitida. O prazo é o dia 20.',
      'Res. CGSN 140/2018, art. 38', '/impostos',
      'pgdas_pendente:' || comp || ':' || company_id::text,
      make_date(substring(comp,1,4)::int, substring(comp,5,2)::int, 20)
    FROM pend
    ON CONFLICT (owner_user_id, chave) DO NOTHING
    RETURNING 1
  )
  SELECT v_inseridas + count(*) INTO v_inseridas FROM ins;

  -- (DASN-SIMEI, DEFIS, limite, honorario: adicionar blocos analogos — ver Step 2.)

  RETURN v_inseridas;
END; $$;
```

- [ ] **Step 2: Adicionar os blocos restantes (DASN, DEFIS, limite, honorário)**

Replicar o padrão CTE→INSERT para cada, com a idempotência via `chave`:
- **DASN-SIMEI** (`Code = 4`, janela jan–mai, ano anterior não em `declaracoes_fiscais` `tipo='DASN-SIMEI'` `competencia_referencia = (year-1)::text`): `tipo='dasn_pendente'`, severidade `danger` se `p_hoje > 31/05` senão `warning`, `chave='dasn_pendente:'||(year-1)||':'||company_id`, norma `Res. CGSN 140/2018, art. 109`, `action_href='/impostos'`.
- **DEFIS** (`Code IN (1,2)`, janela até 31/03, ano anterior não em `declaracoes_fiscais` `tipo='DEFIS'`): `tipo='defis_pendente'`, `chave='defis_pendente:'||(year-1)||':'||company_id`, norma `Res. CGSN 140/2018, art. 72`.
- **Limite de faturamento** (`faturamento_ano >= 0.8*limite`): reusar a lógica de faturamento de `painel_contador` (soma de `notas_fiscais` ativas do ano) e os limites de `parametros_fiscais` (`getLimitesFiscais` equivalente em SQL, ou uma subquery de `parametros_fiscais`). `tipo='limite_faturamento'`, bucket `80`/`100`, `chave='limite_faturamento:'||to_char(p_hoje,'YYYY')||':'||bucket||':'||company_id`, norma conforme regime.
- **Honorário a vencer** (`honorarios`: não pago, `data_vencimento - p_hoje IN {3,0}`, destinatário = dono da empresa-cliente): `tipo='honorario_a_vencer'`, `action_href='/honorarios'`, `chave='honorario_a_vencer:'||honorario_id||':'||bucket`.

> Cada bloco segue exatamente a estrutura do bloco DAS (CTE de origem → `cand`/`pend` com `bucket`/`chave` → `INSERT ... ON CONFLICT DO NOTHING RETURNING 1` → soma em `v_inseridas`).

- [ ] **Step 3: RPC auxiliar para o cron (destinatário + branding)**

```sql
CREATE OR REPLACE FUNCTION public.notificacoes_pendentes_email(p_limite int DEFAULT 200)
RETURNS TABLE (
  id uuid, owner_user_id uuid, tipo text, titulo text, corpo text, norma text,
  action_href text, destinatario_email text, escritorio_nome text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT n.id, n.owner_user_id, n.tipo, n.titulo, n.corpo, n.norma, n.action_href,
         u.email AS destinatario_email,
         COALESCE(ct.email_remetente_nome, ct.nome) AS escritorio_nome
  FROM public.notifications n
  JOIN auth.users u ON u.id = n.owner_user_id
  LEFT JOIN public.companies c ON c.id = n.company_id
  LEFT JOIN public.contabilidades ct ON ct.id = c.contabilidade_id
  LEFT JOIN public.notification_preferences p
    ON p.owner_user_id = n.owner_user_id AND p.tipo = n.tipo
  WHERE n.enviada_email_em IS NULL
    AND u.email IS NOT NULL
    AND COALESCE(p.email_enabled, true) = true
  ORDER BY n.created_at
  LIMIT p_limite;
$$;
```

- [ ] **Step 4: Aplicar (usuário)**

Runner `scratchpad/apply-0045b.mjs` (clone do 0045 apontando para `0045b_rpc_materializar.sql`).
Peça: **`! node scratchpad/apply-0045b.mjs`**
Expected: aplica sem erro.

- [ ] **Step 5: Verificar a materialização com dado real**

`scratchpad/test-materializar.mjs`: conecta, roda `select public.materializar_obrigacoes();`, imprime o retorno, e roda `select count(*), rodar 2x → mesmo count` (idempotência). Peça ao usuário rodar e cole o resultado.
Expected: retorno ≥ 0; segunda chamada não aumenta `count(*)` de `notifications` (idempotente).

- [ ] **Step 6: Commit**

```bash
cd balu && git add app/supabase/migrations/0045b_rpc_materializar.sql
git commit -m "feat(notif): RPC materializar_obrigacoes + notificacoes_pendentes_email

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Cron `/api/cron/obrigacoes`

**Files:**
- Create: `app/src/app/api/cron/obrigacoes/route.ts`
- Modify: `app/vercel.json`

- [ ] **Step 1: Escrever a rota** (espelha a auth de `honorarios-recorrentes/route.ts`)

```ts
// app/src/app/api/cron/obrigacoes/route.ts
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/clients/email';
import { renderNotificacaoEmail } from '@/lib/notifications/email-template';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET ausente' }, { status: 500 });
  if (req.headers.get('authorization') !== `Bearer ${secret}`)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  const { data: criadas, error: eRpc } = await admin.rpc('materializar_obrigacoes');
  if (eRpc) return NextResponse.json({ error: eRpc.message }, { status: 500 });

  const { data: pend, error: ePend } = await admin.rpc('notificacoes_pendentes_email', { p_limite: 200 });
  if (ePend) return NextResponse.json({ ok: true, criadas, email_erro: ePend.message }, { status: 207 });

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://balu-contabil.vercel.app';
  let enviados = 0, pulados = 0;
  for (const n of pend ?? []) {
    const html = renderNotificacaoEmail({
      titulo: n.titulo, corpo: n.corpo, norma: n.norma,
      actionUrl: `${siteUrl}${n.action_href ?? '/'}`,
      escritorioNome: n.escritorio_nome,
    });
    const r = await sendEmail({ to: n.destinatario_email, subject: n.titulo, html, fromName: n.escritorio_nome ?? undefined });
    if (r.ok) { await admin.from('notifications').update({ enviada_email_em: new Date().toISOString() }).eq('id', n.id); enviados++; }
    else { pulados++; } // skipped (sem chave) ou erro: fica pendente p/ proximo run
  }
  return NextResponse.json({ ok: true, criadas, enviados, pulados });
}
```

- [ ] **Step 2: Registrar o cron**

Editar `app/vercel.json` para adicionar ao array `crons`:

```json
{ "path": "/api/cron/obrigacoes", "schedule": "0 11 * * *" }
```

(11:00 UTC = 08:00 BRT, diário. Manter o cron `honorarios-recorrentes` existente.)

- [ ] **Step 3: Verificar tipos e build**

Run: `cd app && npx tsc --noEmit`
Expected: 0 erros. (Confirmar a assinatura de `sendEmail` — retorno `{ ok }`/`{ ok:false, skipped }` — e ajustar o check `r.ok`.)

- [ ] **Step 4: Smoke test local (opcional)**

Com o server rodando, `curl -H "authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/obrigacoes` → `{ ok:true, ... }`. Sem `authorization` → 401.

- [ ] **Step 5: Commit**

```bash
cd balu && git add app/src/app/api/cron/obrigacoes/route.ts app/vercel.json
git commit -m "feat(notif): cron diario /api/cron/obrigacoes (materializa + email)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Actions de notificação (marcar lida)

**Files:**
- Create: `app/src/app/(auth)/(gated)/notificacoes/actions.ts`

- [ ] **Step 1: Implementar** (RLS garante o escopo; `createServerClient`)

```ts
// app/src/app/(auth)/(gated)/notificacoes/actions.ts
'use server';
import { createServerClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export async function marcarNotificacaoLidaAction(id: string) {
  const sb = await createServerClient();
  const { error } = await sb.from('notifications').update({ lida_em: new Date().toISOString() }).eq('id', id);
  if (error) return { ok: false as const, error: error.message };
  revalidatePath('/notificacoes');
  return { ok: true as const };
}

export async function marcarTodasLidasAction() {
  const sb = await createServerClient();
  const { data: user } = await sb.auth.getUser();
  if (!user?.user) return { ok: false as const, error: 'no-auth' };
  const { error } = await sb.from('notifications')
    .update({ lida_em: new Date().toISOString() })
    .is('lida_em', null).eq('owner_user_id', user.user.id);
  if (error) return { ok: false as const, error: error.message };
  revalidatePath('/notificacoes');
  return { ok: true as const };
}
```

> Confirmar o nome real do helper de client server-side (`createServerClient` vs `createClient`) em `src/lib/supabase/` e o path de import usado nas actions existentes (ex.: `honorarios/actions.ts`). Ajustar o import.

- [ ] **Step 2: Verificar tipos**

Run: `cd app && npx tsc --noEmit`
Expected: 0 erros.

- [ ] **Step 3: Commit**

```bash
cd balu && git add "app/src/app/(auth)/(gated)/notificacoes/actions.ts"
git commit -m "feat(notif): actions marcar lida / marcar todas

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Sino no menu

**Files:**
- Create: `app/src/components/notificacoes/SinoNotificacoes.tsx`
- Modify: `app/src/components/MenuLateral.tsx`

- [ ] **Step 1: Componente do sino** (client; busca on-mount + assinatura Realtime; dropdown com padrão de fechar-ao-clicar-fora igual ao seletor de empresa em `MenuLateral.tsx:94-102`)

```tsx
// app/src/components/notificacoes/SinoNotificacoes.tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { createBrowserClient } from '@/lib/supabase/browser';
import { marcarTodasLidasAction } from '@/app/(auth)/(gated)/notificacoes/actions';

type Notif = { id: string; titulo: string; corpo: string; severidade: string; action_href: string | null; lida_em: string | null; created_at: string };

export function SinoNotificacoes({ collapsed }: { collapsed: boolean }) {
  const [open, setOpen] = useState(false);
  const [itens, setItens] = useState<Notif[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const sb = createBrowserClient();

  async function carregar() {
    const { data } = await sb.from('notifications').select('id,titulo,corpo,severidade,action_href,lida_em,created_at')
      .order('created_at', { ascending: false }).limit(15);
    setItens((data as Notif[]) ?? []);
  }
  useEffect(() => { carregar(); /* eslint-disable-next-line */ }, []);
  useEffect(() => {
    const ch = sb.channel('notif').on('postgres_changes',
      { event: '*', schema: 'public', table: 'notifications' }, () => carregar()).subscribe();
    return () => { sb.removeChannel(ch); };
    // eslint-disable-next-line
  }, []);
  useEffect(() => {
    function onClick(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener('mousedown', onClick); return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const naoLidas = itens.filter((i) => !i.lida_em).length;

  return (
    <div ref={ref} className="relative">
      <button aria-label="Notificações" onClick={() => setOpen((v) => !v)} className="relative flex items-center gap-2 rounded-lg p-2 hover:bg-black/5">
        <Bell size={20} />
        {!collapsed && <span className="text-sm">Notificações</span>}
        {naoLidas > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">{naoLidas > 9 ? '9+' : naoLidas}</span>}
      </button>
      {open && (
        <div className="absolute z-50 mt-2 max-h-96 w-80 overflow-auto rounded-xl border bg-white p-2 shadow-lg dark:bg-neutral-900">
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-xs font-semibold text-neutral-500">Notificações</span>
            {naoLidas > 0 && <button onClick={async () => { await marcarTodasLidasAction(); carregar(); }} className="text-xs text-blue-600">Marcar todas como lidas</button>}
          </div>
          {itens.length === 0 && <p className="px-2 py-6 text-center text-sm text-neutral-400">Nada por aqui.</p>}
          {itens.map((n) => (
            <a key={n.id} href={n.action_href ?? '#'} className={`block rounded-lg px-2 py-2 hover:bg-black/5 ${n.lida_em ? 'opacity-60' : ''}`}>
              <p className="text-sm font-medium">{n.titulo}</p>
              <p className="text-xs text-neutral-500">{n.corpo}</p>
            </a>
          ))}
          <a href="/notificacoes" className="block px-2 py-2 text-center text-xs text-blue-600">Ver todas</a>
        </div>
      )}
    </div>
  );
}
```

> Ajustar classes ao design system real (tokens Tailwind do repo — conferir `MenuLateral.tsx`). Confirmar o path `@/lib/supabase/browser` e o nome `createBrowserClient`.

- [ ] **Step 2: Montar no `MenuLateral`**

Em `app/src/components/MenuLateral.tsx`, importar `SinoNotificacoes` e renderizá-lo no topo da sidebar (perto da marca, ~L192) e/ou no header mobile (~L163), passando `collapsed={!open}` (o `open` do estado da sidebar). Não colocar no array `NAV` (é um botão especial, não um link).

- [ ] **Step 3: Verificar build**

Run: `cd app && npx tsc --noEmit && npx next build`
Expected: 0 erros; build limpo.

- [ ] **Step 4: Commit**

```bash
cd balu && git add app/src/components/notificacoes/SinoNotificacoes.tsx app/src/components/MenuLateral.tsx
git commit -m "feat(notif): sino de notificacoes no menu (badge + dropdown + realtime)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Página `/notificacoes`

**Files:**
- Create: `app/src/app/(auth)/(gated)/notificacoes/page.tsx`

- [ ] **Step 1: Implementar** (RSC; RLS filtra por usuário)

```tsx
// app/src/app/(auth)/(gated)/notificacoes/page.tsx
import { createServerClient } from '@/lib/supabase/server';
import { marcarNotificacaoLidaAction, marcarTodasLidasAction } from './actions';

export default async function NotificacoesPage() {
  const sb = await createServerClient();
  const { data } = await sb.from('notifications')
    .select('id,titulo,corpo,norma,severidade,action_href,lida_em,created_at')
    .order('created_at', { ascending: false }).limit(100);
  const itens = data ?? [];
  return (
    <div className="mx-auto max-w-2xl p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Notificações</h1>
        <form action={marcarTodasLidasAction}><button className="text-sm text-blue-600">Marcar todas como lidas</button></form>
      </div>
      {itens.length === 0 && <p className="py-12 text-center text-neutral-400">Você está em dia. Nenhuma notificação.</p>}
      <ul className="space-y-2">
        {itens.map((n) => (
          <li key={n.id} className={`rounded-xl border p-3 ${n.lida_em ? 'opacity-60' : ''}`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-medium">{n.titulo}</p>
                <p className="text-sm text-neutral-500">{n.corpo}</p>
                {n.norma && <p className="mt-1 text-xs text-neutral-400">{n.norma}</p>}
              </div>
              {n.action_href && <a href={n.action_href} className="shrink-0 text-sm text-blue-600">Abrir</a>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

> `marcarNotificacaoLidaAction` fica disponível para uso futuro (marcar item ao abrir); a marcação em massa via `<form action>` já cobre o critério de aceite. Confirmar o helper de layout/RSC padrão das páginas em `(gated)`.

- [ ] **Step 2: Build**

Run: `cd app && npx next build`
Expected: rota `/notificacoes` compilada.

- [ ] **Step 3: Commit**

```bash
cd balu && git add "app/src/app/(auth)/(gated)/notificacoes/page.tsx"
git commit -m "feat(notif): pagina /notificacoes

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Preferências em `/conta`

**Files:**
- Modify: `app/src/app/(auth)/(gated)/conta/page.tsx` (array `TABS`, ~L10)
- Create: `app/src/app/(auth)/(gated)/conta/PreferenciasNotificacao.tsx`
- Modify: `app/src/app/(auth)/(gated)/conta/actions.ts`

- [ ] **Step 1: Action de salvar** (upsert em `notification_preferences`)

Adicionar em `conta/actions.ts`:

```ts
export async function salvarPreferenciasNotificacaoAction(fd: FormData) {
  const sb = await createServerClient();
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return { ok: false as const, error: 'no-auth' };
  const desativados = fd.getAll('desativar_email').map(String); // tipos com e-mail OFF
  const { TIPOS_VALIDOS } = await import('@/lib/notifications/tipos');
  const rows = TIPOS_VALIDOS.map((tipo) => ({
    owner_user_id: u.user.id, tipo, email_enabled: !desativados.includes(tipo), updated_at: new Date().toISOString(),
  }));
  const { error } = await sb.from('notification_preferences').upsert(rows, { onConflict: 'owner_user_id,tipo' });
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const };
}
```

- [ ] **Step 2: Componente do form**

```tsx
// app/src/app/(auth)/(gated)/conta/PreferenciasNotificacao.tsx
import { createServerClient } from '@/lib/supabase/server';
import { NOTIFICACAO_TIPOS, TIPOS_VALIDOS } from '@/lib/notifications/tipos';
import { salvarPreferenciasNotificacaoAction } from './actions';

export async function PreferenciasNotificacao() {
  const sb = await createServerClient();
  const { data } = await sb.from('notification_preferences').select('tipo,email_enabled');
  const off = new Set((data ?? []).filter((r) => !r.email_enabled).map((r) => r.tipo));
  return (
    <form action={salvarPreferenciasNotificacaoAction} className="space-y-3">
      <p className="text-sm text-neutral-500">Escolha por quais avisos você quer receber e-mail. As notificações no app aparecem sempre.</p>
      {TIPOS_VALIDOS.filter((t) => t !== 'abertura_etapa').map((t) => (
        <label key={t} className="flex items-center justify-between rounded-lg border p-2">
          <span className="text-sm">{NOTIFICACAO_TIPOS[t].label}</span>
          <input type="checkbox" name="desativar_email" value={t} defaultChecked={off.has(t)} /> {/* marcado = e-mail desativado */}
        </label>
      ))}
      <button className="rounded-lg bg-black px-4 py-2 text-sm text-white">Salvar preferências</button>
    </form>
  );
}
```

- [ ] **Step 3: Registrar a aba**

Em `conta/page.tsx`: adicionar `{ id: 'notificacoes', label: 'Notificações' }` ao array `TABS` e renderizar `<PreferenciasNotificacao />` quando a aba ativa for `notificacoes` (seguir o switch/condicional existente das abas `perfil`/`seguranca`).

- [ ] **Step 4: Build + tipos**

Run: `cd app && npx tsc --noEmit && npx next build`
Expected: 0 erros.

- [ ] **Step 5: Commit**

```bash
cd balu && git add "app/src/app/(auth)/(gated)/conta/"
git commit -m "feat(notif): aba de preferencias (opt-out de e-mail por tipo)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Corrigir a pendência de certificado A1

**Files:**
- Modify: `app/src/lib/dashboard/queries.ts` (`getPendingActions` ~L87; TODO ~L147-149)

- [ ] **Step 1: Ler o trecho atual**

Ler `getPendingActions` para entender o formato de `PendingAction` (severidade, texto, href).

- [ ] **Step 2: Adicionar a pendência de cert e remover o TODO**

Dentro de `getPendingActions`, após as pendências de guias/notas, buscar o `cert_not_after` da empresa (`arquivos_auxiliares` `WHERE company_id = companyId AND deleted_at IS NULL`, `max(cert_not_after)`), calcular `dias` (usar o mesmo helper que `saude-empresa.ts` — `daysUntilISO`), e:
- `dias < 0` → `danger`: "Certificado digital A1 vencido — a emissão de notas está parada." `href: '/configuracoes'`.
- `dias < 30` → `warning`: `Certificado A1 vence em ${dias} dia(s).` `href: '/configuracoes'`.

Remover o comentário TODO(cert-a1) de L147-149.

- [ ] **Step 3: Verificar**

Run: `cd app && npx tsc --noEmit`
Expected: 0 erros. Se houver teste de `queries`/dashboard, rodar.

- [ ] **Step 4: Commit**

```bash
cd balu && git add app/src/lib/dashboard/queries.ts
git commit -m "fix(dashboard): pendencia de certificado A1 vencendo (remove TODO obsoleto)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: E2E do sino (Playwright)

**Files:**
- Create/Modify: `app/e2e/notificacoes.spec.ts` (seguir o padrão dos specs E2E existentes em `app/e2e/`)

- [ ] **Step 1: Escrever o teste**

Logar como usuário de teste com uma empresa que tenha DAS vencendo (seed via runner ou usar a conta de teste existente). Verificar: (a) badge de não-lidas > 0 após rodar a materialização; (b) abrir o dropdown e "Marcar todas como lidas" zera o badge; (c) `/notificacoes` lista os itens. Usar os seletores `aria-label="Notificações"`.

- [ ] **Step 2: Rodar**

Run: `cd app && npx playwright test notificacoes.spec.ts`
Expected: verde (ou documentar dependência de seed).

- [ ] **Step 3: Commit**

```bash
cd balu && git add app/e2e/notificacoes.spec.ts
git commit -m "test(notif): e2e do sino de notificacoes

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Verificação final + merge

- [ ] **Step 1: Suite completa**

Run: `cd app && npx tsc --noEmit && npx vitest run && npx next build`
Expected: typecheck 0, vitest verde, build limpo.

- [ ] **Step 2: RLS suite** (se aplicável ao repo)

Run: `cd app && npx playwright test rls` (ou o comando de RLS do repo)
Expected: verde. Confirmar que `notifications`/`notification_preferences` isolam por usuário (adicionar caso se a suite cobrir tabelas novas).

- [ ] **Step 3: Atualizar o CHECKPOINT**

Anexar ao `balu/CHECKPOINT.md` uma seção da sessão descrevendo o Bloco 1 entregue (tabelas, RPC, cron, sino, preferências, cert A1), migrations aplicadas (0045/0045b), e a verificação final.

- [ ] **Step 4: Merge para main**

```bash
cd balu && git checkout main && git merge --no-ff feat/bloco-1-obrigacoes
git push origin main
```

Expected: push dispara o auto-deploy da Vercel.

---

## Self-review (cobertura da spec)

- §3.1/§3.2 tabelas + RLS → Task 3 ✅ · §4 RPC → Task 4 ✅ · §5 tipos/buckets → Tasks 1 e 4 ✅ · §6 cron → Task 5 ✅ · §7.1 sino → Task 7 ✅ · §7.2 página → Task 8 ✅ · §7.3 preferências → Task 9 ✅ · §7.4 actions → Task 6 ✅ · §8 cert A1 → Task 10 ✅ · §11 testes → Tasks 1,2,11,12 ✅.
- Pendências deliberadas a confirmar na execução (não são placeholders — são checagens contra o código real): nome exato do helper de client Supabase server/browser; assinatura de `sendEmail`; host/porta do runner de migration; tokens Tailwind do design system. Cada uma tem a nota "confirmar" no passo correspondente.
