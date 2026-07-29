# Bloco 6B — Canal de WhatsApp (uazapi) · Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para implementar task a task. Os passos usam checkbox (`- [ ]`).

**Goal:** o motor de obrigações do Bloco 1 passa a também avisar por WhatsApp (com opt-in explícito do cliente), e o cliente ganha um atendimento com IA que responde sobre a própria situação fiscal, escalando para o contador quando não resolve.

**Architecture:** tudo aditivo sobre o que já está em produção. Consentimento vira duas colunas em `profiles`; o disparo proativo é um terceiro loop dentro do cron de obrigações que já existe (sem cron novo — o Hobby só permite 2); o atendimento é um webhook novo que reaproveita literalmente `renderizar.ts`/`buscar.ts`/`valores-mei.ts` do Bloco 6A; a uazapi é só gateway de mensagem, então a lógica de conversa é nossa.

**Tech Stack:** Next.js 15 (App Router, Route Handlers), Supabase/Postgres, vitest. Provedor de IA já configurado pelo 6A (`config_ia`, `lib/ai/`). uazapi (API não-oficial de WhatsApp, QR code).

**Spec:** `docs/superpowers/specs/2026-07-29-bloco-6b-whatsapp-design.md`

---

## ⚠️ LEIA ANTES DE COMEÇAR

**Este plano traz código pronto onde o repo real foi lido e conferido — e thin (sem código inventado) onde não há como conferir ainda.** O Bloco 4B ensinou a lição: código pronto que não bate com o repo real custa mais do que instrução honesta. Nesta rodada há **duas fronteiras não sondadas de propósito**: o contrato HTTP da uazapi (não há instância provisionada) e o envelope bruto do SERPRO para o Pix Copia-e-Cola. Em ambas, a primeira tarefa é sondar, não presumir.

Em toda task:

1. **Confira cada import e cada assinatura lendo o código real** antes de usar.
2. **Reporte a divergência** em vez de contorná-la em silêncio.
3. **Não escreva contra documentação** — sonde a API real quando houver como.
4. **Sabotagem como prova:** depois de cada teste passar, quebre a linha que ele protege, veja o teste falhar apontando o lugar certo, e desfaça.

**Fatos já verificados contra o repo e o banco real em 2026-07-29** (não precisa reconferir, mas confie desconfiando):

- Última migration: `0060`. A deste bloco é a **`0061`**.
- `public.profiles` **no banco real** tem hoje exatamente estas colunas:
  `id, user_id, company_id, created_at, updated_at, deleted_at, current_company`
  — **não** as de `0001_init.sql` (`empresa_fiscal_id`, `logo`, `background_color`,
  `user_role`). O schema real diverge das migrations idealizadas (já documentado
  em comentário da própria `0045`). Confirmado por query direta:
  `SELECT column_name FROM information_schema.columns WHERE table_name='profiles'`.
- **O código real usa `profiles.user_id`, não `profiles.id`**, para achar o
  perfil da sessão: `app/src/app/(auth)/(gated)/impostos/page.tsx:41-45` faz
  `.from('profiles').select('current_company').eq('user_id', user.id).single()`.
  A spec do 6B falou em `profiles.id` — **é `profiles.user_id`** o join certo
  contra `notifications.owner_user_id` (que é `auth.users.id` = `user.id` da
  sessão). RLS (`profiles_self`, de `0001`) segue protegendo por `id`, e nas
  linhas reais `id = user_id` sempre bate — não é preciso mexer em RLS.
- `notifications.tipo` tem `CHECK` inline sem nome explícito na `0045` → o nome
  gerado pelo Postgres é `notifications_tipo_check` (convenção `<tabela>_<coluna>_check`).
- A cadeia real que produz a explicação na tela do cliente (Bloco 6A), em
  `CompetenciaAtualCardMei.tsx` + `page.tsx`:
  ```
  atividadeMei  ← empresas_fiscais.atividade_mei  (eq empresa_id=companyId)
  apuracaoAtual ← apuracoes_fiscais (eq company_id, competencia_referencia = competência atual)
  guiaAtual     ← guias_fiscais     (eq company_id, competencia_referencia = competência atual)
  totalExibido  = guiaAtual?.valor_total ?? apuracaoAtual?.valor_imposto ?? null
  valores       = valoresDoDasMei(atividadeMei, totalExibido)     // null se não fechar
  situacao      = situacaoDasMei(atividadeMei)
  explicacao    = await buscarExplicacao(sb, chaveDaSituacao(situacao))
  texto         = renderizar(explicacao.texto, valores)
  ```
  `competenciaReferenciaBrt(new Date())` (`@/lib/fiscal/guia`) dá a competência
  atual (`'202607'`). Este plano **reaproveita esta cadeia inteira**, sem
  reescrevê-la — só monta de novo fora de uma sessão HTTP (Task 3).
- `buscarExplicacao(sb: SupabaseClient, chave: string)` aceita **qualquer**
  client, incluindo o admin client — não exige sessão de usuário.
- `gerarTexto(cfg: ConfigProvedor, prompt: string): Promise<string>` (`lib/ai/cliente.ts`)
  **lança** em qualquer falha, nunca devolve `{ok:false}`.
- `vitest.config.ts` não carrega `.env.local` — a suíte roda sem rede e sem
  segredo, e é assim que tem de continuar.
- Runner de migration: `node app/scratchpad/apply-migration.mjs <caminho.sql>`
  (lê `SUPABASE_PASSWORD` de `app/.env.local`).

---

## Onde este plano é grosso, e onde é fino — de propósito

**Tasks 1, 2, 3 e 7 trazem código completo** — schema, tela, helpers puros e o
probe: eu li o código e o banco reais, e podem ser copiados depois de
conferidos.

**Tasks 4, 5 e 6 são thin.** A 4 (sondagem do Pix) e a 5 (cliente uazapi) tocam
APIs externas que não têm como ser verificadas sem uma guia real emitida e uma
instância uazapi provisionada, respectivamente. A 6 depende da 5 e ainda
precisa de uma sondagem própria (quem é o "contador" de uma empresa — não
verificado nesta rodada). Nessas tasks, **o primeiro passo é sempre sondar e
reportar a forma encontrada antes de escrever qualquer cliente definitivo.**

---

## Ordem e dependências

