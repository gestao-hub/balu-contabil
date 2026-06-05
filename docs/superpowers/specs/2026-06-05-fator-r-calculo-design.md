# Spec — Fator R: cálculo e decisão de anexo (III ↔ V)

**Data:** 2026-06-05
**Backlog:** P0.3 (`docs/planning/BACKLOG-IMPOSTOS.md`)
**Origem:** investigação `docs/investigations/FATOR-R-CNAE-SEGREGACAO.md` (modelo já decidido) +
brainstorming 2026-06-05 (fonte da folha, granularidade, UI).

## Problema

CNAEs sujeitos ao **Fator R** (catálogo `cnae_anexo` com `fator_r = true`, `anexo_base = NULL`)
podem cair no **Anexo III** ou no **Anexo V** do Simples conforme a razão:

```
Fator R = folha dos últimos 12 meses ÷ RBT12
  ≥ 28% → Anexo III
  < 28% → Anexo V
```

Hoje o cálculo **não acontece**: em `anexo-resolver.ts:28-29`, quando o CNAE é `fator_r=true`, o
código cai no anexo manual (`empresas_fiscais.anexo_simples`) com o aviso *"Anexo depende do Fator R
— confirmar (III ou V)"*. O RBT12 já é calculado (`rbt12.ts`), mas **a folha não existe em lugar
nenhum** — nenhuma tabela ou campo armazena pró-labore/salários. A coluna `apuracoes_fiscais.fator_r`
existe mas nunca é preenchida.

## Decisões fechadas (brainstorming)

1. **Fonte da folha = modelo B (armazenada e acumulada).** Uma tabela `folha_mensal`, 1 registro por
   empresa por competência, espelhando como as `notas_fiscais` alimentam o RBT12. Não é input
   pontual na apuração (modelo A) nem integração externa (modelo C).
2. **Três componentes por mês:** `pro_labore`, `salarios`, `encargos`. A soma é a folha do mês que
   entra no Fator R. Empresa só com sócio preenche apenas `pro_labore`. A quebra existe porque o
   pró-labore é a alavanca típica das MEs de serviço e a transparência importa.
3. **UI = tela dedicada `/impostos/folha`** (modelo A da pergunta de UI): grade de competências para
   manutenção contínua, perto de onde o número é usado.
4. **Degradação graciosa:** folha ausente/incompleta → **não** calcula Fator R; mantém o
   comportamento atual (anexo manual + aviso). Nunca chuta III/V.

## Escopo

### Dentro
- Tabela `folha_mensal` + tipos + RLS.
- Camada pura de cálculo: `somarFolha12`, `calcularFatorR`.
- Integração no resolver de anexo (`resolverAnexo` puro + `resolverAnexoEmpresa`).
- Persistência do `%` em `apuracoes_fiscais.fator_r`.
- Tela `/impostos/folha` (grade + salvar em lote) e link de entrada em `/impostos`.

### Fora
- **Segregação de receita por anexo** (multi-atividade). A fundação (`company_cnaes` relacional) está
  pronta; a apuração segue com **um anexo** por competência. P0.3 = decidir III↔V, não fatiar receita.
- Integração com folha/contabilidade externa (modelo C).
- Anexo IV (INSS à parte) — flag `cnae_anexo.anexo_iv` já existe, tratada noutro card.
- Anualização da folha: desnecessária — em empresas < 12 meses o fator multiplicaria folha e RBT12
  igualmente e **a razão não muda**; usamos as somas brutas de 12 meses.

## Modelo de dados — `folha_mensal` (migration 0022)

```sql
CREATE TABLE public.folha_mensal (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL,
  competencia   TEXT NOT NULL,                 -- YYYYMM
  pro_labore    NUMERIC(14,2) NOT NULL DEFAULT 0,
  salarios      NUMERIC(14,2) NOT NULL DEFAULT 0,
  encargos      NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT folha_mensal_company_competencia_uniq UNIQUE (company_id, competencia)
);
```

- **Sem `deleted_at`/soft-delete** — folha de um mês é valor que se *corrige* (editar para 0), não
  registro que se apaga. Com isso o `UNIQUE` é real (não índice parcial) e o `upsert ... onConflict:
  'company_id,competencia'` funciona direto, sem o erro `42P10` que partial indexes causam (lição do
  `company_cnaes`).
