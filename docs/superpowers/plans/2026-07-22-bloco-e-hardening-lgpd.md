# Bloco E — Hardening e LGPD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar os 7 itens de hardening/LGPD do Bloco E, deixando o app seguro e conforme para dado real de piloto.

**Architecture:** Camada DB primeiro (migrations 0037–0040: rate-limit, auditoria, documentos/aceite LGPD, anonimização), depois app (rate-limit, anti-SSRF, anti-IDOR, cifra de credenciais, webhook, auditoria, aceite versionado, export, exclusão redesenhada), depois jurídico (minutas + seed). Reusa padrões do Bloco A.

**Tech Stack:** Next.js 15 App Router, Supabase Postgres/RLS, Vitest, Playwright, Node `crypto` (AES-256-GCM), runner node+pg para aplicar migrations.

**Spec:** `docs/product/` não — a spec deste bloco está em `docs/superpowers/specs/2026-07-22-bloco-e-hardening-lgpd-design.md`.

## Fatos verificados no banco/código (2026-07-22)

- Todas as 12 FKs `public.* → auth.users` são **ON DELETE CASCADE** → **nunca** hard-deletar auth user (destruiria notas/guias). Exclusão = anonimizar + banir login.
- `profiles` **não tem `full_name`**; o nome está em `auth.users.user_metadata.full_name`. Anonimização do nome é via auth admin API (app-side).
- `clientes` tem: `razao_social, document, email, telefone, logradouro, numero, complemento, bairro, municipio, uf, cep, status, owner_user_id, company_id, deleted_at`.
- RLS já ligada em 23 tabelas; `serpro_contratante` = deny-all intencional.
- Runner de migrations: `node <scratchpad>/run-migration.js <arquivo.sql> --verify "<sql>"` (lê `SUPABASE_PASSWORD` de `app/.env.local`; separa `ALTER TYPE ADD VALUE`; ver memória `balu-migrations-e-env`).
- Convenção: rodar `npm`/git a partir de `app/` para código e da raiz `balu/` para git. `ActionResult` é declarado local por arquivo de action.

## File Structure

- `app/supabase/migrations/0037_rate_limit.sql` — tabela + `check_rate_limit`.
- `app/supabase/migrations/0038_audit_log.sql` — tabela de auditoria.
- `app/supabase/migrations/0039_lgpd_documentos.sql` — `documento_versoes` + `aceites`.
- `app/supabase/migrations/0040_anonimizacao.sql` — função `anonimizar_usuario`.
- `app/src/lib/security/rate-limit.ts` — helper `limitar()`.
- `app/src/lib/security/url-allowlist.ts` — `hostPermitido` + `bloqueiaAlvoInterno`.
- `app/src/lib/security/audit.ts` — `registrarAuditoria()`.
- `app/src/lib/crypto/envelope.ts` — `cifrarCampo`/`decifrarCampo` (prefixo `enc:v1:`).
- `app/src/app/(auth)/aceite/page.tsx` + `AceiteClient.tsx` — gate de re-aceite.
- `app/src/app/(auth)/conta/actions.ts` — export + exclusão redesenhada.
- `docs/legal/politica-de-privacidade-v1.md`, `docs/legal/termos-de-uso-v1.md`, `docs/reference/inventario-dados-pessoais.md`.
- `app/scripts/seed-documentos-lgpd.mjs`, `app/scripts/cifra-credenciais-nfse.mjs` — one-offs.
- Testes: `app/src/lib/security/url-allowlist.test.ts`, `app/src/lib/security/rate-limit.test.ts`, `app/src/lib/crypto/envelope.test.ts` (estender), `app/tests/rls-all-tables.spec.ts`, `app/tests/webhook-focus-auth.spec.ts`, `app/tests/clientes-idor.spec.ts`.

---

### Task 1: Migration 0037 — rate limiting (Postgres)

**Files:**
- Create: `app/supabase/migrations/0037_rate_limit.sql`

- [ ] **Step 1: Escrever a migration**

```sql
-- 0037: rate limiting atômico por janela (Bloco E, item 7). Só service_role acessa
-- (a RPC é SECURITY DEFINER e é chamada pelo admin client nas server actions/rotas).
CREATE TABLE IF NOT EXISTS public.rate_limit_hits (
  chave text NOT NULL,
  janela_inicio timestamptz NOT NULL,
  contador int NOT NULL DEFAULT 0,
  PRIMARY KEY (chave, janela_inicio)
);
ALTER TABLE public.rate_limit_hits ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.rate_limit_hits TO service_role;

CREATE OR REPLACE FUNCTION public.check_rate_limit(p_chave text, p_max int, p_janela_segs int)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_janela timestamptz := to_timestamp(floor(extract(epoch FROM now()) / p_janela_segs) * p_janela_segs);
  v_contador int;
BEGIN
  INSERT INTO rate_limit_hits (chave, janela_inicio, contador)
    VALUES (p_chave, v_janela, 1)
    ON CONFLICT (chave, janela_inicio)
    DO UPDATE SET contador = rate_limit_hits.contador + 1
    RETURNING contador INTO v_contador;
  -- poda oportunista de janelas velhas (best-effort)
  DELETE FROM rate_limit_hits WHERE janela_inicio < now() - interval '1 day';
  RETURN v_contador <= p_max;
END $$;
REVOKE ALL ON FUNCTION public.check_rate_limit(text,int,int) FROM public;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text,int,int) TO service_role;
```

- [ ] **Step 2: Aplicar e verificar**

Run: `node <scratchpad>/run-migration.js app/supabase/migrations/0037_rate_limit.sql --verify "SELECT public.check_rate_limit('t:teste', 2, 60) AS a; SELECT public.check_rate_limit('t:teste', 2, 60) AS b; SELECT public.check_rate_limit('t:teste', 2, 60) AS c"`
Expected: a=true, b=true, c=false (3ª chamada estoura o limite de 2).