```
Task 1  migration 0061 — colunas, RPC, tabela, novo tipo de notificação   (independente)
Task 2  tela de opt-in em Conta → Notificações                            ← Task 1
Task 3  situacao-atual-mei.ts + prompt de atendimento                     (independente, reaproveita 6A)
Task 4  sondagem do Pix Copia-e-Cola do SERPRO                            (independente)
Task 5  cliente uazapi + terceiro loop no cron de obrigações              ← Tasks 1, 4
Task 6  webhook de entrada — atendimento + escalação                      ← Tasks 1, 3, 5
Task 7  probe _probe-6b.mjs + verificação final + roteiro do smoke        ← todas
```

---

### Task 1: Migration 0061 — consentimento, disparo e tabela de atendimento

**Files:**
- Create: `app/supabase/migrations/0061_whatsapp.sql`
- Create: `app/scratchpad/apply-0061.mjs` (cópia de `apply-migration.mjs`, ou chame o genérico direto)

- [ ] **Step 1: Confirmar o número e reconferir o schema real de `profiles`**

Run: `cd app && ls supabase/migrations | tail -3`
Expected: `0060_default_execute_fora_do_public.sql` é a última; a nova é `0061`.

Reconfira o schema real de `profiles` com o mesmo método usado para escrever este plano (substitua os placeholders pelo conteúdo real de `.env.local`, sem imprimir a senha em nenhum log):

```bash
cd app && node -e "
const {readFileSync}=require('fs');const pg=require('pg');
const env=Object.fromEntries(readFileSync('.env.local','utf8').split(/\r?\n/).filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^[\"']|[\"']\$/g,'')]}));
const ref=env.NEXT_PUBLIC_SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\./)[1];
(async()=>{const c=new pg.Client({host:'db.'+ref+'.supabase.co',port:5432,user:'postgres',password:env.SUPABASE_PASSWORD,database:'postgres',ssl:{rejectUnauthorized:false}});
await c.connect();
const r=await c.query(\"SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' ORDER BY ordinal_position\");
r.rows.forEach(x=>console.log(x.column_name));
await c.end();})()"
```

Expected: `id, user_id, company_id, created_at, updated_at, deleted_at, current_company`. **Se divergir do que este plano assume, pare e reporte antes de escrever a migration.**

- [ ] **Step 2: Escrever a migration**

Criar `app/supabase/migrations/0061_whatsapp.sql`:

```sql
-- Bloco 6B — canal de WhatsApp (uazapi).
--
-- Tudo aditivo: nenhuma linha do caminho de e-mail (Bloco 1) muda aqui.
-- Consentimento é do NÚMERO, informado pelo próprio cliente — nunca herdado
-- de `companies.telefone`, que é contato genérico e pode estar errado.

-- ------------------------------------------------ consentimento
-- Em profiles.user_id (NÃO profiles.id — ver nota do plano/CHECKPOINT sobre a
-- divergência entre o schema real e o 0001_init.sql idealizado), porque é essa
-- a coluna que o resto do app já usa para achar o perfil da sessão.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS whatsapp_numero text,
  ADD COLUMN IF NOT EXISTS whatsapp_habilitado_em timestamptz;

-- Único: dois usuários não podem reivindicar o mesmo número. Parcial (WHERE
-- NOT NULL) para não travar as linhas que nunca ativaram o canal.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_whatsapp_numero_uidx
  ON public.profiles (whatsapp_numero)
  WHERE whatsapp_numero IS NOT NULL;

-- ------------------------------------------------ disparo proativo
-- Espelha enviada_email_em: NULL até o envio ter sucesso, sem tabela de log
-- separada — mesma idempotência que o Bloco 1 já usa para e-mail.
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS enviada_whatsapp_em timestamptz;

-- Novo tipo, para a escalação de atendimento (Task 6) poder notificar o
-- contador pelo MESMO motor que já materializa DAS a vencer etc.
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_tipo_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_tipo_check CHECK (tipo IN (
  'das_a_vencer','das_vencido','pgdas_pendente','dasn_pendente','defis_pendente',
  'cert_a_vencer','cert_vencido','limite_faturamento','honorario_a_vencer','abertura_etapa',
  'whatsapp_escalado'
));

CREATE OR REPLACE FUNCTION public.notificacoes_pendentes_whatsapp(p_limite int DEFAULT 50)
RETURNS TABLE (
  id uuid, owner_user_id uuid, tipo text, titulo text, corpo text,
  action_href text, whatsapp_numero text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT n.id, n.owner_user_id, n.tipo, n.titulo, n.corpo, n.action_href,
         p.whatsapp_numero
  FROM public.notifications n
  JOIN public.profiles p ON p.user_id = n.owner_user_id
  WHERE n.enviada_whatsapp_em IS NULL
    AND p.whatsapp_numero IS NOT NULL
    AND p.whatsapp_habilitado_em IS NOT NULL
  ORDER BY n.created_at
  LIMIT p_limite;
$$;

-- Mesmo padrão de sempre: sem rede/segredo, service_role só.
REVOKE ALL ON FUNCTION public.notificacoes_pendentes_whatsapp(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notificacoes_pendentes_whatsapp(int) TO service_role;

-- ------------------------------------------------ atendimento (Task 6)
-- Idempotência (o webhook pode reenviar) e auditoria mínima — SEM tela nesta
-- rodada (ver spec §2.3: escalação é notificação, não inbox novo).
CREATE TABLE IF NOT EXISTS public.whatsapp_atendimentos (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id_externo text NOT NULL UNIQUE,
  telefone           text NOT NULL,
  profile_user_id    uuid,
  mensagem_recebida  text NOT NULL,
  resposta_enviada   text,
  resolvido          boolean,
  created_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_atendimentos ENABLE ROW LEVEL SECURITY;
-- Sem policy nenhuma + REVOKE explícito: mesma lição da 0053/0055/0058 — o
-- ALTER DEFAULT PRIVILEGES do Supabase concede tudo em `public` para
-- anon/authenticated, calado, em TODA tabela nova.
REVOKE ALL ON public.whatsapp_atendimentos FROM anon, authenticated;

COMMENT ON TABLE public.whatsapp_atendimentos IS
  'Idempotencia e auditoria do atendimento de WhatsApp. Sem tela nesta rodada — service_role apenas.';
COMMENT ON COLUMN public.profiles.whatsapp_numero IS
  'E.164, informado pelo proprio cliente no opt-in. NUNCA herdar de companies.telefone.';
```

- [ ] **Step 3: Aplicar no banco**

Run: `cd app && node scratchpad/apply-migration.mjs supabase/migrations/0061_whatsapp.sql`
Expected: sem erro.

- [ ] **Step 4: Conferir o efeito, não o SQL**

