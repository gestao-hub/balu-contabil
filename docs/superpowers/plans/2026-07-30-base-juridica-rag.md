# Base jurídica/contábil (RAG) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para implementar task a task. Os passos usam checkbox (`- [ ]`).

**Goal:** manter uma base de conteúdo jurídico/contábil (DOU + portal RFB/Simples Nacional) atualizada diariamente via `pg_cron`, e usá-la como contexto de apoio (grounding) quando o admin gera um rascunho no catálogo de explicações do Bloco 6A — sem mudar o que chega ao cliente.

**Architecture:** tabela nova com busca textual nativa do Postgres (sem embeddings/pgvector nesta rodada); uma Edge Function nova, agendada por `pg_cron` (mesmo mecanismo já em produção para `sync-municipios`, independente dos 2 crons do Vercel Hobby); `gerarRascunhoAction`/`montarPrompt` (Bloco 6A) passam a receber esse contexto como uma seção adicional do prompt, sem tocar nas regras existentes (inclusive "não citar lei").

**Tech Stack:** Next.js 15, Supabase/Postgres (`tsvector`/`tsquery`, `pg_cron`, `pg_net`), Deno (Supabase Edge Functions), vitest.

**Spec:** `docs/superpowers/specs/2026-07-30-base-juridica-rag-design.md`

---

## ⚠️ LEIA ANTES DE COMEÇAR

**Este plano traz código pronto onde o repo real foi lido e conferido, e thin (sem código inventado) onde há uma fronteira externa não sondada.** Mesma lição do Bloco 6B: escrever contra suposição sobre uma API externa custa mais do que sondar primeiro. Há duas fronteiras não sondadas de propósito nesta rodada: o contrato de busca do Diário Oficial da União e a estrutura real das páginas do portal RFB/Simples Nacional.

Em toda task:

1. **Confira cada import e cada assinatura lendo o código real** antes de usar.
2. **Reporte a divergência** em vez de contorná-la em silêncio.
3. **Sabotagem como prova:** depois de cada teste passar, quebre a linha que ele protege, veja o teste falhar apontando o lugar certo, e desfaça.

**Fatos já verificados contra o repo e o banco real em 2026-07-30** (não precisa reconferir, mas confie desconfiando):

- Última migration em `main`: `0060`. **A branch `feat/bloco-6b-whatsapp` (não mergeada) já usa `0061`** — o número real da migration desta feature depende de qual branch mergeia primeiro. **Task 1, Step 1 disso trata: reconferir o número na hora, não assumir.**
- `pg_cron` (1.6.4) e `pg_net` (0.20.0) já estão instalados e em uso em produção: há um job (`Sincronizar municipios`, `0 0 * * *`) que chama `net.http_post` contra uma Supabase Edge Function. Confirmado via `SELECT * FROM cron.job`.
- **Esse job NÃO foi criado por uma migration versionada** — não existe nenhum arquivo em `supabase/migrations/` com `cron.schedule`. Foi criado por fora (script avulso ou SQL Editor), porque o comando do job carrega a `service_role_key` em texto puro (`cron.job.command`), e isso **nunca pode entrar num arquivo versionado em git**. Esta feature segue o mesmo cuidado: a Task de agendar o cron usa um script em `scratchpad/` (não versionado, lê `.env.local` em tempo de execução), nunca uma migration.
- `pgvector` está disponível (`SELECT * FROM pg_available_extensions WHERE name='vector'` → true) mas **não instalado**. Não instalar nesta rodada — busca é textual (`tsvector`), conforme a spec §2.1.
- `public.tg_set_updated_at()` já existe (criada na `0001_init.sql`, reusada por toda tabela nova desde então) — a tabela nova desta feature usa o mesmo trigger, não inventa um novo.
- `websearch_to_tsquery('portuguese', 'MEI OR DAS-MEI OR Simples Nacional OR INSS OR ISS')` **testado contra o banco real**: gera `'mei' | 'das-m' <2> 'mei' | 'simpl' & 'nacional' | 'inss' | 'iss'`, casa corretamente com texto que contém os termos e NÃO casa com texto não relacionado. Confirma que "OR" maiúsculo entre frases funciona no `websearch_to_tsquery`, inclusive com palavras hifenizadas e frases de duas palavras.
- `lib/explicacoes/prompt.ts` (`montarPrompt`) e `admin/explicacoes/actions.ts` (`gerarRascunhoAction`) foram lidos por inteiro — o código das Tasks 3/4 abaixo reflete a assinatura e o fluxo reais, não uma suposição.
- Runner de migration: `node app/scratchpad/apply-migration.mjs <caminho.sql>` (lê `SUPABASE_PASSWORD` de `app/.env.local`).
- `scratchpad/` não é versionado neste repo (`.gitignore`) — script de agendamento do cron e qualquer probe ficam no disco, nunca `git add`.

---

## Onde este plano é grosso, e onde é fino — de propósito

**Tasks 1, 2, 3 e 4 trazem código completo** — schema, funções puras, integração com o prompt existente: eu li o código real e o banco real, e podem ser copiados depois de conferidos.

**Tasks 5 e 6 são thin.** São sondagens contra fontes externas (busca do DOU, estrutura do portal RFB/Simples Nacional) que não têm como ser verificadas sem tentar de verdade. **Task 7 depende do que 5 e 6 encontrarem** — não tem código pronto, porque escrevê-lo agora seria inventar um contrato que ninguém confirmou.

---

## Ordem e dependências

