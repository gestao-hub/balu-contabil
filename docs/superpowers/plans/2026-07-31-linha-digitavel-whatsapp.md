# Linha digitável do DAS na mensagem de WhatsApp — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** quando o Bloco 1 dispara o aviso proativo de WhatsApp para uma
notificação de tipo `das_a_vencer`/`das_vencido`, a mensagem passa a incluir
a linha digitável da guia já gerada, pronta pra copiar e colar no app do
banco.

**Architecture:** a RPC `notificacoes_pendentes_whatsapp` (Postgres) ganha um
`LEFT JOIN` com `guias_fiscais` (via `notifications.entidade_ref`) e passa a
devolver `linha_digitavel`; o cron `api/cron/obrigacoes/route.ts` usa uma
função pura nova (`montarTextoWhatsapp`) pra montar o texto da mensagem,
incluindo a linha digitável só quando ela existir. Nenhuma credencial nova,
nenhuma integração nova — só ler um dado que já está persistido.

**Tech Stack:** Postgres/Supabase (migration SQL, `pg` via runner Node
descartável), Next.js route handler (`api/cron/obrigacoes/route.ts`),
Vitest.

**Spec:** `docs/superpowers/specs/2026-07-31-linha-digitavel-whatsapp-design.md`

---

### Task 1: Migration `0064` — a RPC devolve `linha_digitavel`

**Files:**
- Create: `app/supabase/migrations/0064_linha_digitavel_whatsapp.sql`
- Create (descartável, não versionado): `app/scratchpad/_apply-0064.mjs`
- Create (descartável, não versionado): `app/scratchpad/_probe-0064.mjs`

- [ ] **Step 0: Criar a branch de feature**

Mesma convenção de todo bloco anterior deste projeto (6A, 6B, base jurídica):
trabalho isolado numa branch própria, merge `--no-ff` só no fechamento.

```bash
git checkout main
git pull origin main
git checkout -b feat/linha-digitavel-whatsapp
```

- [ ] **Step 1: Escrever a migration**

Criar `app/supabase/migrations/0064_linha_digitavel_whatsapp.sql`:

```sql
-- Linha digitavel do DAS na mensagem de WhatsApp de vencimento.
--
-- O item original do PRD Master ("Pix Copia-e-Cola via SERPRO") foi
-- investigado e refutado no brainstorming desta sessao — a SERPRO nao
-- devolve Pix para DAS em nenhum servico identificado (ver
-- docs/superpowers/specs/2026-07-31-linha-digitavel-whatsapp-design.md).
-- O que existe de verdade e guias_fiscais.linha_digitavel, ja persistida
-- desde a geracao da guia (gerarDasMeiAction/gerarDasSimplesAction).
--
-- A notificacao das_a_vencer/das_vencido so e materializada quando ja existe
-- uma guia (materializar_obrigacoes, 0045b: entidade_ref = gid::text da
-- guia) — entao o join abaixo nunca precisa gerar nada, so ler o que ja
-- esta la.
--
-- O CASE antes do ::uuid restringe a tentativa de cast aos dois tipos que
-- sabemos que gravam um entidade_ref de guia real (materializar_obrigacoes
-- e o unico writer desses tipos) — para qualquer outro tipo de notificacao,
-- o CASE devolve NULL e NULL::uuid nunca lanca.
CREATE OR REPLACE FUNCTION public.notificacoes_pendentes_whatsapp(p_limite int DEFAULT 50)
RETURNS TABLE (
  id uuid, owner_user_id uuid, tipo text, titulo text, corpo text,
  action_href text, whatsapp_numero text, linha_digitavel text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT n.id, n.owner_user_id, n.tipo, n.titulo, n.corpo, n.action_href,
         p.whatsapp_numero, g.linha_digitavel
  FROM public.notifications n
  JOIN public.profiles p ON p.user_id = n.owner_user_id
  LEFT JOIN public.guias_fiscais g
    ON g.id = (CASE WHEN n.tipo IN ('das_a_vencer', 'das_vencido') THEN n.entidade_ref END)::uuid
  WHERE n.enviada_whatsapp_em IS NULL
    AND n.tipo <> 'whatsapp_escalado'
    AND p.whatsapp_numero IS NOT NULL
    AND p.whatsapp_habilitado_em IS NOT NULL
  ORDER BY n.created_at
  LIMIT p_limite;
$$;

REVOKE ALL ON FUNCTION public.notificacoes_pendentes_whatsapp(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notificacoes_pendentes_whatsapp(int) TO service_role;
```