```bash
cd app && node -e "
const {readFileSync}=require('fs');const pg=require('pg');
const env=Object.fromEntries(readFileSync('.env.local','utf8').split(/\r?\n/).filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^[\"']|[\"']\$/g,'')]}));
const ref=env.NEXT_PUBLIC_SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\./)[1];
(async()=>{const c=new pg.Client({host:'db.'+ref+'.supabase.co',port:5432,user:'postgres',password:env.SUPABASE_PASSWORD,database:'postgres',ssl:{rejectUnauthorized:false}});
await c.connect();
const r=await c.query(\"SELECT table_name,grantee,string_agg(DISTINCT privilege_type,',') p FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='whatsapp_atendimentos' AND grantee IN ('anon','authenticated') GROUP BY 1,2\");
console.log('grants em whatsapp_atendimentos para anon/authenticated:', r.rows);
const r2=await c.query(\"SELECT grantee, has_function_privilege(grantee,'public.notificacoes_pendentes_whatsapp(int)','EXECUTE') ok FROM (VALUES('anon'),('authenticated'),('service_role')) g(grantee)\");
console.log('EXECUTE da RPC:', r2.rows);
await c.end();})()"
```

Expected: **nenhuma linha** para `whatsapp_atendimentos` (sem grant nenhum a `anon`/`authenticated`); `EXECUTE` da RPC `false` para `anon`/`authenticated` e `true` só para `service_role`.

- [ ] **Step 5: Commit**

```bash
git add app/supabase/migrations/0061_whatsapp.sql
git commit -m "feat(6b): migration 0061 - consentimento, disparo e tabela de atendimento do WhatsApp"
```

---

### Task 2: Opt-in de WhatsApp em Conta → Notificações

**Files:**
- Modify: `app/src/app/(auth)/(gated)/conta/PreferenciasNotificacao.tsx`
- Modify: `app/src/app/(auth)/(gated)/conta/actions.ts`
- Create: `app/src/app/(auth)/(gated)/conta/actions.test.ts`

- [ ] **Step 1: Ler as duas telas reais antes de mexer**

Run: `cd app && cat "src/app/(auth)/(gated)/conta/PreferenciasNotificacao.tsx" "src/app/(auth)/(gated)/conta/actions.ts"`

Confirme a forma de `ContaActionResult` e o padrão do `salvarWrapper` usado no `<form action={...}>` — a seção nova segue o mesmo molde.

- [ ] **Step 2: Escrever o teste que falha**

Criar `app/src/app/(auth)/(gated)/conta/actions.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { salvarWhatsappAction } from './actions';

const USER_ID = 'user_1';

const h = vi.hoisted(() => ({
  linhaProfile: { user_id: USER_ID, whatsapp_numero: null as string | null, whatsapp_habilitado_em: null as string | null },
  erro: null as { message: string } | null,
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) },
    from: (tabela: string) => {
      if (tabela !== 'profiles') throw new Error(`tabela inesperada: ${tabela}`);
      return {
        update: (valores: Record<string, unknown>) => ({
          eq: (_col: string, _val: string) => {
            if (h.erro) return Promise.resolve({ error: h.erro });
            Object.assign(h.linhaProfile, valores);
            return Promise.resolve({ error: null });
          },
        }),
      };
    },
  }),
}));

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

describe('salvarWhatsappAction', () => {
  it('ativar grava o numero E carimba o consentimento', async () => {
    const fd = new FormData();
    fd.set('ativar', 'on');
    fd.set('whatsapp_numero', '+5511999998888');
    const r = await salvarWhatsappAction(fd);
    expect(r.ok).toBe(true);
    expect(h.linhaProfile.whatsapp_numero).toBe('+5511999998888');
    expect(h.linhaProfile.whatsapp_habilitado_em).not.toBeNull();
  });

  it('recusa numero fora do formato E.164', async () => {
    const fd = new FormData();
    fd.set('ativar', 'on');
    fd.set('whatsapp_numero', '11999998888');
    const r = await salvarWhatsappAction(fd);
    expect(r.ok).toBe(false);
  });

  // DESATIVAR NAO APAGA O NUMERO — só o carimbo. Reativar depois não obriga
  // a redigitar, e sem o carimbo a RPC de disparo já não vê a linha.
  it('desativar limpa o carimbo, preserva o numero', async () => {
    h.linhaProfile.whatsapp_numero = '+5511999998888';
    h.linhaProfile.whatsapp_habilitado_em = new Date().toISOString();
    const fd = new FormData();
    // sem 'ativar' no FormData == desligar, mesmo padrão de checkbox do e-mail
    const r = await salvarWhatsappAction(fd);
    expect(r.ok).toBe(true);
    expect(h.linhaProfile.whatsapp_habilitado_em).toBeNull();
    expect(h.linhaProfile.whatsapp_numero).toBe('+5511999998888');
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `cd app && npx vitest run "src/app/(auth)/(gated)/conta/actions.test.ts"`
Expected: FAIL — `salvarWhatsappAction` não existe.

- [ ] **Step 4: Implementar a action**

Acrescentar em `app/src/app/(auth)/(gated)/conta/actions.ts` (mesmo arquivo, ao lado de `salvarPreferenciasNotificacaoAction`):

```ts
// Regex simples de E.164: '+', dígito 1-9, 6 a 14 dígitos depois. Não valida
// se o número EXISTE no WhatsApp — só a forma. A prova de existência é a
// mensagem de confirmação que a uazapi manda (Task 5/6).
const E164 = /^\+[1-9]\d{6,14}$/;