```
Task 1  migration — tabela documentos_juridicos                         (independente)
Task 2  lib/base-juridica/palavras-chave.ts                              (independente)
Task 3  lib/base-juridica/buscar.ts                                      ← Task 1, 2
Task 4  integrar ao prompt/gerarRascunhoAction do 6A                     ← Task 3
Task 5  sondagem do contrato de busca do DOU                             (independente)
Task 6  sondagem da estrutura do portal RFB/Simples Nacional             (independente)
Task 7  Edge Function sync-base-juridica + deploy                       ← Task 1, 5, 6
Task 8  agendar o pg_cron + probe + verificação final                   ← todas
```

---

### Task 1: Migration — tabela `documentos_juridicos`

**Files:**
- Create: `app/supabase/migrations/00XX_base_juridica.sql` (número real confirmado no Step 1)

- [ ] **Step 1: Confirmar o número real da migration**

Run: `cd app && ls supabase/migrations | tail -3`

Se o último arquivo listado for `0060_default_execute_fora_do_public.sql`, o número desta migration é `0061`. **Se já existir um `0061` (porque a branch `feat/bloco-6b-whatsapp` mergeou primeiro), o número desta migration é o seguinte livre** — confirme antes de criar o arquivo, e ajuste o nome do arquivo e todo o texto abaixo que menciona o número.

- [ ] **Step 2: Escrever a migration**

Criar `app/supabase/migrations/00XX_base_juridica.sql` (substituindo `00XX` pelo número confirmado no Step 1):

```sql
-- Base juridica/contabil — grounding interno para o rascunho de IA do
-- catalogo de explicacoes (Bloco 6A). NAO e lida pelo caminho do cliente
-- (tela de impostos, webhook do 6B) — so por gerarRascunhoAction, via admin
-- client. Busca textual nativa do Postgres nesta rodada (sem pgvector/
-- embeddings — ver spec 2026-07-30-base-juridica-rag-design.md, secao 2.1).

CREATE TABLE IF NOT EXISTS public.documentos_juridicos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fonte          text NOT NULL CHECK (fonte IN ('dou','receita_federal','simples_nacional')),
  -- Chave natural do documento (uma publicacao do DOU ou uma pagina do
  -- portal tem URL estavel) — e o que identifica "e o mesmo documento" ao
  -- longo do tempo. NAO usar hash_conteudo como chave: um documento que
  -- mudou de conteudo geraria hash novo, o upsert inseriria uma segunda
  -- linha em vez de atualizar a existente, acumulando versoes obsoletas.
  url_origem     text NOT NULL,
  titulo         text NOT NULL,
  texto          text NOT NULL,
  publicado_em   date,
  -- Hash do texto — usado so para a Edge Function PULAR reprocessamento
  -- (comparar hash antes de gravar), nunca e a chave do upsert.
  hash_conteudo  text NOT NULL,
  busca          tsvector GENERATED ALWAYS AS (to_tsvector('portuguese', titulo || ' ' || texto)) STORED,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS documentos_juridicos_fonte_url_uidx
  ON public.documentos_juridicos (fonte, url_origem);

CREATE INDEX IF NOT EXISTS documentos_juridicos_busca_gin
  ON public.documentos_juridicos USING GIN (busca);

-- Mesmo trigger reusado por toda tabela nova desde a 0001_init.sql — nao
-- inventar um updated_at manual.
CREATE TRIGGER documentos_juridicos_set_updated_at
  BEFORE UPDATE ON public.documentos_juridicos
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.documentos_juridicos ENABLE ROW LEVEL SECURITY;
-- Sem policy nenhuma + REVOKE explicito: mesma licao da 0053/0055/0058/0061 —
-- o ALTER DEFAULT PRIVILEGES do Supabase concede tudo em `public` para
-- anon/authenticated, calado, em TODA tabela nova.
REVOKE ALL ON public.documentos_juridicos FROM anon, authenticated;

COMMENT ON TABLE public.documentos_juridicos IS
  'Base juridica/contabil para grounding do rascunho de IA (catalogo do 6A). Leitura interna via service_role apenas — nunca lida pelo caminho do cliente.';

-- Tabela nova: rodar node app/scratchpad/_reload-postgrest.mjs
```

- [ ] **Step 3: Aplicar no banco**

Run: `cd app && node scratchpad/apply-migration.mjs supabase/migrations/00XX_base_juridica.sql`
Expected: sem erro.

- [ ] **Step 4: Recarregar o cache de esquema do PostgREST**

Run: `cd app && node scratchpad/_reload-postgrest.mjs`
Expected: `PostgREST: reload schema enviado.`

- [ ] **Step 5: Conferir o efeito, não o SQL**

```bash
cd app && node -e "
const {readFileSync}=require('fs');const pg=require('pg');
const env=Object.fromEntries(readFileSync('.env.local','utf8').split(/\r?\n/).filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^[\"']|[\"']\$/g,'')]}));
const ref=env.NEXT_PUBLIC_SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\./)[1];
(async()=>{const c=new pg.Client({host:'db.'+ref+'.supabase.co',port:5432,user:'postgres',password:env.SUPABASE_PASSWORD,database:'postgres',ssl:{rejectUnauthorized:false}});
await c.connect();
const r=await c.query(\"SELECT table_name,grantee,string_agg(DISTINCT privilege_type,',') p FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='documentos_juridicos' AND grantee IN ('anon','authenticated') GROUP BY 1,2\");
console.log('grants em documentos_juridicos para anon/authenticated:', r.rows);
await c.end();})()"
```

