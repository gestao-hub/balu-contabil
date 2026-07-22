# Bloco A — Multi-tenant do Contador: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tenant `contabilidades` com aprovação, vínculo empresa↔escritório por convite, painel do contador somente-leitura com semáforo fiscal, co-branding, honorários v2 com recorrência.

**Architecture:** Tabela de vínculo + RLS por join (helper `minha_contabilidade()`) + RPCs que retornam fatos crus; a classificação do semáforo vive em TS (`lib/fiscal/semaforo.ts`) para ser testável por norma no Vitest. Escritas de tenant passam por server actions com service role + guards; contador não tem NENHUMA política de escrita em dados do cliente.

**Tech Stack:** Next.js 15 App Router (padrões existentes: `createServerClient`/`createAdminClient`, `ActionResult`, Zod em `types/zod.ts`), Supabase Postgres/RLS/Storage, Vitest, Playwright.

**Spec:** `docs/product/2026-07-22-bloco-a-multitenant-contador-design.md`

## Emendas à spec (descobertas contra o banco REAL — `docs/reference/db_atual.sql`)

1. **Semáforo em TS, não na RPC:** `painel_contador()` retorna fatos crus (contagens/datas); `classificarSemaforo()` em TS é o único lugar da regra — testável por norma no Vitest (a spec pedia "único lugar testável"; SQL não é testável no Vitest).
2. **Honorários usa as colunas reais:** o banco real já tem `mes_referencia date`, `valor numeric(10,2)`, `data_vencimento NOT NULL`, `data_pagamento date`, `status ('pendente','pago','atrasado')`. Mantemos `valor numeric` (exato no Postgres; JS converte via helpers de centavos) em vez de criar `valor_centavos`. Nova coluna **`empresa_cliente_id`** (FK companies) — no legado `company_id` é a empresa DO CONTADOR e `cliente_id` aponta para `clientes`; não sobrecarregamos a semântica. Linhas legadas ficam intactas (dados de teste; app não lançado) e fora da UI v2.
3. **`companies.user_id` já é nullable** no banco real — 0031 só adiciona `contabilidade_id`.
4. **Drill-down:** views read-only novas e compactas (mesmos tokens visuais) em vez de refatorar as páginas existentes com `ReadOnlyContext` — menos risco de regressão; RLS continua sendo a garantia.
5. **E-mails (convite/aprovação):** `lib/clients/email.ts` via API HTTP do Resend (`RESEND_API_KEY`, `EMAIL_FROM`); sem chave → no-op com `console.warn` (dev não trava).
6. **`user_types` é um enum** (criado fora do repo; o trigger da 0002 faz cast `::user_types`) — a 0030 adiciona o valor `AdminBalu`.

## Colunas reais usadas pelas RPCs (conferidas no db_atual.sql)

- `companies`: `id, user_id (nullable), nome, razao_social, cnpj, deleted_at` → ganha `contabilidade_id`
- `empresas_fiscais`: `empresa_id` (FK companies), `"Code_regime_tributario"` ('1'|'2'|'3'|'4'), `deleted_at`
- `notas_fiscais`: `company_id, tipo_documento ('NFe','NFCe','NFSe'), data_emissao, status, valor_total`
- `guias_fiscais`: `company_id, competencia_referencia varchar(7), data_vencimento date, data_pagamento date, deleted_at`
- `declaracoes_fiscais` (0025): `company_id, competencia_referencia text, tipo ('PGDAS-D','DASN-SIMEI'), data_transmissao, status`
- `arquivos_auxiliares`: `unique_id_empresa` (FK companies), `cert_not_after timestamptz`
- `honorarios`: ver emenda 2
- `clientes`, `company_cnaes`: `company_id`

---

### Task 1: Migration 0030 — contabilidades, membros, convites, AdminBalu

**Files:**
- Create: `app/supabase/migrations/0030_contabilidades.sql`

- [ ] **Step 1: Escrever a migration**

```sql
-- 0030: tenant do escritório de contabilidade (Bloco A).
-- Spec: docs/product/2026-07-22-bloco-a-multitenant-contador-design.md

-- Papel de admin do Balu (enum user_types existe fora do repo; trigger 0002 faz cast)
ALTER TYPE public.user_types ADD VALUE IF NOT EXISTS 'AdminBalu';

CREATE TABLE IF NOT EXISTS public.contabilidades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  cnpj text UNIQUE,
  crc text NOT NULL,
  crc_uf char(2) NOT NULL,
  logo_url text,                          -- path no bucket privado 'branding'
  whatsapp_suporte text,                  -- E.164
  email_remetente_nome text,
  status text NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente','aprovada','suspensa')),
  aprovada_em timestamptz,
  aprovada_por uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.contabilidade_membros (
  contabilidade_id uuid NOT NULL REFERENCES public.contabilidades(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contabilidade_id, user_id)
);
-- Lançamento: 1 usuário em no máx. 1 contabilidade (dropar este índice na V2/papéis)
CREATE UNIQUE INDEX IF NOT EXISTS contabilidade_membros_user_unique
  ON public.contabilidade_membros(user_id);

CREATE TABLE IF NOT EXISTS public.convites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contabilidade_id uuid NOT NULL REFERENCES public.contabilidades(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('cliente','membro')),
  email text,                             -- null = link reutilizável do escritório
  token text NOT NULL UNIQUE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  expira_em timestamptz,                  -- null = sem expiração (link)
  revogado_em timestamptz,
  usado_em timestamptz,
  usado_por uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS convites_contabilidade_idx ON public.convites(contabilidade_id);

-- updated_at (função tg_set_updated_at existe desde a 0025)
DO $$ BEGIN
  CREATE TRIGGER tg_contabilidades_updated_at BEFORE UPDATE ON public.contabilidades
    FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- RLS ligada já no nascimento
ALTER TABLE public.contabilidades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contabilidade_membros ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.convites ENABLE ROW LEVEL SECURITY;

-- membro lê a própria contabilidade
CREATE POLICY contabilidades_select_membro ON public.contabilidades FOR SELECT
  USING (id IN (SELECT contabilidade_id FROM public.contabilidade_membros
                WHERE user_id = auth.uid()));
-- membro edita branding (colunas restritas por GRANT abaixo; status NUNCA via client)
CREATE POLICY contabilidades_update_membro ON public.contabilidades FOR UPDATE
  USING (id IN (SELECT contabilidade_id FROM public.contabilidade_membros
                WHERE user_id = auth.uid()))
  WITH CHECK (id IN (SELECT contabilidade_id FROM public.contabilidade_membros
                     WHERE user_id = auth.uid()));

-- membro lê os colegas; INSERT/DELETE só via service role (server actions)
CREATE POLICY membros_select ON public.contabilidade_membros FOR SELECT
  USING (contabilidade_id IN (SELECT contabilidade_id FROM public.contabilidade_membros
                              WHERE user_id = auth.uid()));

-- membro lê/gerencia convites do escritório; aceite roda por RPC (security definer)
CREATE POLICY convites_all_membro ON public.convites FOR ALL
  USING (contabilidade_id IN (SELECT contabilidade_id FROM public.contabilidade_membros
                              WHERE user_id = auth.uid()))
  WITH CHECK (contabilidade_id IN (SELECT contabilidade_id FROM public.contabilidade_membros
                                   WHERE user_id = auth.uid()));

GRANT SELECT ON public.contabilidades, public.contabilidade_membros, public.convites TO authenticated;
GRANT UPDATE (nome, logo_url, whatsapp_suporte, email_remetente_nome)
  ON public.contabilidades TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.convites TO authenticated;
GRANT ALL ON public.contabilidades, public.contabilidade_membros, public.convites TO service_role;
```

- [ ] **Step 2: Aplicar no banco** — SQL Editor do Dashboard (convenção do repo: `db_atual.sql` é a fonte da verdade; migrations aplicadas manualmente). Nota: `ALTER TYPE ... ADD VALUE` não roda dentro de transação com uso posterior no mesmo bloco — rodar a 1ª linha separada se o editor reclamar.

- [ ] **Step 3: Verificar**

Run (SQL Editor): `SELECT status FROM public.contabilidades LIMIT 1; SELECT 'AdminBalu'::public.user_types;`
Expected: sem erro (0 linhas na primeira; cast válido na segunda).

- [ ] **Step 4: Commit**

```bash
git add app/supabase/migrations/0030_contabilidades.sql
git commit -m "feat(db): contabilidades, membros, convites + papel AdminBalu (Bloco A)"
```

---

### Task 2: Migration 0031 — companies.contabilidade_id

**Files:**
- Create: `app/supabase/migrations/0031_companies_contabilidade.sql`

- [ ] **Step 1: Escrever a migration**

```sql
-- 0031: vínculo empresa ↔ escritório. NULL = empresa "solta" (experiência atual).
-- companies.user_id já é nullable no banco real (empresa criada pelo contador nasce sem dono).
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS contabilidade_id uuid REFERENCES public.contabilidades(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS companies_contabilidade_idx ON public.companies(contabilidade_id);
```

- [ ] **Step 2: Aplicar e verificar** — Run: `SELECT contabilidade_id FROM public.companies LIMIT 1;` Expected: coluna existe, valores NULL.

- [ ] **Step 3: Commit**

```bash
git add app/supabase/migrations/0031_companies_contabilidade.sql
git commit -m "feat(db): companies.contabilidade_id (vínculo empresa-escritório)"
```

---

### Task 3: Migration 0032 — honorários v2

**Files:**
- Create: `app/supabase/migrations/0032_honorarios_v2.sql`

- [ ] **Step 1: Escrever a migration**

```sql
-- 0032: honorários v2 (cli_2_11). Colunas reais mantidas (mes_referencia date, valor numeric,
-- data_vencimento, data_pagamento, status). Linhas legadas (contabilidade_id null) ficam fora da UI v2.
ALTER TABLE public.honorarios
  ADD COLUMN IF NOT EXISTS contabilidade_id uuid REFERENCES public.contabilidades(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS empresa_cliente_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS forma_pagamento text,
  ADD COLUMN IF NOT EXISTS recorrente boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recorrencia_dia int CHECK (recorrencia_dia BETWEEN 1 AND 28),
  ADD COLUMN IF NOT EXISTS asaas_charge_id text,    -- gancho Bloco B
  ADD COLUMN IF NOT EXISTS asaas_customer_id text;  -- gancho Bloco B

-- cliente_id (legado) passa a ser opcional: o v2 vincula pela empresa cliente
ALTER TABLE public.honorarios ALTER COLUMN cliente_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS honorarios_contabilidade_idx ON public.honorarios(contabilidade_id);
-- idempotência do cron: 1 honorário recorrente por escritório+cliente+competência
CREATE UNIQUE INDEX IF NOT EXISTS honorarios_recorrencia_unique
  ON public.honorarios(contabilidade_id, empresa_cliente_id, mes_referencia)
  WHERE recorrente = true;
```

- [ ] **Step 2: Aplicar e verificar** — Run: `SELECT recorrente, empresa_cliente_id FROM public.honorarios LIMIT 1;` Expected: colunas existem.

- [ ] **Step 3: Commit**