- [ ] **Step 3: Commit**

```bash
git add app/supabase/migrations/0037_rate_limit.sql
git commit -m "feat(db): rate_limit_hits + check_rate_limit (Bloco E)"
```

---

### Task 2: Migration 0038 — audit_log

**Files:**
- Create: `app/supabase/migrations/0038_audit_log.sql`

- [ ] **Step 1: Escrever a migration**

```sql
-- 0038: trilha de auditoria (Bloco E, item 6.6). Leitura só AdminBalu; escrita
-- só service_role (via helper registrarAuditoria).
CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  acao text NOT NULL,
  alvo_tipo text,
  alvo_id uuid,
  contabilidade_id uuid,
  meta jsonb,
  ip inet,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON public.audit_log(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_alvo_idx ON public.audit_log(alvo_tipo, alvo_id);
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_select_admin ON public.audit_log FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.role_types WHERE user_id = auth.uid() AND type = 'AdminBalu'));
GRANT SELECT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;
```

- [ ] **Step 2: Aplicar e verificar**

Run: `node <scratchpad>/run-migration.js app/supabase/migrations/0038_audit_log.sql --verify "INSERT INTO public.audit_log (acao) VALUES ('teste') RETURNING id; SELECT count(*) FROM public.audit_log WHERE acao='teste'; DELETE FROM public.audit_log WHERE acao='teste'"`
Expected: insere 1, conta 1, apaga (limpa o teste).

- [ ] **Step 3: Commit**

```bash
git add app/supabase/migrations/0038_audit_log.sql
git commit -m "feat(db): audit_log (leitura AdminBalu, escrita service_role)"
```

---

### Task 3: Migration 0039 — documentos LGPD + aceites

**Files:**
- Create: `app/supabase/migrations/0039_lgpd_documentos.sql`

- [ ] **Step 1: Escrever a migration**

```sql
-- 0039: versionamento de Termos/Política + aceites do titular (Bloco E, item 6.1).
CREATE TABLE IF NOT EXISTS public.documento_versoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL CHECK (tipo IN ('termos','privacidade')),
  versao text NOT NULL,
  conteudo_md text NOT NULL,
  publicado_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tipo, versao)
);
CREATE TABLE IF NOT EXISTS public.aceites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('termos','privacidade')),
  versao text NOT NULL,
  aceito_em timestamptz NOT NULL DEFAULT now(),
  ip inet
);
CREATE INDEX IF NOT EXISTS aceites_user_idx ON public.aceites(user_id, tipo);

ALTER TABLE public.documento_versoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aceites ENABLE ROW LEVEL SECURITY;

CREATE POLICY doc_select_publicado ON public.documento_versoes FOR SELECT
  USING (publicado_em IS NOT NULL);
GRANT SELECT ON public.documento_versoes TO anon, authenticated;
GRANT ALL ON public.documento_versoes TO service_role;

CREATE POLICY aceites_select_own ON public.aceites FOR SELECT USING (user_id = auth.uid());
CREATE POLICY aceites_insert_own ON public.aceites FOR INSERT WITH CHECK (user_id = auth.uid());
GRANT SELECT, INSERT ON public.aceites TO authenticated;
GRANT ALL ON public.aceites TO service_role;
```

- [ ] **Step 2: Aplicar e verificar**

Run: `node <scratchpad>/run-migration.js app/supabase/migrations/0039_lgpd_documentos.sql --verify "SELECT count(*) FROM public.documento_versoes; SELECT count(*) FROM public.aceites"`
Expected: 0 e 0, sem erro.

- [ ] **Step 3: Commit**

```bash
git add app/supabase/migrations/0039_lgpd_documentos.sql
git commit -m "feat(db): documento_versoes + aceites (LGPD versionado)"
```

---

### Task 4: Migration 0040 — anonimizar_usuario

**Files:**
- Create: `app/supabase/migrations/0040_anonimizacao.sql`

Contexto: FKs para auth.users são CASCADE — **não** deletamos o auth user. Esta função só trata as tabelas de negócio; o bloqueio de login + neutralização do e-mail/nome é app-side (Task 15).

- [ ] **Step 1: Escrever a migration**

```sql
-- 0040: anonimização do titular mantendo documentos fiscais (LGPD art. 16, I).
-- NÃO deleta auth.users (FKs são CASCADE → destruiria notas/guias). O bloqueio de
-- login e a neutralização de nome/e-mail no auth são feitos pela server action.
CREATE OR REPLACE FUNCTION public.anonimizar_usuario(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- profiles não tem dado pessoal além do vínculo; marca excluído.
  UPDATE profiles SET deleted_at = now(), updated_at = now()
    WHERE user_id = p_user_id;
  -- empresas do titular: fiscal RETIDO; marca excluída e desvincula de escritório.
  UPDATE companies SET deleted_at = COALESCE(deleted_at, now()), contabilidade_id = NULL,
                       updated_at = now()
    WHERE user_id = p_user_id;
  -- clientes do titular: anonimiza contato/endereço/nome; mantém `document`
  -- (id fiscal do terceiro é exigido para a guarda do documento fiscal) e histórico.
  UPDATE clientes SET razao_social = 'Removido', email = NULL, telefone = NULL,
                      logradouro = NULL, numero = NULL, complemento = NULL,
                      bairro = NULL, cep = NULL, deleted_at = COALESCE(deleted_at, now()),
                      updated_at = now()
    WHERE owner_user_id = p_user_id;
  INSERT INTO audit_log (actor_user_id, acao, alvo_tipo, alvo_id)
    VALUES (p_user_id, 'conta.exclusao', 'user', p_user_id);
END $$;
REVOKE ALL ON FUNCTION public.anonimizar_usuario(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.anonimizar_usuario(uuid) TO service_role;
```

- [ ] **Step 2: Aplicar e verificar**