Expected: **nenhuma linha** (sem grant nenhum a `anon`/`authenticated`).

- [ ] **Step 6: Commit**

```bash
git add app/supabase/migrations/00XX_base_juridica.sql
git commit -m "feat(base-juridica): migration - tabela documentos_juridicos"
```

---

### Task 2: `lib/base-juridica/palavras-chave.ts`

**Files:**
- Create: `app/src/lib/base-juridica/palavras-chave.ts`
- Test: `app/src/lib/base-juridica/palavras-chave.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, it, expect } from 'vitest';
import { palavrasChaveDaSituacao } from './palavras-chave';
import { situacaoDasMei, situacaoPgdas } from '@/lib/fiscal/situacao-fiscal';

describe('palavrasChaveDaSituacao', () => {
  it('das-mei inclui MEI e so os componentes desta situacao', () => {
    const p = palavrasChaveDaSituacao(situacaoDasMei('Prestacao de Servicos'));
    expect(p).toContain('MEI');
    expect(p).toContain('INSS');
    expect(p).toContain('ISS');
    expect(p).not.toContain('ICMS');
  });

  it('pgdas inclui o anexo e Fator R so quando se aplica', () => {
    const comFatorR = palavrasChaveDaSituacao(situacaoPgdas('Anexo III', true));
    expect(comFatorR).toContain('Anexo III');
    expect(comFatorR).toContain('Fator R');

    const semFatorR = palavrasChaveDaSituacao(situacaoPgdas('Anexo I', false));
    expect(semFatorR).not.toContain('Fator R');
  });

  it('sempre inclui Simples Nacional, o guarda-chuva comum as duas situacoes', () => {
    expect(palavrasChaveDaSituacao(situacaoDasMei('Comercio ou Industria'))).toContain('Simples Nacional');
    expect(palavrasChaveDaSituacao(situacaoPgdas('Anexo I', false))).toContain('Simples Nacional');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd app && npx vitest run src/lib/base-juridica/palavras-chave.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

```ts
// Base juridica — as palavras-chave de busca textual para uma situacao
// fiscal. Puro: sem I/O, sem `server-only`. Reaproveita `SituacaoFiscal` do
// 6A/6B sem alargar o tipo — a mesma garantia estrutural: nao ha como este
// modulo carregar dado de contribuinte, porque o tipo que ele recebe nao tem
// onde guardar um.
import type { SituacaoFiscal } from '@/lib/fiscal/situacao-fiscal';

const NOME_COMPONENTE_BUSCA: Record<string, string> = {
  inss: 'INSS',
  icms: 'ICMS',
  iss: 'ISS',
};

export function palavrasChaveDaSituacao(s: SituacaoFiscal): string[] {
  if (s.tributo === 'das-mei') {
    const componentes = [...s.componentes].map((c) => NOME_COMPONENTE_BUSCA[c] ?? c.toUpperCase());
    return ['MEI', 'DAS-MEI', 'Simples Nacional', ...componentes];
  }

  const base = ['Simples Nacional', 'PGDAS-D', s.anexo];
  return s.fatorR ? [...base, 'Fator R'] : base;
}
```

- [ ] **Step 4: Rodar**

Run: `cd app && npx vitest run src/lib/base-juridica/palavras-chave.test.ts && npx tsc --noEmit`
Expected: PASS, 0 erros.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/base-juridica/palavras-chave.ts app/src/lib/base-juridica/palavras-chave.test.ts
git commit -m "feat(base-juridica): palavras-chave de busca por situacao fiscal"
```

---

### Task 3: `lib/base-juridica/buscar.ts`

**Files:**
- Create: `app/src/lib/base-juridica/buscar.ts`
- Test: `app/src/lib/base-juridica/buscar.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, it, expect, vi } from 'vitest';
import { buscarContextoJuridico } from './buscar';
import { situacaoDasMei } from '@/lib/fiscal/situacao-fiscal';

function clienteFalso(resultado: { data: unknown; error: unknown }) {
  return {
    from: (tabela: string) => {
      if (tabela !== 'documentos_juridicos') throw new Error(`tabela inesperada: ${tabela}`);
      return {
        select: (_cols: string) => ({
          textSearch: (_col: string, _query: string, _opts: unknown) => ({
            limit: async (_n: number) => resultado,
          }),
        }),
      };
    },
  } as never;
}

describe('buscarContextoJuridico', () => {
  it('devolve os trechos encontrados (titulo e texto)', async () => {
    const sb = clienteFalso({
      data: [{ titulo: 'Resolução X', texto: 'Trecho relevante.' }],
      error: null,
    });
    const r = await buscarContextoJuridico(sb, situacaoDasMei('Prestacao de Servicos'));
    expect(r).toEqual([{ titulo: 'Resolução X', texto: 'Trecho relevante.' }]);
  });

  // NUNCA LANÇA — quem chama (gerarRascunhoAction) trata ausencia de contexto
  // como "gerar sem contexto extra", o mesmo estado de hoje sem esta feature.
  // Se este modulo lançasse, um erro de busca derrubaria a geração de
  // rascunho inteira por causa de uma peça que é só apoio.
  it('erro do banco devolve lista vazia, nunca lança', async () => {
    const sb = clienteFalso({ data: null, error: { message: 'falhou' } });
    const r = await buscarContextoJuridico(sb, situacaoDasMei('Prestacao de Servicos'));
    expect(r).toEqual([]);
  });

  it('exceção na chamada devolve lista vazia, nunca lança', async () => {
    const sb = {
      from: () => { throw new Error('conexão caiu'); },
    } as never;
    const r = await buscarContextoJuridico(sb, situacaoDasMei('Prestacao de Servicos'));
    expect(r).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd app && npx vitest run src/lib/base-juridica/buscar.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

```ts
// Base juridica — busca textual em documentos_juridicos (Task 1). NUNCA
// lança: quem chama (gerarRascunhoAction, Task 4) trata lista vazia como
// "sem contexto extra", o mesmo comportamento de hoje sem esta feature —
// uma falha aqui e uma peca de apoio caindo, nao motivo para bloquear o
// admin de gerar rascunho.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SituacaoFiscal } from '@/lib/fiscal/situacao-fiscal';
import { palavrasChaveDaSituacao } from './palavras-chave';