- RLS: policy `FOR ALL TO authenticated USING (owner_user_id = auth.uid()) WITH CHECK (...)`.
- Trigger `tg_set_updated_at` (mesmo padrão das demais tabelas).
- Índice extra `(company_id)` para a leitura por janela.
- Aditiva/idempotente (`CREATE TABLE IF NOT EXISTS`, policy em bloco `DO $$ ... EXCEPTION`).

Tipo em `app/src/types/database.ts`: `folha_mensal: { Row; Insert; Update }` seguindo as demais.

## Camada pura

### `app/src/lib/fiscal/folha.ts`

```ts
export type FolhaMensal = { competencia: string; proLabore: number; salarios: number; encargos: number };

// Soma a folha dos 12 meses anteriores à competência (exclui a própria), mesma janela do RBT12.
export function somarFolha12(folhas: FolhaMensal[], competencia: string): { folha12m: number; meses: number };
```

- Janela idêntica ao `calcularRbt12`: `inicio = competenciaAddMonths(competencia, -12)`,
  `fim = competenciaAddMonths(competencia, -1)`; soma `proLabore + salarios + encargos` das
  competências em `[inicio, fim]`. `meses` = quantas competências distintas tinham algum valor > 0
  (usado para "suficiência").

### `app/src/lib/fiscal/fator-r.ts`

```ts
export type FatorRResult = {
  fatorR: number | null;                                   // razão 0..1 (null se insuficiente)
  anexoDecidido: 'Anexo III' | 'Anexo V' | null;
  suficiente: boolean;
};

export function calcularFatorR(input: { folha12m: number; rbt12: number }): FatorRResult;
```

- `rbt12 <= 0` **ou** `folha12m <= 0` → `{ fatorR: null, anexoDecidido: null, suficiente: false }`.
- Senão `fatorR = folha12m / rbt12`; `>= 0.28 → 'Anexo III'`, senão `'Anexo V'`; `suficiente: true`.
- Limiar como constante `LIMIAR_FATOR_R = 0.28`.

## Integração no resolver

### `anexo-resolver.ts` (puro) — estende `resolverAnexo`

Novo param opcional `fatorR?: FatorRResult | null`. A ramificação `cnaeAnexo.fator_r` passa a:

```ts
if (cnaeAnexo && cnaeAnexo.fator_r) {
  if (fatorR && fatorR.suficiente && fatorR.anexoDecidido) {
    return {
      anexo: fatorR.anexoDecidido,
      origem: 'fator_r',
      fatorR: fatorR.fatorR,
      aviso: `Fator R = ${(fatorR.fatorR! * 100).toFixed(1)}% → ${fatorR.anexoDecidido}.`,
    };
  }
  return {
    anexo: anexoManual,
    origem: 'manual',
    aviso: 'Informe a folha dos últimos 12 meses para calcular o Fator R (Anexo III ou V).',
  };
}
```

`AnexoResolvido` ganha campos opcionais: `origem: 'cnae' | 'manual' | 'fator_r'`, `fatorR?: number | null`.
As demais ramificações (anexo do catálogo, sem CNAE, não mapeado) ficam **inalteradas**.

### `cnae-sync.ts` — `resolverAnexoEmpresa` ganha `competencia`

Assinatura nova:
```ts
resolverAnexoEmpresa(supabase, companyId, anexoManual, competencia?: string): Promise<AnexoResolvido>
```
- Lê o CNAE principal e o `cnae_anexo` como hoje.
- **Só quando** `ref?.fator_r === true` **e** `competencia` foi passada: lê a folha
  (`lerFolhaParaApuracao`) e as receitas (`lerReceitasParaApuracao`), computa
  `rbt12 = calcularRbt12(receitas, competencia).rbt12` e `folha12m = somarFolha12(folhas,
  competencia).folha12m`, e monta `fatorR = calcularFatorR({ folha12m, rbt12 })`.
- Repassa `fatorR` para `resolverAnexo`. Sem `competencia` ou sem `fator_r`, comportamento idêntico
  ao atual (compatível com qualquer chamador existente que não passe competência).
- `catch` continua devolvendo o fallback manual.

### Leitura da folha — `app/src/lib/fiscal/folha-source.ts`

```ts
export async function lerFolhaParaApuracao(
  supabase: SupabaseClient, companyId: string, ateCompetencia: string,
): Promise<FolhaMensal[]>;
```
Espelha `receitas-source.ts`: lê `folha_mensal` por `company_id` na janela de 13 meses
(`competenciaAddMonths(ateCompetencia, -12)` até a atual), mapeia para `FolhaMensal`.

### `iniciarApuracaoAction` (impostos/actions.ts)