- [ ] **Step 2: Aplicar a migration em produção**

Criar `app/scratchpad/_apply-0064.mjs` (não versionado — mesmo padrão de
todo runner de migration deste projeto):

```javascript
import { readFileSync } from 'node:fs';
import pg from 'pg';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => {
    const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
  }),
);
const ref = env.NEXT_PUBLIC_SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\./)[1];
const sql = readFileSync('supabase/migrations/0064_linha_digitavel_whatsapp.sql', 'utf8');

const c = new pg.Client({
  host: `db.${ref}.supabase.co`, port: 5432, user: 'postgres',
  password: env.SUPABASE_PASSWORD, database: 'postgres', ssl: { rejectUnauthorized: false },
});
await c.connect();
await c.query(sql);
console.log('Migration 0064 aplicada.');
await c.query("NOTIFY pgrst, 'reload schema'");
console.log('PostgREST: reload schema enviado.');
await c.end();
```

Run (a partir de `balu/app`): `node scratchpad/_apply-0064.mjs`
Expected:
```
Migration 0064 aplicada.
PostgREST: reload schema enviado.
```

- [ ] **Step 3: Provar o JOIN contra dados reais, sem gravar nada em produção**

Hoje não existe nenhuma guia real com `linha_digitavel` preenchida no banco
(confirmado nesta sessão — a geração de DAS real nunca rodou até o fim neste
ambiente). A prova usa uma guia e uma notificação **sintéticas, dentro de
uma transação que sempre faz ROLLBACK** — nada fica gravado.

Criar `app/scratchpad/_probe-0064.mjs`:

```javascript
// Prova a migration 0064 contra o banco real, sem gravar nada (BEGIN...ROLLBACK).
// Reusa o profile da ideapp (ja tem whatsapp_numero + whatsapp_habilitado_em
// de uma sessao anterior) como owner_user_id de teste.
import { readFileSync } from 'node:fs';
import pg from 'pg';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => {
    const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
  }),
);
const ref = env.NEXT_PUBLIC_SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\./)[1];

const c = new pg.Client({
  host: `db.${ref}.supabase.co`, port: 5432, user: 'postgres',
  password: env.SUPABASE_PASSWORD, database: 'postgres', ssl: { rejectUnauthorized: false },
});
await c.connect();

try {
  await c.query('BEGIN');

  const owner = await c.query(
    `SELECT p.user_id, p.company_id FROM public.profiles p
       JOIN auth.users u ON u.id = p.user_id
      WHERE u.email = 'walacesssantos@gmail.com'
        AND p.whatsapp_numero IS NOT NULL AND p.whatsapp_habilitado_em IS NOT NULL`
  );
  if (owner.rows.length === 0) throw new Error('Profile de teste sem WhatsApp habilitado — ajuste o e-mail no probe.');
  const { user_id: ownerId, company_id: companyId } = owner.rows[0];

  const guia = await c.query(
    `INSERT INTO public.guias_fiscais
       (company_id, owner_user_id, competencia_mes, competencia_ano, data_vencimento, linha_digitavel, status)
     VALUES ($1, $2, 7, 2026, '2026-08-20', '85810.00019 03605.999999 00000.000000 1 00000000008090', 'pendente')
     RETURNING id`,
    [companyId, ownerId],
  );
  const guiaId = guia.rows[0].id;

  await c.query(
    `INSERT INTO public.notifications
       (owner_user_id, company_id, tipo, titulo, corpo, entidade_ref, chave)
     VALUES ($1, $2, 'das_a_vencer', 'Seu DAS está próximo do vencimento (probe 0064)',
             'Notificação de teste da migration 0064.', $3, $4)`,
    [ownerId, companyId, guiaId, `probe-0064:${guiaId}`],
  );

  const r = await c.query(`SELECT tipo, linha_digitavel FROM public.notificacoes_pendentes_whatsapp(50)`);
  const linha = r.rows.find((row) => row.linha_digitavel === '85810.00019 03605.999999 00000.000000 1 00000000008090');
  console.log(linha
    ? 'ok    linha_digitavel apareceu na RPC para a notificação de teste'
    : 'FALHA linha_digitavel NÃO apareceu — linhas devolvidas: ' + JSON.stringify(r.rows));
} finally {
  await c.query('ROLLBACK');
  console.log('ROLLBACK feito — nada gravado em produção.');
  await c.end();
}
```