export async function salvarWhatsappAction(fd: FormData): Promise<ContaActionResult> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  const ativar = fd.get('ativar') != null;

  if (!ativar) {
    const { error } = await supabase
      .from('profiles')
      .update({ whatsapp_habilitado_em: null })
      .eq('user_id', user.id);
    if (error) return { ok: false, error: error.message };
    revalidatePath('/conta');
    return { ok: true };
  }

  const numero = String(fd.get('whatsapp_numero') ?? '').trim();
  if (!E164.test(numero)) {
    return { ok: false, error: 'Informe o número no formato +5511999998888.' };
  }

  const { error } = await supabase
    .from('profiles')
    .update({ whatsapp_numero: numero, whatsapp_habilitado_em: new Date().toISOString() })
    .eq('user_id', user.id);
  // Único índice: outro usuário já reivindicou este número.
  if (error) return { ok: false, error: error.message.includes('duplicate')
    ? 'Este número já está em uso por outra conta.' : error.message };

  revalidatePath('/conta');
  return { ok: true };
}
```

⚠️ Confira o import de `createServerClient`, `revalidatePath` e o tipo `ContaActionResult` **no arquivo real** — use os mesmos já importados por `salvarPreferenciasNotificacaoAction`, não duplique import.

- [ ] **Step 5: Rodar**

Run: `cd app && npx vitest run "src/app/(auth)/(gated)/conta" && npx tsc --noEmit`
Expected: PASS, 0 erros.

- [ ] **Step 6: A seção nova na tela**

Em `PreferenciasNotificacao.tsx`, ao lado da seção de e-mail, no mesmo padrão visual (`rounded-lg border border-border bg-surface p-4 space-y-3`):

```tsx
<form action={salvarWhatsappWrapper} className="rounded-lg border border-border bg-surface p-4 space-y-3">
  <h3 className="text-sm font-medium text-foreground">WhatsApp</h3>
  <p className="text-xs text-muted-foreground">
    Avisos de vencimento e pendências também por WhatsApp. Você pode desativar quando quiser.
  </p>
  <input
    type="tel"
    name="whatsapp_numero"
    placeholder="+5511999998888"
    defaultValue={whatsappNumero ?? ''}
    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
  />
  <label className="flex items-center gap-2 text-sm">
    <input type="checkbox" name="ativar" defaultChecked={!!whatsappHabilitadoEm} />
    Ativar avisos por WhatsApp
  </label>
  <button type="submit" className="rounded-md bg-primary px-3 py-1.5 text-sm text-white">Salvar</button>
</form>
```

Leia `profiles.whatsapp_numero`/`whatsapp_habilitado_em` na mesma query de `profiles` que a página já faz (via `user_id = user.id`, mesma coluna da Task 1) e passe como `whatsappNumero`/`whatsappHabilitadoEm`. `salvarWhatsappWrapper` segue o mesmo padrão adaptador (`ContaActionResult → void`) que `salvarWrapper` já usa.

- [ ] **Step 7: Rodar tudo, sabotar, commitar**

Run: `cd app && npx vitest run && npx tsc --noEmit`

Sabotagem: troque a branch de "desativar" para não limpar `whatsapp_habilitado_em`. O teste "desativar limpa o carimbo" tem de falhar. Desfaça.

```bash
git add "app/src/app/(auth)/(gated)/conta"
git commit -m "feat(6b): opt-in de WhatsApp em Conta -> Notificacoes"
```

---

### Task 3: A situação fiscal atual, fora de uma sessão HTTP

Reaproveita a cadeia do 6A (`renderizar`, `buscarExplicacao`, `valoresDoDasMei`, `situacaoDasMei`) montada com `companyId` direto, sem passar por `page.tsx`.

**Files:**
- Create: `app/src/lib/explicacoes/situacao-atual-mei.ts`
- Test: `app/src/lib/explicacoes/situacao-atual-mei.test.ts`
- Create: `app/src/lib/atendimento/prompt.ts`
- Test: `app/src/lib/atendimento/prompt.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, it, expect, vi } from 'vitest';
import { buscarSituacaoAtualMei } from './situacao-atual-mei';

function clienteFalso(tabelas: Record<string, unknown>) {
  return {
    from: (t: string) => ({
      select: () => ({
        eq: () => ({
          is: () => ({
            maybeSingle: async () => ({ data: tabelas[t] ?? null, error: null }),
            order: () => ({ limit: async () => ({ data: (tabelas[t] as unknown[]) ?? [], error: null }) }),
          }),
        }),
      }),
      eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    }),
  } as never;
}

describe('buscarSituacaoAtualMei', () => {
  it('sem ficha fiscal devolve null', async () => {
    const r = await buscarSituacaoAtualMei(clienteFalso({}), 'empresa-1', '202607');
    expect(r).toBeNull();
  });
});
```

⚠️ **O mock acima é um esqueleto, não uma verdade.** As chamadas reais em `page.tsx` encadeiam `.select().eq().is('deleted_at', null).maybeSingle()` (ficha) e `.select().eq().is('deleted_at', null).order().limit()` (apurações/guias) — **leia `page.tsx:58-71` de novo e ajuste o mock até bater exatamente com a cadeia usada na implementação real do Step 3**, antes de confiar neste teste.

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd app && npx vitest run src/lib/explicacoes/situacao-atual-mei.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

```ts
// Bloco 6B — a MESMA cadeia que produz a explicação na tela de impostos
// (CompetenciaAtualCardMei.tsx + page.tsx), montada fora de uma sessão HTTP —
// o webhook de atendimento (Task 6) não tem `user` de sessão, só um companyId
// já resolvido a partir do telefone de quem escreveu.
//
// NÃO reescreve a regra: chama exatamente as mesmas funções puras do 6A
// (situacaoDasMei, valoresDoDasMei, chaveDaSituacao, buscarExplicacao,
// renderizar). Se um dia divergir de page.tsx, é porque um dos dois lados
// mudou sem o outro — o teste deste módulo não substitui o da tela.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { situacaoDasMei, chaveDaSituacao } from '@/lib/fiscal/situacao-fiscal';
import { valoresDoDasMei } from '@/lib/explicacoes/valores-mei';
import { buscarExplicacao } from '@/lib/explicacoes/buscar';
import { renderizar } from '@/lib/explicacoes/renderizar';

export type SituacaoAtual = {
  texto: string;
  geradoPor: string | null;
};

/**
 * `sb` pode ser o admin client — `buscarExplicacao` aceita qualquer
 * `SupabaseClient` (ver `lib/explicacoes/buscar.ts`).
 */
