# Bloco 6A — Explicação de imposto com IA · Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para implementar task a task. Os passos usam checkbox (`- [ ]`).

**Goal:** O cliente abre a tela de impostos e lê, em português simples, o que aquele número é — com o texto gerado por IA **uma vez por situação**, revisado por um humano, e os valores preenchidos pela Balu.

**Architecture:** A IA sai do caminho da requisição. Ela alimenta um **catálogo** de explicações por *situação fiscal* (nunca por cliente); a tela deriva a chave da situação, busca o texto aprovado e troca marcadores por valores localmente. Nenhum dado de contribuinte atravessa a fronteira.

**Tech Stack:** Next.js 15 (App Router, Server Actions), Supabase/Postgres, vitest. Provedor de IA configurável pelo AdminBalu (adaptador OpenAI-compatível + adaptador Anthropic), com a chave cifrada pelo cofre do Bloco E (`lib/crypto/envelope.ts`).

**Spec:** `docs/superpowers/specs/2026-07-28-bloco-6a-explicacao-ia-design.md`

---

## ⚠️ LEIA ANTES DE COMEÇAR

**Este plano traz código pronto, e código pronto em plano NÃO é confiável.** No Bloco 4B, **nenhuma** das 12 tasks passou sem divergência entre o plano e o repo real: havia funções inventadas, um fluxo que nunca fechava e um `retry` num POST não-idempotente.

Por isso, em toda task:

1. **Confira cada import e cada assinatura lendo o código real** antes de usar.
2. **Reporte a divergência** em vez de contorná-la em silêncio.
3. **Não escreva contra documentação** — sonde a API real quando houver como.
4. **Sabotagem como prova:** depois de cada teste passar, quebre a linha que ele protege, veja o teste falhar apontando o lugar certo, e desfaça. Teste que não morde é pior que teste nenhum.

**Fatos já verificados contra o repo em 2026-07-28** (não precisa reconferir, mas confie desconfiando):

- Última migration: `0055`. A deste bloco é a **`0056`**.
- `src/lib/fiscal/regime.ts:23` — `AtividadeMei = 'Comercio ou Industria' | 'Prestacao de Servicos' | 'Comercio e Servicos'`.
- `empresas_fiscais.atividade_mei` existe no banco; `companies` não tem coluna de regime.
- `src/lib/fiscal/das-mei.ts` — `DAS_MEI_2026` com os três **totais**; a quebra por componente existe **só em comentário**.
- `src/lib/crypto/envelope.ts` exporta `cifrarCampo`, `decifrarCampo` e `PREFIXO`.
- `src/lib/billing/credencial-subconta.ts` é o **molde** de credencial cifrada (o 4B provou em produção).
- `vitest.config.ts` **não carrega `.env.local`** — a suíte roda sem segredo, e é assim que tem de continuar.

---

## Onde este plano é grosso, e onde é fino — de propósito

**Tasks 1 a 6 e 8 trazem código completo.** São módulos puros e um cliente HTTP:
eu li os tipos reais, e o código pode ser copiado depois de conferido.

**Tasks 7, 9, 10 e 11 são mais finas** — descrevem invariantes, nomes de teste e
regras, sem o corpo inteiro. Não é economia: essas tasks encostam em guardas de
admin, telas existentes e formas de retorno que eu **não** verifiquei uma a uma, e
o Bloco 4B mostrou o preço de inventar isso. O plano do 4B trazia
`requireContadorAction`, `requireContadorPage` e `exigirAcessoContador` — **nenhuma
existia no repo**, e o `tsc` não pegava porque o arquivo nem chegava a existir.

Nessas tasks, o primeiro passo é sempre **ler o arquivo real e reportar a forma
encontrada**. Código inventado com aparência de pronto é pior que instrução
honesta.

---

## Ordem e dependências

```
Task 1  composição do DAS-MEI vira dado      (puro, sem dependência)
Task 2  migration 0056                        (independente)
Task 3  situacao-fiscal.ts                    ← Task 1
Task 4  renderizar.ts                         (puro, sem dependência)
Task 5  lib/ai/ — interface e adaptadores     (independente)
Task 6  credencial do provedor, cifrada       ← Task 2
Task 7  tela de config do provedor no admin   ← Tasks 5, 6
Task 8  gerar rascunho                        ← Tasks 3, 5, 6
Task 9  catálogo no admin (revisar/aprovar)   ← Tasks 2, 4, 8
Task 10 contagem de situações sem texto       ← Tasks 2, 3
Task 11 a explicação na tela do cliente       ← Tasks 3, 4, 10
Task 12 verificação final + roteiro do smoke  ← todas
```

---

### Task 1: A composição do DAS-MEI vira dado

Hoje `das-mei.ts` guarda três **totais** e explica a composição **em comentário**. Para a tela escrever "{inss} de INSS" a quebra precisa ser estrutura. Ganho de brinde: derivar o total da soma torna impossível o total e as partes discordarem — hoje, mudar o INSS exige editar três totais à mão e torcer.

**Files:**
- Modify: `app/src/lib/fiscal/das-mei.ts`
- Test: `app/src/lib/fiscal/das-mei.test.ts`

- [ ] **Step 1: Ler o arquivo real antes de mexer**

Run: `cd app && cat src/lib/fiscal/das-mei.ts && ls src/lib/fiscal/das-mei.test.ts`

Confira se já existe teste e quais valores ele fixa. **Se os valores divergirem do que este plano assume, pare e reporte.**

- [ ] **Step 2: Escrever o teste que falha**

Acrescentar em `app/src/lib/fiscal/das-mei.test.ts` (criar se não existir):