Run: `node scratchpad/_probe-0064.mjs`
Expected:
```
ok    linha_digitavel apareceu na RPC para a notificação de teste
ROLLBACK feito — nada gravado em produção.
```

Se der `FALHA`, o problema está no JOIN/CASE da migration — revisar antes de
seguir para a Task 2.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0064_linha_digitavel_whatsapp.sql
git commit -m "feat(1): notificacoes_pendentes_whatsapp devolve linha_digitavel da guia"
```

(`scratchpad/_apply-0064.mjs` e `scratchpad/_probe-0064.mjs` não entram no
commit — `scratchpad/` é ignorado pelo `.gitignore`.)

---

### Task 2: `montarTextoWhatsapp` — mensagem com a linha digitável (TDD)

**Files:**
- Create: `app/src/app/api/cron/obrigacoes/route.test.ts`
- Modify: `app/src/app/api/cron/obrigacoes/route.ts`

Não existe hoje nenhum teste para esta rota. Este task cria o arquivo do
zero, com um mock mínimo de `createAdminClient`/`rpc`/`from` (mesmo estilo
de `src/app/api/webhooks/uazapi/route.test.ts`), focado só no comportamento
da mensagem de WhatsApp — os outros loops (e-mail, billing) recebem estado
vazio/no-op nos mocks, sem precisar reproduzir a lógica deles aqui.

- [ ] **Step 1: Escrever o teste (falha esperada)**

Criar `app/src/app/api/cron/obrigacoes/route.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const SECRET = 'segredo-teste-cron-obrigacoes';
process.env.CRON_SECRET = SECRET;

const h = vi.hoisted(() => {
  const estado = {
    pendWhats: [] as Array<Record<string, unknown>>,
  };
  const updates: Array<{ tabela: string; valores: Record<string, unknown> }> = [];

  const rpc = vi.fn(async (nome: string) => {
    if (nome === 'materializar_obrigacoes') return { data: 0, error: null };
    if (nome === 'notificacoes_pendentes_email') return { data: [], error: null };
    if (nome === 'notificacoes_pendentes_whatsapp') return { data: estado.pendWhats, error: null };
    throw new Error(`RPC inesperada no mock: ${nome}`);
  });

  const from = vi.fn((tabela: string) => ({
    update: (valores: Record<string, unknown>) => ({
      eq: async () => { updates.push({ tabela, valores }); return { data: null, error: null }; },
    }),
  }));

  const createAdminClient = vi.fn(() => ({ rpc, from }));
  const sendEmail = vi.fn(async () => ({ ok: true }));
  const enviarMensagem = vi.fn(async () => ({ ok: true }));
  const configDeEnv = vi.fn(() => null);
  const rodarBilling = vi.fn(async () => ({ reconciliadas: 0 }));

  return { estado, updates, rpc, from, createAdminClient, sendEmail, enviarMensagem, configDeEnv, rodarBilling };
});

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: h.createAdminClient }));
vi.mock('@/lib/clients/email', () => ({ sendEmail: h.sendEmail }));
vi.mock('@/lib/billing/cron', () => ({ rodarBilling: h.rodarBilling }));
vi.mock('@/lib/uazapi/cliente', () => ({ configDeEnv: h.configDeEnv, enviarMensagem: h.enviarMensagem }));

import { GET } from './route';

function requisicaoFalsa() {
  return new Request('http://localhost/api/cron/obrigacoes', {
    headers: { authorization: `Bearer ${SECRET}` },
  });
}

beforeEach(() => {
  h.estado.pendWhats = [];
  h.updates.length = 0;
  h.rpc.mockClear();
  h.enviarMensagem.mockClear();
});

