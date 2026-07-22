# Spec — Escopo Remanescente do Balu: Design Técnico

> **Data:** 2026-07-22 · **Status:** proposto (revisar antes de writing-plans por item) · **PRD:** `PRD-Remanescente-Balu.md` (mesma pasta).
> Cobre **tudo que falta**, em ordem de importância. Itens buildáveis agora estão em profundidade de implementação; itens travados em credencial externa (🔒) estão em profundidade de design com a dependência explícita.
> **Convenção:** cada item vira sua própria spec-detalhada + plano (writing-plans) quando for executado — este documento é o mapa técnico mestre. Não implementar em lote gigante; um bloco por vez, com testes.

---

## 0. Regras anti-erro de implementação (LER ANTES DE QUALQUER CÓDIGO)

Consolidação das armadilhas reais encontradas nos Blocos A/E. Violar qualquer uma custa retrabalho:

1. **Migrations** são aplicadas por runner `node`+`pg` (lê `SUPABASE_PASSWORD` de `app/.env.local`), **não** por Supabase CLI. Numeração sequencial: a **próxima é 0043**. `ALTER TYPE ... ADD VALUE` não roda na mesma transação de uso posterior — separar. `docs/reference/db_atual.sql` (pré-Bloco A) + migrations 0030–0042 = fonte da verdade do schema.
2. **Fonte da verdade de schema é o BANCO, não os tipos.** `src/types/database.ts` é hand-mirrored e o client Supabase é **untyped** (`Database = any`) — o typecheck **não** pega coluna/relacionamento inexistente. **Sempre verificar nome de coluna/FK no banco** antes de escrever query. Ex.: não existe FK `empresas_fiscais → companies` (usar duas queries, não embed); `arquivos_auxiliares` liga por `company_id` (não `unique_id_empresa`).
3. **FKs para `auth.users` são ON DELETE CASCADE** (todas as 12). **Nunca** `admin.auth.admin.deleteUser` — destrói dados fiscais. Exclusão = anonimizar + banir (padrão do Bloco E).
4. **Competência fiscal é `YYYYMM`** (sem hífen) no banco (`guia.ts/competenciaReferenciaBrt`); DASN usa **ano puro `YYYY`**. Comparar com o formato certo (bug real: `YYYY-MM` nunca casava).
5. **Fuso: datas de calendário fiscal são BRT** (America/Sao_Paulo). Usar `ymdBrt`/`mesBrt` de `src/lib/fiscal/tempo-brt.ts` — nunca `toISOString().slice(0,10)` (UTC erra 1 dia nas ~3h finais do dia).
6. **RLS:** políticas que referenciam a própria tabela ou tabela com RLS recursiva devem passar por **helper `SECURITY DEFINER STABLE`** (padrão `minha_contabilidade()`/`minha_contabilidade_membro()`) — subquery direta causa recursão infinita (42P17). Toda tabela nova de dado de usuário: **RLS on + política escopada** desde o nascimento.
7. **`SECURITY DEFINER` e `current_user`:** dentro de função DEFINER, `current_user` vira o dono (postgres). Para checar o role do chamador PostgREST (authenticated/service_role), usar **SECURITY INVOKER** + `current_user` (padrão do trigger `tg_role_types_protege_admin`).
8. **`ActionResult` é declarado local por arquivo de action** (não cross-import de rota). Mirror o shape exato de cada arquivo (`{ ok:true, data? } | { ok:false, error }`).
9. **Next 15:** `headers()`, `cookies()`, `params` são **async** — sempre `await`. Route files (`route.ts`) **só podem exportar** `GET/POST/...`/`runtime`/`dynamic` — helper extra quebra o typecheck (extrair para módulo irmão, ex.: `webhooks/focus/segredo.ts`).
10. **Segredos:** credenciais em repouso via `cifrarCampo`/`decifrarCampo` (`src/lib/crypto/envelope.ts`, AES-256-GCM, `CERT_ENC_KEY`, prefixo `enc:v1:`). **Nunca** logar valor decifrado nem mandar ao client (UI mostra "configurado"). **Nunca** commitar `.env.local`; `.env.example` com valor vazio.
11. **Webhooks externos:** validar segredo com `timingSafeEqual` + `rate-limit` (`limitar` de `src/lib/security/rate-limit.ts`, chave capada, e-mail normalizado com `chaveEmail`), retornar 200 em rejeição para o provedor não reenfileirar. Focus não tem HMAC; Asaas tem token de webhook.
12. **Crons:** padrão `Bearer ${CRON_SECRET}` no header `authorization` (ver `api/cron/honorarios-recorrentes/route.ts`); agendados em `app/vercel.json`. Idempotência via índice único / `ON CONFLICT`.
13. **E-mail:** `sendEmail({ to, subject, html, fromName? })` (`src/lib/clients/email.ts`, Resend HTTP). Sem `RESEND_API_KEY` → no-op logado (não quebra). **Escapar HTML** de qualquer string do usuário interpolada no corpo (`escapeHtml`).
14. **Best-effort nunca quebra a ação principal:** auditoria, notificação, cifra de fallback, remoção de storage — tudo em `try/catch` que loga e segue.
15. **TDD + verificação real:** teste unitário para lógica pura (Vitest); teste de fronteira RLS/segurança no banco real (Playwright, padrão `rls-contador.spec.ts`, teardown completo). Rodar `npm run typecheck` + `npx vitest run` + `npm run build` antes de commit. Migrations verificadas no banco vivo pós-aplicação.