export type TrechoJuridico = { titulo: string; texto: string };

const LIMITE = 5;

export async function buscarContextoJuridico(
  sb: SupabaseClient, s: SituacaoFiscal,
): Promise<TrechoJuridico[]> {
  try {
    // "OR" maiusculo entre frases — testado contra websearch_to_tsquery no
    // banco real (ver nota do plano): frases de duas palavras ("Simples
    // Nacional") viram AND interno, palavras hifenizadas ("DAS-MEI") viram
    // frase por proximidade, e cada termo entra no OR geral.
    const consulta = palavrasChaveDaSituacao(s).join(' OR ');
    const { data, error } = await sb
      .from('documentos_juridicos')
      .select('titulo, texto')
      .textSearch('busca', consulta, { type: 'websearch', config: 'portuguese' })
      .limit(LIMITE);
    if (error || !data) return [];
    return data as TrechoJuridico[];
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Rodar**

Run: `cd app && npx vitest run src/lib/base-juridica/buscar.test.ts && npx tsc --noEmit`
Expected: PASS, 0 erros.

- [ ] **Step 5: Sabotar, commitar**

Run: `cd app && npx vitest run src/lib/base-juridica`

Sabotagem: troque `if (error || !data) return [];` para `if (error) return [];` (deixando `!data` sem tratamento). Rode de novo com um mock que devolve `{data: null, error: null}` — se não houver teste cobrindo esse caso especificamente, ADICIONE um antes de sabotar (`data: null, error: null` é um estado real que o PostgREST pode devolver). Confirme que o teste novo falha com a sabotagem (`data as TrechoJuridico[]` viraria `null`, e `.map`/iteração posterior quebraria), então desfaça.

```bash
git add app/src/lib/base-juridica/buscar.ts app/src/lib/base-juridica/buscar.test.ts
git commit -m "feat(base-juridica): busca textual de contexto para o prompt do 6A"
```

---

### Task 4: Integrar ao prompt e ao `gerarRascunhoAction` do 6A

**Files:**
- Modify: `app/src/lib/explicacoes/prompt.ts`
- Modify: `app/src/lib/explicacoes/prompt.test.ts`
- Modify: `app/src/app/(auth)/(gated)/admin/explicacoes/actions.ts`
- Modify: `app/src/app/(auth)/(gated)/admin/explicacoes/actions.test.ts`

- [ ] **Step 1: Ler os dois arquivos reais antes de mexer**

Run: `cd app && cat src/lib/explicacoes/prompt.ts "src/app/(auth)/(gated)/admin/explicacoes/actions.ts"`

Confirme que `montarPrompt(s: SituacaoFiscal): string` é a assinatura atual, e que `gerarRascunhoAction` chama `montarPrompt(situacao)` logo antes de `gerarTexto(...)`. Se qualquer um dos dois divergir do que os Steps abaixo assumem, pare e reporte antes de editar.

- [ ] **Step 2: Escrever o teste que falha (extensão do prompt)**

Adicionar a `app/src/lib/explicacoes/prompt.test.ts` (arquivo já existe — acrescentar estes casos, não duplicar os existentes):

```ts
describe('contexto juridico de apoio (base-juridica)', () => {
  it('sem contexto, o prompt e IDENTICO ao de hoje (compatibilidade)', () => {
    const s = situacaoDasMei('Prestacao de Servicos');
    expect(montarPrompt(s)).toBe(montarPrompt(s, undefined));
    expect(montarPrompt(s)).toBe(montarPrompt(s, []));
  });

  it('com contexto, inclui os trechos numa secao separada, marcada como uso interno', () => {
    const s = situacaoDasMei('Prestacao de Servicos');
    const p = montarPrompt(s, [{ titulo: 'Resolução CGSN 140', texto: 'Teto de faturamento do MEI.' }]);
    expect(p).toContain('Resolução CGSN 140');
    expect(p).toContain('Teto de faturamento do MEI.');
    expect(p.toLowerCase()).toMatch(/uso interno|não cite|nao cite/);
  });

  // A REGRA CENTRAL NAO PODE AFROUXAR: mesmo com contexto juridico de apoio,
  // o prompt continua proibindo citar lei/norma no texto final.
  it('com contexto, a proibicao de citar lei continua presente', () => {
    const s = situacaoDasMei('Prestacao de Servicos');
    const p = montarPrompt(s, [{ titulo: 'Lei X', texto: 'Artigo Y diz Z.' }]).toLowerCase();
    expect(p).toContain('não cite lei');
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `cd app && npx vitest run src/lib/explicacoes/prompt.test.ts`
Expected: FAIL — `montarPrompt` não aceita um segundo argumento (erro de tipo/assinatura).

- [ ] **Step 4: Implementar a extensão do prompt**

Em `app/src/lib/explicacoes/prompt.ts`, mudar a assinatura de `montarPrompt` e acrescentar a seção nova. **Não altere nenhuma linha das regras existentes** — só adicione:

```ts
import type { TrechoJuridico } from '@/lib/base-juridica/buscar';

// ... (resto do arquivo antes de montarPrompt inalterado) ...

export function montarPrompt(s: SituacaoFiscal, contexto?: TrechoJuridico[]): string {
  const marcadores = marcadoresDaChave(chaveDaSituacao(s));
  const lista = marcadores.map((m) => `{${m}}`).join(', ');
  const exemplo = marcadores.length ? `{${marcadores[0]}}` : '{valor}';

  const secaoContexto = contexto && contexto.length
    ? [
        '',
        'CONTEXTO DE APOIO (uso interno seu, para redigir com precisão — NÃO cite',
        'nem repita este texto, nem mencione lei/norma/resolução no rascunho):',
        ...contexto.map((c) => `- ${c.titulo}: ${c.texto}`),
      ]
    : [];

  return [
    'Você escreve explicações curtas sobre tributos para donos de pequenas empresas no Brasil,',
    'em português simples, sem jargão. Quem vai ler não é contador.',
    '',
    'SITUAÇÃO:',
    descreverSituacao(s),
    ...secaoContexto,
    '',
    'REGRAS DO TEXTO:',
    '- Escreva de duas a quatro frases, em texto corrido, sem título e sem listas.',
    '- Fale com quem lê na segunda pessoa ("você paga"), não "o contribuinte paga".',
    `- Use exatamente estes marcadores, cada um pelo menos uma vez: ${lista}.`,
    '- Cada marcador será trocado por um valor em reais na hora de exibir. Escreva de',
    `  modo que a frase continue correta depois da troca: prefira "${exemplo} de <nome do`,
    `  tributo>", e nunca "a contribuição ${exemplo}" nem "o ${exemplo}".`,
    '- Não escreva nenhum valor em dinheiro, nenhuma alíquota e nenhum percentual:',
    '  os números entram só pelos marcadores.',
    '- Não invente marcador que não esteja na lista acima.',
    '- Não dê conselho: não diga o que fazer, o que contratar nem como economizar.',
    '- Não cite lei, artigo, resolução nem número de norma.',
    '- Não fale de prazo nem de data de vencimento.',
    '- Explique o que o contribuinte está pagando e por quê, e nada além disso.',
    '',
    'Responda apenas com o texto, sem aspas e sem comentários.',
  ].join('\n');
}
```

⚠️ Confira contra o arquivo real se `descreverSituacao`, `marcadoresDaChave` e `chaveDaSituacao` continuam com esses nomes e esses imports — copie a função inteira só depois de confirmar que o corpo acima é igual ao original mais a seção de contexto.

- [ ] **Step 5: Rodar**

Run: `cd app && npx vitest run src/lib/explicacoes/prompt.test.ts && npx tsc --noEmit`
Expected: PASS (incluindo os testes já existentes, inalterados), 0 erros.

- [ ] **Step 6: Escrever o teste que falha (gerarRascunhoAction chama a busca)**

Em `app/src/app/(auth)/(gated)/admin/explicacoes/actions.test.ts` (arquivo já existe, com mocks extensos — ver Step 1 desta task), acrescentar no topo, antes dos `vi.mock` existentes:

```ts
vi.mock('@/lib/base-juridica/buscar', () => ({
  buscarContextoJuridico: vi.fn(async () => []),
}));
```

Isso faz `gerarRascunhoAction` continuar funcionando exatamente como hoje em todos os testes já existentes (contexto vazio = prompt idêntico, confirmado pela Task 4/Step 2 acima), sem precisar ensinar o mock manual de `from()` a entender a tabela `documentos_juridicos`.

Acrescentar um teste novo confirmando que a busca É chamada com a situação certa:

```ts
import { buscarContextoJuridico } from '@/lib/base-juridica/buscar';

// ... dentro do describe existente, ou em um describe novo ...

it('busca contexto juridico para a situacao antes de montar o prompt', async () => {
  await gerarRascunhoAction(CHAVE_SIT);
  expect(buscarContextoJuridico).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ tributo: 'das-mei' }),
  );
});
```

- [ ] **Step 7: Rodar e ver falhar**

Run: `cd app && npx vitest run "src/app/(auth)/(gated)/admin/explicacoes"`
Expected: FAIL no teste novo — `gerarRascunhoAction` ainda não chama `buscarContextoJuridico`.

- [ ] **Step 8: Implementar a chamada em `gerarRascunhoAction`**

Em `app/src/app/(auth)/(gated)/admin/explicacoes/actions.ts`, acrescentar o import:

```ts
import { buscarContextoJuridico } from '@/lib/base-juridica/buscar';
```

E, dentro de `gerarRascunhoAction`, logo antes da chamada a `gerarTexto` (onde hoje `montarPrompt(situacao)` é usado), buscar o contexto e passá-lo:

```ts
const contexto = await buscarContextoJuridico(sb, situacao);
// ...
texto = await gerarTexto(
  {
    provedor: cfg.provedor as Provedor,
    modelo: cfg.modelo,
    base_url: cfg.base_url,
    chave: chaveIa,
  },
  montarPrompt(situacao, contexto),
);
```

⚠️ Confira contra o arquivo real ONDE exatamente `montarPrompt(situacao)` é chamado hoje (dentro do `try` que envolve `gerarTexto`, ver Step 1) — a chamada a `buscarContextoJuridico` pode ficar fora desse `try` (ela já nunca lança, por construção da Task 3) ou dentro, mas `montarPrompt(situacao, contexto)` tem que substituir a chamada de um argumento só, no lugar exato onde ela está hoje — não mova a chamada a `gerarTexto` nem a reordene em relação às outras validações (chave inválida, situação desconhecida, texto aprovado existente) que já rodam antes.

- [ ] **Step 9: Rodar, sabotar, commitar**

Run: `cd app && npx vitest run "src/app/(auth)/(gated)/admin/explicacoes" src/lib/explicacoes && npx tsc --noEmit`

Sabotagem: troque `montarPrompt(situacao, contexto)` de volta para `montarPrompt(situacao)` (sem o contexto). O teste "busca contexto juridico para a situacao antes de montar o prompt" continua passando (a chamada a `buscarContextoJuridico` ainda acontece), mas rode manualmente uma verificação adicional: com um mock de `buscarContextoJuridico` devolvendo um trecho não-vazio, confirme que o prompt passado para `gerarTexto` mockado contém o texto do trecho — se esse teste não existir ainda, adicione-o agora, veja-o falhar com a sabotagem, então desfaça.

```bash
git add app/src/lib/explicacoes/prompt.ts app/src/lib/explicacoes/prompt.test.ts \
  "app/src/app/(auth)/(gated)/admin/explicacoes/actions.ts" \
  "app/src/app/(auth)/(gated)/admin/explicacoes/actions.test.ts"