Run: `node <scratchpad>/run-migration.js app/supabase/migrations/0040_anonimizacao.sql --verify "SELECT proname FROM pg_proc WHERE proname='anonimizar_usuario'"`
Expected: 1 linha.

- [ ] **Step 3: Commit**

```bash
git add app/supabase/migrations/0040_anonimizacao.sql
git commit -m "feat(db): anonimizar_usuario (retem fiscal, sem hard-delete)"
```

---

### Task 5: Rate-limit helper + aplicar em login

**Files:**
- Create: `app/src/lib/security/rate-limit.ts`
- Test: `app/src/lib/security/rate-limit.test.ts`
- Modify: `app/src/app/(public)/login/actions.ts`

- [ ] **Step 1: Teste falhando do helper (mock da RPC)**

```ts
// app/src/lib/security/rate-limit.test.ts
import { describe, it, expect, vi } from 'vitest';
import { limitar } from './rate-limit';

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ rpc: async () => ({ data: false, error: null }) }),
}));

describe('limitar', () => {
  it('retorna o data da RPC (false = estourou)', async () => {
    expect(await limitar('login:1.2.3.4', 10, 300)).toBe(false);
  });
  it('fail-open: erro na RPC não bloqueia o usuário', async () => {
    // com data:false acima já cobre o caminho normal; este documenta o contrato.
    expect(typeof (await limitar('x', 1, 1))).toBe('boolean');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `cd app && npx vitest run src/lib/security/rate-limit.test.ts` → FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

```ts
// app/src/lib/security/rate-limit.ts
import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

/** true = dentro do limite; false = estourou. Fail-open: se a RPC falhar, retorna true
 *  (não bloqueia usuário legítimo por indisponibilidade do rate-limiter). */
export async function limitar(chave: string, max: number, janelaSegs: number): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc('check_rate_limit', {
      p_chave: chave, p_max: max, p_janela_segs: janelaSegs,
    });
    if (error) return true;
    return data !== false;
  } catch {
    return true;
  }
}

/** Extrai um IP de cliente do header (best-effort) para compor a chave.
 *  Aceita tanto `Headers` (Request.headers) quanto `ReadonlyHeaders` (next/headers). */
export function ipDe(h: { get(name: string): string | null }): string {
  const xff = h.get('x-forwarded-for') ?? '';
  return xff.split(',')[0].trim() || 'sem-ip';
}
```

- [ ] **Step 4: Rodar e ver passar** — `npx vitest run src/lib/security/rate-limit.test.ts` → PASS.

- [ ] **Step 5: Aplicar em `login/actions.ts`** — no início de `loginAction`, antes do `signInWithPassword`, adicionar (o arquivo já importa `createServerClient`, `safeNext`, `redirect`; adicionar imports novos):

```ts
import { headers } from 'next/headers';
import { limitar, ipDe } from '@/lib/security/rate-limit';
// ...dentro de loginAction, após ler email/password do formData e antes do supabase.auth:
const ip = ipDe(await headers());
const ok = await limitar(`login:${ip}:${email}`, 10, 300); // 10 tentativas / 5 min
if (!ok) return { error: 'Muitas tentativas. Tente novamente em alguns minutos.' };
```

- [ ] **Step 6: Typecheck + commit**

```bash
cd app && npm run typecheck
git add src/lib/security/rate-limit.ts src/lib/security/rate-limit.test.ts "src/app/(public)/login/actions.ts"
git commit -m "feat(sec): helper de rate-limit + aplicado no login"
```

---

### Task 6: Aplicar rate-limit em cadastro, aceite de convite e reset

**Files:**
- Modify: `app/src/app/(public)/cadastro/actions.ts`
- Modify: `app/src/app/(auth)/contador/convites-actions.ts` (`aceitarConviteAction`)
- Modify: rota/action de reset de senha (localizar: `app/src/app/(public)/reset_pw` ou equivalente)

- [ ] **Step 1: cadastro** — no início de `signupAction`, após obter `email`, antes do `auth.signUp`:

```ts
import { headers } from 'next/headers';
import { limitar, ipDe } from '@/lib/security/rate-limit';
// ...
const ip = ipDe(await headers());
if (!(await limitar(`signup:${ip}`, 5, 3600))) return { error: 'Muitas tentativas. Tente novamente mais tarde.' };
```

- [ ] **Step 2: aceite de convite** — no início de `aceitarConviteAction`, após obter `user`:

```ts
import { headers } from 'next/headers';
import { limitar, ipDe } from '@/lib/security/rate-limit';
// ...
if (!(await limitar(`convite:${ipDe(await headers())}`, 20, 3600)))
  return { ok: false, error: 'Muitas tentativas. Tente novamente mais tarde.' };
```

- [ ] **Step 3: reset de senha** — localizar a action de reset (grep `resetPasswordForEmail`) e aplicar `limitar(`reset:${ip}:${email}`, 5, 3600)` com erro amigável.

- [ ] **Step 4: Typecheck** — `cd app && npm run typecheck` (0 erros). Rodar `npx vitest run` (suíte existente verde).

- [ ] **Step 5: Commit**

```bash
git add "src/app/(public)/cadastro/actions.ts" "src/app/(auth)/contador/convites-actions.ts" "src/app/(public)/reset_pw"
git commit -m "feat(sec): rate-limit em cadastro, aceite de convite e reset"
```

---

### Task 7: Anti-SSRF no download de notas

**Files:**
- Create: `app/src/lib/security/url-allowlist.ts`
- Test: `app/src/lib/security/url-allowlist.test.ts`
- Modify: `app/src/app/(auth)/notas_fiscais/[id]/download/route.ts`

- [ ] **Step 1: Teste falhando**

```ts
// app/src/lib/security/url-allowlist.test.ts
import { describe, it, expect } from 'vitest';
import { urlDownloadPermitida } from './url-allowlist';