export async function buscarSituacaoAtualMei(
  sb: SupabaseClient, companyId: string, competenciaAtual: string,
): Promise<SituacaoAtual | null> {
  const { data: fiscal } = await sb
    .from('empresas_fiscais')
    .select('atividade_mei')
    .eq('empresa_id', companyId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!fiscal) return null;

  const atividadeMei = (fiscal as { atividade_mei: string | null }).atividade_mei;

  const [{ data: apuracoes }, { data: guias }] = await Promise.all([
    sb.from('apuracoes_fiscais')
      .select('competencia_referencia, valor_imposto')
      .eq('company_id', companyId).is('deleted_at', null)
      .order('competencia_referencia', { ascending: false }).limit(13),
    sb.from('guias_fiscais')
      .select('competencia_referencia, valor_total')
      .eq('company_id', companyId).is('deleted_at', null)
      .order('competencia_referencia', { ascending: false }).limit(24),
  ]);

  type Apuracao = { competencia_referencia: string; valor_imposto: number | null };
  type Guia = { competencia_referencia: string; valor_total: number | null };
  const apuracaoAtual = ((apuracoes ?? []) as Apuracao[])
    .find((a) => a.competencia_referencia === competenciaAtual) ?? null;
  const guiaAtual = ((guias ?? []) as Guia[])
    .find((g) => g.competencia_referencia === competenciaAtual) ?? null;

  const totalExibido = guiaAtual?.valor_total ?? apuracaoAtual?.valor_imposto ?? null;
  const valores = valoresDoDasMei(atividadeMei, totalExibido);
  if (!valores) return null;

  const situacao = situacaoDasMei(atividadeMei);
  const explicacao = await buscarExplicacao(sb, chaveDaSituacao(situacao));
  if (!explicacao) return null;

  const r = renderizar(explicacao.texto, valores);
  if (!r.ok) return null;

  return { texto: r.texto, geradoPor: explicacao.geradoPor };
}
```

- [ ] **Step 4: Rodar**

Run: `cd app && npx vitest run src/lib/explicacoes/situacao-atual-mei.test.ts && npx tsc --noEmit`
Expected: PASS, 0 erros.

- [ ] **Step 5: O prompt de atendimento — teste que falha**

```ts
import { describe, it, expect } from 'vitest';
import { montarPromptAtendimento } from './prompt';

describe('prompt de atendimento', () => {
  it('inclui a pergunta do cliente e a situacao fiscal, pede resposta estruturada', () => {
    const p = montarPromptAtendimento({
      pergunta: 'quanto eu pago esse mes?',
      situacaoFiscalTexto: 'Você paga R$ 75,90 de INSS e R$ 5,00 de ISS.',
    });
    expect(p).toContain('quanto eu pago esse mes?');
    expect(p).toContain('R$ 75,90');
    expect(p).toMatch(/resolvido/i);
  });

  // A GARANTIA DO 6A DE NOVO: o prompt so recebe o TEXTO ja calculado, nunca
  // um numero cru que a IA teria que decidir sozinha.
  it('sem situacao fiscal, instrui a nao inventar', () => {
    const p = montarPromptAtendimento({ pergunta: 'quanto eu pago?', situacaoFiscalTexto: null });
    expect(p).not.toContain('null');
    expect(p.toLowerCase()).toMatch(/não (sabe|tem informação|encontr)/);
  });
});
```

- [ ] **Step 6: Rodar e ver falhar** · **Step 7: Implementar**

```ts
// Bloco 6B — o prompt do atendimento. Puro, sem I/O: quem chama a IA
// (Task 6) monta o prompt aqui e passa para `gerarTexto` (lib/ai/cliente.ts,
// já existe do 6A).
//
// MESMA GARANTIA DO 6A: este módulo só recebe TEXTO já calculado
// (`situacaoFiscalTexto`, produto de `buscarSituacaoAtualMei`), nunca um valor
// numérico cru — a IA não tem como inventar um número que nunca viu.
export type EntradaAtendimento = {
  pergunta: string;
  situacaoFiscalTexto: string | null;
};

export function montarPromptAtendimento(e: EntradaAtendimento): string {
  const contexto = e.situacaoFiscalTexto
    ?? 'Não há informação fiscal disponível para responder com segurança.';

  return [
    'Você é o atendimento de um escritório de contabilidade, respondendo por WhatsApp.',
    `Pergunta do cliente: "${e.pergunta}"`,
    `O que já sabemos sobre a situação fiscal dele: ${contexto}`,
    '',
    'Responda em até 3 frases, em português simples, usando SOMENTE a informação acima.',
    'Nunca invente valor, data ou norma que não esteja no texto acima.',
    'Se a informação acima não for suficiente para responder com segurança, diga que vai',
    'encaminhar para o contador.',
    '',
    'Responda em JSON, só com estas duas chaves: ',
    '{ "resposta": "...", "resolvido": true ou false }',
  ].join('\n');
}
```

- [ ] **Step 8: Rodar, sabotar, commitar**

Run: `cd app && npx vitest run src/lib/atendimento src/lib/explicacoes && npx tsc --noEmit`

Sabotagem: troque `contexto` para incluir `e.situacaoFiscalTexto` sem o fallback (`e.situacaoFiscalTexto!`). O teste "sem situação fiscal" tem de falhar (o prompt passaria a conter a string `"null"`). Desfaça.

```bash
git add app/src/lib/explicacoes/situacao-atual-mei.ts app/src/lib/explicacoes/situacao-atual-mei.test.ts app/src/lib/atendimento
git commit -m "feat(6b): situacao fiscal atual fora de sessao + prompt de atendimento"
```

---

### Task 4: Sondagem do Pix Copia-e-Cola do SERPRO

**Decide se o pagamento via WhatsApp entra nesta rodada.** Investigativa — sem código pronto porque o envelope bruto do SERPRO nunca foi inspecionado atrás deste campo.

**Files:**
- Create: `app/scratchpad/_sondar-pix-das-mei.mjs`
- Modify (condicional): `app/src/lib/fiscal/das-mei-parse.ts`
- Modify (condicional): `app/src/lib/fiscal/das-mei-parse.test.ts`

- [ ] **Step 1: Ler o parser real**

Run: `cd app && cat src/lib/fiscal/das-mei-parse.ts`

Confirme `DasMeiResult` e que `parseDasMei(envelope)` só extrai `numeroDocumento`, `dataVencimento`, `valores`, `codigoDeBarras`, `pdfBase64` de `envelope.dados.detalhamento[0]` (mais `obj.pdf`) — **tudo o resto do envelope é descartado antes de chegar aqui.**

- [ ] **Step 2: Escrever a sonda**

`app/src/lib/fiscal/serpro-das-mei.ts` exporta `gerarDasMei(supabase, companyId, competencia)`. Escreva um script que chama essa função para uma competência **já emitida** de uma empresa MEI real do ambiente (a `ideapp`, já usada como cenário de teste do 6A — ver `docs/smoke/2026-07-29-bloco-6a-roteiro-smoke.md`), e **loga o envelope bruto ANTES do parse** — não o resultado já filtrado por `parseDasMei`.

```javascript
// app/scratchpad/_sondar-pix-das-mei.mjs
// Sonda o envelope bruto do SERPRO atrás de Pix Copia-e-Cola. NAO gera guia
// nova: usa uma competencia ja emitida (o SERPRO e idempotente para guia ja
// gerada no periodo — confirme isso na Step 3 antes de rodar contra qualquer
// competencia nao vazia).
import { createAdminClient } from '../src/lib/supabase/admin.js';
// ⚠️ Ajuste o import acima para o caminho/formato real (ESM vs ts-node) — o
// resto do repo roda scripts de scratchpad em Node puro; confira como
// `seed-6a.mjs`/`_probe-6a.mjs` importam módulos TS do app antes de copiar.