---

## 1. Arquitetura geral do remanescente

- **Determinístico decide, notificação/IA comunica.** O motor de obrigações (P0.2) reusa o cálculo fiscal existente (`src/lib/fiscal/*`) e as pendências de `guias_fiscais`/`declaracoes_fiscais`. A IA (P2) só explica depois — nunca calcula/transmite.
- **Camadas por item:** migração (schema + funções/RLS) → lib pura (regra testável) → server action/route (I/O + guardas) → UI. Um item por spec-detalhada + plano.
- **Novos crons** seguem `honorarios-recorrentes`. **Novos webhooks** seguem o hardening do Bloco E.

---

## 2. P0.2 — Motor de obrigações e notificações 🟢 (implementation-ready)

O item mais valioso e sem dependência externa. Entrega a promessa "cuidamos dos seus prazos".

### 2.1 Modelo de dados (migration 0043)

```sql
-- 0043: notificações + calendário de obrigações (P0.2).
-- Notificação: mensagem para o titular (in-app + e-mail).
CREATE TABLE IF NOT EXISTS public.notificacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  tipo text NOT NULL,               -- 'das_vence' | 'dasn_prazo' | 'cert_vence' | 'pgdas_pendente' | 'abertura_etapa' | ...
  titulo text NOT NULL,
  corpo text NOT NULL,
  severidade text NOT NULL DEFAULT 'info' CHECK (severidade IN ('info','alerta','critico')),
  alvo_tipo text,                   -- 'guia' | 'declaracao' | 'company' | 'abertura'
  alvo_id uuid,
  competencia text,                 -- 'YYYYMM' | 'YYYY' quando aplicável (idempotência)
  lida_em timestamptz,
  email_enviado_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notificacoes_user_idx ON public.notificacoes(user_id, created_at DESC);
-- Idempotência do cron: 1 notificação por (user, tipo, competencia, alvo).
CREATE UNIQUE INDEX IF NOT EXISTS notificacoes_dedup
  ON public.notificacoes(user_id, tipo, COALESCE(competencia,''), COALESCE(alvo_id,'00000000-0000-0000-0000-000000000000'));

ALTER TABLE public.notificacoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY notif_select_own ON public.notificacoes FOR SELECT USING (user_id = auth.uid());
CREATE POLICY notif_update_own ON public.notificacoes FOR UPDATE   -- só marcar lida
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
GRANT SELECT ON public.notificacoes TO authenticated;
GRANT UPDATE (lida_em) ON public.notificacoes TO authenticated;
GRANT ALL ON public.notificacoes TO service_role;

-- Preferências de opt-out por tipo (LGPD art. 18). Ausência = opt-in (avisos fiscais = legítimo interesse).
CREATE TABLE IF NOT EXISTS public.notificacao_preferencias (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tipo text NOT NULL,
  email_ativo boolean NOT NULL DEFAULT true,
  in_app_ativo boolean NOT NULL DEFAULT true,
  PRIMARY KEY (user_id, tipo)
);
ALTER TABLE public.notificacao_preferencias ENABLE ROW LEVEL SECURITY;
CREATE POLICY pref_all_own ON public.notificacao_preferencias FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notificacao_preferencias TO authenticated;
GRANT ALL ON public.notificacao_preferencias TO service_role;
```