```ts
import { describe, it, expect } from 'vitest';
import { componentesDasMei, valorDasMei } from './das-mei';

describe('composição do DAS-MEI', () => {
  it('Comércio ou Indústria = INSS + ICMS', () => {
    const c = componentesDasMei('Comercio ou Industria');
    expect(Object.keys(c)).toEqual(['inss', 'icms']);
    expect(c.inss).toBeCloseTo(75.90, 2);
    expect(c.icms).toBeCloseTo(1.00, 2);
  });

  it('Prestação de Serviços = INSS + ISS', () => {
    const c = componentesDasMei('Prestacao de Servicos');
    expect(Object.keys(c)).toEqual(['inss', 'iss']);
    expect(c.iss).toBeCloseTo(5.00, 2);
  });

  it('Comércio e Serviços = INSS + ICMS + ISS', () => {
    expect(Object.keys(componentesDasMei('Comercio e Servicos')))
      .toEqual(['inss', 'icms', 'iss']);
  });

  // A INVARIANTE QUE JUSTIFICA A REFATORAÇÃO: total e partes não podem divergir.
  // Antes, o total era digitado à mão ao lado das partes em comentário.
  it.each([
    'Comercio ou Industria', 'Prestacao de Servicos', 'Comercio e Servicos',
  ] as const)('o total de %s é exatamente a soma dos componentes', (a) => {
    const soma = Object.values(componentesDasMei(a)).reduce((s, v) => s + v, 0);
    expect(valorDasMei(a)).toBeCloseTo(soma, 2);
  });

  // Atividade desconhecida cai em Serviços — comportamento ATUAL, preservado de
  // propósito: mudar isso alteraria a estimativa de quem não preencheu a atividade.
  it('atividade desconhecida ou nula cai em Prestação de Serviços', () => {
    expect(valorDasMei(null)).toBeCloseTo(valorDasMei('Prestacao de Servicos'), 2);
    expect(valorDasMei('bananas')).toBeCloseTo(valorDasMei('Prestacao de Servicos'), 2);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `cd app && npx vitest run src/lib/fiscal/das-mei.test.ts`
Expected: FAIL — `componentesDasMei is not a function`.

- [ ] **Step 4: Implementar**

Substituir o conteúdo de `app/src/lib/fiscal/das-mei.ts` por:

```ts
// DAS-MEI: INSS 5% do salário mínimo + ICMS (R$ 1) e/ou ISS (R$ 5).
// Base: salário mínimo R$ 1.518 (2025) → INSS R$ 75,90.
//
// ⚠️ DÍVIDA CONHECIDA: este valor é o de 2025. O salário mínimo de 2026 já é
// oficial e NÃO foi conferido — a estimativa do DAS-MEI pode estar desatualizada.
// Conferir e atualizar `INSS_MENSAL`; o resto se ajusta sozinho (ver abaixo).
//
// A COMPOSIÇÃO É DADO, NÃO COMENTÁRIO. Antes, os três totais eram digitados à
// mão e a quebra vivia num comentário — mudar o INSS exigia editar três números
// e torcer para não errar. Agora o total é a SOMA, e há teste que morde se
// divergirem. É também o que permite a explicação do Bloco 6A dizer
// "{inss} de INSS" com o valor certo.

const INSS_MENSAL = 75.90;
const ICMS_MENSAL = 1.00;
const ISS_MENSAL = 5.00;

/** Ordem das chaves é estável e importa: ela vira a ordem do texto na tela. */
export type ComponentesDasMei = {
  inss: number;
  icms?: number;
  iss?: number;
};

const COMPOSICAO = {
  'Comercio ou Industria': { inss: INSS_MENSAL, icms: ICMS_MENSAL },
  'Prestacao de Servicos': { inss: INSS_MENSAL, iss: ISS_MENSAL },
  'Comercio e Servicos':   { inss: INSS_MENSAL, icms: ICMS_MENSAL, iss: ISS_MENSAL },
} as const satisfies Record<string, ComponentesDasMei>;

/** Atividade desconhecida cai em Serviços — comportamento herdado, preservado
 *  de propósito: é o mais comum e mudá-lo alteraria estimativa já exibida. */
const PADRAO = 'Prestacao de Servicos';

function chave(atividade: string | null | undefined): keyof typeof COMPOSICAO {
  return atividade && atividade in COMPOSICAO
    ? (atividade as keyof typeof COMPOSICAO)
    : PADRAO;
}

export function componentesDasMei(atividade: string | null | undefined): ComponentesDasMei {
  return { ...COMPOSICAO[chave(atividade)] };
}

/** O total é a SOMA dos componentes — nunca um número digitado ao lado deles. */
export function valorDasMei(atividade: string | null | undefined): number {
  const c = componentesDasMei(atividade);
  return Number((c.inss + (c.icms ?? 0) + (c.iss ?? 0)).toFixed(2));
}
```

- [ ] **Step 5: Rodar tudo**

Run: `cd app && npx vitest run src/lib/fiscal && npx tsc --noEmit`
Expected: PASS, 0 erros. **Se algum teste alheio quebrar, é porque dependia do valor antigo — reporte antes de ajustar.**

- [ ] **Step 6: Sabotagem**

Troque `c.inss + (c.icms ?? 0) + (c.iss ?? 0)` por `c.inss`. Rode: o teste "o total é exatamente a soma" tem de falhar nas três atividades. Desfaça.

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/fiscal/das-mei.ts app/src/lib/fiscal/das-mei.test.ts
git commit -m "refactor(fiscal): composicao do DAS-MEI vira dado, total vira soma"
```

---

### Task 2: Migration 0056 — catálogo, config e faltantes

**Files:**
- Create: `app/supabase/migrations/0056_explicacoes_ia.sql`

- [ ] **Step 1: Conferir o número e o padrão**

Run: `cd app && ls supabase/migrations | tail -3 && tail -30 supabase/migrations/0055_idempotencia_cobranca_escritorio.sql`

Confirme que `0056` é o próximo e veja como a 0055 fecha privilégios — **é o padrão a copiar**.

- [ ] **Step 2: Escrever a migration**

Criar `app/supabase/migrations/0056_explicacoes_ia.sql`:

```sql
-- Bloco 6A — explicação de imposto com IA.
--
-- Três tabelas, e nenhuma delas guarda dado de contribuinte: o catálogo é por
-- SITUAÇÃO fiscal, não por cliente. É essa propriedade que permite gerar o
-- texto uma única vez e revisá-lo antes de qualquer cliente ver.

-- ------------------------------------------------ catálogo
CREATE TABLE IF NOT EXISTS public.explicacoes_fiscais (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Chave canônica da situação (ver lib/fiscal/situacao-fiscal.ts). Ex.:
  -- 'das-mei:icms+inss+iss'. Componentes em ordem alfabética de propósito —
  -- sem isso o catálogo duplica sozinho.
  chave        text NOT NULL UNIQUE,
  -- Texto COM MARCADORES (`{inss}`), nunca com valores.
  texto        text NOT NULL,
  status       text NOT NULL DEFAULT 'rascunho'
                 CHECK (status IN ('rascunho','aprovado')),
  -- Quem carimbou. Editar derrubará a aprovação (regra na action, §5.6 da spec).
  aprovado_por uuid,
  aprovado_em  timestamptz,
  -- Rastro de origem: qual provedor/modelo redigiu o rascunho. Não é segredo.
  gerado_por   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------ configuração do provedor
-- LINHA ÚNICA, e não chave-valor: são campos que só fazem sentido juntos —
-- modelo sem provedor, ou chave sem URL base no modo personalizado, é estado
-- inválido. Uma linha torna o estado inválido irrepresentável.
CREATE TABLE IF NOT EXISTS public.config_ia (
  id             int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  provedor       text CHECK (provedor IN
                   ('anthropic','gemini','openai','openrouter','groq',
                    'deepseek','mistral','personalizado')),
  modelo         text,
  -- Só usado em 'personalizado'; nos demais o adaptador conhece a URL.
  base_url       text,
  -- SEMPRE cifrada (prefixo enc:v1:). Nunca volta para a tela.
  chave_cifrada  text,
  atualizado_por uuid,
  atualizado_em  timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------ o buraco, contado
-- Situação exibida SEM texto aprovado. Sem isto o catálogo cresceria por
-- adivinhação; com isto, cresce por demanda real. Mesmo princípio do contador
-- de boletos órfãos do 4B: buraco silencioso é pior que buraco.
CREATE TABLE IF NOT EXISTS public.explicacoes_faltando (
  chave       text PRIMARY KEY,
  vistas      bigint NOT NULL DEFAULT 0,
  primeira_em timestamptz NOT NULL DEFAULT now(),
  ultima_em   timestamptz NOT NULL DEFAULT now()
);

-- Incremento atômico e sem corrida. SECURITY DEFINER porque a tabela é fechada
-- para as roles do cliente (ver privilégios abaixo) e quem chama é a tela do
-- empresário, pela sessão dele.
CREATE OR REPLACE FUNCTION public.registrar_explicacao_faltando(p_chave text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO explicacoes_faltando (chave, vistas)
  VALUES (p_chave, 1)
  ON CONFLICT (chave) DO UPDATE
     SET vistas = explicacoes_faltando.vistas + 1,
         ultima_em = now();
END $$;

-- ------------------------------------------------ RLS e privilégios
ALTER TABLE public.explicacoes_fiscais   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.config_ia             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.explicacoes_faltando  ENABLE ROW LEVEL SECURITY;

-- O cliente lê SÓ o que está aprovado. Rascunho não vaza para tela nenhuma —
-- é a trava que faz a revisão humana valer alguma coisa.
DROP POLICY IF EXISTS explicacoes_select_aprovadas ON public.explicacoes_fiscais;
CREATE POLICY explicacoes_select_aprovadas ON public.explicacoes_fiscais
  FOR SELECT USING (status = 'aprovado');

-- Escrita do catálogo: só service role (as actions do admin). Sem policy.
REVOKE INSERT, UPDATE, DELETE ON public.explicacoes_fiscais FROM anon, authenticated;

-- CONFIG É SEGREDO: RLS ligada SEM POLICY já fecha, mas o REVOKE explícito é a
-- lição da 0053/0055 — o ALTER DEFAULT PRIVILEGES do Supabase concede tudo em
-- `public` para anon/authenticated, calado, em TODA tabela nova.
REVOKE ALL ON public.config_ia FROM anon, authenticated;

-- Faltantes: ninguém lê pela sessão; o incremento passa pela função acima.
REVOKE ALL ON public.explicacoes_faltando FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_explicacao_faltando(text) TO anon, authenticated;

COMMENT ON TABLE public.explicacoes_fiscais IS
  'Catalogo de explicacoes por SITUACAO fiscal (nunca por cliente). Texto com marcadores; a tela preenche os valores.';
COMMENT ON TABLE public.config_ia IS
  'Linha unica. chave_cifrada SEMPRE com prefixo enc:v1:. Fechada para anon/authenticated.';
```

- [ ] **Step 3: Aplicar no banco**

Use o runner do repo (ver `app/scratchpad/apply-*.mjs` das migrations anteriores como molde; exige `SUPABASE_PASSWORD` no `.env.local`).

Run: `cd app && node scratchpad/apply-0056.mjs`
Expected: sem erro; as três tabelas criadas.

- [ ] **Step 4: Conferir os privilégios de verdade**

Não confie no SQL ter rodado — confira o efeito, como o 4B ensinou:

```bash
cd app && node -e "
const {readFileSync}=require('fs');const pg=require('pg');
const env=Object.fromEntries(readFileSync('.env.local','utf8').split(/\r?\n/).filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^[\"']|[\"']\$/g,'')]}));
const ref=env.NEXT_PUBLIC_SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\./)[1];
(async()=>{const c=new pg.Client({host:'db.'+ref+'.supabase.co',port:5432,user:'postgres',password:env.SUPABASE_PASSWORD,database:'postgres',ssl:{rejectUnauthorized:false}});
await c.connect();
const r=await c.query(\"SELECT table_name,grantee,string_agg(DISTINCT privilege_type,',') p FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name IN ('explicacoes_fiscais','config_ia','explicacoes_faltando') AND grantee IN ('anon','authenticated') GROUP BY 1,2 ORDER BY 1,2\");
r.rows.forEach(x=>console.log(x.table_name,x.grantee,x.p));
await c.end();})()"
```

Expected: `config_ia` e `explicacoes_faltando` **não aparecem** (ou sem nenhum privilégio); `explicacoes_fiscais` aparece só com `SELECT`.

- [ ] **Step 5: Commit**

```bash
git add app/supabase/migrations/0056_explicacoes_ia.sql app/scratchpad
git commit -m "feat(6a): migration 0056 — catalogo de explicacoes, config de IA e contador de faltantes"
```

---

### Task 3: `situacao-fiscal.ts` — a chave canônica

O coração do bloco. Chave instável = catálogo com buracos que ninguém entende.

**Files:**
- Create: `app/src/lib/fiscal/situacao-fiscal.ts`
- Test: `app/src/lib/fiscal/situacao-fiscal.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, it, expect } from 'vitest';
import { situacaoDasMei, situacaoPgdas, chaveDaSituacao } from './situacao-fiscal';

describe('chave da situação fiscal', () => {
  it('DAS-MEI de serviços', () => {
    const s = situacaoDasMei('Prestacao de Servicos');
    expect(s.tributo).toBe('das-mei');
    expect(chaveDaSituacao(s)).toBe('das-mei:inss+iss');
  });

  it('DAS-MEI de comércio e serviços', () => {
    expect(chaveDaSituacao(situacaoDasMei('Comercio e Servicos')))
      .toBe('das-mei:icms+inss+iss');
  });

  // A ORDEM É CANÔNICA. Sem isso, 'inss+icms' e 'icms+inss' viram duas linhas do
  // catálogo para a MESMA situação, e o admin aprova a mesma coisa duas vezes.
  it('a ordem dos componentes é alfabética, sempre', () => {
    const k = chaveDaSituacao(situacaoDasMei('Comercio e Servicos'));
    const partes = k.split(':')[1].split('+');
    expect(partes).toEqual([...partes].sort());
  });

  it('a mesma atividade sempre dá a mesma chave', () => {
    expect(chaveDaSituacao(situacaoDasMei('Comercio ou Industria')))
      .toBe(chaveDaSituacao(situacaoDasMei('Comercio ou Industria')));
  });

  it('PGDAS-D distingue o anexo e o Fator R', () => {
    expect(chaveDaSituacao(situacaoPgdas('Anexo III', true))).toBe('pgdas:anexo-iii+fator-r');
    expect(chaveDaSituacao(situacaoPgdas('Anexo III', false))).toBe('pgdas:anexo-iii');
    expect(chaveDaSituacao(situacaoPgdas('Anexo I', false))).toBe('pgdas:anexo-i');
  });

  // O QUE A CHAVE NÃO PODE CARREGAR: nada que mude o NÚMERO sem mudar a
  // EXPLICAÇÃO. R$ 61,60 e R$ 75,00 se explicam igual.
  it('a chave não depende de valor, competência nem empresa', () => {
    const k = chaveDaSituacao(situacaoDasMei('Prestacao de Servicos'));
    expect(k).not.toMatch(/\d{2,}/);   // sem valores
    expect(k).not.toMatch(/20\d\d/);   // sem ano/competência
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd app && npx vitest run src/lib/fiscal/situacao-fiscal.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

```ts
// Bloco 6A — a chave canônica de uma SITUAÇÃO fiscal.
//
// POR QUE ESTE MÓDULO EXISTE
// O catálogo de explicações é indexado por situação, não por cliente. Esta é a
// função que decide o que "mesma situação" significa — e ela é a peça mais
// delicada do bloco: chave instável produz catálogo com buracos que ninguém
// entende, e chave duplicada faz o admin aprovar a mesma coisa duas vezes.
//
// A RÉGUA: a chave carrega só o que muda a EXPLICAÇÃO, nunca o que muda o
// NÚMERO. No DAS-MEI, o que muda a explicação é quais componentes existem —
// R$ 61,60 e R$ 75,00 se explicam com o mesmo texto. No PGDAS-D, é o anexo e se
// o Fator R se aplica.
//
// Puro de propósito: sem I/O, sem `server-only`. A tela do cliente e a tela do
// admin têm de derivar a MESMA chave, e uma regra dessas não pode existir em
// duas versões.
import { componentesDasMei } from './das-mei';
import { fatorRAplicavel } from './regime';