- Passa `competencia` para `resolverAnexoEmpresa(supabase, companyId, anexoManual, competencia)`.
- No `upsert` de `apuracoes_fiscais` (modo commit), grava `fator_r: resolvido.fatorR ?? null`.
- Nada mais muda (o `calcularApuracao` recomputa o RBT12 internamente — sobreposição barata e pura;
  não vale acoplar o RBT12 já calculado ao contrato dele).

## UI — `/impostos/folha`

- **Rota** `app/src/app/(auth)/impostos/folha/page.tsx` (server component): carrega a empresa ativa e
  as últimas 13 competências de `folha_mensal`; renderiza `FolhaGrid` (client).
- **`FolhaGrid.tsx`** (client): tabela das 13 competências (atual + 12 anteriores, rotuladas
  `MM/AAAA`), cada linha com 3 inputs numéricos (`pró-labore / salários / encargos`) e a soma do mês.
  Botão **"Salvar"** único (lote). Estado local controlado; toast no sucesso/erro.
- **Action** `salvarFolhaAction(rows: Array<{ competencia; proLabore; salarios; encargos }>)`:
  valida sessão + empresa ativa; faz `upsert` em `folha_mensal` com
  `onConflict: 'company_id,competencia'`; `revalidatePath('/impostos/folha')` e `/impostos`.
- **Entrada**: link/botão **"Folha (Fator R)"** em `app/src/app/(auth)/impostos/page.tsx`.
- Mostrar uma nota explicando que a folha alimenta o Fator R (decide Anexo III vs V) e que meses em
  branco contam como zero.

## Fluxo de dados

```
/impostos/folha (grid) → salvarFolhaAction → folha_mensal
                                                   │
iniciarApuracaoAction(competencia) ───────────────┤
  → resolverAnexoEmpresa(..., competencia)         │
      ├─ ref.fator_r? → lerFolha + lerReceitas ────┘
      │     → somarFolha12 + calcularRbt12 → calcularFatorR
      │     → resolverAnexo({..., fatorR}) → {anexo III|V, origem:'fator_r', fatorR%}
      └─ senão → resolverAnexo (manual/cnae, como hoje)
  → calcularApuracao(anexo) ; commit grava apuracoes_fiscais.fator_r
```

## Erros / bordas
- `rbt12 = 0` (sem notas no período) → Fator R insuficiente → cai no manual + aviso.
- Folha toda em branco → idem (a soma é 0 → insuficiente).
- Folha parcial (poucos meses) → ainda calcula com o que há; a soma reflete os meses lançados. (É
  responsabilidade do usuário manter a folha; a nota da UI avisa que branco = zero.)
- Chamador antigo de `resolverAnexoEmpresa` sem `competencia` → nunca calcula Fator R (seguro).

## Testes (TDD)
- `somarFolha12`: soma janela correta (exclui a própria competência); ignora meses fora; soma os 3
  componentes; conta `meses` com valor.
- `calcularFatorR`: `≥28% → III`; `<28% → V`; `rbt12=0 → insuficiente`; `folha=0 → insuficiente`;
  fronteira exata 0.28 → III.
- `resolverAnexo` com `fatorR`: `fator_r=true` + suficiente III → `origem:'fator_r'`, anexo III, %
  no aviso; + insuficiente → manual + aviso de folha; ramos não-Fator-R inalterados.
- `lerFolhaParaApuracao` e `salvarFolhaAction` são I/O — cobertos indiretamente; foco nos puros.

## Arquivos
- **Create** `app/supabase/migrations/0022_folha_mensal.sql`
- **Modify** `app/src/types/database.ts` (tipo `folha_mensal`)
- **Create** `app/src/lib/fiscal/folha.ts` + teste
- **Create** `app/src/lib/fiscal/fator-r.ts` + teste
- **Create** `app/src/lib/fiscal/folha-source.ts`
- **Modify** `app/src/lib/fiscal/anexo-resolver.ts` (+ teste) — param `fatorR`, `origem:'fator_r'`
- **Modify** `app/src/lib/fiscal/cnae-sync.ts` — `resolverAnexoEmpresa(..., competencia)`
- **Modify** `app/src/app/(auth)/impostos/actions.ts` — passar competência + gravar `fator_r`; nova
  `salvarFolhaAction`
- **Create** `app/src/app/(auth)/impostos/folha/page.tsx`
- **Create** `app/src/app/(auth)/impostos/folha/FolhaGrid.tsx`
- **Modify** `app/src/app/(auth)/impostos/page.tsx` (link de entrada)