> **Regra 6:** RLS por `auth.uid()` direto (sem recursão — tabela não se referencia). **Regra 2:** conferir que `companies.id`/`guias_fiscais`/`declaracoes_fiscais` têm as colunas usadas pelo gerador antes de escrever o SELECT.

### 2.2 Lib pura — cálculo do calendário (testável)

`src/lib/obrigacoes/calendario.ts` — função **pura** que, dado os fatos de uma empresa (regime, guias em aberto, declarações, `cert_not_after`, data de hoje BRT), devolve a lista de obrigações pendentes com prazo. Espelha a lógica do `semaforo.ts` (mesmas normas), mas orientada a **prazo/aviso**, não a cor.

```ts
// src/lib/obrigacoes/calendario.ts
import { ymdBrt, mesBrt } from '@/lib/fiscal/tempo-brt';
export type Obrigacao = {
  tipo: 'das_vence' | 'dasn_prazo' | 'cert_vence' | 'pgdas_pendente';
  competencia?: string;            // 'YYYYMM' | 'YYYY'
  venceEm: string;                 // 'YYYY-MM-DD' (BRT)
  severidade: 'info' | 'alerta' | 'critico';
  titulo: string;
  corpo: string;
  alvoId?: string;
};
export function calcularObrigacoes(fatos: FatosEmpresa, hoje?: Date): Obrigacao[] { /* determinístico */ }
```

- **Regra 4/5:** competência em `YYYYMM`/`YYYY`; datas em BRT. Testes por norma (Vitest), 1 caso por tipo + fronteiras de prazo (D-7, D-1, vencido; 31/05 do DASN; 20 do DAS).

### 2.3 Cron gerador (migration + rota)

- **RPC `gerar_obrigacoes_do_periodo()`** (SECURITY DEFINER, service_role) **ou** lógica no route handler com admin client — preferir o route handler chamando a lib pura + `sendEmail`, para manter a regra testável em TS (mesma decisão do semáforo no Bloco A).
- `src/app/api/cron/obrigacoes/route.ts` — auth `Bearer ${CRON_SECRET}` (**regra 12**). Para cada empresa ativa: monta fatos, roda `calcularObrigacoes`, faz **upsert idempotente** em `notificacoes` (índice `notificacoes_dedup`), e dispara `sendEmail` para o que vence nas janelas configuradas **respeitando `notificacao_preferencias`**. Marca `email_enviado_em`.
- Agendamento em `app/vercel.json`: diário (ex.: `0 9 * * *` = 06:00 BRT). Idempotente: rodar 2× não duplica (índice único) e não reenvia e-mail (checar `email_enviado_em`).

### 2.4 UI

- **Sino** no `MenuLateral.tsx`: contador de `notificacoes` não-lidas (`lida_em IS NULL`) do usuário; badge. Query leve na RSC do layout (já busca dados lá).
- **Lista** `/(auth)/notificacoes/page.tsx` + `NotificacoesList.tsx` (client): lista, marca lida (action `marcarLidaAction` — update escopado por `auth.uid()` via RLS), link para a entidade-alvo.
- **Dashboard:** estender `getPendingActions` para incluir certificado A1 vencendo (`arquivos_auxiliares.cert_not_after` **existe** — o TODO(cert-a1) do código some).
- **Preferências:** seção em `/conta` para opt-out por tipo.