export type SituacaoFiscal =
  | { tributo: 'das-mei'; componentes: readonly string[] }
  | { tributo: 'pgdas'; anexo: string; fatorR: boolean };

export function situacaoDasMei(atividade: string | null | undefined): SituacaoFiscal {
  return { tributo: 'das-mei', componentes: Object.keys(componentesDasMei(atividade)) };
}

export function situacaoPgdas(anexo: string | null | undefined, usaFatorR: boolean): SituacaoFiscal {
  return {
    tributo: 'pgdas',
    anexo: (anexo ?? 'desconhecido').toLowerCase().replace(/\s+/g, '-'),
    // Fator R só existe em Anexo III/V — a regra já mora em `regime.ts` e não
    // é reimplementada aqui.
    fatorR: usaFatorR && fatorRAplicavel(anexo),
  };
}

/**
 * A chave. **Ordenação alfabética dos componentes é obrigatória**: sem ela,
 * `inss+icms` e `icms+inss` viram duas entradas para a mesma situação e o
 * catálogo duplica sozinho.
 */
export function chaveDaSituacao(s: SituacaoFiscal): string {
  if (s.tributo === 'das-mei') {
    return `das-mei:${[...s.componentes].sort().join('+')}`;
  }
  return `pgdas:${s.anexo}${s.fatorR ? '+fator-r' : ''}`;
}
```

- [ ] **Step 4: Rodar**

Run: `cd app && npx vitest run src/lib/fiscal/situacao-fiscal.test.ts && npx tsc --noEmit`
Expected: PASS, 0 erros.

- [ ] **Step 5: Sabotagem**

Tire o `.sort()` de `chaveDaSituacao`. O teste "a ordem dos componentes é alfabética" tem de falhar. Desfaça.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/fiscal/situacao-fiscal.ts app/src/lib/fiscal/situacao-fiscal.test.ts
git commit -m "feat(6a): chave canonica da situacao fiscal"
```

---

### Task 4: `renderizar.ts` — marcador vira valor, ou nada

**Files:**
- Create: `app/src/lib/explicacoes/renderizar.ts`
- Test: `app/src/lib/explicacoes/renderizar.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, it, expect } from 'vitest';
import { marcadoresDe, renderizar } from './renderizar';

describe('renderização da explicação', () => {
  it('troca marcador por valor', () => {
    const r = renderizar('São {inss} de INSS e {iss} de ISS.',
      { inss: 'R$ 75,90', iss: 'R$ 5,00' });
    expect(r).toEqual({ ok: true, texto: 'São R$ 75,90 de INSS e R$ 5,00 de ISS.' });
  });

  // FALHA FECHADA. Exibir "{iss}" cru na cara do cliente é pior que não explicar.
  it('recusa quando falta valor para um marcador', () => {
    const r = renderizar('São {inss} e {iss}.', { inss: 'R$ 75,90' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.faltando).toEqual(['iss']);
  });

  it('valor a mais não atrapalha', () => {
    const r = renderizar('São {inss}.', { inss: 'R$ 75,90', icms: 'R$ 1,00' });
    expect(r.ok).toBe(true);
  });

  it('texto sem marcador nenhum passa', () => {
    expect(renderizar('O MEI paga valor fixo.', {})).toEqual(
      { ok: true, texto: 'O MEI paga valor fixo.' });
  });

  it('lista os marcadores de um texto, sem repetir', () => {
    expect(marcadoresDe('{a} e {b} e {a}')).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd app && npx vitest run src/lib/explicacoes/renderizar.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

```ts
// Bloco 6A — o texto do catálogo vira o texto da tela.
//
// É AQUI QUE OS NÚMEROS ENTRAM, e é o único lugar. O catálogo guarda
// "{inss} de INSS"; o valor do contribuinte só encosta no texto neste módulo,
// dentro da Balu, depois de a IA ter ido embora há muito tempo.
//
// Puro: sem I/O, sem React.

const MARCADOR = /\{([a-z0-9_]+)\}/gi;

/** Os marcadores de um texto, sem repetição e na ordem em que aparecem.
 *  A aprovação usa isto para recusar texto com marcador que a situação não
 *  fornece (ver a action de aprovar). */
export function marcadoresDe(texto: string): string[] {
  return [...new Set(Array.from(texto.matchAll(MARCADOR), (m) => m[1]))];
}

export type Renderizacao =
  | { ok: true; texto: string }
  | { ok: false; faltando: string[] };

/**
 * FALHA FECHADA: faltando valor para qualquer marcador, não devolve texto
 * nenhum. Renderizar "{iss}" cru na tela do cliente seria pior que não explicar
 * — dá a impressão de sistema quebrado justamente numa tela sobre imposto.
 *
 * Isto é a rede de baixo. A trava de cima é a validação no ato de APROVAR, que
 * impede o texto incompatível de entrar no catálogo.
 */
export function renderizar(texto: string, valores: Record<string, string>): Renderizacao {
  const faltando = marcadoresDe(texto).filter((m) => valores[m] === undefined);
  if (faltando.length) return { ok: false, faltando };
  return { ok: true, texto: texto.replace(MARCADOR, (_, k: string) => valores[k]) };
}
```

- [ ] **Step 4: Rodar**

Run: `cd app && npx vitest run src/lib/explicacoes && npx tsc --noEmit`
Expected: PASS, 0 erros.

- [ ] **Step 5: Sabotagem**

Faça `renderizar` devolver sempre `{ ok: true, ... }`. O teste "recusa quando falta valor" tem de falhar. Desfaça.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/explicacoes
git commit -m "feat(6a): renderizacao com falha fechada em marcador nao resolvido"
```