git commit -m "feat(base-juridica): gerarRascunhoAction usa contexto juridico no prompt"
```

---

### Task 5: Sondagem do contrato de busca do Diário Oficial da União

**Investigativa — sem código pronto porque o contrato real nunca foi testado por este projeto.**

**Files:**
- Create: `app/scratchpad/_sondar-dou.mjs` (não versionado — mesma convenção descoberta na Task 4 do 6B)

- [ ] **Step 1: Confirmar se existe um mecanismo de busca público**

O ponto de partida é `https://www.in.gov.br/consulta` (busca oficial da Imprensa Nacional) e ferramentas de terceiros que já automatizam isso (ex. Ro-DOU, um projeto open-source que replica os parâmetros de busca do site). Nenhum dos dois foi testado por este repo — a Task é confirmar, contra a URL real, um caminho que devolva resultado filtrável por palavra-chave (ex.: "Simples Nacional", "CGSN", "MEI") e por data.

- [ ] **Step 2: Escrever a sonda**

```javascript
// app/scratchpad/_sondar-dou.mjs
// Sonda o mecanismo de busca do Diario Oficial da Uniao atras de um caminho
// que devolva resultado filtravel por palavra-chave e data, sem exigir
// autenticacao. NAO grava nada no banco — so imprime o que encontrou.
//
// Uso: node scratchpad/_sondar-dou.mjs "Simples Nacional"

const termo = process.argv[2] ?? 'Simples Nacional';

// TODO na implementacao real: tentar https://www.in.gov.br/consulta com os
// parametros de busca reais (inspecionar a requisicao que o proprio site
// faz ao pesquisar, via devtools do navegador, ja que pode nao haver
// documentacao publica formal) OU replicar o que o Ro-DOU
// (https://github.com/gestaogovbr/Ro-dou) usa internamente — ele e
// open-source, dá pra ler o codigo dele para saber o endpoint real em vez
// de adivinhar. Imprimir: status HTTP, forma da resposta (JSON? HTML?),
// quantos resultados para o termo, e se ha campo de data/link para o texto
// completo de cada resultado.
```