const COMPANY_ID = process.argv[2]; // id da ideapp
const COMPETENCIA = process.argv[3]; // ex.: '202607', já com guia emitida

// TODO na implementação real: chamar o MESMO caminho que gerarDasMei usa
// (emitirComProcurador em lib/clients/serpro.ts) e console.log(JSON.stringify(...))
// do envelope INTEIRO antes de qualquer parse, procurando por chaves como
// "pix", "qrcode", "copiaECola" (nomes exatos desconhecidos — é isto que a
// sonda existe para descobrir).
```

- [ ] **Step 3: Rodar contra uma guia real já emitida, sem gerar nada novo**

Confirme antes de rodar: `gerarDasMei` é idempotente para uma competência já emitida (ler `serpro-das-mei.ts`/`serpro-das-comum.ts` — `isNadaDevido` e o que acontece se a guia já existir). **Se não for idempotente, não rode contra produção** — peça ao usuário uma cópia do envelope de uma guia já emitida, ou rode contra o sandbox do SERPRO com uma competência de teste.

Run: `cd app && node scratchpad/_sondar-pix-das-mei.mjs <company-id-ideapp> <competencia-com-guia>`

- [ ] **Step 4: Reportar o resultado, e decidir**

**Se existir campo de Pix/QR code no envelope:**
- Acrescente o campo a `DasMeiResult` em `das-mei-parse.ts` e capture-o em `parseDasMei`.
- Acrescente um teste em `das-mei-parse.test.ts` fixando o novo campo com o payload real sondado (não um payload inventado).
- Este texto de Pix passa a entrar no corpo da notificação de vencimento (Task 5 usa `n.corpo`, que já vem pronto da RPC — se o Pix for exposto por aí, é a Task 5 que decide incluir).

**Se não existir:** documente aqui mesmo, no arquivo desta task, o resultado da sondagem (data, competência sondada, campos encontrados no envelope) e siga sem essa parte — a mensagem de vencimento por WhatsApp usa só `action_href` (link do app), como já é para o e-mail.

- [ ] **Step 5: Commit**

```bash
git add app/scratchpad/_sondar-pix-das-mei.mjs app/src/lib/fiscal/das-mei-parse.ts app/src/lib/fiscal/das-mei-parse.test.ts
git commit -m "feat(6b): sondagem do Pix Copia-e-Cola do SERPRO (resultado documentado no commit)"
```

---

### Task 5: Cliente `uazapi` e o terceiro loop no cron de obrigações

**Thin na parte do contrato HTTP** — não há instância provisionada ainda.

**Files:**
- Create: `app/src/lib/uazapi/cliente.ts`
- Test: `app/src/lib/uazapi/cliente.test.ts`
- Modify: `app/src/app/api/cron/obrigacoes/route.ts`

- [ ] **Step 1: Sondar o contrato real (quando houver instância) ou a documentação pública**

Antes de escrever `enviarMensagem`, tente confirmar contra a documentação pública da uazapi (`https://docs.uazapi.com`) ou, se já houver uma instância provisionada, contra ela diretamente: qual header carrega o token (`token`? `Authorization`?), o path e o body de enviar texto, e a URL/instância própria (`UAZAPI_BASE_URL`). **Se não houver como confirmar ainda, escreva o cliente com a MELHOR hipótese abaixo, mas deixe marcado no código exatamente o que é hipótese** — não apague o comentário depois sem ter sondado de verdade.

- [ ] **Step 2: Escrever o teste com a hipótese marcada**

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { enviarMensagem } from './cliente';

afterEach(() => vi.restoreAllMocks());

describe('cliente uazapi', () => {
  it('manda o texto para a instancia configurada, com o token no header', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      { ok: true, status: 200, json: async () => ({}) } as Response);

    await enviarMensagem(
      { baseUrl: 'https://minha-instancia.uazapi.com', token: 'TOKEN_TESTE' },
      { telefone: '+5511999998888', texto: 'oi' });

    expect(String(spy.mock.calls[0][0])).toContain('minha-instancia.uazapi.com');
    const init = spy.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).token).toBe('TOKEN_TESTE');
  });

  it('sem instancia/token configurados, no-op sem lancar', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const r = await enviarMensagem(null, { telefone: '+5511999998888', texto: 'oi' });
    expect(r).toEqual({ ok: false, skipped: true });
    expect(spy).not.toHaveBeenCalled();
  });

  it('erro do provedor nao lanca — devolve ok:false', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: false, status: 500 } as Response);
    const r = await enviarMensagem(
      { baseUrl: 'https://x.uazapi.com', token: 't' },
      { telefone: '+5511999998888', texto: 'oi' });
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 3: Implementar (com a hipótese marcada explicitamente)**

```ts
// Bloco 6B — cliente da uazapi.
//
// ⚠️ CONTRATO NAO SONDADO CONTRA INSTANCIA REAL (ver Task 5, Step 1). O header
// `token` e o path `/send/text` são a MELHOR hipótese a partir da documentação
// pública — confirme contra uma instância real assim que houver uma, e
// atualize este comentário quando confirmar (removendo o aviso).
//
// Mesma convenção do sendEmail (Bloco 1): sem credencial configurada, no-op
// logado — nunca derruba quem chama.
import 'server-only';

export type ConfigUazapi = { baseUrl: string; token: string };
export type EnvioResultado = { ok: true } | { ok: false; skipped?: true; erro?: string };

export function configDeEnv(): ConfigUazapi | null {
  const baseUrl = process.env.UAZAPI_BASE_URL;
  const token = process.env.UAZAPI_TOKEN;
  if (!baseUrl || !token) return null;
  return { baseUrl, token };
}

export async function enviarMensagem(
  cfg: ConfigUazapi | null, msg: { telefone: string; texto: string },
): Promise<EnvioResultado> {
  if (!cfg) return { ok: false, skipped: true };

  try {
    const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/send/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', token: cfg.token },
      body: JSON.stringify({ number: msg.telefone, text: msg.texto }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { ok: false, erro: `uazapi respondeu ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e) };
  }
}
```

- [ ] **Step 4: Rodar**

Run: `cd app && npx vitest run src/lib/uazapi && npx tsc --noEmit`
Expected: PASS, 0 erros.

- [ ] **Step 5: O terceiro loop no cron**

Ler `app/src/app/api/cron/obrigacoes/route.ts` de novo (conteúdo já conferido no início deste plano) e acrescentar, **depois do loop de e-mail e antes do bloco de billing**:

```ts
import { configDeEnv, enviarMensagem } from '@/lib/uazapi/cliente';
// ...