```bash
git add app/supabase/migrations/0032_honorarios_v2.sql
git commit -m "feat(db): honorarios v2 — vinculo por empresa cliente, recorrencia, ganchos asaas"
```

---

### Task 4: Migration 0033 — helper, políticas RLS do contador, parametros_fiscais

**Files:**
- Create: `app/supabase/migrations/0033_rls_contador.sql`

- [ ] **Step 1: Escrever a migration**

```sql
-- 0033: fronteira de segurança do contador. SÓ SELECT em dados do cliente; zero escrita.

-- Helper: contabilidade APROVADA do usuário logado (null = sem acesso).
-- security definer p/ não recursar RLS; stable p/ cache por statement.
CREATE OR REPLACE FUNCTION public.minha_contabilidade()
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT cm.contabilidade_id
  FROM contabilidade_membros cm
  JOIN contabilidades c ON c.id = cm.contabilidade_id AND c.status = 'aprovada'
  WHERE cm.user_id = auth.uid()
$$;
REVOKE ALL ON FUNCTION public.minha_contabilidade() FROM public;
GRANT EXECUTE ON FUNCTION public.minha_contabilidade() TO authenticated;

-- companies: condição direta
CREATE POLICY companies_select_contador ON public.companies FOR SELECT
  USING (contabilidade_id IS NOT NULL AND contabilidade_id = public.minha_contabilidade());

-- filhas por company_id
CREATE POLICY notas_fiscais_select_contador ON public.notas_fiscais FOR SELECT
  USING (company_id IN (SELECT id FROM public.companies
                        WHERE contabilidade_id = public.minha_contabilidade()));
CREATE POLICY apuracoes_select_contador ON public.apuracoes_fiscais FOR SELECT
  USING (company_id IN (SELECT id FROM public.companies
                        WHERE contabilidade_id = public.minha_contabilidade()));
CREATE POLICY declaracoes_select_contador ON public.declaracoes_fiscais FOR SELECT
  USING (company_id IN (SELECT id FROM public.companies
                        WHERE contabilidade_id = public.minha_contabilidade()));
CREATE POLICY guias_select_contador ON public.guias_fiscais FOR SELECT
  USING (company_id IN (SELECT id FROM public.companies
                        WHERE contabilidade_id = public.minha_contabilidade()));
CREATE POLICY clientes_select_contador ON public.clientes FOR SELECT
  USING (company_id IN (SELECT id FROM public.companies
                        WHERE contabilidade_id = public.minha_contabilidade()));
CREATE POLICY company_cnaes_select_contador ON public.company_cnaes FOR SELECT
  USING (company_id IN (SELECT id FROM public.companies
                        WHERE contabilidade_id = public.minha_contabilidade()));
-- colunas de FK divergentes:
CREATE POLICY empresas_fiscais_select_contador ON public.empresas_fiscais FOR SELECT
  USING (empresa_id IN (SELECT id FROM public.companies
                        WHERE contabilidade_id = public.minha_contabilidade()));
CREATE POLICY arquivos_aux_select_contador ON public.arquivos_auxiliares FOR SELECT
  USING (unique_id_empresa IN (SELECT id FROM public.companies
                               WHERE contabilidade_id = public.minha_contabilidade()));

-- honorarios v2: membro CRUD no que é do escritório; empresário lê os da própria empresa
CREATE POLICY honorarios_all_membro ON public.honorarios FOR ALL
  USING (contabilidade_id IS NOT NULL AND contabilidade_id = public.minha_contabilidade())
  WITH CHECK (contabilidade_id IS NOT NULL AND contabilidade_id = public.minha_contabilidade());
CREATE POLICY honorarios_select_empresario ON public.honorarios FOR SELECT
  USING (empresa_cliente_id IN (SELECT id FROM public.companies WHERE user_id = auth.uid()));

-- parâmetros fiscais versionados (tetos NUNCA hard-coded — LC 123/2006; PLP 108/2024 pode reajustar)
CREATE TABLE IF NOT EXISTS public.parametros_fiscais (
  chave text NOT NULL,
  valor numeric NOT NULL,
  vigencia_inicio date NOT NULL,
  norma text,
  PRIMARY KEY (chave, vigencia_inicio)
);
ALTER TABLE public.parametros_fiscais ENABLE ROW LEVEL SECURITY;
CREATE POLICY parametros_select_all ON public.parametros_fiscais FOR SELECT USING (true);
GRANT SELECT ON public.parametros_fiscais TO authenticated, anon;
GRANT ALL ON public.parametros_fiscais TO service_role;

INSERT INTO public.parametros_fiscais (chave, valor, vigencia_inicio, norma) VALUES
  ('limite_mei',     81000,   '2018-01-01', 'LC 123/2006, art. 18-A, §1º'),
  ('limite_simples', 4800000, '2018-01-01', 'LC 123/2006, art. 3º, II')
ON CONFLICT DO NOTHING;
```

- [ ] **Step 2: Aplicar e verificar** — Run: `SELECT public.minha_contabilidade(); SELECT chave, valor FROM public.parametros_fiscais;` Expected: null (SQL editor não tem auth.uid) + 2 linhas de parâmetros.

- [ ] **Step 3: Verificar que RLS está ATIVA nas 9 tabelas** (pré-condição das políticas terem efeito; a 0009 desligou, a 0010 religou — confirmar):

```sql
SELECT relname, relrowsecurity FROM pg_class
WHERE relname IN ('companies','notas_fiscais','apuracoes_fiscais','declaracoes_fiscais',
  'guias_fiscais','clientes','company_cnaes','empresas_fiscais','arquivos_auxiliares','honorarios');
```
Expected: `relrowsecurity = true` em todas. Se alguma vier `false`, **PARAR e reportar** (é o item 1 do Bloco E; ligar antes de prosseguir: `ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;`).

- [ ] **Step 4: Commit**

```bash
git add app/supabase/migrations/0033_rls_contador.sql
git commit -m "feat(db): RLS contador (select-only) + minha_contabilidade() + parametros_fiscais"
```

---

### Task 5: Migration 0034 — RPCs (painel, resumo, aceite, cron)

**Files:**
- Create: `app/supabase/migrations/0034_rpcs_contador.sql`

- [ ] **Step 1: Escrever a migration**

```sql
-- 0034: RPCs do Bloco A. painel_contador retorna FATOS CRUS; a classificação do semáforo
-- vive em src/lib/fiscal/semaforo.ts (testável por norma no Vitest).

CREATE OR REPLACE FUNCTION public.painel_contador()
RETURNS TABLE (
  company_id uuid, nome text, razao_social text, cnpj text,
  regime_code text, convite_pendente boolean,
  faturamento_ano numeric, faturamento_12m numeric,
  das_vencidos int, pgdas_mes_anterior_transmitida boolean,
  dasn_ano_anterior_transmitida boolean, cert_not_after timestamptz,
  honorarios_aberto numeric, honorarios_atrasado numeric
) LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT
    c.id, c.nome, c.razao_social, c.cnpj,
    ef."Code_regime_tributario"::text,
    (c.user_id IS NULL),
    COALESCE((SELECT sum(n.valor_total) FROM notas_fiscais n
      WHERE n.company_id = c.id AND n.status IN ('ativa','lancada')
        AND n.tipo_documento IN ('NFe','NFCe','NFSe')
        AND n.data_emissao >= date_trunc('year', now())), 0),
    COALESCE((SELECT sum(n.valor_total) FROM notas_fiscais n
      WHERE n.company_id = c.id AND n.status IN ('ativa','lancada')
        AND n.tipo_documento IN ('NFe','NFCe','NFSe')
        AND n.data_emissao >= date_trunc('month', now()) - interval '12 months'), 0),
    (SELECT count(*)::int FROM guias_fiscais g
      WHERE g.company_id = c.id AND g.deleted_at IS NULL
        AND g.data_pagamento IS NULL AND g.data_vencimento < current_date),
    EXISTS (SELECT 1 FROM declaracoes_fiscais d
      WHERE d.company_id = c.id AND d.tipo = 'PGDAS-D' AND d.data_transmissao IS NOT NULL
        AND d.competencia_referencia = to_char(date_trunc('month', now()) - interval '1 month', 'YYYY-MM')),
    EXISTS (SELECT 1 FROM declaracoes_fiscais d
      WHERE d.company_id = c.id AND d.tipo = 'DASN-SIMEI' AND d.data_transmissao IS NOT NULL
        AND d.competencia_referencia LIKE (extract(year FROM now())::int - 1)::text || '%'),
    (SELECT max(a.cert_not_after) FROM arquivos_auxiliares a WHERE a.unique_id_empresa = c.id),
    COALESCE((SELECT sum(h.valor) FROM honorarios h
      WHERE h.empresa_cliente_id = c.id AND h.contabilidade_id = c.contabilidade_id
        AND h.data_pagamento IS NULL AND h.data_vencimento >= current_date), 0),
    COALESCE((SELECT sum(h.valor) FROM honorarios h
      WHERE h.empresa_cliente_id = c.id AND h.contabilidade_id = c.contabilidade_id
        AND h.data_pagamento IS NULL AND h.data_vencimento < current_date), 0)
  FROM companies c
  LEFT JOIN empresas_fiscais ef ON ef.empresa_id = c.id AND ef.deleted_at IS NULL
  WHERE c.deleted_at IS NULL
    AND c.contabilidade_id = public.minha_contabilidade()
  ORDER BY c.nome NULLS LAST
$$;
REVOKE ALL ON FUNCTION public.painel_contador() FROM public;
GRANT EXECUTE ON FUNCTION public.painel_contador() TO authenticated;

CREATE OR REPLACE FUNCTION public.resumo_escritorio()
RETURNS TABLE (total_clientes int, honorarios_aberto numeric, honorarios_atrasado numeric)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT
    (SELECT count(*)::int FROM companies
      WHERE contabilidade_id = public.minha_contabilidade() AND deleted_at IS NULL),
    COALESCE((SELECT sum(valor) FROM honorarios
      WHERE contabilidade_id = public.minha_contabilidade()
        AND data_pagamento IS NULL AND data_vencimento >= current_date), 0),
    COALESCE((SELECT sum(valor) FROM honorarios
      WHERE contabilidade_id = public.minha_contabilidade()
        AND data_pagamento IS NULL AND data_vencimento < current_date), 0)
$$;
REVOKE ALL ON FUNCTION public.resumo_escritorio() FROM public;
GRANT EXECUTE ON FUNCTION public.resumo_escritorio() TO authenticated;

-- Aceite de convite DIRIGIDO (cliente com empresa pré-cadastrada, ou membro).
-- Transacional (função = transação), idempotente no re-clique do mesmo usuário.
CREATE OR REPLACE FUNCTION public.aceitar_convite(p_token text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v convites%ROWTYPE; v_uid uuid := auth.uid(); v_status text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'NAO_AUTENTICADO'; END IF;
  SELECT * INTO v FROM convites WHERE token = p_token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONVITE_INVALIDO'; END IF;
  IF v.revogado_em IS NOT NULL THEN RAISE EXCEPTION 'CONVITE_REVOGADO'; END IF;
  IF v.expira_em IS NOT NULL AND v.expira_em < now() THEN RAISE EXCEPTION 'CONVITE_EXPIRADO'; END IF;
  IF v.usado_em IS NOT NULL THEN
    IF v.usado_por = v_uid THEN RETURN COALESCE(v.company_id, v.contabilidade_id); END IF; -- no-op idempotente
    RAISE EXCEPTION 'CONVITE_USADO';
  END IF;
  SELECT status INTO v_status FROM contabilidades WHERE id = v.contabilidade_id;
  IF v_status IS DISTINCT FROM 'aprovada' THEN RAISE EXCEPTION 'ESCRITORIO_INATIVO'; END IF;

  IF v.tipo = 'membro' THEN
    INSERT INTO contabilidade_membros (contabilidade_id, user_id)
      VALUES (v.contabilidade_id, v_uid) ON CONFLICT DO NOTHING;
    UPDATE convites SET usado_em = now(), usado_por = v_uid WHERE id = v.id;
    RETURN v.contabilidade_id;
  END IF;

  -- tipo 'cliente' dirigido: assume a empresa pré-cadastrada
  IF v.company_id IS NULL THEN RAISE EXCEPTION 'CONVITE_SEM_EMPRESA'; END IF;
  UPDATE companies SET user_id = v_uid
    WHERE id = v.company_id AND contabilidade_id = v.contabilidade_id AND user_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'EMPRESA_JA_TEM_DONO'; END IF;
  UPDATE convites SET usado_em = now(), usado_por = v_uid WHERE id = v.id;
  RETURN v.company_id;
END $$;
REVOKE ALL ON FUNCTION public.aceitar_convite(text) FROM public;
GRANT EXECUTE ON FUNCTION public.aceitar_convite(text) TO authenticated;

-- Vínculo pelo LINK do escritório (empresa existente do próprio usuário)
CREATE OR REPLACE FUNCTION public.vincular_empresa_por_link(p_token text, p_company_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v convites%ROWTYPE; v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'NAO_AUTENTICADO'; END IF;
  SELECT * INTO v FROM convites WHERE token = p_token
    AND tipo = 'cliente' AND email IS NULL AND company_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONVITE_INVALIDO'; END IF;
  IF v.revogado_em IS NOT NULL THEN RAISE EXCEPTION 'CONVITE_REVOGADO'; END IF;
  IF (SELECT status FROM contabilidades WHERE id = v.contabilidade_id) IS DISTINCT FROM 'aprovada'
    THEN RAISE EXCEPTION 'ESCRITORIO_INATIVO'; END IF;
  UPDATE companies SET contabilidade_id = v.contabilidade_id
    WHERE id = p_company_id AND user_id = v_uid AND contabilidade_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'EMPRESA_INDISPONIVEL'; END IF; -- não é sua ou já vinculada
END $$;
REVOKE ALL ON FUNCTION public.vincular_empresa_por_link(text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.vincular_empresa_por_link(text, uuid) TO authenticated;

-- Cron mensal: materializa a competência corrente dos honorários recorrentes.
-- Idempotente pelo índice honorarios_recorrencia_unique. Roda com service_role (sem grant p/ authenticated).
CREATE OR REPLACE FUNCTION public.gerar_honorarios_recorrentes()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  INSERT INTO honorarios (contabilidade_id, empresa_cliente_id, company_id, mes_referencia,
                          valor, data_vencimento, status, recorrente, recorrencia_dia)
  SELECT t.contabilidade_id, t.empresa_cliente_id, t.company_id, date_trunc('month', now())::date,
         t.valor,
         make_date(extract(year FROM now())::int, extract(month FROM now())::int, t.recorrencia_dia),
         'pendente', true, t.recorrencia_dia
  FROM (
    SELECT DISTINCT ON (contabilidade_id, empresa_cliente_id) *
    FROM honorarios
    WHERE recorrente = true AND contabilidade_id IS NOT NULL AND empresa_cliente_id IS NOT NULL
    ORDER BY contabilidade_id, empresa_cliente_id, mes_referencia DESC
  ) t
  JOIN contabilidades ct ON ct.id = t.contabilidade_id AND ct.status = 'aprovada'
  WHERE t.mes_referencia < date_trunc('month', now())::date
  ON CONFLICT (contabilidade_id, empresa_cliente_id, mes_referencia) WHERE recorrente DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.gerar_honorarios_recorrentes() FROM public;
```