---

### Task 5: `lib/ai/` — interface e os dois adaptadores

**Files:**
- Create: `app/src/lib/ai/tipos.ts`
- Create: `app/src/lib/ai/provedores.ts`
- Create: `app/src/lib/ai/cliente.ts`
- Test: `app/src/lib/ai/cliente.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { gerarTexto } from './cliente';
import { URL_PADRAO } from './provedores';

const resposta = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }) as Response;

afterEach(() => vi.restoreAllMocks());

describe('cliente de IA', () => {
  it('adaptador OpenAI-compatível: manda para a URL do provedor e lê a escolha', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      resposta({ choices: [{ message: { content: 'texto gerado' } }] }));

    const r = await gerarTexto(
      { provedor: 'groq', modelo: 'llama-3.3-70b', base_url: null, chave: 'k' },
      'prompt');

    expect(r).toBe('texto gerado');
    expect(String(spy.mock.calls[0][0])).toContain(URL_PADRAO.groq);
  });

  it('adaptador Anthropic: formato próprio', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      resposta({ content: [{ type: 'text', text: 'texto claude' }] }));

    const r = await gerarTexto(
      { provedor: 'anthropic', modelo: 'claude-sonnet-4-6', base_url: null, chave: 'k' },
      'prompt');

    expect(r).toBe('texto claude');
    const headers = (spy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('k');
    expect(headers['anthropic-version']).toBeTruthy();
  });

  it('personalizado usa a base_url informada', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      resposta({ choices: [{ message: { content: 'ok' } }] }));

    await gerarTexto(
      { provedor: 'personalizado', modelo: 'm', base_url: 'https://meu.invalido/v1', chave: 'k' },
      'p');

    expect(String(spy.mock.calls[0][0])).toContain('https://meu.invalido/v1');
  });

  // A CHAVE NÃO VAZA NEM EM ERRO. Mesma regra que a varredura do 4B teve de
  // aprender: a mensagem é montada longe daqui.
  it('erro do provedor não carrega a chave na mensagem', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      { ok: false, status: 401, text: async () => 'invalid key sk-SEGREDO-123' } as Response);

    await expect(gerarTexto(
      { provedor: 'openai', modelo: 'm', base_url: null, chave: 'sk-SEGREDO-123' }, 'p'))
      .rejects.toThrow(/401/);

    await expect(gerarTexto(
      { provedor: 'openai', modelo: 'm', base_url: null, chave: 'sk-SEGREDO-123' }, 'p')
      .catch((e) => e.message)).resolves.not.toContain('sk-SEGREDO-123');
  });

  it('personalizado sem base_url é recusado antes de qualquer rede', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    await expect(gerarTexto(
      { provedor: 'personalizado', modelo: 'm', base_url: null, chave: 'k' }, 'p'))
      .rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd app && npx vitest run src/lib/ai/cliente.test.ts`
Expected: FAIL — módulos não existem.

- [ ] **Step 3: Implementar `provedores.ts`**

```ts
// Bloco 6A — a lista de provedores e o que cada um precisa.
//
// Puro (sem `server-only`): a TELA do admin também consome esta lista para
// montar o dropdown, e duplicá-la faria a tela oferecer provedor que o cliente
// não sabe chamar.

export const PROVEDORES = [
  'anthropic', 'gemini', 'openai', 'openrouter', 'groq',
  'deepseek', 'mistral', 'personalizado',
] as const;

export type Provedor = (typeof PROVEDORES)[number];

/** Rótulo para a tela. */
export const PROVEDOR_LABEL: Record<Provedor, string> = {
  anthropic: 'Anthropic (Claude)',
  gemini: 'Google Gemini',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
  groq: 'Groq',
  deepseek: 'DeepSeek',
  mistral: 'Mistral',
  personalizado: 'Personalizado…',
};

/**
 * URL base de cada provedor. Quase todos falam o dialeto OpenAI — inclusive o
 * Gemini, pelo endpoint de compatibilidade. É por isso que dois adaptadores
 * cobrem a lista inteira em vez de oito.
 *
 * `personalizado` não tem padrão de propósito: quem escolhe informa a URL, e é
 * essa saída que permite um provedor novo sem deploy.
 */
export const URL_PADRAO: Record<Provedor, string | null> = {
  anthropic: 'https://api.anthropic.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  groq: 'https://api.groq.com/openai/v1',
  deepseek: 'https://api.deepseek.com/v1',
  mistral: 'https://api.mistral.ai/v1',
  personalizado: null,
};

/** Só o Anthropic fala outro dialeto. */
export function ehAnthropic(p: Provedor): boolean {
  return p === 'anthropic';
}
```

- [ ] **Step 4: Implementar `tipos.ts` e `cliente.ts`**

`app/src/lib/ai/tipos.ts`:

```ts
import type { Provedor } from './provedores';

/** O que o cliente precisa para falar com o provedor. A `chave` já vem
 *  DECIFRADA — decifrar é responsabilidade de quem lê a config. */
export type ConfigProvedor = {
  provedor: Provedor;
  modelo: string;
  base_url: string | null;
  chave: string;
};
```

`app/src/lib/ai/cliente.ts`:

```ts
// Bloco 6A — a única porta de saída para um provedor de IA.
//
// UM TEXTO ENTRA, UM TEXTO SAI. Sem streaming, sem ferramentas, sem imagem —
// e é essa simplicidade que permite dois adaptadores cobrirem oito provedores.
//
// ⚠️ ESTA FUNÇÃO NUNCA RECEBE DADO DE CONTRIBUINTE. Quem monta o prompt é
// `lib/explicacoes/prompt.ts`, que aceita `SituacaoFiscal` — tipo que não tem
// como carregar valor, nome ou documento. A garantia é do TIPO, não da
// disciplina de quem chama.
import 'server-only';
import { ehAnthropic, URL_PADRAO } from './provedores';
import type { ConfigProvedor } from './tipos';

const TIMEOUT_MS = 60_000;
const MAX_TOKENS = 1024;

function urlDe(cfg: ConfigProvedor): string {
  const base = cfg.provedor === 'personalizado' ? cfg.base_url : URL_PADRAO[cfg.provedor];
  if (!base) {
    // Falha ANTES da rede: 'personalizado' sem URL é configuração incompleta, e
    // deixar seguir daria um erro de rede confuso em vez do motivo real.
    throw new Error('Provedor personalizado sem URL base configurada.');
  }
  return `${base.replace(/\/+$/, '')}${ehAnthropic(cfg.provedor) ? '/messages' : '/chat/completions'}`;
}

/**
 * Gera texto. Lança em qualquer falha — quem chama decide o que mostrar.
 *
 * A CHAVE NÃO ENTRA NA MENSAGEM DE ERRO, nem quando o provedor a devolve no
 * corpo (alguns devolvem). Mesma regra que a varredura do 4B teve de aprender:
 * a mensagem é montada longe daqui e não dá para confiar nela.
 */
export async function gerarTexto(cfg: ConfigProvedor, prompt: string): Promise<string> {
  const url = urlDe(cfg);
  const anthropic = ehAnthropic(cfg.provedor);

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (anthropic) {
    headers['x-api-key'] = cfg.chave;
    headers['anthropic-version'] = '2023-06-01';
  } else {
    headers['Authorization'] = `Bearer ${cfg.chave}`;
  }

  // O CORPO É O MESMO NOS DOIS DIALETOS — os dois aceitam
  // `{ model, max_tokens, messages:[{role,content}] }` para uma pergunta simples.
  // A diferença entre Anthropic e OpenAI-compatível está no CAMINHO e no
  // CABEÇALHO, não aqui. (Se um dia divergir, é aqui que o `if` nasce; um
  // ternário com os dois lados iguais só faria o leitor procurar diferença que
  // não existe.)
  const body = { model: cfg.modelo, max_tokens: MAX_TOKENS, messages: [{ role: 'user', content: prompt }] };

  const res = await fetch(url, {
    method: 'POST', headers, body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    const bruto = (await res.text()).slice(0, 300);
    const limpo = cfg.chave ? bruto.split(cfg.chave).join('***') : bruto;
    throw new Error(`Provedor respondeu ${res.status}: ${limpo}`);
  }

  const j = (await res.json()) as Record<string, unknown>;
  const texto = anthropic
    ? (j.content as Array<{ type: string; text?: string }> | undefined)
        ?.find((b) => b.type === 'text')?.text
    : (j.choices as Array<{ message?: { content?: string } }> | undefined)?.[0]?.message?.content;

  if (!texto || !texto.trim()) throw new Error('Provedor respondeu sem texto.');
  return texto.trim();
}
```

- [ ] **Step 5: Rodar**

Run: `cd app && npx vitest run src/lib/ai && npx tsc --noEmit`
Expected: PASS, 0 erros. **Nenhum teste fala com rede de verdade** — se algum demorar, o mock não pegou.

- [ ] **Step 6: Sabotagem**

Troque `limpo` por `bruto` na mensagem de erro. O teste "erro do provedor não carrega a chave" tem de falhar. Desfaça.

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/ai
git commit -m "feat(6a): cliente de IA com adaptador OpenAI-compativel e Anthropic"
```

---

### Task 6: A credencial do provedor, cifrada

Espelha `lib/billing/credencial-subconta.ts`, que o 4B provou em produção.

**Files:**
- Create: `app/src/lib/ai/config-ia.ts`
- Test: `app/src/lib/ai/config-ia.test.ts`

- [ ] **Step 1: Ler o molde**

Run: `cd app && cat src/lib/billing/credencial-subconta.ts`

Repare em três coisas e reproduza todas: `guardarCredencial` recusa gravar quando a cifra não foi aplicada; `lerCredencial` **lança** em valor sem prefixo em vez de devolver o valor cru; `mascarar` é a única forma de mencionar a chave fora do módulo.

- [ ] **Step 2: Escrever o teste que falha**

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { guardarChaveIa, lerChaveIa, mascararChaveIa } from './config-ia';

beforeAll(() => {
  process.env.CERT_ENC_KEY ??= Buffer.alloc(32, 7).toString('base64');
});

const FALSA = 'sk-TESTE-chave-obviamente-falsa-0001';

describe('credencial do provedor de IA', () => {
  it('grava cifrada e lê de volta', () => {
    const c = guardarChaveIa(FALSA);
    expect(c.startsWith('enc:v1:')).toBe(true);
    expect(c).not.toContain(FALSA);
    expect(lerChaveIa(c)).toBe(FALSA);
  });

  it('nula entra, nula sai', () => {
    expect(lerChaveIa(null)).toBeNull();
  });

  // Não há legado de chave em claro nesta coluna: ela nasceu na 0056. Valor sem
  // prefixo só pode ser gravação corrompida, e devolvê-lo cru esconderia um
  // segredo em claro no banco fingindo que está tudo bem.
  it('LANÇA em valor sem cifra, em vez de devolver o valor cru', () => {
    expect(() => lerChaveIa('sk-em-claro')).toThrow();
  });

  it('vazia é recusada na gravação', () => {
    expect(() => guardarChaveIa('')).toThrow();
  });

  it('mascarar não devolve a chave utilizável', () => {
    const m = mascararChaveIa(FALSA);
    expect(m).not.toContain(FALSA.slice(6));
    expect(m).toContain('…');
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `cd app && npx vitest run src/lib/ai/config-ia.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implementar**

```ts
// Bloco 6A — a chave do provedor de IA, cifrada em repouso.
//
// Mesmo molde de `lib/billing/credencial-subconta.ts`, que o 4B provou em
// produção. Não é abstração compartilhada de propósito: são segredos de domínios
// diferentes, e juntá-los faria uma mudança de regra de um alcançar o outro.
import { cifrarCampo, decifrarCampo, PREFIXO } from '@/lib/crypto/envelope';

export function guardarChaveIa(chave: string): string {
  if (!chave) throw new Error('guardarChaveIa: chave vazia');
  const cifrada = cifrarCampo(chave);
  // `cifrarCampo` devolve o próprio valor quando recebe '' — barrado acima. Se
  // um dia a cifra falhar em silêncio, gravar em claro seria pior que falhar.
  if (cifrada === chave) throw new Error('guardarChaveIa: cifra nao aplicada');
  return cifrada;
}

export function lerChaveIa(cifrada: string | null): string | null {
  if (!cifrada) return null;
  // A coluna nasceu na 0056 e `guardarChaveIa` recusa gravar sem cifra: valor
  // sem prefixo só pode ser gravação corrompida. O fallback silencioso de
  // `decifrarCampo` (que existe para certificado legado) esconderia isso.
  if (!cifrada.startsWith(PREFIXO)) {
    throw new Error('lerChaveIa: chave do provedor sem cifra — gravacao corrompida');
  }
  return decifrarCampo(cifrada);
}

/** Única forma permitida de mencionar a chave fora deste módulo. */
export function mascararChaveIa(chave: string | null): string {
  if (!chave || chave.length < 12) return '…';
  return `${chave.slice(0, 4)}…${chave.slice(-4)}`;
}
```

- [ ] **Step 5: Rodar e sabotar**

Run: `cd app && npx vitest run src/lib/ai && npx tsc --noEmit`
Expected: PASS.