describe('GET /api/cron/obrigacoes — linha digitável na mensagem de WhatsApp', () => {
  it('notificação DAS com linha_digitavel: mensagem inclui a seção de pagamento', async () => {
    h.estado.pendWhats = [{
      id: 'n1', owner_user_id: 'u1', tipo: 'das_a_vencer',
      titulo: 'Seu DAS está próximo do vencimento',
      corpo: 'Seu DAS vence em 3 dia(s). Pague pelo app para ficar em dia.',
      action_href: '/impostos', whatsapp_numero: '+5511999990000',
      linha_digitavel: '85810.00019 03605.999999 00000.000000 1 00000000008090',
    }];

    await GET(requisicaoFalsa());

    // Texto exato (não só stringContaining) para provar a ORDEM: título,
    // corpo, código de pagamento, e só depois o link — cobre o caso do §4
    // item 4 da spec (linha_digitavel + action_href juntos).
    const chamada = h.enviarMensagem.mock.calls[0][1] as { telefone: string; texto: string };
    expect(chamada.telefone).toBe('+5511999990000');
    expect(chamada.texto).toBe(
      'Seu DAS está próximo do vencimento\n\n' +
      'Seu DAS vence em 3 dia(s). Pague pelo app para ficar em dia.\n\n' +
      'Código para pagar (copie e cole no app do seu banco):\n' +
      '85810.00019 03605.999999 00000.000000 1 00000000008090\n\n' +
      'https://balu-contabil.vercel.app/impostos',
    );
  });

  it('notificação DAS sem linha_digitavel (null): mensagem igual ao formato atual', async () => {
    h.estado.pendWhats = [{
      id: 'n2', owner_user_id: 'u1', tipo: 'das_a_vencer',
      titulo: 'Seu DAS está próximo do vencimento',
      corpo: 'Seu DAS vence em 3 dia(s). Pague pelo app para ficar em dia.',
      action_href: '/impostos', whatsapp_numero: '+5511999990000',
      linha_digitavel: null,
    }];

    await GET(requisicaoFalsa());

    const chamada = h.enviarMensagem.mock.calls[0][1] as { texto: string };
    expect(chamada.texto).toBe(
      'Seu DAS está próximo do vencimento\n\nSeu DAS vence em 3 dia(s). Pague pelo app para ficar em dia.\n\nhttps://balu-contabil.vercel.app/impostos',
    );
  });

  it('linha_digitavel como string vazia: tratada como ausente', async () => {
    h.estado.pendWhats = [{
      id: 'n3', owner_user_id: 'u1', tipo: 'das_a_vencer',
      titulo: 'Título', corpo: 'Corpo', action_href: null, whatsapp_numero: '+5511999990000',
      linha_digitavel: '',
    }];

    await GET(requisicaoFalsa());

    const chamada = h.enviarMensagem.mock.calls[0][1] as { texto: string };
    expect(chamada.texto).not.toContain('Código para pagar');
    expect(chamada.texto).toBe('Título\n\nCorpo');
  });

  it('notificação de outro tipo (pgdas_pendente): linha_digitavel nula não aparece', async () => {
    h.estado.pendWhats = [{
      id: 'n4', owner_user_id: 'u1', tipo: 'pgdas_pendente',
      titulo: 'Declaração mensal (PGDAS-D) pendente',
      corpo: 'A declaração do mês 202607 ainda não foi transmitida.',
      action_href: '/impostos', whatsapp_numero: '+5511999990000',
      linha_digitavel: null,
    }];

    await GET(requisicaoFalsa());

    const chamada = h.enviarMensagem.mock.calls[0][1] as { texto: string };
    expect(chamada.texto).not.toContain('Código para pagar');
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar a falha**

Run: `npx vitest run src/app/api/cron/obrigacoes/route.test.ts`
Expected: FAIL no primeiro teste ("mensagem inclui a seção de pagamento") —
o texto atual não tem `linha_digitavel` nem a seção "Código para pagar" (a
rota de hoje ignora esse campo por completo). Os outros 3 testes já devem
passar mesmo sem mudança nenhuma no código (são guarda-corpo do
comportamento atual) — confirmar isso também, é o sinal de que o teste está
isolando exatamente a mudança certa.

- [ ] **Step 3: Implementar `montarTextoWhatsapp` e usar no loop de WhatsApp**

Em `app/src/app/api/cron/obrigacoes/route.ts`, adicionar a função logo antes
de `export async function GET(req: Request) {` (depois do comentário de
`maxDuration`, linha 24 atual):

```typescript
// Achado no brainstorming do item "pagamento do DAS no WhatsApp": a SERPRO
// nao devolve Pix para DAS em nenhum servico identificado (GERARDAS12 nem
// GERARDASCOBRANCA17) — ver docs/superpowers/specs/2026-07-31-linha-
// digitavel-whatsapp-design.md §1. O que existe de verdade e a linha
// digitavel do boleto, ja persistida em guias_fiscais desde a geracao da
// guia. Funcao pura para poder testar a montagem da mensagem sem mockar
// rede/banco.
function montarTextoWhatsapp(n: {
  titulo: string;
  corpo: string;
  action_href: string | null;
  linha_digitavel: string | null;
  siteUrl: string;
}): string {
  const linhas = [n.titulo, '', n.corpo];
  if (n.linha_digitavel && n.linha_digitavel.trim()) {
    linhas.push('', 'Código para pagar (copie e cole no app do seu banco):', n.linha_digitavel.trim());
  }
  if (n.action_href) linhas.push('', `${n.siteUrl}${n.action_href}`);
  return linhas.join('\n');
}
```

E trocar o `texto:` dentro do loop de WhatsApp (linha ~91 atual) de:

```typescript
        texto: `${n.titulo}\n\n${n.corpo}${n.action_href ? `\n\n${siteUrl}${n.action_href}` : ''}`,
```

para:

```typescript
        texto: montarTextoWhatsapp({
          titulo: n.titulo,
          corpo: n.corpo,
          action_href: n.action_href,
          linha_digitavel: n.linha_digitavel,
          siteUrl,
        }),
```

- [ ] **Step 4: Rodar o teste de novo e confirmar que passa**

Run: `npx vitest run src/app/api/cron/obrigacoes/route.test.ts`
Expected: PASS nos 4 testes.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cron/obrigacoes/route.ts src/app/api/cron/obrigacoes/route.test.ts
git commit -m "feat(1): mensagem de WhatsApp de vencimento do DAS inclui a linha digitavel"
```

---

### Task 3: Verificação final e fechamento

**Files:** nenhum novo — só verificação.

- [ ] **Step 1: Suíte completa**

Run: `npx vitest run`
Expected: todos os testes verdes, incluindo os 4 novos de
`route.test.ts` (contagem total deve subir em exatamente 4 em relação ao
estado atual do branch).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: `TypeScript: No errors found` (0 erros).

- [ ] **Step 3: Confirmar que não há `npm run dev` rodando, depois `next build`**

Windows: `Get-CimInstance Win32_Process -Filter "Name='node.exe'"` — se
houver processo de `next dev`, parar antes (dois processos disputando
`.next/` corrompem o build, armadilha já documentada neste projeto).

Run: `rm -rf .next && npx next build`
Expected: `0 erros / 0 warnings`. Confirmar a contagem real de rotas pelo
manifesto, não pelo resumo do `rtk` (ruído de parser já visto antes neste
projeto):

```bash
node -e "const m = require('./.next/app-build-manifest.json'); console.log('rotas:', Object.keys(m.pages).length)"
```

- [ ] **Step 4: Nota sobre verificação manual — por que não precisa de smoke com o usuário**

Esta mudança não toca nenhuma tela nem fluxo que o usuário clique — é
formatação de mensagem de um cron que já roda sozinho, coberta pelos 4
testes da Task 2 (que cravam o comportamento exato da mensagem) e pela prova
contra o banco real da Task 1 (Step 3, com ROLLBACK). Diferente dos blocos
anteriores deste projeto (6A, 6B, 4B), que sempre passaram por roteiro de
smoke manual porque envolviam telas novas ou fluxos que só o clique humano
prova — aqui não há UI nova, e o `next build` já prova que nada mais no app
quebrou. Não pular smoke por preguiça; pular porque não há o que uma tela
provaria que o teste automatizado já não prove.

- [ ] **Step 5: Merge e push**

```bash
git status --porcelain
```

Esperado: limpo, só os dois untracked pré-existentes do projeto (PDF na raiz
e `.docx` em `app/`) — a feature já está toda commitada nas Tasks 1 e 2.

```bash
git checkout main
git pull origin main
git merge --no-ff feat/linha-digitavel-whatsapp -m "merge: linha digitavel do DAS na mensagem de WhatsApp de vencimento"
npx tsc --noEmit && npx vitest run
```

Expected: merge sem conflito, `tsc` 0, suíte verde.

**Push exige confirmação explícita do usuário na conversa ao vivo antes de
rodar** — mesma disciplina de todo bloco anterior deste projeto (4B, 6A, 6B,
base jurídica): `git push origin main` dispara auto-deploy em produção.