Nota: `ON CONFLICT` com índice parcial usa a sintaxe `ON CONFLICT (cols) WHERE recorrente` — se o Postgres da instância rejeitar, trocar por `ON CONFLICT DO NOTHING` simples (o índice único ainda garante a idempotência via erro suprimido... não suprime: usar então `WHERE NOT EXISTS (...)` no SELECT). Implementar com `WHERE NOT EXISTS` se necessário e anotar no PR.

- [ ] **Step 2: Aplicar e verificar** — Run: `SELECT * FROM public.painel_contador(); SELECT public.gerar_honorarios_recorrentes();` Expected: 0 linhas / 0.

- [ ] **Step 3: Commit**

```bash
git add app/supabase/migrations/0034_rpcs_contador.sql
git commit -m "feat(db): RPCs painel_contador, resumo, aceitar_convite, vincular por link, cron honorarios"
```

---

### Task 6: Tipos TS + Zod + helpers de dinheiro

**Files:**
- Modify: `app/src/types/database.ts` (adicionar tipos das tabelas novas ao padrão existente do arquivo)
- Modify: `app/src/types/zod.ts`
- Create: `app/src/lib/format/dinheiro.ts`
- Test: `app/src/lib/format/dinheiro.test.ts`

- [ ] **Step 1: Teste falhando de dinheiro**