Sabotagem: troque o `throw` de `lerChaveIa` por `return cifrada`. O teste "LANÇA em valor sem cifra" tem de falhar. Desfaça.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/ai/config-ia.ts app/src/lib/ai/config-ia.test.ts
git commit -m "feat(6a): chave do provedor de IA cifrada em repouso"
```

---

### Task 7: Tela de configuração do provedor (AdminBalu)

**Files:**
- Create: `app/src/app/(auth)/(gated)/admin/configuracoes/ia/page.tsx`
- Create: `app/src/app/(auth)/(gated)/admin/configuracoes/ia/actions.ts`
- Create: `app/src/app/(auth)/(gated)/admin/configuracoes/ia/ConfigIaForm.tsx`
- Test: `app/src/app/(auth)/(gated)/admin/configuracoes/ia/actions.test.ts`

- [ ] **Step 1: Descobrir a guarda de admin REAL**

Run: `cd app && ls "src/app/(auth)/(gated)/admin/configuracoes/" && head -40 "src/app/(auth)/(gated)/admin/configuracoes/page.tsx"`

**Não invente `requireAdmin`.** Use a guarda que as outras telas de `/admin` usam, com o nome e a forma de retorno reais. Reporte qual é.

- [ ] **Step 2: Escrever o teste das invariantes da action**

Cubra, com o Supabase mockado (molde: `src/app/(auth)/(gated)/contador/configuracoes/subconta/actions.test.ts`):

```ts
// 1. salvar sem chave nova NÃO apaga a chave existente
//    (o campo da tela vem vazio quando o admin não quer trocar)
// 2. a chave gravada está CIFRADA (prefixo enc:v1:)
// 3. a chave NUNCA volta no retorno da action nem no que a página lê
// 4. 'personalizado' sem base_url é recusado ANTES de gravar
// 5. testarConexaoAction devolve erro legível sem vazar a chave
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `cd app && npx vitest run "src/app/(auth)/(gated)/admin/configuracoes/ia"`
Expected: FAIL.

- [ ] **Step 4: Implementar as actions**

Duas actions, ambas atrás da guarda de admin da Step 1:

- `salvarConfigIaAction(entrada)` — valida com Zod (`provedor` no enum de `PROVEDORES`, `modelo` não vazio, `base_url` obrigatória sse `provedor === 'personalizado'`), cifra a chave com `guardarChaveIa` **apenas quando vier preenchida**, faz `upsert` na linha `id = 1` de `config_ia` pelo **admin client**, e registra auditoria com o provedor e o modelo — **nunca a chave**, nem mascarada.
- `testarConexaoAction()` — lê a config, decifra dentro de `try`, chama `gerarTexto` com um prompt trivial (`'Responda apenas: ok'`) e devolve `{ ok: true }` ou `{ ok: false, error }` com a mensagem já limpa pelo `cliente.ts`.

⚠️ `lerChaveIa` **lança**. Chame-a **dentro** do `try`, um caso por vez — foi exatamente o defeito que o plano do 4B trazia na Task 13.

- [ ] **Step 5: Implementar a tela**

`ConfigIaForm.tsx` (Client Component) com o dropdown de `PROVEDOR_LABEL`, campo de modelo, campo de chave em `type="password"` com placeholder `••••••••` quando já houver chave gravada, o campo de URL base **só** quando `provedor === 'personalizado'`, e o botão **Testar conexão**.

A página (Server Component) lê `config_ia` pelo admin client e passa **apenas** `{ provedor, modelo, base_url, temChave: boolean }` — a chave cifrada não sai do servidor.

- [ ] **Step 6: Rodar**

Run: `cd app && npx vitest run && npx tsc --noEmit`
Expected: PASS, 0 erros.

- [ ] **Step 7: Commit**

```bash
git add "app/src/app/(auth)/(gated)/admin/configuracoes/ia"
git commit -m "feat(6a): tela de configuracao do provedor de IA, com testar conexao"
```

---

### Task 8: Gerar o rascunho

**Files:**
- Create: `app/src/lib/explicacoes/prompt.ts`
- Test: `app/src/lib/explicacoes/prompt.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, it, expect } from 'vitest';
import { montarPrompt } from './prompt';
import { situacaoDasMei, situacaoPgdas } from '@/lib/fiscal/situacao-fiscal';

describe('prompt da explicação', () => {
  it('descreve a situação e pede marcadores', () => {
    const p = montarPrompt(situacaoDasMei('Comercio e Servicos'));
    expect(p).toContain('MEI');
    expect(p).toContain('{inss}');
  });

  // A INVARIANTE CENTRAL DO BLOCO. Se algum dia alguém alargar `SituacaoFiscal`
  // para carregar valor, competência ou documento, este teste morde.
  it('o prompt NUNCA contém número que pareça dado do contribuinte', () => {
    for (const s of [
      situacaoDasMei('Comercio e Servicos'),
      situacaoDasMei('Prestacao de Servicos'),
      situacaoPgdas('Anexo III', true),
    ]) {
      const p = montarPrompt(s);
      expect(p).not.toMatch(/\d+[.,]\d{2}/);   // valor monetário
      expect(p).not.toMatch(/\d{11,14}/);      // CPF/CNPJ
      expect(p).not.toMatch(/20\d\d-\d\d/);    // competência
    }
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd app && npx vitest run src/lib/explicacoes/prompt.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

`montarPrompt(s: SituacaoFiscal): string` — função **pura**, recebendo só a situação. O prompt descreve o tributo e os componentes, e instrui: escrever 2 a 4 frases em português simples, usar **exatamente** os marcadores fornecidos, não inventar valores, não dar conselho tributário, não citar lei.

⚠️ A assinatura receber `SituacaoFiscal` (e não a guia) é o que torna o vazamento **impossível de compilar**. Não relaxe esse tipo.

- [ ] **Step 4: A action de gerar**

Na tela do admin do catálogo (Task 9): lê a config, decifra **dentro do try**, monta o prompt, chama `gerarTexto`, e faz `upsert` em `explicacoes_fiscais` com `status = 'rascunho'` e `gerado_por = '<provedor>/<modelo>'`.

**Gerar nunca sobrescreve texto `aprovado`** — só cria ou substitui rascunho. Senão um clique acidental derrubaria conteúdo revisado.

- [ ] **Step 5: Rodar, sabotar, commitar**

Sabotagem: acrescente um campo numérico a `SituacaoFiscal` e inclua-o no prompt. O teste "nunca contém número" tem de falhar. Desfaça.

```bash
git add app/src/lib/explicacoes/prompt.ts app/src/lib/explicacoes/prompt.test.ts
git commit -m "feat(6a): prompt puro, com a garantia de nao vazar dado por TIPO"
```

---

### Task 9: Catálogo no admin — revisar e aprovar

**Files:**
- Create: `app/src/app/(auth)/(gated)/admin/explicacoes/page.tsx`
- Create: `app/src/app/(auth)/(gated)/admin/explicacoes/actions.ts`
- Test: `app/src/app/(auth)/(gated)/admin/explicacoes/actions.test.ts`

- [ ] **Step 1: Escrever o teste da regra que mais importa**

```ts
// APROVAR É RECUSADO quando o texto tem marcador que a situação não fornece.
// Sem isto, "{iss}" apareceria cru na tela do cliente. Validar no ato da
// ESCOLHA, não no envio — a lição do 4A com o `.exe`.
it('recusa aprovar texto com marcador que a situacao nao fornece', async () => {
  // situação 'das-mei:inss+iss' NÃO fornece {icms}
  const r = await aprovarExplicacaoAction({ chave: 'das-mei:inss+iss', texto: 'tem {icms}' });
  expect(r.ok).toBe(false);
});