const { data: pendWhats, error: ePendWhats } = await admin.rpc('notificacoes_pendentes_whatsapp', { p_limite: 50 });
let whatsappEnviados = 0;
let whatsappPulados = 0;
if (ePendWhats) {
  console.error('[cron obrigacoes] notificacoes_pendentes_whatsapp', ePendWhats.message);
} else {
  const cfgUazapi = configDeEnv();
  for (const n of pendWhats ?? []) {
    const r = await enviarMensagem(cfgUazapi, {
      telefone: n.whatsapp_numero,
      texto: `${n.titulo}\n\n${n.corpo}${n.action_href ? `\n\n${siteUrl}${n.action_href}` : ''}`,
    });
    if (r.ok) {
      await admin.from('notifications').update({ enviada_whatsapp_em: new Date().toISOString() }).eq('id', n.id);
      whatsappEnviados++;
    } else {
      whatsappPulados++;
    }
  }
}
```

E no `NextResponse.json` final, acrescentar `whatsapp_enviados: whatsappEnviados, whatsapp_pulados: whatsappPulados` ao lado de `enviados`/`pulados` já existentes.

⚠️ **Sem `UAZAPI_BASE_URL`/`UAZAPI_TOKEN` no ambiente, `configDeEnv()` devolve `null` e todo item vira `skipped` — o cron não quebra.** É exatamente o estado de hoje, sem instância provisionada.

- [ ] **Step 6: Rodar, verificar, commitar**

Run: `cd app && npx vitest run && npx tsc --noEmit`

```bash
git add app/src/lib/uazapi app/src/app/api/cron/obrigacoes/route.ts
git commit -m "feat(6b): cliente uazapi (contrato a confirmar) + terceiro loop no cron de obrigacoes"
```

---

### Task 6: Webhook de entrada — atendimento e escalação

**Thin em dois pontos**: o payload real da uazapi (depende da Task 5) e quem é "o contador" de uma empresa (não verificado nesta rodada).

**Files:**
- Create: `app/src/app/api/webhooks/uazapi/route.ts`
- Test: `app/src/app/api/webhooks/uazapi/route.test.ts`

- [ ] **Step 1: Sondar quem é o contador de uma empresa**

Antes de escrever a escalação, rode:

Run: `cd app && grep -rn "contabilidade_id" src/lib src/app --include=*.ts --include=*.tsx | grep -v test`

Procure onde o repo já resolve "o profissional responsável por esta empresa" (a partir de `companies.contabilidade_id` → algum vínculo até um `owner_user_id` de um profile com `user_role='contador'`). **Se não achar um caminho já pronto, reporte e proponha o mais simples que o schema real permitir** — não invente uma tabela nova sem necessidade; é provável que `contabilidades` já tenha uma coluna de usuário responsável, ou que exista uma tabela de vínculo. Escreva o resultado desta sondagem como comentário no topo do arquivo da Step 3.

- [ ] **Step 2: Escrever o teste com o contrato de payload marcado como hipótese**

```ts
import { describe, it, expect, vi } from 'vitest';
import { POST } from './route';

// ⚠️ FORMATO DO PAYLOAD DA UAZAPI NAO CONFIRMADO — ajuste esta forma para a
// real assim que a Task 5/6 sondar contra uma instância de verdade.
function requisicaoFalsa(corpo: unknown, segredo: string) {
  return new Request('http://localhost/api/webhooks/uazapi?s=' + segredo, {
    method: 'POST', body: JSON.stringify(corpo),
  });
}