```ts
// app/src/lib/format/dinheiro.test.ts
import { describe, it, expect } from 'vitest';
import { valorToCentavos, centavosToValor, formatBRL } from './dinheiro';

describe('dinheiro', () => {
  it('valorToCentavos evita float (199.9 → 19990)', () => {
    expect(valorToCentavos('199.90')).toBe(19990);
    expect(valorToCentavos('0.1')).toBe(10);
    expect(valorToCentavos(1234.56)).toBe(123456);
  });
  it('centavosToValor round-trip', () => {
    expect(centavosToValor(19990)).toBe('199.90');
  });
  it('formatBRL', () => {
    expect(formatBRL(19990)).toBe('R$ 199,90');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — Run: `cd app && npx vitest run src/lib/format/dinheiro.test.ts` — Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

```ts
// app/src/lib/format/dinheiro.ts
// Dinheiro trafega como string decimal (numeric do Postgres) e é manipulado em centavos int.
export function valorToCentavos(v: string | number): number {
  const s = typeof v === 'number' ? v.toFixed(2) : v;
  const [int, frac = ''] = s.replace(',', '.').split('.');
  return parseInt(int, 10) * 100 + parseInt((frac + '00').slice(0, 2), 10) * (s.startsWith('-') ? -1 : 1);
}
export function centavosToValor(c: number): string {
  const sign = c < 0 ? '-' : '';
  const abs = Math.abs(c);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
export function formatBRL(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
```

- [ ] **Step 4: Rodar e ver passar** — Run: `npx vitest run src/lib/format/dinheiro.test.ts` — Expected: PASS (ajustar o esperado do NBSP se o runtime formatar diferente — validar com o output real).

- [ ] **Step 5: Zod + types** — Em `app/src/types/zod.ts` adicionar (seguindo o estilo dos schemas existentes):

```ts
export const ContabilidadeSchema = z.object({
  nome: z.string().min(2, 'Informe o nome do escritório.'),
  cnpj: z.string().refine(isValidCnpj, 'CNPJ inválido.'),
  crc: z.string().min(3, 'Informe o registro CRC.'),
  crc_uf: z.string().length(2, 'UF do CRC inválida.'),
});
export const ContabilidadeBrandingSchema = z.object({
  nome: z.string().min(2),
  whatsapp_suporte: z.string().regex(/^\+?\d{10,15}$/, 'WhatsApp inválido (use DDD+número).').optional().or(z.literal('')),
  email_remetente_nome: z.string().max(80).optional().or(z.literal('')),
});
export const HonorarioV2Schema = z.object({
  empresa_cliente_id: z.string().uuid('Selecione o cliente.'),
  valor: z.string().regex(/^\d+([.,]\d{1,2})?$/, 'Valor inválido.'),
  mes_referencia: z.string().regex(/^\d{4}-\d{2}$/, 'Competência inválida.'), // YYYY-MM
  data_vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  observacao: z.string().max(500).optional().or(z.literal('')),
  recorrente: z.boolean().default(false),
  recorrencia_dia: z.coerce.number().int().min(1).max(28).optional(),
}).refine((h) => !h.recorrente || h.recorrencia_dia != null,
  { message: 'Informe o dia da recorrência (1–28).' });
```

(import `isValidCnpj` de `@/lib/validators/cnpj`.) Em `types/database.ts`, adicionar os tipos `Contabilidade`, `ContabilidadeMembro`, `Convite`, `ParametroFiscal` e estender `Honorario` com os campos novos, no formato já usado pelo arquivo.

- [ ] **Step 6: Typecheck + commit**

```bash
cd app && npm run typecheck
git add src/types/zod.ts src/types/database.ts src/lib/format/dinheiro.ts src/lib/format/dinheiro.test.ts
git commit -m "feat(types): schemas contabilidade/honorario v2 + helpers de centavos"
```

---

### Task 7: `lib/fiscal/semaforo.ts` — classificação testada por norma (TDD)

**Files:**
- Create: `app/src/lib/fiscal/semaforo.ts`
- Test: `app/src/lib/fiscal/semaforo.test.ts`

- [ ] **Step 1: Teste falhando (1 caso por norma + combinações)**

```ts
// app/src/lib/fiscal/semaforo.test.ts
import { describe, it, expect } from 'vitest';
import { classificarSemaforo, type FatosCliente } from './semaforo';

const LIMITES = { mei: 81000, simples: 4800000 };
const HOJE = new Date('2026-07-15T12:00:00-03:00');
const base: FatosCliente = {
  regimeCode: '1', dasVencidos: 0, pgdasMesAnteriorTransmitida: true,
  dasnAnoAnteriorTransmitida: true, faturamentoAno: 0, certNotAfter: null,
};

describe('classificarSemaforo', () => {
  it('verde quando nada pendente', () => {
    expect(classificarSemaforo(base, LIMITES, HOJE).cor).toBe('verde');
  });
  it('🔴 DAS vencido (LC 123/2006, art. 21)', () => {
    const r = classificarSemaforo({ ...base, dasVencidos: 2 }, LIMITES, HOJE);
    expect(r.cor).toBe('vermelho');
    expect(r.motivos[0].norma).toContain('art. 21');
  });
  it('🔴 PGDAS-D do mês anterior ausente (Res. CGSN 140/2018, art. 38) — só Simples', () => {
    const r = classificarSemaforo({ ...base, pgdasMesAnteriorTransmitida: false }, LIMITES, HOJE);
    expect(r.cor).toBe('vermelho');
    expect(r.motivos[0].norma).toContain('art. 38');
  });
  it('MEI não é cobrado por PGDAS-D', () => {
    const r = classificarSemaforo({ ...base, regimeCode: '4', pgdasMesAnteriorTransmitida: false,
      dasnAnoAnteriorTransmitida: true }, LIMITES, HOJE);
    expect(r.cor).toBe('verde');
  });
  it('🔴 DASN-SIMEI pendente após 31/05 (Res. CGSN 140/2018, art. 109) — só MEI', () => {
    const r = classificarSemaforo({ ...base, regimeCode: '4', dasnAnoAnteriorTransmitida: false }, LIMITES, HOJE);
    expect(r.cor).toBe('vermelho');
    expect(r.motivos[0].norma).toContain('art. 109');
  });
  it('DASN pendente ANTES de 31/05 não marca (prazo aberto)', () => {
    const r = classificarSemaforo({ ...base, regimeCode: '4', dasnAnoAnteriorTransmitida: false },
      LIMITES, new Date('2026-03-10T12:00:00-03:00'));
    expect(r.cor).toBe('verde');
  });
  it('🟡 faturamento ≥ 80% do limite (LC 123/2006, arts. 3º/18-A)', () => {
    const r = classificarSemaforo({ ...base, regimeCode: '4', faturamentoAno: 65000 }, LIMITES, HOJE);
    expect(r.cor).toBe('amarelo');
  });
  it('regime 3 (normal) não tem teto', () => {
    const r = classificarSemaforo({ ...base, regimeCode: '3', faturamentoAno: 99_000_000 }, LIMITES, HOJE);
    expect(r.cor).toBe('verde');
  });
  it('🟡 certificado A1 vence em < 30 dias', () => {
    const r = classificarSemaforo({ ...base, certNotAfter: '2026-08-01T00:00:00Z' }, LIMITES, HOJE);
    expect(r.cor).toBe('amarelo');
  });
  it('vermelho vence amarelo e acumula motivos', () => {
    const r = classificarSemaforo({ ...base, dasVencidos: 1, faturamentoAno: 4_000_000 }, LIMITES, HOJE);
    expect(r.cor).toBe('vermelho');
    expect(r.motivos.length).toBe(2);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — Run: `npx vitest run src/lib/fiscal/semaforo.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implementar**

```ts
// app/src/lib/fiscal/semaforo.ts
// Única fonte da regra "cliente irregular" (spec Bloco A). Textos em pt simples + norma (didático).
export type RegimeCode = '1' | '2' | '3' | '4';
export type FatosCliente = {
  regimeCode: RegimeCode | null;
  dasVencidos: number;
  pgdasMesAnteriorTransmitida: boolean;
  dasnAnoAnteriorTransmitida: boolean;
  faturamentoAno: number;
  certNotAfter: string | null;
};
export type Motivo = { texto: string; norma: string };
export type Semaforo = { cor: 'vermelho' | 'amarelo' | 'verde'; motivos: Motivo[] };

const DIA_MS = 86_400_000;

export function classificarSemaforo(
  f: FatosCliente,
  limites: { mei: number; simples: number },
  hoje: Date = new Date(),
): Semaforo {
  const vermelhos: Motivo[] = [];
  const amarelos: Motivo[] = [];
  const isMei = f.regimeCode === '4';
  const isSimples = f.regimeCode === '1' || f.regimeCode === '2';

  if (f.dasVencidos > 0) vermelhos.push({
    texto: `${f.dasVencidos} guia(s) DAS vencida(s) sem pagamento registrado.`,
    norma: 'LC 123/2006, art. 21',
  });
  if (isSimples && !f.pgdasMesAnteriorTransmitida) vermelhos.push({
    texto: 'A declaração mensal (PGDAS-D) do mês passado ainda não foi transmitida — o prazo é o dia 20.',
    norma: 'Res. CGSN 140/2018, art. 38',
  });
  const aposPrazoDasn = hoje.getMonth() + 1 > 5; // após 31/05
  if (isMei && aposPrazoDasn && !f.dasnAnoAnteriorTransmitida) vermelhos.push({
    texto: 'A declaração anual do MEI (DASN-SIMEI) do ano passado não foi entregue — o prazo era 31/05.',
    norma: 'Res. CGSN 140/2018, art. 109',
  });

  const limite = isMei ? limites.mei : isSimples ? limites.simples : null;
  if (limite && f.faturamentoAno >= limite * 0.8) amarelos.push({
    texto: `Faturamento do ano já usou ${Math.round((f.faturamentoAno / limite) * 100)}% do limite do regime.`,
    norma: isMei ? 'LC 123/2006, art. 18-A, §1º' : 'LC 123/2006, art. 3º, II',
  });
  if (f.certNotAfter) {
    const dias = Math.floor((new Date(f.certNotAfter).getTime() - hoje.getTime()) / DIA_MS);
    if (dias < 30) amarelos.push({
      texto: dias < 0 ? 'Certificado digital A1 vencido — a emissão de notas para.'
        : `Certificado digital A1 vence em ${dias} dia(s).`,
      norma: 'exigência de emissão (ICP-Brasil, MP 2.200-2/2001)',
    });
  }

  if (vermelhos.length) return { cor: 'vermelho', motivos: [...vermelhos, ...amarelos] };
  if (amarelos.length) return { cor: 'amarelo', motivos: amarelos };
  return { cor: 'verde', motivos: [] };
}
```

- [ ] **Step 4: Rodar e ver passar** — Run: `npx vitest run src/lib/fiscal/semaforo.test.ts` — Expected: PASS (10 testes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/fiscal/semaforo.ts src/lib/fiscal/semaforo.test.ts
git commit -m "feat(fiscal): semaforo de irregularidade com norma por criterio (TDD)"
```

---

### Task 8: Parâmetros fiscais lidos do banco (limites deixam de ser hard-coded)

**Files:**
- Create: `app/src/lib/fiscal/parametros.ts`
- Modify: `app/src/lib/fiscal/limite-emissao.ts:11-12` (constantes viram fallback)
- Test: `app/src/lib/fiscal/limite-emissao.test.ts` (existente — manter verde)

- [ ] **Step 1: Implementar o loader**

```ts
// app/src/lib/fiscal/parametros.ts
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

export type LimitesFiscais = { mei: number; simples: number };
export const LIMITES_FALLBACK: LimitesFiscais = { mei: 81000, simples: 4800000 }; // LC 123/2006

/** Lê os tetos vigentes de parametros_fiscais (maior vigencia_inicio <= hoje). */
export async function getLimitesFiscais(supabase: SupabaseClient): Promise<LimitesFiscais> {
  const { data } = await supabase
    .from('parametros_fiscais')
    .select('chave, valor, vigencia_inicio')
    .in('chave', ['limite_mei', 'limite_simples'])
    .lte('vigencia_inicio', new Date().toISOString().slice(0, 10))
    .order('vigencia_inicio', { ascending: false });
  const pick = (k: string) => Number(data?.find((r) => r.chave === k)?.valor);
  return {
    mei: pick('limite_mei') || LIMITES_FALLBACK.mei,
    simples: pick('limite_simples') || LIMITES_FALLBACK.simples,
  };
}
```

- [ ] **Step 2: Parametrizar `limite-emissao.ts`** — trocar as constantes por parâmetro opcional, preservando a assinatura usada hoje (testes existentes continuam passando):

```ts
// em limite-emissao.ts — substituir os usos diretos de LIMITE_MEI/LIMITE_SIMPLES:
export function limitePorRegime(code: string, limites = { mei: LIMITE_MEI, simples: LIMITE_SIMPLES }) {
  // '4' → limites.mei ; '1'|'2' → limites.simples ; '3' → null (mesma lógica atual)
}
export function calcularLimiteEmissao(code: string, total: number, ano: number,
  limites?: { mei: number; simples: number }) { /* repassa limites */ }
```

E no chamador (`app/src/app/(auth)/notas_fiscais/page.tsx` ~l.67-88): buscar `getLimitesFiscais(supabase)` junto das queries existentes e passar para `calcularLimiteEmissao`.

- [ ] **Step 3: Verificar** — Run: `npx vitest run src/lib/fiscal/limite-emissao.test.ts && npm run typecheck` — Expected: PASS (testes existentes intactos — usam o default).

- [ ] **Step 4: Commit**

```bash
git add src/lib/fiscal/parametros.ts src/lib/fiscal/limite-emissao.ts "src/app/(auth)/notas_fiscais/page.tsx"
git commit -m "feat(fiscal): tetos lidos de parametros_fiscais com fallback (nunca hard-coded)"
```

---

### Task 9: Guards do contador + client de e-mail

**Files:**
- Create: `app/src/lib/contador/guards.ts`
- Create: `app/src/lib/clients/email.ts`

- [ ] **Step 1: Guards**

```ts
// app/src/lib/contador/guards.ts
import 'server-only';
import { createServerClient } from '@/lib/supabase/server';

export type ContabilidadeCtx = {
  userId: string;
  contabilidade: { id: string; nome: string; status: 'pendente' | 'aprovada' | 'suspensa';
    logo_url: string | null; whatsapp_suporte: string | null; email_remetente_nome: string | null } | null;
};

/** Contexto do usuário logado + sua contabilidade (null se não é membro de nenhuma). */
export async function getContabilidadeCtx(): Promise<ContabilidadeCtx | { error: string }> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Sessão inválida.' };
  const { data } = await supabase
    .from('contabilidade_membros')
    .select('contabilidade_id, contabilidades ( id, nome, status, logo_url, whatsapp_suporte, email_remetente_nome )')
    .eq('user_id', user.id)
    .maybeSingle();
  const c = (data?.contabilidades ?? null) as ContabilidadeCtx['contabilidade'];
  return { userId: user.id, contabilidade: c };
}
```

- [ ] **Step 2: E-mail (Resend HTTP, sem SDK)**

```ts
// app/src/lib/clients/email.ts
import 'server-only';

/** Envia e-mail transacional via Resend. Sem RESEND_API_KEY → no-op logado (dev não trava). */
export async function sendEmail(opts: { to: string; subject: string; html: string; fromName?: string }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM; // ex.: "Balu <noreply@balu.app>"
  if (!key || !from) {
    console.warn('[email] RESEND_API_KEY/EMAIL_FROM ausentes — e-mail NÃO enviado:', opts.subject, '→', opts.to);
    return { ok: false as const, skipped: true as const };
  }
  const fromFinal = opts.fromName ? `${opts.fromName} <${from.replace(/^.*</, '').replace('>', '')}>` : from;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: fromFinal, to: [opts.to], subject: opts.subject, html: opts.html }),
  });
  if (!res.ok) console.error('[email] falha Resend', res.status, await res.text().catch(() => ''));
  return { ok: res.ok as boolean };
}
```

Adicionar ao `app/.env.example`: `RESEND_API_KEY=` e `EMAIL_FROM="Balu <noreply@exemplo.com>"` com comentário "e-mails de convite/aprovação (Bloco A)".

- [ ] **Step 3: Typecheck + commit**

```bash
npm run typecheck
git add src/lib/contador/guards.ts src/lib/clients/email.ts .env.example
git commit -m "feat(contador): guards de contexto + client de email transacional"
```

---

### Task 10: Cadastro da contabilidade + tela de espera

**Files:**
- Create: `app/src/app/(auth)/contador/cadastro/page.tsx`
- Create: `app/src/app/(auth)/contador/cadastro/ContabilidadeForm.tsx`
- Create: `app/src/app/(auth)/contador/actions.ts`
- Create: `app/src/app/(auth)/contador/aguardando/page.tsx`

- [ ] **Step 1: Action** (em `contador/actions.ts`, padrão `ActionResult` existente)

```ts
'use server';
import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { ContabilidadeSchema } from '@/types/zod';
import type { ActionResult } from '@/app/(auth)/clientes/actions';

export async function criarContabilidadeAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão inválida.' };
  const parsed = ContabilidadeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos.' };

  const admin = createAdminClient();
  // 1 usuário = 1 contabilidade no lançamento
  const { data: jaMembro } = await admin.from('contabilidade_membros')
    .select('contabilidade_id').eq('user_id', user.id).maybeSingle();
  if (jaMembro) return { ok: false, error: 'Você já faz parte de um escritório.' };

  const { data: cont, error } = await admin.from('contabilidades')
    .insert({ ...parsed.data, status: 'pendente' }).select('id').single();
  if (error) return { ok: false, error: error.message };
  const { error: e2 } = await admin.from('contabilidade_membros')
    .insert({ contabilidade_id: cont.id, user_id: user.id });
  if (e2) return { ok: false, error: e2.message };
  revalidatePath('/contador');
  return { ok: true, data: { id: cont.id } };
}
```

- [ ] **Step 2: Páginas** — `cadastro/page.tsx` (RSC): usa `getContabilidadeCtx()`; se já tem contabilidade → redirect (`aprovada` → `/contador`; senão → `/contador/aguardando`). Renderiza `ContabilidadeForm` (client): campos nome, CNPJ (com `formatCnpj` de `@/lib/format/masks`), CRC, UF (select com as 27 UFs), submit → `criarContabilidadeAction` → `router.push('/contador/aguardando')`. `aguardando/page.tsx` (RSC): guard (sem contabilidade → redirect `/contador/cadastro`; aprovada → `/contador`); card didático: título "Cadastro em análise", texto "Validamos o registro CRC de cada escritório antes de liberar o acesso — é uma exigência da profissão contábil (DL 9.295/46). Você recebe um e-mail assim que aprovarmos." Estilo: mesmos tokens (`bg-card`, `font-head` etc.).

- [ ] **Step 3: Verificar manualmente** — Run: `npm run dev`; logar com user de papel Contador; acessar `/contador/cadastro`, criar, conferir linha em `contabilidades` (status pendente) e redirect para aguardando.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(auth)/contador"
git commit -m "feat(contador): cadastro da contabilidade com aprovacao pendente + tela de espera"
```

---

### Task 11: Admin — aprovação de escritórios

**Files:**
- Create: `app/src/app/(auth)/admin/contabilidades/page.tsx`
- Create: `app/src/app/(auth)/admin/contabilidades/actions.ts`
- Create: `app/src/app/(auth)/admin/contabilidades/AprovacaoList.tsx`
- Modify: `app/src/components/MenuLateral.tsx` (item Admin) e `app/src/app/(auth)/layout.tsx` (role `adminbalu`)

- [ ] **Step 1: Guard + actions**

```ts
// admin/contabilidades/actions.ts
'use server';
import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/clients/email';
import type { ActionResult } from '@/app/(auth)/clientes/actions';

async function requireAdminBalu(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Sessão inválida.' };
  const { data: role } = await supabase.from('role_types')
    .select('type').eq('user_id', user.id).maybeSingle();
  if (role?.type !== 'AdminBalu') return { error: 'Acesso restrito.' };
  return { userId: user.id };
}

export async function decidirContabilidadeAction(
  id: string, decisao: 'aprovada' | 'suspensa',
): Promise<ActionResult> {
  const ctx = await requireAdminBalu();
  if ('error' in ctx) return { ok: false, error: ctx.error };
  const admin = createAdminClient();
  const { error } = await admin.from('contabilidades')
    .update(decisao === 'aprovada'
      ? { status: 'aprovada', aprovada_em: new Date().toISOString(), aprovada_por: ctx.userId }
      : { status: 'suspensa' })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  // avisa o(s) membro(s) por e-mail
  const { data: membros } = await admin.from('contabilidade_membros').select('user_id').eq('contabilidade_id', id);
  for (const m of membros ?? []) {
    const { data: u } = await admin.auth.admin.getUserById(m.user_id);
    if (u?.user?.email) await sendEmail({
      to: u.user.email,
      subject: decisao === 'aprovada' ? 'Seu escritório foi aprovado no Balu 🎉' : 'Cadastro do escritório no Balu',
      html: decisao === 'aprovada'
        ? '<p>Seu escritório foi aprovado. Acesse o painel do contador para começar.</p>'
        : '<p>Seu cadastro não foi aprovado neste momento. Responda este e-mail para falar com a gente.</p>',
    });
  }
  revalidatePath('/admin/contabilidades');
  return { ok: true };
}
```

- [ ] **Step 2: Página** — `page.tsx` (RSC): mesma checagem `role_types.type === 'AdminBalu'` senão `redirect('/')`; lista via admin client: `contabilidades` order `status` (pendentes primeiro) com nome, cnpj (`formatCnpj`), crc/uf, status, created_at; `AprovacaoList` (client) com botões Aprovar / Recusar → `decidirContabilidadeAction` + `useToast`.

- [ ] **Step 3: Menu + layout** — `(auth)/layout.tsx`: o normalize atual (`toLowerCase`) já produzirá `'adminbalu'`; ampliar o tipo do `userRole` para `'empresa' | 'contador' | 'adminbalu'` aqui e no `MenuLateral`. No `MenuLateral.NAV` adicionar `{ href: '/admin/contabilidades', label: 'Admin', Icon: ShieldCheck, roles: ['adminbalu'] }` (import `ShieldCheck` de `lucide-react`). Atenção: usuários AdminBalu sem empresa cairiam no `redirect('/onboarding')` do layout — condicionar: `if (!profile?.current_company && normalizedRole !== 'adminbalu') redirect('/onboarding')`.

- [ ] **Step 4: Conceder papel ao time (documentar no PR, rodar no SQL Editor)**

```sql
UPDATE public.role_types SET type = 'AdminBalu' WHERE user_id = '<uuid-do-michel>';
```

- [ ] **Step 5: Verificar manualmente** — aprovar a contabilidade criada na Task 10; conferir `status='aprovada'` e (sem RESEND_API_KEY) o `console.warn` do e-mail.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(auth)/admin" src/components/MenuLateral.tsx "src/app/(auth)/layout.tsx"
git commit -m "feat(admin): aprovacao de contabilidades (papel AdminBalu)"
```

---

### Task 12: Convites — actions, páginas públicas e integração com onboarding

**Files:**
- Create: `app/src/app/(auth)/contador/convites-actions.ts`
- Create: `app/src/app/(public)/convite/[token]/page.tsx` + `AceiteConvite.tsx`
- Create: `app/src/app/(public)/r/[token]/route.ts`
- Modify: `app/src/app/(auth)/onboarding/actions.ts` (`createCompanyAction` lê cookie do link)
- Modify: `app/src/app/(public)/cadastro/page.tsx` (banner "entrando pelo escritório X")

- [ ] **Step 1: Actions de convite**

```ts
// contador/convites-actions.ts
'use server';
import { randomBytes } from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { getContabilidadeCtx } from '@/lib/contador/guards';
import { sendEmail } from '@/lib/clients/email';
import type { ActionResult } from '@/app/(auth)/clientes/actions';

const novoToken = () => randomBytes(24).toString('base64url');
const siteUrl = () => process.env.NEXT_PUBLIC_SITE_URL!;

async function requireEscritorioAprovado() {
  const ctx = await getContabilidadeCtx();
  if ('error' in ctx) return { error: ctx.error };
  if (!ctx.contabilidade) return { error: 'Você não faz parte de um escritório.' };
  if (ctx.contabilidade.status !== 'aprovada') return { error: 'Escritório ainda não aprovado.' };
  return { ctx };
}

export async function convidarClienteAction(
  email: string, companyId: string,
): Promise<ActionResult<{ url: string }>> {
  const g = await requireEscritorioAprovado();
  if ('error' in g) return { ok: false, error: g.error };
  const admin = createAdminClient();
  // empresa precisa ser do escritório e não ter dono ainda
  const { data: comp } = await admin.from('companies')
    .select('id, nome, user_id, contabilidade_id').eq('id', companyId).maybeSingle();
  if (!comp || comp.contabilidade_id !== g.ctx.contabilidade!.id)
    return { ok: false, error: 'Empresa não encontrada na sua carteira.' };
  const token = novoToken();
  const expira = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const { error } = await admin.from('convites').insert({
    contabilidade_id: g.ctx.contabilidade!.id, tipo: 'cliente',
    email, token, company_id: companyId, expira_em: expira,
  });
  if (error) return { ok: false, error: error.message };
  const url = `${siteUrl()}/convite/${token}`;
  await sendEmail({
    to: email,
    fromName: g.ctx.contabilidade!.email_remetente_nome ?? g.ctx.contabilidade!.nome,
    subject: `${g.ctx.contabilidade!.nome} convidou você para o Balu`,
    html: `<p>O escritório <b>${g.ctx.contabilidade!.nome}</b> cadastrou a empresa <b>${comp.nome ?? ''}</b> no Balu.</p>
           <p>Pelo link abaixo você cria seu acesso e assume a empresa. O escritório poderá <b>visualizar</b> suas notas,
           impostos e guias — ele <b>não pode</b> emitir nem alterar nada.</p>
           <p><a href="${url}">${url}</a> (válido por 7 dias)</p>`,
  });
  return { ok: true, data: { url } };
}

export async function gerarLinkEscritorioAction(): Promise<ActionResult<{ url: string }>> {
  const g = await requireEscritorioAprovado();
  if ('error' in g) return { ok: false, error: g.error };
  const admin = createAdminClient();
  const { data: existente } = await admin.from('convites')
    .select('token').eq('contabilidade_id', g.ctx.contabilidade!.id)
    .eq('tipo', 'cliente').is('email', null).is('revogado_em', null).maybeSingle();
  if (existente) return { ok: true, data: { url: `${siteUrl()}/r/${existente.token}` } };
  const token = novoToken();
  const { error } = await admin.from('convites').insert({
    contabilidade_id: g.ctx.contabilidade!.id, tipo: 'cliente', token, email: null, expira_em: null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { url: `${siteUrl()}/r/${token}` } };
}

export async function revogarLinkEscritorioAction(): Promise<ActionResult> {
  const g = await requireEscritorioAprovado();
  if ('error' in g) return { ok: false, error: g.error };
  const admin = createAdminClient();
  const { error } = await admin.from('convites')
    .update({ revogado_em: new Date().toISOString() })
    .eq('contabilidade_id', g.ctx.contabilidade!.id)
    .eq('tipo', 'cliente').is('email', null).is('revogado_em', null);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function convidarMembroAction(email: string): Promise<ActionResult<{ url: string }>> {
  const g = await requireEscritorioAprovado();
  if ('error' in g) return { ok: false, error: g.error };
  const admin = createAdminClient();
  const token = novoToken();
  const { error } = await admin.from('convites').insert({
    contabilidade_id: g.ctx.contabilidade!.id, tipo: 'membro', email, token,
    expira_em: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  });
  if (error) return { ok: false, error: error.message };
  const url = `${siteUrl()}/convite/${token}`;
  await sendEmail({ to: email, subject: `Convite para a equipe de ${g.ctx.contabilidade!.nome} no Balu`,
    html: `<p>Você foi convidado(a) para a equipe do escritório <b>${g.ctx.contabilidade!.nome}</b>.</p><p><a href="${url}">${url}</a> (7 dias)</p>` });
  return { ok: true, data: { url } };
}
```

- [ ] **Step 2: Página de aceite** — `(public)/convite/[token]/page.tsx` (RSC): busca o convite via admin client (`token`), junta nome do escritório e nome da empresa; estados de erro (inexistente/expirado/revogado/usado) → card amigável "peça um novo link ao seu contador". Usuário deslogado → botões "Entrar" / "Criar conta" com `?next=/convite/${token}` (o login/cadastro já suporta redirect? conferir `(public)/login`; se não suportar `next`, adicionar passthrough simples). Logado → `AceiteConvite` (client) com o texto de consentimento (LGPD arts. 7º/9º): lista do que o escritório verá + botão "Aceitar e vincular" → chama action `aceitarConviteAction`:

```ts
// dentro de contador/convites-actions.ts (server), exportar também:
export async function aceitarConviteAction(token: string): Promise<ActionResult<{ companyId: string | null }>> {
  const { createServerClient } = await import('@/lib/supabase/server');
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Faça login para aceitar o convite.' };
  const { data, error } = await supabase.rpc('aceitar_convite', { p_token: token });
  if (error) {
    const msg: Record<string, string> = {
      CONVITE_INVALIDO: 'Convite não encontrado.', CONVITE_REVOGADO: 'Este convite foi cancelado.',
      CONVITE_EXPIRADO: 'Convite expirado — peça um novo ao seu contador.',
      CONVITE_USADO: 'Este convite já foi utilizado.', ESCRITORIO_INATIVO: 'O escritório não está ativo.',
      EMPRESA_JA_TEM_DONO: 'Esta empresa já tem um responsável no Balu.',
    };
    const key = Object.keys(msg).find((k) => error.message.includes(k));
    return { ok: false, error: key ? msg[key] : 'Não foi possível aceitar o convite.' };
  }
  // se veio company: vira empresa ativa do usuário
  const admin = (await import('@/lib/supabase/admin')).createAdminClient();
  const { data: conv } = await admin.from('convites').select('tipo, company_id').eq('token', token).single();
  if (conv?.tipo === 'cliente' && conv.company_id) {
    await admin.from('profiles').update({ current_company: conv.company_id }).eq('user_id', user.id);
  }
  return { ok: true, data: { companyId: conv?.company_id ?? null } };
}
```

Após sucesso: `router.push(tipo === 'membro' ? '/contador' : '/')`.

- [ ] **Step 3: Link do escritório** — `(public)/r/[token]/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();
  const { data: conv } = await admin.from('convites')
    .select('contabilidade_id, revogado_em, contabilidades ( nome, status )')
    .eq('token', token).eq('tipo', 'cliente').is('email', null).maybeSingle();
  const cont = conv?.contabilidades as { nome: string; status: string } | null;
  const url = new URL('/cadastro', process.env.NEXT_PUBLIC_SITE_URL!);
  if (!conv || conv.revogado_em || cont?.status !== 'aprovada') {
    url.searchParams.set('ref_invalido', '1');
    return NextResponse.redirect(url);
  }
  url.searchParams.set('escritorio', cont.nome);
  const res = NextResponse.redirect(url);
  res.cookies.set('balu_ref_convite', token, {
    httpOnly: true, secure: true, sameSite: 'lax', maxAge: 7 * 86_400, path: '/' });
  return res;
}
```

- [ ] **Step 4: Integração no cadastro/onboarding** — `(public)/cadastro/page.tsx`: se `searchParams.escritorio`, banner informativo: "Você está entrando pelo escritório **X**. Depois de criar sua empresa, o escritório poderá **visualizar** suas notas, impostos e guias — ele não pode emitir nem alterar nada. Você pode desvincular quando quiser em Configurações." Em `onboarding/actions.ts` → `createCompanyAction`: após criar a company, ler `cookies().get('balu_ref_convite')`; se presente, chamar `supabase.rpc('vincular_empresa_por_link', { p_token, p_company_id })` (client autenticado — a RPC valida tudo) e apagar o cookie; falha na RPC não bloqueia a criação (empresa fica solta; logar warn).

- [ ] **Step 5: Verificar manualmente** — fluxo A: contador (aprovado) cria convite dirigido no banco via action (UI vem na Task 15) e aceita com outro usuário; fluxo B: abrir `/r/<token>`, cadastrar, criar empresa e conferir `contabilidade_id` preenchido.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(auth)/contador/convites-actions.ts" "src/app/(public)/convite" "src/app/(public)/r" "src/app/(auth)/onboarding/actions.ts" "src/app/(public)/cadastro/page.tsx"
git commit -m "feat(convites): convite dirigido + link do escritorio + aceite com consentimento"
```

---

### Task 13: Painel do Contador (`/contador`)

**Files:**
- Create: `app/src/app/(auth)/contador/page.tsx`
- Create: `app/src/app/(auth)/contador/PainelClientes.tsx`
- Modify: `app/src/components/MenuLateral.tsx` (seção Escritório)
- Modify: `app/src/app/(auth)/layout.tsx` (passar `escritorio` ao menu)

- [ ] **Step 1: Página (RSC)**

```tsx
// (auth)/contador/page.tsx
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { getContabilidadeCtx } from '@/lib/contador/guards';
import { getLimitesFiscais } from '@/lib/fiscal/parametros';
import { classificarSemaforo, type FatosCliente } from '@/lib/fiscal/semaforo';
import PainelClientes from './PainelClientes';

export default async function ContadorPage() {
  const ctx = await getContabilidadeCtx();
  if ('error' in ctx) redirect('/login');
  if (!ctx.contabilidade) redirect('/contador/cadastro');
  if (ctx.contabilidade.status === 'pendente') redirect('/contador/aguardando');
  if (ctx.contabilidade.status === 'suspensa') redirect('/contador/aguardando'); // aguardando mostra o status real

  const supabase = await createServerClient();
  const [{ data: linhas }, { data: resumoRows }, limites] = await Promise.all([
    supabase.rpc('painel_contador'),
    supabase.rpc('resumo_escritorio'),
    getLimitesFiscais(supabase),
  ]);
  const resumo = resumoRows?.[0] ?? { total_clientes: 0, honorarios_aberto: 0, honorarios_atrasado: 0 };
  const clientes = (linhas ?? []).map((l: Record<string, unknown>) => {
    const fatos: FatosCliente = {
      regimeCode: (l.regime_code as FatosCliente['regimeCode']) ?? null,
      dasVencidos: Number(l.das_vencidos ?? 0),
      pgdasMesAnteriorTransmitida: Boolean(l.pgdas_mes_anterior_transmitida),
      dasnAnoAnteriorTransmitida: Boolean(l.dasn_ano_anterior_transmitida),
      faturamentoAno: Number(l.faturamento_ano ?? 0),
      certNotAfter: (l.cert_not_after as string) ?? null,
    };
    return { ...l, semaforo: classificarSemaforo(fatos, limites) };
  });
  return <PainelClientes clientes={clientes} resumo={resumo} contabilidade={ctx.contabilidade} />;
}
```

- [ ] **Step 2: `PainelClientes.tsx` (client)** — cards de resumo no padrão `DashboardCard` (total de clientes; nº 🔴; nº 🟡; honorários em aberto e atrasados com `formatBRL`), tabela (padrão visual de `HonorarioList`): colunas Cliente (nome/razão + `formatCnpj`), Regime (badge MEI/Simples/Normal a partir do `regime_code`), Situação (bolinha colorida + texto; clicar expande linha com a lista de `motivos` — `texto` + `norma` em `text-muted-foreground text-xs`), Faturamento 12m, Honorários (aberto/atrasado), badge "convite pendente" quando `convite_pendente`. Filtros: select Situação (todas/vermelho/amarelo/verde) e Regime. Link da linha → `/contador/clientes/${company_id}`. Botão topo "+ Cadastrar cliente" → `/contador/clientes/novo`. Estado vazio didático: "Sua carteira ainda está vazia. Cadastre um cliente ou compartilhe o link do escritório (Configurações do escritório)."

- [ ] **Step 2b: Remover cliente da carteira** (spec: desvínculo pelos dois lados) — em `contador/actions.ts`:

```ts
export async function removerClienteDaCarteiraAction(companyId: string): Promise<ActionResult> {
  const g = await getContabilidadeCtx();
  if ('error' in g || !g.contabilidade) return { ok: false, error: 'Sem escritório.' };
  const admin = createAdminClient();
  const { error } = await admin.from('companies')
    .update({ contabilidade_id: null })
    .eq('id', companyId).eq('contabilidade_id', g.contabilidade.id); // escopado (anti-IDOR)
  revalidatePath('/contador');
  return error ? { ok: false, error: error.message } : { ok: true };
}
```

No `PainelClientes`, menu de linha (⋯) com "Remover da carteira" + `PopupConfirm`: "O escritório deixará de ver os dados deste cliente. Nada é apagado."

- [ ] **Step 3: Menu** — `MenuLateral`: nova prop `temEscritorio: boolean`; adicionar ao NAV `{ href: '/contador', label: 'Escritório', Icon: Briefcase, roles: ['contador'] }` e filtrar também: item `/contador` só aparece se `temEscritorio`. No `(auth)/layout.tsx`: junto do `Promise.all` existente, buscar `contabilidade_membros.select('contabilidade_id').eq('user_id', user.id).maybeSingle()` e passar `temEscritorio={!!membro}`.

- [ ] **Step 4: Verificar** — `npm run dev`, contador aprovado com 1 cliente vinculado (Task 12) vê o painel; conferir semáforo verde e valores zerados; `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(auth)/contador" src/components/MenuLateral.tsx "src/app/(auth)/layout.tsx"
git commit -m "feat(contador): painel com semaforo fiscal, resumo e filtros"
```

---

### Task 14: Drill-down somente-leitura do cliente

**Files:**
- Create: `app/src/app/(auth)/contador/clientes/[companyId]/page.tsx`
- Create: `app/src/app/(auth)/contador/clientes/[companyId]/VisaoCliente.tsx`

- [ ] **Step 1: Página (RSC)** — carrega via `createServerClient()` (RLS do contador garante o escopo — se a empresa não é da carteira, queries voltam vazias → `notFound()`):

```tsx
import { notFound, redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { getContabilidadeCtx } from '@/lib/contador/guards';
import VisaoCliente from './VisaoCliente';

export default async function ClienteDrillDown(
  { params, searchParams }: { params: Promise<{ companyId: string }>;
    searchParams: Promise<{ tab?: string }> },
) {
  const ctx = await getContabilidadeCtx();
  if ('error' in ctx || !ctx.contabilidade || ctx.contabilidade.status !== 'aprovada') redirect('/contador');
  const { companyId } = await params;
  const { tab = 'notas' } = await searchParams;
  const supabase = await createServerClient();
  const { data: empresa } = await supabase.from('companies')
    .select('id, nome, razao_social, cnpj').eq('id', companyId).maybeSingle();
  if (!empresa) notFound();
  const [{ data: notas }, { data: guias }, { data: declaracoes }] = await Promise.all([
    supabase.from('notas_fiscais')
      .select('id, tipo_documento, data_emissao, status, valor_total')
      .eq('company_id', companyId).order('data_emissao', { ascending: false }).limit(50),
    supabase.from('guias_fiscais')
      .select('id, competencia_referencia, data_vencimento, data_pagamento, status')
      .eq('company_id', companyId).is('deleted_at', null)
      .order('data_vencimento', { ascending: false }).limit(24),
    supabase.from('declaracoes_fiscais')
      .select('id, tipo, competencia_referencia, data_transmissao, status')
      .eq('company_id', companyId).order('competencia_referencia', { ascending: false }).limit(24),
  ]);
  return <VisaoCliente empresa={empresa} tab={tab} notas={notas ?? []} guias={guias ?? []} declaracoes={declaracoes ?? []} />;
}
```

- [ ] **Step 2: `VisaoCliente.tsx` (client)** — banner fixo no topo (`bg-primary/10 border border-primary rounded`): "👁 Você está vendo os dados de **{empresa.nome}** em modo leitura." Tabs por `?tab=` (padrão de `/configuracoes`): **Notas** (tipo, data, status, valor `formatBRL(valorToCentavos(...))`), **Guias** (competência, vencimento, pago em, status), **Declarações** (tipo, competência, transmitida em, status). Nenhum botão de ação em lugar nenhum. Link "← Voltar ao painel".

- [ ] **Step 3: Verificar** — abrir cliente vinculado (dados aparecem) e um `companyId` de empresa solta (→ 404). `npm run typecheck`.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(auth)/contador/clientes/[companyId]"
git commit -m "feat(contador): drill-down somente-leitura do cliente (notas/guias/declaracoes)"
```

---

### Task 15: Cadastrar cliente pelo contador + enviar convite

**Files:**
- Create: `app/src/app/(auth)/contador/clientes/novo/page.tsx`
- Create: `app/src/app/(auth)/contador/clientes/novo/NovoClienteFlow.tsx`
- Modify: `app/src/app/(auth)/contador/actions.ts` (nova action)
- Modify: `app/src/components/CreateCompanyDialog.tsx` (prop opcional `submitAction`)

- [ ] **Step 1: Action** (em `contador/actions.ts`):

```ts
export async function criarEmpresaClienteAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const g = await getContabilidadeCtx();
  if ('error' in g) return { ok: false, error: g.error };
  if (!g.contabilidade || g.contabilidade.status !== 'aprovada')
    return { ok: false, error: 'Escritório não aprovado.' };
  const parsed = CompanyCreateSchema.safeParse(input); // mesmo schema do onboarding
  if (!parsed.success) return { ok: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos.' };
  const admin = createAdminClient();
  const { data: comp, error } = await admin.from('companies')
    .insert({ ...parsed.data, user_id: null, contabilidade_id: g.contabilidade.id })
    .select('id').single();
  if (error) return { ok: false, error: error.message };
  // reusa os pós-processos do onboarding (empresa fiscal + Focus + CNAEs) — mesmas funções chamadas
  // por createCompanyAction; extrair de onboarding/actions.ts um helper compartilhado
  // `posProcessarNovaEmpresa(companyId, dados)` se ainda estiverem inline.
  await posProcessarNovaEmpresa(comp.id, parsed.data);
  revalidatePath('/contador');
  return { ok: true, data: { id: comp.id } };
}
```

**Passo obrigatório desta task:** extrair de `onboarding/actions.ts` o trecho pós-insert (`add_company_to_profile` NÃO entra — é só do fluxo dono; `syncEmpresaNaFocus` + `sincronizarCnaesEmpresa` entram) para `posProcessarNovaEmpresa()` exportada e usada pelos dois fluxos (DRY).

- [ ] **Step 2: UI** — `CreateCompanyDialog` ganha prop opcional `submitAction?: (data) => Promise<ActionResult<{id:string}>>` (default: `createCompanyAction` — comportamento atual intocado). `NovoClienteFlow` (client): passo 1 renderiza o dialog com `submitAction={criarEmpresaClienteAction}`; no `onCreated(id)`, passo 2: input de e-mail do cliente + botão "Enviar convite" → `convidarClienteAction(email, id)`; mostra o link gerado (copiável) + aviso "válido por 7 dias"; botão "Pular por enquanto" → volta ao painel (empresa fica como "convite pendente").

- [ ] **Step 3: Verificar** — cadastrar cliente com CNPJ real de teste (busca Focus funciona), conferir empresa no painel com badge convite pendente; `npm run typecheck`.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(auth)/contador" src/components/CreateCompanyDialog.tsx "src/app/(auth)/onboarding/actions.ts"
git commit -m "feat(contador): cadastro de cliente pelo escritorio + convite dirigido"
```

---

### Task 16: Honorários v2 (contador) + visão do empresário

**Files:**
- Create: `app/src/app/(auth)/contador/honorarios/page.tsx` + `HonorariosV2List.tsx` + `HonorarioV2FormDialog.tsx` + `actions.ts`
- Modify: `app/src/app/(auth)/honorarios/page.tsx` (vira visão do empresário + redirect do contador)
- Modify: `app/src/components/MenuLateral.tsx` (item Honorários passa a ser visível para todos)

- [ ] **Step 1: Actions v2** (`contador/honorarios/actions.ts`; padrão idêntico ao `honorarios/actions.ts` atual, com `HonorarioV2Schema`):

```ts
'use server';
// createHonorarioV2Action(input): guard escritório aprovado → valida HonorarioV2Schema →
//   admin.insert({ contabilidade_id, empresa_cliente_id, company_id: empresa_cliente_id, // company_id NOT NULL no schema real
//     mes_referencia: `${input.mes_referencia}-01`, valor: input.valor.replace(',', '.'),
//     data_vencimento, observacao, recorrente, recorrencia_dia, status: 'pendente' })
// marcarPagoV2Action(id, forma_pagamento): update { data_pagamento: hoje, status: 'pago', forma_pagamento }
//   .eq('id', id).eq('contabilidade_id', ctx.id)   ← SEMPRE escopado (anti-IDOR)
// desmarcarPagoV2Action(id): limpa pagamento (correção de engano)
// updateHonorarioV2Action(id, input) e deleteHonorarioV2Action(id): mesmos escopos
```

Escrever as 5 actions completas seguindo o exemplo real de `honorarios/actions.ts` (mesmo tratamento de erro/`revalidatePath('/contador/honorarios')`). `status` derivado na leitura: `pago` se `data_pagamento`; senão `atrasado` se `data_vencimento < hoje`; senão `aberto` — helper puro:

```ts
// app/src/lib/fiscal/status-honorario.ts  (+ teste status-honorario.test.ts com 3 casos)
export function statusHonorario(h: { data_pagamento: string | null; data_vencimento: string }, hoje = new Date()) {
  if (h.data_pagamento) return 'pago' as const;
  return h.data_vencimento < hoje.toISOString().slice(0, 10) ? ('atrasado' as const) : ('aberto' as const);
}
```

- [ ] **Step 2: Página do contador** — `contador/honorarios/page.tsx` (RSC): guard aprovado; query `honorarios` `.eq('contabilidade_id', id).not('empresa_cliente_id', 'is', null)` + join `companies!empresa_cliente_id (nome, cnpj)`, order vencimento desc. Lista (adaptar o layout de `HonorarioList.tsx`): colunas Cliente, Competência (`MM/AAAA`), Valor (`formatBRL`), Vencimento, Status (badge com `statusHonorario`), Recorrente (✓ + dia), ações (Marcar pago com select de forma: PIX/boleto/transferência/dinheiro/outro · Editar · Excluir com `PopupConfirm`). Filtros status/competência + export CSV (mesmo padrão BOM UTF-8 da lista atual). Form dialog: select de cliente (empresas da carteira), valor, competência (month input), vencimento, checkbox Recorrente + dia 1–28, observação.

- [ ] **Step 3: Visão do empresário** — `(auth)/honorarios/page.tsx`: **substituir** o gate atual (`role !== 'contador' → redirect('/')`) por: se membro de escritório → `redirect('/contador/honorarios')`; senão lista read-only dos honorários da empresa ativa (`.eq('empresa_cliente_id', currentCompany)` — RLS `honorarios_select_empresario` cobre), colunas Competência/Valor/Vencimento/Status + nome do escritório no cabeçalho; estado vazio: "Nenhuma cobrança do seu escritório por aqui ainda." No `MenuLateral`, remover `roles: ['contador']` do item Honorários.

- [ ] **Step 4: Testes + verificação** — Run: `npx vitest run src/lib/fiscal/status-honorario.test.ts` (PASS); manual: criar honorário recorrente, marcar pago, ver como empresário vinculado.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(auth)/contador/honorarios" "src/app/(auth)/honorarios" src/lib/fiscal/status-honorario.ts src/lib/fiscal/status-honorario.test.ts src/components/MenuLateral.tsx
git commit -m "feat(honorarios): v2 por escritorio com recorrencia + visao read-only do empresario"
```

---

### Task 17: Equipe do escritório

**Files:**
- Create: `app/src/app/(auth)/contador/equipe/page.tsx` + `EquipeClient.tsx`
- Modify: `app/src/app/(auth)/contador/actions.ts` (remover membro)

- [ ] **Step 1: Action de remoção** (em `contador/actions.ts`):

```ts
export async function removerMembroAction(userId: string): Promise<ActionResult> {
  const g = await getContabilidadeCtx();
  if ('error' in g || !g.contabilidade) return { ok: false, error: 'Sem escritório.' };
  const admin = createAdminClient();
  const { count } = await admin.from('contabilidade_membros')
    .select('*', { count: 'exact', head: true }).eq('contabilidade_id', g.contabilidade.id);
  if ((count ?? 0) <= 1) return { ok: false, error: 'O escritório precisa ter ao menos 1 membro.' };
  const { error } = await admin.from('contabilidade_membros').delete()
    .eq('contabilidade_id', g.contabilidade.id).eq('user_id', userId);
  revalidatePath('/contador/equipe');
  return error ? { ok: false, error: error.message } : { ok: true };
}
```

- [ ] **Step 2: Página** — RSC com guard aprovado: lista membros (`contabilidade_membros` + e-mail/nome via `admin.auth.admin.getUserById` por membro — carteiras pequenas, ok no lançamento) e convites de membro pendentes (`convites` tipo membro, não usados/expirados). `EquipeClient`: form "Convidar por e-mail" → `convidarMembroAction`; lista com botão Remover (`PopupConfirm`, desabilitado para si mesmo com dica "peça a outro membro").

- [ ] **Step 3: Verificar + commit**

```bash
git add "src/app/(auth)/contador/equipe" "src/app/(auth)/contador/actions.ts"
git commit -m "feat(contador): gestao de equipe (convite + remocao com guard de ultimo membro)"
```

---

### Task 18: White-label (config do escritório) + co-branding no app do cliente

**Files:**
- Create: `app/src/app/(auth)/contador/configuracoes/page.tsx` + `EscritorioConfigForm.tsx`
- Create: `app/src/app/api/contador/logo/route.ts`
- Modify: `app/src/lib/clients/supabase-storage.ts` (bucket branding + signed URL)
- Modify: `app/src/app/(auth)/layout.tsx` + `app/src/components/MenuLateral.tsx` (co-branding)
- Modify: `app/src/app/(auth)/configuracoes/…` (bloco "Meu escritório" com desvincular — localizar a tab adequada, padrão `GroupCard`)

- [ ] **Step 1: Storage** — em `supabase-storage.ts` adicionar:

```ts
export const BRANDING_BUCKET = 'branding';
export async function uploadLogoEscritorio(contabilidadeId: string, file: Buffer, ext: 'png'|'jpg'|'svg', contentType: string) {
  const path = `${contabilidadeId}/logo.${ext}`;
  // upsert: true (trocar logo substitui)
  await uploadToBucket(BRANDING_BUCKET, path, file, contentType);
  return path;
}
export async function signedUrlBranding(path: string, expiresInSec = 3600): Promise<string | null> {
  const admin = getAdmin(); // client service_role já existente no módulo
  const { data } = await admin.storage.from(BRANDING_BUCKET).createSignedUrl(path, expiresInSec);
  return data?.signedUrl ?? null;
}
```

Criar o bucket (documentar no PR; SQL Editor): `insert into storage.buckets (id, name, public) values ('branding','branding', false) on conflict do nothing;`

- [ ] **Step 2: Upload com validação real (magic bytes)** — `api/contador/logo/route.ts` (POST, FormData):

```ts
// Guard: getContabilidadeCtx() aprovado. Limite 1MB (413 se maior).
// Magic bytes: PNG 89 50 4E 47 · JPEG FF D8 FF · SVG = texto começando com '<svg' ou '<?xml' (após trim/BOM).
// Extensão/contentType derivados DO CONTEÚDO, nunca do nome do arquivo.
// uploadLogoEscritorio(...) → update contabilidades.logo_url = path (client autenticado; GRANT de coluna cobre).
// Resposta: { ok: true, url: signedUrlBranding(path) }
```

Escrever o handler completo com esses passos (validações retornam 400 com mensagem amigável).

- [ ] **Step 3: Config do escritório** — `contador/configuracoes/page.tsx`: form (nome, WhatsApp de suporte com `formatTel`, nome do remetente) → action `salvarBrandingAction` (update via client autenticado — policy + GRANT de colunas garantem; validar com `ContabilidadeBrandingSchema`); upload de logo (preview via signed URL); seção "Link do escritório" (gerar/copiar/revogar — actions da Task 12) com texto didático: "Clientes que se cadastrarem por este link já entram vinculados ao seu escritório."

- [ ] **Step 4: Co-branding** — `(auth)/layout.tsx`: quando a empresa ativa tiver `contabilidade_id` (buscar `companies.contabilidade_id` junto das queries existentes) e a contabilidade estiver `aprovada`, montar `escritorio = { nome, logoUrl: signedUrlBranding(logo_url), whatsapp: whatsapp_suporte }` e passar ao `MenuLateral`. No `MenuLateral`: se `escritorio`, exibir no topo da sidebar o logo (ou `<Logo/>` do Balu se sem logo) + "oferecido por {nome}" (`text-xs text-muted-foreground`), e item "Suporte" (`Icon: MessageCircle`) linkando `https://wa.me/${digits}` (target _blank) quando houver WhatsApp. Rodapé mantém marca Balu. Empresa solta → exatamente como hoje.

- [ ] **Step 5: Desvincular (LGPD art. 18)** — na página de configurações da EMPRESA (`(auth)/configuracoes`, tab de dados da empresa): bloco "Meu escritório" mostrando nome do escritório vinculado + botão "Desvincular escritório" (`PopupConfirm` com texto: "O escritório deixará de ver seus dados imediatamente. Nada é apagado.") → action `desvincularEscritorioAction`: update `companies set contabilidade_id = null` via client autenticado `.eq('id', companyId).eq('user_id', user.id)`.

- [ ] **Step 6: Verificar** — subir logo PNG real (aparece na sidebar do cliente vinculado), arquivo .txt renomeado .png é rejeitado, desvincular remove o co-branding e o cliente some do painel do contador. `npm run typecheck`.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(auth)/contador/configuracoes" src/app/api/contador/logo src/lib/clients/supabase-storage.ts "src/app/(auth)/layout.tsx" src/components/MenuLateral.tsx "src/app/(auth)/configuracoes"
git commit -m "feat(whitelabel): branding do escritorio + co-branding no app do cliente + desvinculo"
```

---

### Task 19: Cron de honorários recorrentes

**Files:**
- Create: `app/src/app/api/cron/honorarios-recorrentes/route.ts`
- Modify: `app/vercel.json`

- [ ] **Step 1: Route handler** (mesmo padrão do `cron/sync-municipios`):

```ts
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET não configurado' }, { status: 500 });
  if ((req.headers.get('authorization') ?? '') !== `Bearer ${secret}`)
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('gerar_honorarios_recorrentes');
  if (error) {
    console.error('[cron honorarios]', error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, gerados: data ?? 0 });
}
```

- [ ] **Step 2: `vercel.json`** (hoje é `{}`):

```json
{
  "crons": [
    { "path": "/api/cron/honorarios-recorrentes", "schedule": "0 9 1 * *" }
  ]
}
```

(09:00 UTC = 06:00 BRT, dia 1. Se o cron do sync-municipios for agendado na Vercel UI, manter como está — só adicionar o novo.)

- [ ] **Step 3: Testar idempotência** — Run local: `curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/honorarios-recorrentes` duas vezes. Expected: 1ª `{ok:true, gerados:N}`, 2ª `{ok:true, gerados:0}`.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/cron/honorarios-recorrentes vercel.json
git commit -m "feat(cron): geracao mensal idempotente de honorarios recorrentes"
```

---

### Task 20: Testes de RLS do contador (fronteira de segurança)

**Files:**
- Create: `app/tests/rls-contador.spec.ts`

- [ ] **Step 1: Escrever o teste** (padrão do `rls-isolation.spec.ts` existente: `createClient` direto, admin cria atores descartáveis, teardown completo). Setup no `beforeAll`:

- contador C1 (user) + `contabilidade` CT1 **aprovada** + membro; contador C2 + CT2 aprovada + membro;
- empresário E1 (user) + company X `contabilidade_id = CT1`;
- empresário E2 + company Y solta (`contabilidade_id null`);
- 1 linha em cada tabela filha de X (via admin): `clientes`, `notas_fiscais`, `guias_fiscais`, `declaracoes_fiscais`, `empresas_fiscais` (`empresa_id`), `arquivos_auxiliares` (`unique_id_empresa`), `honorarios` (contabilidade CT1, empresa_cliente X);
- contador C3 + CT3 **pendente** + membro.

Casos (cada um com login `signInWithPassword` do ator + asserts):

```ts
test('contador lê cliente vinculado', ...)          // C1 select companies → contém X; painel_contador() → 1 linha
test('contador NÃO lê empresa solta', ...)          // C1 select companies eq Y.id → 0 linhas
test('contador NÃO lê cliente de outro escritório', ...) // C2 select X → 0; painel_contador() → 0
test('contador NÃO escreve nos dados do cliente', ...)   // C1: update companies X (nome), insert notas_fiscais X,
                                                          // update guias X, delete clientes X → TODOS erro/0 rows
test('membro de contabilidade pendente NÃO lê', ...)      // C3: select companies → 0; painel_contador() → 0
test('empresário NÃO lê contabilidades alheias', ...)     // E2: select contabilidades → 0 linhas
test('empresário lê honorários da própria empresa e NÃO os de outros', ...) // E1 vê 1; E2 vê 0
test('aceitar_convite é idempotente e nega token inválido', ...) // rpc com token fake → erro CONVITE_INVALIDO
```

- [ ] **Step 2: Rodar** — Run: `cd app && npx playwright test tests/rls-contador.spec.ts` — Expected: PASS. Se `contador NÃO escreve` falhar, é política de escrita vazando — **corrigir a migration antes de qualquer outra coisa** (critério de merge da spec).

- [ ] **Step 3: Commit**

```bash
git add tests/rls-contador.spec.ts
git commit -m "test(rls): matriz de isolamento do contador (select-only, cross-tenant, pendente)"
```

---

### Task 21: E2E da jornada + verificação final

**Files:**
- Create: `app/tests/walkthrough-contador.spec.ts`

- [ ] **Step 1: E2E Playwright** (contra build, como os existentes): jornada — signup contador → form contabilidade → tela aguardando → (aprovar via admin client no teste) → painel vazio → cadastrar cliente (mock/CNPJ de teste) → badge convite pendente → aceitar convite com segundo usuário → cliente vê co-branding ("oferecido por") → contador vê semáforo 🟢 → cria honorário recorrente → marca pago → empresário vê honorário pago em `/honorarios` → drill-down do cliente sem nenhum botão de ação (`expect(page.getByRole('button', { name: /emitir|editar|excluir/i })).toHaveCount(0)`).

- [ ] **Step 2: Verificação final completa**

```bash
cd app
npm run typecheck        # zero erros
npx vitest run           # 317 existentes + novos, zero falhas
npm run build            # build limpo
npm run test:e2e         # smoke + walkthrough + rls-isolation + rls-contador + walkthrough-contador
```

Expected: tudo verde. Reportar contagens reais no PR.

- [ ] **Step 3: Commit final**

```bash
git add tests/walkthrough-contador.spec.ts
git commit -m "test(e2e): jornada completa do contador (cadastro -> aprovacao -> carteira -> honorarios)"
```

---

## Riscos conhecidos / decisões de implementação

- **`ALTER TYPE ADD VALUE`** exige commit antes de usar o valor — aplicar a 0030 em duas execuções se necessário.
- **`ON CONFLICT` com índice parcial** (Task 5): fallback `WHERE NOT EXISTS` documentado no próprio SQL.
- **RLS precisa estar ATIVA** nas tabelas antigas para as políticas do contador valerem (verificação na Task 4, Step 3 — bloqueia se `false`).
- **Convite dirigido para e-mail que já tem conta com outra empresa:** o aceite só assume empresas `user_id IS NULL`; usuário existente ganha a empresa nova na lista (o `add_company_to_profile` não roda — a empresa aparece via query do layout que filtra `user_id`; conferir na Task 12 Step 5 que a empresa aceita aparece no switcher; se o switcher filtrar por outra coisa, ajustar a query do layout).
- **E-mails são best-effort** no Bloco A (sem retry/fila — isso é Bloco C); falha de e-mail nunca falha a action (convite fica visível na UI com link copiável).