### 2.5 Critérios de aceite / testes
- Vitest: `calendario.test.ts` (obrigações por norma + fronteiras de prazo + BRT).
- Integração: cron gera notificação para empresa com DAS D-7; rodar 2× não duplica; opt-out suprime e-mail.
- `typecheck` + `build` limpos.

---

## 3. P1.2 — Gestão de etapas de abertura 🟢 (implementation-ready)

### 3.1 Estados
Definir a lista final com o Michel; proposta: `recebido → em_analise → protocolado → deferido → concluido` (+ `pendente_cliente` quando falta doc). Guardar em `companies.processo_etapa` (já existe, hoje fixo em `'recebido'`).

### 3.2 Action
`src/app/(auth)/contador/abertura-actions.ts` (novo) — `avancarEtapaAbertura(companyId, novaEtapa, observacao?)`:
- Guarda: `getContabilidadeCtx()` aprovado **e** a empresa pertence à carteira do escritório (`companies.contabilidade_id = ctx.id`) — **regra 2** (anti-IDOR, escopar por contabilidade).
- Valida transição (não pular estados de forma inválida).
- Update via admin client escopado; registra em `audit_log` (`acao:'abertura.etapa'`).
- Dispara notificação ao dono da empresa (P0.2) na transição.

### 3.3 UI
- Painel do contador: componente de avanço de etapa + timeline + campo observação.
- Cliente: `AberturaInfoView` já exibe; garantir que reflete a etapa nova.

### 3.4 Aceite
RLS impede escritório alheio de alterar (teste de fronteira); transição inválida barrada; notificação disparada; auditoria registrada.

---

## 4. P1.3 — DASN-SIMEI assistida + DEFIS 🟢

### 4.1 DASN-SIMEI assistida
- Builder `montarDasnSimei` **já existe** (`src/lib/fiscal/dasn-simei.ts`, hoje código morto).
- Nova tela em `/(auth)/impostos/dasn/` que: monta o resumo anual a partir dos dados reais (receita do ano-base), **instrui** a transmissão no portal oficial (o Integra Contador não transmite DASN), e permite **registrar** `numero_declaracao`/comprovante em `declaracoes_fiscais` (`tipo='DASN-SIMEI'`, `competencia_referencia=YYYY` — **regra 4**).
- Aviso na fila (P0.2) a partir de janeiro; `tipo='dasn_prazo'`, `competencia='YYYY'`.

### 4.2 DEFIS
- **Decisão pendente (Michel):** lançamento ou V2. No mínimo entra na fila de obrigações (aviso 31/03). Se no lançamento: builder análogo ao DASN + fluxo assistido (mesma estrutura).

### 4.3 Aceite
DASN preparada e comprovante registrável; obrigação anual na fila no período; DEFIS ao menos avisada.

---

## 5. P1.1 — Billing Asaas 🔒 (design; sandbox buildável)

### 5.1 Schema (migration futura)
```sql
-- assinaturas espelha o Asaas (status, ciclo, valor, asaas_subscription_id).
-- cobrancas espelha cada cobrança (status, vencimento, valor, asaas_charge_id, link/pix).
```
Reusar os ganchos `honorarios.asaas_charge_id`/`asaas_customer_id`.

### 5.2 Integração
- `src/lib/clients/asaas.ts`: criar customer/assinatura, consultar cobrança (contra **sandbox** enquanto a prod não chega 🔒).
- **Webhook** `src/app/api/webhooks/asaas/route.ts`: validar token do Asaas com `timingSafeEqual` + `limitar` (**regra 11**), atualizar `assinaturas`/`cobrancas`, 200 sempre.
- **Gate de acesso** por status: helper `assinaturaAtiva(userId)`; inadimplente (após grace period configurável) perde **escrita/emissão** (bloquear nas actions de emissão, como o gate de aceite do Bloco E), **mantém leitura/exportação** (LGPD/CDC — **nunca** bloquear direito do titular).

### 5.3 Dependência 🔒
Credenciais Asaas de produção. Sandbox do Asaas permite construir/testar tudo antes.

---