it('aprova quando os marcadores cabem na situacao', async () => { /* ... */ });

// Senão "aprovado" para de significar alguma coisa.
it('editar um texto APROVADO derruba a aprovacao', async () => { /* ... */ });
```

- [ ] **Step 2: Rodar e ver falhar** · **Step 3: Implementar**

`marcadoresDaSituacao(chave)` — função pura que devolve os marcadores válidos de uma chave (`das-mei:inss+iss` → `['inss','iss']`; PGDAS → `['total']` nesta rodada). `aprovarExplicacaoAction` usa `marcadoresDe` (Task 4) e recusa se houver marcador fora do conjunto.

A página lista: as explicações existentes com status, **e** as situações de `explicacoes_faltando` ordenadas por `vistas` — as mais vistas sem texto no topo.

- [ ] **Step 4: Rodar, sabotar, commitar**

Sabotagem: remova a validação de marcador da aprovação. O teste tem de falhar.

```bash
git add "app/src/app/(auth)/(gated)/admin/explicacoes"
git commit -m "feat(6a): catalogo no admin — gerar, revisar e aprovar com validacao de marcador"
```

---

### Task 10: Contar a situação vista sem texto

**Files:**
- Create: `app/src/lib/explicacoes/buscar.ts`
- Test: `app/src/lib/explicacoes/buscar.test.ts`

- [ ] **Step 1: Teste**

```ts
it('devolve o texto quando ha explicacao APROVADA', async () => { /* ... */ });

it('rascunho NAO vaza para o cliente', async () => { /* ... */ });

// O BURACO É CONTADO. Sem isto, o catálogo cresceria por adivinhação.
it('situacao sem texto aprovado incrementa o contador e devolve null', async () => { /* ... */ });

// Contar não pode quebrar a tela de impostos por causa de uma explicação.
it('falha ao contar nao derruba a busca', async () => { /* ... */ });
```

- [ ] **Steps 2-4: Implementar, rodar, commitar**

`buscarExplicacao(sb, chave)` — `SELECT` com `status = 'aprovado'`; não achando, chama a RPC `registrar_explicacao_faltando` dentro de `try/catch` próprio e devolve `null`.

```bash
git add app/src/lib/explicacoes/buscar.ts app/src/lib/explicacoes/buscar.test.ts
git commit -m "feat(6a): busca da explicacao, com o buraco contado em vez de silencioso"
```

---

### Task 11: A explicação na tela do cliente

**Files:**
- Create: `app/src/app/(auth)/(gated)/impostos/ExplicacaoImposto.tsx`
- Modify: `app/src/app/(auth)/(gated)/impostos/CompetenciaAtualCardMei.tsx`

- [ ] **Step 1: Ler a tela real**

Run: `cd app && cat "src/app/(auth)/(gated)/impostos/CompetenciaAtualCardMei.tsx"`

Descubra de onde vêm `atividade_mei` e o valor exibido. **Se a atividade não estiver disponível ali, reporte** — sem ela não há chave de situação.

- [ ] **Step 2: Implementar o componente**

Server Component que recebe a situação e os valores já formatados, chama `buscarExplicacao`, renderiza com `renderizar` e **não mostra nada** quando não há texto ou quando a renderização recusa.

O disclaimer é **fixo no componente**, fora do catálogo e fora do alcance do admin:

```tsx
<p className="mt-2 text-xs text-muted-foreground">
  Informação educativa gerada com apoio de IA e revisada pela Balu. Não
  substitui a orientação do seu contador.
</p>
```

- [ ] **Step 3: Verificar**

Run: `cd app && npx tsc --noEmit && npx vitest run && npx next build`
Expected: 0 erros. ⚠️ **Rode o build com o `npm run dev` PARADO** — os dois disputam o `.next/`.

- [ ] **Step 4: Commit**

```bash
git add "app/src/app/(auth)/(gated)/impostos"
git commit -m "feat(6a): a explicacao na tela do cliente, com disclaimer fixo"
```

---

### Task 12: Verificação final e roteiro do smoke

**Files:**
- Create: `app/scratchpad/_probe-6a.mjs`
- Create: `balu/docs/smoke/2026-XX-XX-bloco-6a-roteiro-smoke.md`

- [ ] **Step 1: O probe**

Somente leitura, provando o que a tela não prova:

1. `config_ia.chave_cifrada` começa com `enc:v1:` e **decifra** com a `CERT_ENC_KEY`;
2. `config_ia` **não é legível** pela anon key (repetir o teste de fronteira do 4B);
3. nenhuma explicação `aprovado` tem marcador fora do conjunto da sua chave — a invariante da Task 9, conferida contra o banco de verdade;
4. `explicacoes_faltando` lista o que falta, ordenado por `vistas`.

- [ ] **Step 2: O roteiro do smoke**

Seções, cada uma com o valor esperado:

1. configurar um provedor e **Testar conexão** (com chave errada primeiro — o erro tem de ser legível e **não** conter a chave);
2. abrir a tela de impostos de um MEI **sem catálogo** → **nada aparece**, e a situação passa a constar em `explicacoes_faltando`;
3. no admin, gerar o rascunho → ler → **aprovar**;
4. recarregar a tela do cliente → a explicação aparece **com os valores dele** e com o disclaimer;
5. tentar aprovar um texto com `{icms}` numa situação de serviços → **recusado**;
6. editar o texto aprovado → some da tela do cliente até nova aprovação;
7. trocar o provedor (ex.: Anthropic → Groq) e gerar de novo → **sem deploy**;
8. rodar `_probe-6a.mjs` → tudo verde.

- [ ] **Step 3: Fechamento**

Ordem: verificação com o cenário vivo → suíte → `next build` com o dev parado → commits → merge `--no-ff` → **confirmar com o usuário antes do push** (é auto-deploy em produção).

---

## Dívidas que este bloco NÃO resolve (registradas, não esquecidas)

- **O DAS-MEI usa o salário mínimo de 2025** (R$ 1.518 → INSS R$ 75,90). O de 2026 já é oficial e não foi conferido — a estimativa pode estar errada hoje, independentemente deste bloco. Corrigir é trocar `INSS_MENSAL` na Task 1; o total se ajusta sozinho.
- **Não existe lista oficial de códigos de serviço** (10 escritos à mão, validador só de 6 dígitos — `999999` passa), e o repo usa a Lista Nacional de 6 dígitos, não a LC 116 no formato `X.XX`. **Pré-requisito da feature de sugestão de código.**
- **O Pix do DAS é suposição do PRD.** Nosso parser não lê campo de Pix e descarta em silêncio o que não lê. **Pré-requisito do 6B.**
- `db_atual.sql` e `src/types/database.ts` seguem atrasados desde a `0050`.