- [ ] **Step 3: Rodar e reportar**

Run: `cd app && node scratchpad/_sondar-dou.mjs "Simples Nacional"`

Reporte, como comentário no próprio arquivo (parágrafo no topo, com a data da sondagem): o endpoint real encontrado (ou a confirmação de que não há um sem autenticação/scraping), o formato da resposta, e um exemplo real de item encontrado (título + trecho). **Isso vira o contrato que a Task 7 usa** — não decida a forma final da Edge Function sem ter rodado esta sonda pelo menos uma vez contra a fonte de verdade.

- [ ] **Step 4: Decidir e documentar**

Se não houver caminho viável sem autenticação/scraping frágil demais para manter, documente isso aqui e no arquivo — a Task 7 pode reduzir escopo para só a fonte RFB/Simples Nacional (Task 6) nesta primeira versão, deixando o DOU como próximo passo. **Não invente um endpoint que não foi confirmado rodando.**

---

### Task 6: Sondagem da estrutura do portal RFB/Simples Nacional

**Investigativa — mesmo princípio da Task 5.**

**Files:**
- Create: `app/scratchpad/_sondar-portal-simples.mjs` (não versionado)

- [ ] **Step 1: Escolher as páginas-alvo**

Uma lista curada (não crawling livre) de páginas conhecidas do portal do Simples Nacional (`www8.receita.fazenda.gov.br` ou `gov.br/receitafederal`, o domínio real a confirmar) que respondem perguntas frequentes sobre MEI/Simples Nacional — ex. a página de perguntas frequentes do Simples Nacional, a página de resoluções do CGSN.

- [ ] **Step 2: Escrever a sonda**