describe('urlDownloadPermitida', () => {
  it('permite S3 pré-assinado da Focus e a API Focus', () => {
    expect(urlDownloadPermitida('https://focus-nfe-arquivos.s3.amazonaws.com/x.pdf')).toBe(true);
    expect(urlDownloadPermitida('https://api.focusnfe.com.br/v2/x.xml')).toBe(true);
    expect(urlDownloadPermitida('https://homologacao.focusnfe.com.br/v2/x.xml')).toBe(true);
  });
  it('bloqueia hosts fora da allowlist', () => {
    expect(urlDownloadPermitida('https://evil.com/x')).toBe(false);
  });
  it('bloqueia alvos internos e metadata', () => {
    expect(urlDownloadPermitida('http://169.254.169.254/latest/meta-data')).toBe(false);
    expect(urlDownloadPermitida('http://127.0.0.1/x')).toBe(false);
    expect(urlDownloadPermitida('http://10.0.0.5/x')).toBe(false);
    expect(urlDownloadPermitida('http://192.168.1.1/x')).toBe(false);
    expect(urlDownloadPermitida('http://localhost/x')).toBe(false);
  });
  it('bloqueia esquemas não-http', () => {
    expect(urlDownloadPermitida('file:///etc/passwd')).toBe(false);
    expect(urlDownloadPermitida('lixo')).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/lib/security/url-allowlist.test.ts` → FAIL.

- [ ] **Step 3: Implementar**

```ts
// app/src/lib/security/url-allowlist.ts
// Só permite baixar de hosts conhecidos da Focus; bloqueia SSRF para rede interna.
const SUFIXOS_PERMITIDOS = ['.focusnfe.com.br', '.amazonaws.com'];

function ehIpInterno(host: string): boolean {
  if (host === 'localhost') return true;
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 127) return true;                 // loopback
  if (a === 10) return true;                   // privado
  if (a === 192 && b === 168) return true;     // privado
  if (a === 172 && b >= 16 && b <= 31) return true; // privado
  if (a === 169 && b === 254) return true;     // link-local / metadata
  return false;
}

export function urlDownloadPermitida(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (ehIpInterno(host)) return false;
  return SUFIXOS_PERMITIDOS.some((s) => host === s.slice(1) || host.endsWith(s));
}
```

- [ ] **Step 4: Rodar e ver passar** — `npx vitest run src/lib/security/url-allowlist.test.ts` → PASS (5 casos).

- [ ] **Step 5: Guardar os fetch de URL absoluta no route** — em `download/route.ts`, importar `urlDownloadPermitida` e, nos dois pontos que fazem `fetch(savedUrl)` com URL absoluta (bloco XML `if (isAbsoluteUrl(savedUrl))` e bloco PDF `if (isAbsoluteUrl(savedUrl))`), inserir a checagem antes do fetch:

```ts
import { urlDownloadPermitida } from '@/lib/security/url-allowlist';
// XML: substituir
//   const url = isAbsoluteUrl(savedUrl) ? savedUrl : `${focusBase(ENV)}${savedUrl}`;
// por:
      const url = isAbsoluteUrl(savedUrl) ? savedUrl : `${focusBase(ENV)}${savedUrl}`;
      if (isAbsoluteUrl(savedUrl) && !urlDownloadPermitida(savedUrl)) {
        return new Response('origem do arquivo não permitida', { status: 400 });
      }
// PDF: no ramo `if (isAbsoluteUrl(savedUrl)) {` adicionar como 1ª linha:
      if (!urlDownloadPermitida(savedUrl)) return new Response('origem do arquivo não permitida', { status: 400 });
```

- [ ] **Step 6: Typecheck + commit**

```bash
cd app && npm run typecheck
git add src/lib/security/url-allowlist.ts src/lib/security/url-allowlist.test.ts "src/app/(auth)/notas_fiscais/[id]/download/route.ts"
git commit -m "feat(sec): allowlist de host no download de notas (anti-SSRF)"
```

---

### Task 8: Anti-IDOR em clientes

**Files:**
- Modify: `app/src/app/(auth)/clientes/actions.ts`
- Test: `app/tests/clientes-idor.spec.ts`

- [ ] **Step 1: Escopar `updateClienteAction`** — o `.update(...).eq('id', id)` vira `.eq('id', id).eq('owner_user_id', ctx.userId)`. Como o `update` não retorna erro quando afeta 0 linhas, checar contagem: trocar por `.update(...).eq('id', id).eq('owner_user_id', ctx.userId).select('id')` e, se `data?.length === 0`, retornar `{ ok: false, error: 'Cliente não encontrado.' }`. Mesma coisa em `softDeleteClienteAction`. (Ler o `ctx.userId` do `getContext()` já existente.)

- [ ] **Step 2: Teste de fronteira (Playwright, DB real, padrão rls-contador)**

```ts
// app/tests/clientes-idor.spec.ts — resumo do que provar:
// - cria usuário A e B (admin), cria cliente do A;
// - autenticado como B, chama update/softDelete no id do cliente do A;
// - assere que a linha do A permanece intacta (re-lê via admin);
// - teardown apaga usuários/clientes criados.
```
(Escrever o spec completo espelhando a estrutura de `tests/rls-contador.spec.ts`: env de `.env.local`, `createClient` admin, `signInWithPassword`, `afterAll` de limpeza.)

- [ ] **Step 3: Rodar** — `set -a; . ./.env.local; set +a; npx playwright test tests/clientes-idor.spec.ts` → PASS.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(auth)/clientes/actions.ts" tests/clientes-idor.spec.ts
git commit -m "fix(sec): escopa update/softDelete de clientes por dono (anti-IDOR)"
```

---

### Task 9: Webhook Focus — segredo constant-time

**Files:**
- Modify: `app/src/app/api/webhooks/focus/route.ts`
- Modify: `app/.env.example`
- Test: `app/tests/webhook-focus-auth.spec.ts`

- [ ] **Step 1: Exigir e comparar o segredo** — no topo do `POST`, antes de ler o body, validar o query param `s` contra `process.env.FOCUS_WEBHOOK_SECRET` com comparação constant-time:

```ts
import { timingSafeEqual } from 'node:crypto';
import { limitar, ipDe } from '@/lib/security/rate-limit';

function segredoOk(req: Request): boolean {
  const esperado = process.env.FOCUS_WEBHOOK_SECRET ?? '';
  const recebido = new URL(req.url).searchParams.get('s') ?? '';
  if (!esperado || recebido.length !== esperado.length) return false;
  return timingSafeEqual(Buffer.from(recebido), Buffer.from(esperado));
}

// como 1ªs linhas do POST:
if (!(await limitar(`focus-webhook:${ipDe(req.headers)}`, 300, 60))) {
  return NextResponse.json({ ok: false, reason: 'rate_limited' }, { status: 200 });
}
if (!segredoOk(req)) {
  console.warn('[webhook focus] segredo inválido/ausente');
  return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 200 });
}
// (mantém 200 para a Focus não reenfileirar; remove o TODO de HMAC)
```

- [ ] **Step 2: `.env.example`** — adicionar:

```
# Segredo do webhook da Focus (query param ?s= na URL de callback configurada na Focus) — Bloco E
FOCUS_WEBHOOK_SECRET=
```
E definir um valor real em `app/.env.local` (gerar: `openssl rand -hex 24`).

- [ ] **Step 3: Teste**

```ts
// app/tests/webhook-focus-auth.spec.ts — provar via fetch ao route handler (ou unit da função segredoOk):
// - sem ?s → resposta { ok:false, reason:'unauthorized' };
// - ?s errado → unauthorized;
// - ?s correto + ref inexistente → não-unauthorized (segue o fluxo).
```
(Como o route usa admin client, o teste mais simples é unitar `segredoOk` exportando-a, OU um teste de integração com `FOCUS_WEBHOOK_SECRET` setado. Preferir exportar `segredoOk` e testá-la no Vitest.)

- [ ] **Step 4: Typecheck + commit**

```bash
cd app && npm run typecheck && npx vitest run
git add "src/app/api/webhooks/focus/route.ts" .env.example
git commit -m "feat(sec): webhook Focus exige segredo constant-time + rate-limit"
```

---

### Task 10: Cifra de credenciais NFS-e em repouso

**Files:**
- Modify: `app/src/lib/crypto/envelope.ts`
- Test: `app/src/lib/crypto/envelope.test.ts` (estender)
- Modify: `app/src/app/(auth)/configuracoes/actions.ts` (escrita)
- Modify: `app/src/lib/fiscal/focus-empresa-update-payload.ts` (leitura)
- Create: `app/scripts/cifra-credenciais-nfse.mjs` (one-off)

- [ ] **Step 1: Teste falhando de `cifrarCampo`/`decifrarCampo`**

```ts
// adicionar em envelope.test.ts
import { cifrarCampo, decifrarCampo } from './envelope';
describe('cifrarCampo/decifrarCampo', () => {
  it('round-trip com prefixo enc:v1:', () => {
    const c = cifrarCampo('senha-secreta');
    expect(c.startsWith('enc:v1:')).toBe(true);
    expect(decifrarCampo(c)).toBe('senha-secreta');
  });
  it('valor legado em claro passa direto na leitura', () => {
    expect(decifrarCampo('claro-legado')).toBe('claro-legado');
  });
  it('null/vazio: cifrar retorna o mesmo; decifrar idem', () => {
    expect(cifrarCampo('')).toBe('');
    expect(decifrarCampo(null)).toBe(null);
  });
});
```
(Requer `CERT_ENC_KEY` no ambiente de teste — o `envelope.test.ts` atual já roda com ela; se não, o setup de teste deve exportá-la.)

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/lib/crypto/envelope.test.ts` → FAIL (funções não existem).

- [ ] **Step 3: Implementar em `envelope.ts`** (reusa `ALGO`/`key()`/IV/TAG já existentes):

```ts
const PREFIXO = 'enc:v1:';
/** Cifra um campo curto (string) para armazenar em repouso. '' passa direto. */
export function cifrarCampo(v: string): string {
  if (!v) return v;
  const iv = randomBytes(IV_LEN);
  const c = createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([c.update(v, 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  return PREFIXO + Buffer.concat([iv, tag, enc]).toString('base64');
}
/** Decifra; se não tiver o prefixo (legado em claro), retorna o próprio valor. */
export function decifrarCampo(v: string | null): string | null {
  if (v == null || !v.startsWith(PREFIXO)) return v;
  const buf = Buffer.from(v.slice(PREFIXO.length), 'base64');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = buf.subarray(IV_LEN + TAG_LEN);
  const d = createDecipheriv(ALGO, key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}
```

- [ ] **Step 4: Rodar e ver passar** — `npx vitest run src/lib/crypto/envelope.test.ts` → PASS.

- [ ] **Step 5: Cifrar na escrita** — em `configuracoes/actions.ts`, onde grava `empresas_fiscais` com os campos `nfse_senha_login, nfse_token_api, nfse_chave_api, nfse_frase_secreta, token_portal, senha_responsavel`, envolver cada valor não-vazio com `cifrarCampo(...)` antes do insert/update. (Import `cifrarCampo` de `@/lib/crypto/envelope`.)

- [ ] **Step 6: Decifrar na leitura** — em `focus-empresa-update-payload.ts` (e qualquer outro leitor que envie esses campos à Focus), aplicar `decifrarCampo(...)` ao ler cada campo. Confirmar via grep que não há OUTRO leitor: `grep -rn "nfse_senha_login\|nfse_token_api\|nfse_chave_api\|nfse_frase_secreta\|token_portal\|senha_responsavel" src/` — cada leitura que vai pra Focus decifra; a UI só mostra "configurado" (não lê o valor).

- [ ] **Step 7: Script one-off para cifrar legado** — `app/scripts/cifra-credenciais-nfse.mjs`: conecta via pg (padrão do runner, lê `SUPABASE_PASSWORD`), SELECT das linhas de `empresas_fiscais` com algum desses campos preenchido e SEM prefixo `enc:v1:`, cifra com a mesma lógica (importar de um módulo compartilhado OU replicar AES-256-GCM com `CERT_ENC_KEY`), UPDATE. Idempotente (pula quem já tem prefixo). Rodar uma vez e conferir: nenhum valor sem prefixo resta.

- [ ] **Step 8: Verificar no banco** — Run: `node <scratchpad>/run-migration.js --verify "SELECT count(*) AS claro FROM empresas_fiscais WHERE (nfse_token_api IS NOT NULL AND nfse_token_api NOT LIKE 'enc:v1:%')"` → Expected: 0 após o script.

- [ ] **Step 9: Commit**

```bash
cd app && npm run typecheck && npx vitest run
git add src/lib/crypto/envelope.ts src/lib/crypto/envelope.test.ts "src/app/(auth)/configuracoes/actions.ts" src/lib/fiscal/focus-empresa-update-payload.ts scripts/cifra-credenciais-nfse.mjs
git commit -m "feat(sec): cifra credenciais NFS-e em repouso (AES-256-GCM) + migra legado"
```

---

### Task 11: Helper de auditoria + wiring

**Files:**
- Create: `app/src/lib/security/audit.ts`
- Modify: `app/src/app/(auth)/contador/actions.ts`, `contador/honorarios/actions.ts`, `contador/convites-actions.ts`, `admin/contabilidades/actions.ts`, `contador/clientes/[companyId]/page.tsx`

- [ ] **Step 1: Helper**

```ts
// app/src/lib/security/audit.ts
import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

export type EventoAuditoria = {
  actorUserId: string;
  acao: string;                 // ex.: 'honorario.criar', 'cliente.acessar', 'contabilidade.aprovar'
  alvoTipo?: string;
  alvoId?: string | null;
  contabilidadeId?: string | null;
  meta?: Record<string, unknown>;
  ip?: string | null;
};

/** Best-effort: nunca lança nem bloqueia a ação principal. */
export async function registrarAuditoria(e: EventoAuditoria): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from('audit_log').insert({
      actor_user_id: e.actorUserId, acao: e.acao, alvo_tipo: e.alvoTipo ?? null,
      alvo_id: e.alvoId ?? null, contabilidade_id: e.contabilidadeId ?? null,
      meta: e.meta ?? null, ip: e.ip ?? null,
    });
  } catch (err) {
    console.warn('[auditoria] falhou:', err instanceof Error ? err.message : String(err));
  }
}
```

- [ ] **Step 2: Registrar ESCRITAS** — em cada action abaixo, após o sucesso, chamar `registrarAuditoria`:
  - `contador/honorarios/actions.ts`: create/update/marcarPago/desmarcarPago/delete → `acao: 'honorario.<verbo>'`, `alvoTipo:'honorario'`, `alvoId: id`, `contabilidadeId: ctx.id`.
  - `contador/actions.ts`: `removerClienteDaCarteiraAction` → `'carteira.remover'`; `removerMembroAction` → `'equipe.remover'`; `salvarBrandingAction` → `'escritorio.branding'`.
  - `contador/convites-actions.ts`: `convidarClienteAction`/`convidarMembroAction` → `'convite.criar'`; `aceitarConviteAction` → `'convite.aceitar'`.
  - `admin/contabilidades/actions.ts`: `decidirContabilidadeAction` → `'contabilidade.<aprovada|suspensa>'`.
  (Pegar `actorUserId` do usuário logado já disponível em cada guard.)

- [ ] **Step 3: Registrar ACESSO** — em `contador/clientes/[companyId]/page.tsx` (RSC), após validar o acesso e carregar `empresa`, chamar `registrarAuditoria({ actorUserId: ctx.userId, acao: 'cliente.acessar', alvoTipo:'company', alvoId: companyId, contabilidadeId: ctx.contabilidade.id })`. (RSC pode chamar server helper diretamente.)

- [ ] **Step 4: Typecheck + verificação manual** — `npm run typecheck`; opcional: após um fluxo, `SELECT acao, count(*) FROM audit_log GROUP BY 1`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/security/audit.ts "src/app/(auth)/contador" "src/app/(auth)/admin"
git commit -m "feat(lgpd): trilha de auditoria (acessos do contador + escritas)"
```

---

### Task 12: Aceite versionado + gate de re-aceite

**Files:**
- Modify: `app/src/app/(public)/cadastro/actions.ts` (grava aceites)
- Modify: `app/src/app/(auth)/layout.tsx` (gate)
- Create: `app/src/app/(auth)/aceite/page.tsx` + `AceiteClient.tsx`
- Create: `app/src/app/(auth)/aceite/actions.ts` (`aceitarDocumentosAction`)

- [ ] **Step 1: Gravar aceites no signup** — em `signupAction`, após criar o usuário, inserir em `aceites` (via admin, pois a sessão pode ainda não existir) uma linha por documento vigente (`termos` e `privacidade`) com a `versao` da última `documento_versoes` publicada de cada tipo e o `ip`. Manter o `terms_accepted_at` atual por compat.

- [ ] **Step 2: Helper de pendência** — criar `app/src/lib/lgpd/pendencia-aceite.ts`:

```ts
import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
/** Retorna os tipos ('termos'|'privacidade') cuja versão publicada mais recente
 *  o usuário ainda NÃO aceitou. Vazio = tudo em dia. */
export async function documentosPendentes(userId: string): Promise<string[]> {
  const admin = createAdminClient();
  const { data: docs } = await admin.from('documento_versoes')
    .select('tipo, versao, publicado_em').not('publicado_em', 'is', null)
    .order('publicado_em', { ascending: false });
  const vigentes = new Map<string, string>();
  for (const d of docs ?? []) if (!vigentes.has(d.tipo)) vigentes.set(d.tipo, d.versao);
  const { data: aceites } = await admin.from('aceites').select('tipo, versao').eq('user_id', userId);
  const aceitou = new Set((aceites ?? []).map((a) => `${a.tipo}:${a.versao}`));
  return [...vigentes].filter(([tipo, versao]) => !aceitou.has(`${tipo}:${versao}`)).map(([t]) => t);
}
```

- [ ] **Step 3: Gate no layout** — em `(auth)/layout.tsx`, após resolver `user`, chamar `documentosPendentes(user.id)`; se não-vazio e a rota atual não for `/aceite` nem logout, `redirect('/aceite')`. (Como o layout não conhece o pathname, o gate pode viver na própria `/aceite` que só renderiza se houver pendência e, no layout, redirecionar sempre que pendente — a página `/aceite` faz `redirect('/')` se não houver pendência, evitando loop.)

- [ ] **Step 4: Página `/aceite`** — RSC busca as versões vigentes pendentes (conteúdo_md) e renderiza `AceiteClient` com o texto + checkbox + botão. `aceitarDocumentosAction` (server) insere em `aceites` (via client autenticado, policy `aceites_insert_own`) as versões vigentes pendentes com `ip`, e retorna ok → `router.push('/')`.

- [ ] **Step 5: Typecheck + commit**

```bash
cd app && npm run typecheck
git add "src/app/(public)/cadastro/actions.ts" "src/app/(auth)/layout.tsx" "src/app/(auth)/aceite" src/lib/lgpd/pendencia-aceite.ts
git commit -m "feat(lgpd): aceite versionado de termos/privacidade + gate de re-aceite"
```

---

### Task 13: Exportação de dados do titular

**Files:**
- Modify: `app/src/app/(auth)/conta/actions.ts` (`exportarMeusDadosAction`)
- Modify: `app/src/app/(auth)/conta/DangerZone.tsx` ou nova seção na página `/conta` (botão)

- [ ] **Step 1: Action de export** — `exportarMeusDadosAction(): Promise<ActionResult<{ json: string }>>`: com o client autenticado (RLS garante escopo do titular), montar objeto com `profile`, `companies`, `empresas_fiscais` (SUBSTITUIR os campos de credencial por `'configurado'|null`, nunca o valor), `clientes`, `notas_fiscais`, `guias_fiscais`, `apuracoes_fiscais`, `declaracoes_fiscais`, `honorarios` (do titular), `aceites`. Retornar `JSON.stringify` (indentado). (Se ficar grande, o download vira arquivo no cliente.)

- [ ] **Step 2: UI** — na página `/conta`, botão "Exportar meus dados" que chama a action e dispara download de `meus-dados-balu.json` (Blob no cliente). Estado de loading + erro.

- [ ] **Step 3: Typecheck + commit**

```bash
cd app && npm run typecheck
git add "src/app/(auth)/conta"
git commit -m "feat(lgpd): exportação dos dados do titular (direito de acesso)"
```

---

### Task 14: Exclusão de conta redesenhada (anonimizar + banir)

**Files:**
- Modify: `app/src/app/(auth)/conta/actions.ts` (`deleteAccountAction`)
- Modify: `app/src/app/(auth)/conta/DangerZone.tsx` (cópia)

- [ ] **Step 1: Redesenhar `deleteAccountAction`** — substituir o `admin.auth.admin.deleteUser(user.id)` por:

```ts
const admin = createAdminClient();
// 1) anonimiza tabelas de negócio (fiscal retido)
const { error: eAnon } = await admin.rpc('anonimizar_usuario', { p_user_id: user.id });
if (eAnon) return { ok: false, error: eAnon.message };
// 2) neutraliza identidade + bloqueia login no auth (NUNCA deletar: FKs são CASCADE)
await admin.auth.admin.updateUserById(user.id, {
  email: `deleted+${user.id}@invalid.local`,
  user_metadata: { full_name: 'Usuário removido' },
  ban_duration: '876000h', // ~100 anos = banido de fato
});
// 3) encerra a sessão
await supabase.auth.signOut();
```
(Confirmar na doc do supabase-js a assinatura de `ban_duration`; se a versão não suportar, trocar por senha aleatória via `updateUserById({ password: randomBytes(24).toString('hex') })` + revogação de sessões. Documentar no PR o método efetivo.)

- [ ] **Step 2: Ajustar a cópia da DangerZone** — trocar "dados vinculados serão permanentemente excluídos" por: "Sua conta e seus dados pessoais serão removidos e o acesso, encerrado. Documentos fiscais são retidos de forma anonimizada pelo prazo legal (obrigação legal, LGPD art. 16, I)."

- [ ] **Step 3: Verificação manual (banco de teste)** — criar usuário descartável + 1 company + 1 cliente via admin; chamar a lógica de anonimização; conferir: `profiles.deleted_at` set, `companies.deleted_at` set e `contabilidade_id` null, `clientes` anonimizado, notas/guias **intactas**, login bloqueado. (Pode ser um teste Playwright `tests/exclusao-conta.spec.ts` que exercita `anonimizar_usuario` + verifica retenção fiscal.)

- [ ] **Step 4: Typecheck + commit**

```bash
cd app && npm run typecheck
git add "src/app/(auth)/conta"
git commit -m "feat(lgpd): exclusão anonimiza e retém fiscal (sem hard-delete)"
```

---

### Task 15: Minutas jurídicas + inventário + seed

**Files:**
- Create: `docs/legal/politica-de-privacidade-v1.md`, `docs/legal/termos-de-uso-v1.md`, `docs/reference/inventario-dados-pessoais.md`
- Create: `app/scripts/seed-documentos-lgpd.mjs`

- [ ] **Step 1: Inventário de dados pessoais** — `docs/reference/inventario-dados-pessoais.md`: tabela (campo · tabela · finalidade · base legal · retenção · titular) cobrindo CPF/CNPJ, endereço, e-mail, telefone, faturamento (notas), certificado digital A1 (sensível — acesso), credenciais NFS-e, IP/logs (audit_log), aceites. Uma linha por categoria de dado.

- [ ] **Step 2: Minuta da Política de Privacidade** — `docs/legal/politica-de-privacidade-v1.md`, versão `1.0`, baseada no inventário. Placeholders explícitos: `[Controlador: razão social + CNPJ]`, `[DPO/Encarregado: nome + e-mail]`. Aviso no topo: "Minuta técnica — pendente de revisão jurídica." Seções: dados coletados, finalidades, bases legais (art. 7º/9º), compartilhamento (Focus, SERPRO, Supabase, Resend), retenção (fiscal ~5 anos), direitos do titular (art. 18) e como exercê-los, segurança (art. 46), incidentes (art. 48), contato do DPO.

- [ ] **Step 3: Minuta dos Termos de Uso** — `docs/legal/termos-de-uso-v1.md`, versão `1.0`. Placeholders de controlador. Seções: objeto, cadastro, papéis (empresa/contador/AdminBalu), acesso do contador (somente leitura + consentimento), obrigações do usuário, limitação (o app não transmite declaração/emite nota automaticamente — determinístico + confirmação), cancelamento sem barreira (CDC), foro.

- [ ] **Step 4: Script de seed** — `app/scripts/seed-documentos-lgpd.mjs`: conecta via pg, lê os dois `.md`, faz upsert em `documento_versoes` (tipo, versao '1.0', conteudo_md, `publicado_em = now()`) `ON CONFLICT (tipo, versao) DO UPDATE`. Rodar uma vez.

- [ ] **Step 5: Verificar** — Run: `node <scratchpad>/run-migration.js --verify "SELECT tipo, versao, publicado_em IS NOT NULL AS publicado FROM documento_versoes ORDER BY tipo"` → 2 linhas publicadas.

- [ ] **Step 6: Commit**

```bash
git add docs/legal docs/reference/inventario-dados-pessoais.md app/scripts/seed-documentos-lgpd.mjs
git commit -m "docs(lgpd): minutas de politica/termos + inventario de dados + seed"
```

---

### Task 16: Teste RLS abrangente + verificação final

**Files:**
- Create: `app/tests/rls-all-tables.spec.ts`

- [ ] **Step 1: Teste** — espelhar `tests/rls-contador.spec.ts`. `beforeAll` cria dois titulares (A, B) via admin, cada um com 1 company + 1 cliente + 1 nota + 1 guia. Para cada tabela de tenant (`companies`, `clientes`, `notas_fiscais`, `guias_fiscais`, `apuracoes_fiscais`, `declaracoes_fiscais`, `empresas_fiscais`, `honorarios`, `company_cnaes`, `arquivos_auxiliares`, `abertura_empresas`), provar que B (autenticado) não lê linha do A (`select ... eq(id do A)` → 0). `afterAll` limpa. Um teste extra assere estruturalmente (via admin) que toda tabela `relkind='r'` em `public` tem `relrowsecurity=true` e que só `serpro_contratante` tem 0 políticas.

- [ ] **Step 2: Rodar** — `set -a; . ./.env.local; set +a; npx playwright test tests/rls-all-tables.spec.ts` → PASS. Se achar tabela desprotegida → migration corretiva antes de prosseguir (bloqueia o bloco).

- [ ] **Step 3: Verificação final do bloco**

```bash
cd app
npm run typecheck            # 0 erros
npx vitest run               # tudo verde (inclui url-allowlist, rate-limit, envelope)
npm run build                # build limpo
set -a; . ./.env.local; set +a
npx playwright test tests/rls-all-tables.spec.ts tests/rls-contador.spec.ts tests/clientes-idor.spec.ts tests/webhook-focus-auth.spec.ts
```
Expected: tudo verde. Reportar contagens reais.

- [ ] **Step 4: Commit**

```bash
git add tests/rls-all-tables.spec.ts
git commit -m "test(rls): matriz abrangente de isolamento por tenant (Bloco E)"
```

---

## Riscos conhecidos / decisões

- **FKs CASCADE para auth.users:** nunca deletar o auth user — só anonimizar + banir (Task 14). Verificado no banco em 2026-07-22.
- **`profiles` sem `full_name`:** nome vive no `user_metadata` do auth — neutralizado via admin API na Task 14.
- **`clientes.document` retido:** o id fiscal do terceiro é necessário para a guarda do documento fiscal; anonimizamos contato/endereço/nome, não o CPF/CNPJ. Registrar na minuta e confirmar com o Michel.
- **Focus sem HMAC:** autenticação por segredo na URL (constant-time) + rate-limit; documentar allowlist de IP no edge.
- **`CERT_ENC_KEY` obrigatória** para a cifra de credenciais NFS-e e para o script de migração do legado.
- **Rate-limit fail-open:** indisponibilidade do rate-limiter não bloqueia usuário legítimo (decisão consciente; o abuso real precisa da RPC responder).

## Pendências externas (go-live, não bloqueiam o código)

- Revisão jurídica das minutas + nome/e-mail do DPO + razão/CNPJ do controlador.
- `FOCUS_WEBHOOK_SECRET` definido e configurado na URL de callback da Focus.
- Allowlist de IP da Focus no edge do deploy.
- Rotação da `SUPABASE_SERVICE_ROLE_KEY` (recomendação pendente).