## 6. P0.1 — Produção fiscal: emissão real 🔒 (design)

### 6.1 Mudança central
Hoje `FocusEnv = 'hom'` é **hard-coded** (`notas_fiscais/actions.ts` e `[id]/download/route.ts`). Tornar o ambiente **por empresa**:
- Fonte do ambiente: coluna em `empresas_fiscais` (ex.: `focus_ambiente 'hom'|'prod'`) **ou** derivar de `FOCUS_NFE_ENV` + flag de habilitação por empresa. Verificar no banco a coluna real antes (**regra 2**).
- Token de produção por empresa (cifrado — **regra 10**).
- **Guarda de habilitação:** só emite em `prod` se a empresa está totalmente habilitada (certificado válido via `cert_not_after`, credenciais municipais NFS-e OK). Senão erro claro.
- Registrar toda emissão de produção em `audit_log`.

### 6.2 Dependência 🔒
Contrato Focus produção; certificados A1 reais dos pilotos; credenciais municipais; procurações. **Preparar o código de "ligar a chave" em paralelo**, testável em homologação, para ativar assim que as credenciais chegarem.

### 6.3 Risco
Não regredir o fluxo de homologação (que segue para testes). Feature-flag por empresa, nunca global.

---

## 7. P0.3 — PGDAS-D transmissão real 🔒 (design)

- Builder existe (`src/lib/fiscal/serpro-pgdasd.ts`) e suporta `indicadorTransmissao:true`; hoje só chamado com `false` (dry-run).
- Nova action `transmitirPgdasdAction`: guarda (procuração + credenciais prod), chama builder com `true`, persiste recibo/`numero_declaracao`/`data_transmissao` em `declaracoes_fiscais` (`tipo='PGDAS-D'`, `competencia_referencia=YYYYMM` — **regra 4**), mapeia erros SERPRO → mensagem amigável, registra em `audit_log`.
- **Retificadora** (art. 39) desde o início: permitir retransmitir corrigindo.
- **Dependência 🔒:** SERPRO produção + procuração RFB por cliente.

---

## 8. P2 / P3 (design-level, pós-lançamento)

- **P2.1 WhatsApp 🔒:** estende P0.2 com canal WhatsApp Business API (`lib/clients/whatsapp.ts`, webhook inbound, templates, consentimento de canal registrado). Guard-rail: determinístico decide, IA só comunica.
- **P2.2 IA 🔒:** `lib/ai/*` com cliente LLM (chave a definir). Casos: explicação da apuração, sugestão de código de serviço LC116, onboarding leigo. **Guard-rail inviolável:** IA nunca calcula/transmite; sempre confirmação do usuário; cálculo é sempre determinístico.
- **P2.3:** `/documentos` (guarda de XML/PDF/comprovantes); conciliação bancária (Open Finance 🔒).
- **P3:** domínio customizado (host-routing no `middleware.ts` + coluna `dominio_custom` + API de domínios Vercel); busca semântica LC116 (pgvector); SLA; Lucro Presumido; eSocial/SPED.

---

## 9. Estratégia de testes (todos os itens)

- **Vitest** para lógica pura (`calendario.ts`, builders, guards de gate).
- **Playwright** para fronteira de segurança (RLS por tenant, anti-IDOR) contra o banco real, com teardown — padrão `rls-contador.spec.ts`.
- **Idempotência** de cron/webhook testada explicitamente (rodar 2×).
- **Gate anti-erro:** `typecheck` 0 · `vitest` verde · `build` limpo · migration verificada no banco vivo, antes de cada commit.

## 10. Ordem de execução (do PRD)

1. **P0.2** (motor de obrigações) → 2. **P1.2** (abertura etapas) → 3. **P1.3** (DASN/DEFIS) → 4. **P1.1** (Asaas sandbox) → 5. **P0.1/P0.3** (produção fiscal, ao chegar credencial) → 6. **P2/P3**.

Cada item, ao ser iniciado, ganha sua própria spec-detalhada (brainstorming) + plano (writing-plans) e execução subagent-driven, como nos Blocos A/E.