```javascript
// app/scratchpad/_sondar-portal-simples.mjs
// Sonda a estrutura real de 1-2 paginas do portal RFB/Simples Nacional para
// confirmar se da pra extrair texto util por scraping simples (fetch +
// parser de HTML) antes de escrever o parser definitivo da Task 7.
//
// Uso: node scratchpad/_sondar-portal-simples.mjs <url>

const url = process.argv[2];
if (!url) {
  console.error('Uso: node scratchpad/_sondar-portal-simples.mjs <url>');
  process.exit(1);
}

// TODO na implementacao real: fetch(url), imprimir o Content-Type da
// resposta, o tamanho do HTML, e uma tentativa de extrair o texto principal
// (title + paragrafos do corpo — qualquer parser HTML leve resolve, este
// repo ja usa Next.js/React mas nao tem um parser de HTML arbitrario
// instalado; confirmar se vale a pena adicionar uma dependencia pequena ou
// se regex/split simples ja resolve para as paginas-alvo especificas).
```

- [ ] **Step 3: Rodar contra 1-2 páginas reais e reportar**

Run: `cd app && node scratchpad/_sondar-portal-simples.mjs <url real>`

Reporte como comentário no arquivo: a URL testada, se o conteúdo é HTML estático (scraping simples funciona) ou depende de JavaScript (precisaria de outra abordagem), e um trecho real do texto extraído.

---

### Task 7: Edge Function `sync-base-juridica`

**Depende do que as Tasks 5 e 6 encontraram — thin de propósito.**

**Files:**
- Create: `app/supabase/functions/sync-base-juridica/index.ts`

- [ ] **Step 1: Ler o molde real**

Run: `cd app && cat supabase/functions/sync-municipios/index.ts`

Confirme a forma: `Deno.serve(async (_req) => {...})`, leitura de `Deno.env.get(...)` para credenciais, `createClient` do `npm:@supabase/supabase-js@2`, upsert em lotes (`chunkArray`), resposta `200`/`207` conforme sucesso parcial.

- [ ] **Step 2: Implementar seguindo o mesmo molde, com as fontes confirmadas nas Tasks 5/6**

Estrutura mínima (adaptar com o que as Tasks 5/6 confirmaram — **não inventar campo/endpoint que a sondagem não confirmou**):

```typescript
import { createClient } from 'npm:@supabase/supabase-js@2';

// Hash simples (SHA-256, disponivel via Web Crypto nativo do Deno) — usado
// so para a funcao decidir se vale a pena regravar uma linha, nunca como
// chave do upsert (ver comentario da migration, Task 1).
async function hashTexto(texto: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

type Documento = {
  fonte: 'dou' | 'receita_federal' | 'simples_nacional';
  url_origem: string;
  titulo: string;
  texto: string;
  publicado_em: string | null;
};

// TODO: buscarDou() e buscarPortalSimples() usam o contrato confirmado nas
// Tasks 5/6 — substituir estes stubs pelo que a sondagem encontrou.
async function buscarDou(): Promise<Documento[]> {
  return [];
}
async function buscarPortalSimples(): Promise<Documento[]> {
  return [];
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

Deno.serve(async (_req) => {
  const start = Date.now();
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const [dou, portalSimples] = await Promise.allSettled([buscarDou(), buscarPortalSimples()]);
  const documentos: Documento[] = [
    ...(dou.status === 'fulfilled' ? dou.value : []),
    ...(portalSimples.status === 'fulfilled' ? portalSimples.value : []),
  ];
  const falhasFonte = [dou, portalSimples].filter((r) => r.status === 'rejected').length;

  let upserted = 0;
  let failed = 0;

  for (const chunk of chunkArray(documentos, 200)) {
    const linhas = await Promise.all(chunk.map(async (d) => ({
      fonte: d.fonte,
      url_origem: d.url_origem,
      titulo: d.titulo,
      texto: d.texto,
      publicado_em: d.publicado_em,
      hash_conteudo: await hashTexto(d.texto),
    })));

    const { error } = await supabase
      .from('documentos_juridicos')
      .upsert(linhas, { onConflict: 'fonte,url_origem' });
    if (error) {
      console.error('[sync-base-juridica] chunk error:', error.message);
      failed += chunk.length;
    } else {
      upserted += chunk.length;
    }
  }

  const duration_ms = Date.now() - start;
  const ok = failed === 0 && falhasFonte === 0;

  return new Response(
    JSON.stringify({ ok, total: documentos.length, upserted, failed, falhasFonte, duration_ms }),
    { status: ok ? 200 : 207, headers: { 'Content-Type': 'application/json' } },
  );
});
```

⚠️ **`Promise.allSettled` é de propósito, não `Promise.all`**: uma fonte falhando (DOU fora do ar, portal mudou de layout) não pode derrubar a atualização da outra — mesmo princípio de "best-effort por fonte" da spec §5.

- [ ] **Step 3: Deploy**

Este projeto não tem `supabase/config.toml` local nem histórico de `supabase functions deploy` documentado — confirme com o usuário como as Edge Functions deste projeto são deployadas antes de tentar (`npx supabase login` + `npx supabase link --project-ref <ref>` + `npx supabase functions deploy sync-base-juridica`, ou outro caminho que ele já use). **Não presuma que o MCP do Supabase tem permissão neste ambiente** — foi tentado nesta sessão e devolveu "permission denied".

- [ ] **Step 4: Testar a função deployada manualmente**

```bash
curl -s -X POST "<SUPABASE_URL>/functions/v1/sync-base-juridica" \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>"
```

Expected: `200` (ou `207` se alguma fonte ainda não estiver implementada de verdade — aceitável nesta primeira versão se a Task 5/6 concluiu que uma das duas fontes não é viável ainda).