describe('webhook uazapi', () => {
  it('segredo errado e rejeitado, sempre 200', async () => {
    const res = await POST(requisicaoFalsa({ messageId: 'm1', from: '+5511999998888', text: 'oi' }, 'errado'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  // idempotencia, telefone desconhecido, resposta com resolvido=true/false:
  // cada um exige mockar createAdminClient/gerarTexto — ver o mock usado em
  // src/app/(auth)/(gated)/admin/explicacoes/actions.test.ts como referência
  // de como este repo mocka o client do Supabase por completo, e reproduza o
  // mesmo estilo aqui antes de considerar esta task pronta.
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `cd app && npx vitest run "src/app/api/webhooks/uazapi"`
Expected: FAIL — rota não existe.

- [ ] **Step 4: Implementar a rota**

Mesmo padrão do `webhooks/asaas/route.ts` (rate-limit por **telefone**, não IP; segredo; sempre 200):

```ts
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { segredoDaQuery } from '../segredo';
import { limitar } from '@/lib/security/rate-limit';
import { buscarSituacaoAtualMei } from '@/lib/explicacoes/situacao-atual-mei';
import { montarPromptAtendimento } from '@/lib/atendimento/prompt';
import { gerarTexto } from '@/lib/ai/cliente';
import { lerChaveIa } from '@/lib/ai/config-ia';
import { enviarMensagem, configDeEnv } from '@/lib/uazapi/cliente';
import { competenciaReferenciaBrt } from '@/lib/fiscal/guia';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ⚠️ FORMATO REAL NAO CONFIRMADO — ver Task 6 Step 1/2. Ajuste os nomes de
// campo (`messageId`, `from`, `text`) assim que a sondagem confirmar.
type PayloadUazapi = { messageId: string; from: string; text: string };

export async function POST(req: Request) {
  let corpo: PayloadUazapi;
  try {
    corpo = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: 'payload_invalido' }, { status: 200 });
  }

  if (!(await limitar(`uazapi-webhook:${corpo.from ?? 'sem-telefone'}`, 30, 60))) {
    return NextResponse.json({ ok: false, reason: 'rate_limited' }, { status: 200 });
  }
  if (!segredoDaQuery(req, 's', process.env.UAZAPI_WEBHOOK_SECRET ?? '')) {
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 200 });
  }

  const admin = createAdminClient();

  // Idempotência primeiro — a uazapi pode reenviar.
  const { data: jaVisto } = await admin
    .from('whatsapp_atendimentos').select('id').eq('message_id_externo', corpo.messageId).maybeSingle();
  if (jaVisto) return NextResponse.json({ ok: true, reason: 'duplicado' }, { status: 200 });

  const { data: profile } = await admin
    .from('profiles').select('user_id, current_company')
    .eq('whatsapp_numero', corpo.from).maybeSingle();

  if (!profile?.current_company) {
    await enviarMensagem(configDeEnv(), {
      telefone: corpo.from,
      texto: 'Não conseguimos identificar sua conta. Confirme seu número em Conta > Notificações no app.',
    });
    await admin.from('whatsapp_atendimentos').insert({
      message_id_externo: corpo.messageId, telefone: corpo.from,
      mensagem_recebida: corpo.text, resolvido: false,
    });
    return NextResponse.json({ ok: true, reason: 'telefone_desconhecido' }, { status: 200 });
  }

  const situacao = await buscarSituacaoAtualMei(
    admin, profile.current_company as string, competenciaReferenciaBrt(new Date()));

  const { data: cfgRow } = await admin.from('config_ia').select('*').eq('id', 1).maybeSingle();
  let resposta = 'Não consegui responder agora — o contador vai retornar em breve.';
  let resolvido = false;

  if (cfgRow) {
    try {
      const chave = lerChaveIa(cfgRow.chave_cifrada as string | null);
      if (chave) {
        const prompt = montarPromptAtendimento({ pergunta: corpo.text, situacaoFiscalTexto: situacao?.texto ?? null });
        const bruto = await gerarTexto(
          { provedor: cfgRow.provedor, modelo: cfgRow.modelo, base_url: cfgRow.base_url, chave },
          prompt);
        const j = JSON.parse(bruto) as { resposta: string; resolvido: boolean };
        resposta = j.resposta;
        resolvido = j.resolvido;
      }
    } catch (e) {
      console.error('[webhook uazapi] falha ao gerar resposta:', e instanceof Error ? e.message : String(e));
    }
  }

  await enviarMensagem(configDeEnv(), { telefone: corpo.from, texto: resposta });

  if (!resolvido) {
    // Escalação: notificação in-app pro contador — ver Step 1 desta task para
    // como profile.user_id resolve o contador responsável por esta empresa.
    // TODO: preencher owner_user_id do contador aqui, com o resultado da
    // sondagem da Step 1 — NÃO commitar com um valor inventado.
  }

  await admin.from('whatsapp_atendimentos').insert({
    message_id_externo: corpo.messageId, telefone: corpo.from, profile_user_id: profile.user_id,
    mensagem_recebida: corpo.text, resposta_enviada: resposta, resolvido,
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}
```

⚠️ **Não deixe o `TODO` da escalação sem preencher.** Ele existe porque a Step 1 desta task ainda não tinha rodado quando este plano foi escrito — é o próprio agente executor que sonda e substitui, com o `INSERT` real em `notifications` (`tipo: 'whatsapp_escalado'`, `owner_user_id` = o contador resolvido, `titulo`/`corpo` citando a pergunta original).

- [ ] **Step 5: Completar os testes que a Step 2 deixou de referência, rodar, sabotar, commitar**

Run: `cd app && npx vitest run && npx tsc --noEmit`

Sabotagem: remova a checagem de `jaVisto`. Um teste de reenvio do mesmo `messageId` tem de responder duas vezes em vez de uma. Desfaça.

```bash
git add app/src/app/api/webhooks/uazapi
git commit -m "feat(6b): webhook de atendimento com IA e escalacao"
```

---

### Task 7: Probe, verificação final e roteiro do smoke

**Files:**
- Create: `app/scratchpad/_probe-6b.mjs`
- Create: `docs/smoke/2026-XX-XX-bloco-6b-roteiro-smoke.md`

- [ ] **Step 1: O probe**

Somente leitura, mesmo molde de `_probe-6a.mjs`/`_probe-4b.mjs`:

1. `anon` não lê `profiles.whatsapp_numero` de outro usuário (RLS `profiles_self` já cobre — provar com HTTP e a anon key, sem login);
2. `anon` não lê `whatsapp_atendimentos` (401);
3. `anon` não executa `notificacoes_pendentes_whatsapp` (401);
4. se houver linhas em `whatsapp_atendimentos`, nenhuma tem `message_id_externo` duplicado (unicidade, conferida contra o banco de verdade, não só a constraint).

- [ ] **Step 2: O roteiro do smoke**

Sem instância uazapi real conectada ainda, o smoke desta rodada é parcial — registre isso no próprio roteiro, seção por seção:

1. ativar WhatsApp em Conta → Notificações com um número de teste → confirmar `whatsapp_habilitado_em` gravado;
2. desativar → confirmar que `notificacoes_pendentes_whatsapp` deixa de devolver a linha (rodar a RPC direto via SQL, já que não há mensagem real ainda);
3. rodar o cron manualmente (`GET /api/cron/obrigacoes` com o `CRON_SECRET`) com o opt-in ativo e sem `UAZAPI_TOKEN` configurado → confirmar `whatsapp_pulados` no JSON de resposta, e que `enviados`/`billing` do e-mail continuam funcionando normalmente (a prova de que nada do 6B quebrou o Bloco 1);
4. chamar `POST /api/webhooks/uazapi` diretamente (`curl`, com o segredo certo) simulando uma mensagem de um telefone com opt-in ativo → confirmar que a resposta usa a mesma explicação que a tela de impostos mostraria para aquela empresa;
5. repetir o mesmo `messageId` → confirmar que não duplica em `whatsapp_atendimentos`;
6. rodar `_probe-6b.mjs` → tudo verde.

**Registrar como pendente, não fingir testado:** mensagem de WhatsApp de verdade chegando num celular — depende da instância uazapi que o usuário está provisionando em paralelo.

- [ ] **Step 3: Fechamento**

Ordem: verificação com o cenário vivo → suíte completa → `next build` com o dev **parado** → commits → merge `--no-ff` em `main` → **confirmar com o usuário antes do push** (auto-deploy em produção).

---

## Dívidas que este bloco NÃO resolve (registradas, não esquecidas)

- **A instância uazapi real** e o número WhatsApp conectado — provisionamento do usuário, em paralelo.
- **O contrato HTTP exato da uazapi** — a Task 5 escreve com a melhor hipótese; confirmar contra uma instância real assim que ela existir, e remover o aviso do código quando confirmado.
- **Quem é "o contador" de uma empresa**, para a escalação notificar a pessoa certa — sondagem da Task 6, Step 1, não resolvida na escrita deste plano.
- **Granularidade por tipo de notificação no opt-in do WhatsApp** — v1 é interruptor único (spec §2.1).
- **Pagamento via WhatsApp**, se a Task 4 não achar o Pix Copia-e-Cola no envelope do SERPRO.
- **Risco de bloqueio do número** por ser conexão não-oficial (spec §4.4/§8) — observar nas primeiras semanas em produção, não é algo que teste automatizado prove antes do fato.