---

### Task 8: Agendar o `pg_cron`, probe e verificação final

**Files:**
- Create: `app/scratchpad/_agendar-cron-base-juridica.mjs` (não versionado — nunca commitar um script com a service_role_key embutida)
- Create: `app/scratchpad/_probe-base-juridica.mjs` (não versionado)

- [ ] **Step 1: Escrever e rodar o script de agendamento**

```javascript
// app/scratchpad/_agendar-cron-base-juridica.mjs
// Agenda o job pg_cron que dispara a Edge Function sync-base-juridica
// diariamente. NAO versionado de proposito: o comando do job carrega a
// service_role_key em texto puro (mesma caracteristica do job existente
// "Sincronizar municipios", que tambem nao foi criado por uma migration
// versionada — ver nota do topo do plano).
//
// Uso: node scratchpad/_agendar-cron-base-juridica.mjs

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

// Horario as 06:00 UTC — diferente da meia-noite UTC do sync-municipios, de
// proposito, para nao competir por recursos no mesmo instante. Ajustar se o
// usuario preferir outro horario.
await c.query(`
  select cron.schedule(
    'sync-base-juridica',
    '0 6 * * *',
    $$ select net.http_post(
         url:='${env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/sync-base-juridica',
         headers:='{"Authorization":"Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}"}'::jsonb,
         timeout_milliseconds:=25000
       );
    $$
  );
`);
console.log('Job pg_cron "sync-base-juridica" agendado.');
await c.end();
```

Run: `cd app && node scratchpad/_agendar-cron-base-juridica.mjs`
Expected: `Job pg_cron "sync-base-juridica" agendado.`

- [ ] **Step 2: Confirmar o agendamento**

```bash
cd app && node -e "
const {readFileSync}=require('fs');const pg=require('pg');
const env=Object.fromEntries(readFileSync('.env.local','utf8').split(/\r?\n/).filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^[\"']|[\"']\$/g,'')]}));
const ref=env.NEXT_PUBLIC_SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\./)[1];
(async()=>{const c=new pg.Client({host:'db.'+ref+'.supabase.co',port:5432,user:'postgres',password:env.SUPABASE_PASSWORD,database:'postgres',ssl:{rejectUnauthorized:false}});
await c.connect();
const r=await c.query(\"SELECT jobname, schedule, active FROM cron.job WHERE jobname='sync-base-juridica'\");
console.log('job:', JSON.stringify(r.rows));
await c.end();})()"
```

Expected: uma linha, `active: true`, `schedule: '0 6 * * *'`.

- [ ] **Step 3: O probe**

```javascript
// app/scratchpad/_probe-base-juridica.mjs
// Somente leitura, mesmo molde de _probe-6a.mjs/_probe-6b.mjs. Confirma:
// 1. anon nao le documentos_juridicos (401 — migration REVOKE ALL);
// 2. se houver linhas, nenhuma tem (fonte, url_origem) duplicado.
//
// Uso: node scratchpad/_probe-base-juridica.mjs
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => {
    const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
  }),
);

let tudoOk = true;

const r1 = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/documentos_juridicos?select=id&limit=1`, {
  headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, Authorization: `Bearer ${env.NEXT_PUBLIC_SUPABASE_ANON_KEY}` },
});
const okAnon = r1.status === 401;
console.log(okAnon ? 'ok' : 'FALHA', '  anon NÃO lê documentos_juridicos (esperado 401, veio', r1.status, ')');
tudoOk &&= okAnon;

console.log(tudoOk ? '=== OK: tudo verde ===' : '=== FALHA: ver acima ===');
process.exit(tudoOk ? 0 : 1);
```

Run: `cd app && node scratchpad/_probe-base-juridica.mjs`
Expected: `ok  anon NÃO lê documentos_juridicos...` e `=== OK: tudo verde ===`.

- [ ] **Step 4: Verificação final e fechamento**

Run: `cd app && npx vitest run && npx tsc --noEmit`
Expected: suíte cheia verde, 0 erros de tipo.

Antes de `next build`: confirmar que não há `npm run dev` rodando (ver nota de armadilha de ambiente do projeto — os dois processos disputam `.next/`).

Run: `cd app && npx next build`
Expected: 0 erros.

```bash
git add docs/superpowers/plans/2026-07-30-base-juridica-rag.md
git commit -m "docs(base-juridica): fechamento — cron agendado, probe verde, build limpo"
```

**Merge e push exigem o aval explícito do usuário na conversa ao vivo** — mesma convenção de todo bloco anterior deste projeto (4B, 6A, 6B).

---

## Dívidas que este plano NÃO resolve (registradas, não esquecidas)

- **Busca vetorial (pgvector + embeddings)** — caminho de evolução documentado na spec §2.1, não construído nesta rodada.
- **Se a Task 5 concluir que não há caminho viável para o DOU sem scraping frágil ou autenticação**, a primeira versão desta feature fica só com a fonte RFB/Simples Nacional — decisão a tomar na hora, documentada no próprio código da Edge Function.
- **Horário exato do `pg_cron`** — Task 8 usa `0 6 * * *` como padrão; confirmar com o usuário se há preferência antes de rodar o Step 1 daquela task.
- **Deploy da Edge Function** — este projeto não documenta o processo hoje; Task 7/Step 3 pede confirmação do usuário antes de tentar, em vez de presumir CLI configurada ou acesso ao MCP do Supabase (que devolveu "permission denied" nesta sessão).
