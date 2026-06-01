# Motor de apuração de impostos — MEI + Simples (NFS-e v1)

> **Status:** desenho aprovado (2026-05-29). Escopo: motor de apuração (itens 1–7 do plano de migração n8n→Next). Integração Serpro/DAS fica para spec separado.
>
> **Precede:** `docs/superpowers/specs/2026-05-28-apuracao-n8n-para-next-design.md` (análise do fluxo n8n, 6 bugs encontrados).

## Objetivo

Calcular a apuração mensal de imposto (MEI fixo / Simples Nacional via tabela) a partir das receitas da empresa, persistir em `apuracoes_fiscais` e exibir num wizard com breakdown. Reimplementação tipada e testável do fluxo n8n, corrigindo seus bugs de cálculo.

## Escopo

**Dentro:**
- Regimes: **MEI** (code 4) e **Simples Nacional** (codes 1 e 2). Foco NFS-e/serviço.
- Núcleo de cálculo puro + migration + server action + wizard de 2 passos.

**Fora (v2 ou spec próprio):**
- **Regime Normal / Lucro Real / Presumido** (code 3) → **bloqueado** com mensagem, não calculado.
- **Fator R** → não calculado; usa o `anexo_simples` cadastrado na empresa (não temos schema de folha de pagamento). Mesmo comportamento do n8n, mas explícito sobre a limitação.
- **Integração Serpro / geração de DAS real** → spec separado (itens 8–9 do plano de migração).

## Decisões herdadas

1. **Origem das receitas (`receitas_fiscais` vs `notas_fiscais`) — RESOLVIDO (2026-05-31): opção (b).** Investigação (mensagens de 2026-05-29) concluiu que `receitas_fiscais` é uma **tabela órfã**: nenhum gravador existe (nem Bubble REST, nem RPC, nem trigger, nem n8n, nem app). O dado que existia foi apagado em 2026-05-28; sem backup (plano Free). **DECISÃO FINAL (2026-05-31): opção (b)** — `receitas_fiscais` descontinuada (drop na migration 0014); fonte canônica é `notas_fiscais`.
2. **Fator R não calculado** — ver Escopo.
3. **Regime Normal bloqueado** — ver Escopo.

## Arquitetura — 3 camadas + costura

```
Núcleo puro (lib/fiscal/) ──────── sem Supabase/React, 100% testável (vitest)
  simples.ts · rbt12.ts · das-mei.ts · apuracao.ts (orquestrador)
       ▲ consome ReceitaApuracao[]  ← o tipo normalizado é a costura
Costura de dados (lib/fiscal/receitas-source.ts) ── ÚNICO ponto da decisão a/b
  lerReceitasParaApuracao(supabase, companyId, ateCompetencia) → ReceitaApuracao[]
Server action (app/(auth)/impostos/actions.ts) ── iniciarApuracaoAction
UI (app/(auth)/impostos/novo/ApuracaoWizard.tsx) ── 2 passos: preview → confirmar
```

**Princípio central:** o núcleo de cálculo consome um tipo normalizado `ReceitaApuracao` e não sabe de onde vêm os dados. A decisão pendente (a/b) vive isolada em **um** arquivo (`receitas-source.ts`); trocá-la é mudar uma função, sem tocar no núcleo.

## Tipos (a costura)

```ts
// lib/fiscal/apuracao-types.ts
export type ReceitaApuracao = {
  competencia: string;   // "YYYY-MM"
  valor: number;         // R$ (receita bruta do documento)
};

export type ResultadoApuracao = {
  tipoApuracao: 'DAS-MEI' | 'Simples Nacional';
  competencia: string;            // "YYYY-MM"
  receitaMes: number;             // receita bruta da própria competência
  rbt12: number | null;           // null para MEI
  aliquotaEfetiva: number | null; // null para MEI
  valorImposto: number;
  breakdown: Record<string, unknown>; // vai pra payload_calculo
};
```

## Módulos

### `lib/fiscal/simples.ts`
Tabela do Simples Nacional (Anexos I–V), válida 2026 (LC 155/2016), versionada por vigência para futura troca (LC 214/2025).

```ts
type FaixaSimples = { ate: number; nominal: number; deduzir: number };
const TABELA_SIMPLES_2026: Record<AnexoSimples, FaixaSimples[]>; // faixas ordenadas por `ate` asc
export function getTabelaSimples(competencia: string): Record<AnexoSimples, FaixaSimples[]>;
export function identificarFaixa(rbt12: number, anexo: AnexoSimples): FaixaSimples;
export function aliquotaEfetiva(rbt12: number, faixa: FaixaSimples): number;
  // = Math.max(0, ((rbt12 * faixa.nominal) - faixa.deduzir) / rbt12)   ← clamp (Bug 3)
  // rbt12 === 0 → retorna 0 (evita divisão por zero)
```

### `lib/fiscal/rbt12.ts`
RBT12 = receita bruta dos **12 meses imediatamente anteriores** à competência (exclui a própria competência — corrige Bug 2). Anualização proporcional para empresa com < 12 meses de atividade (corrige Limitação 1).

```ts
export function calcularRbt12(
  receitas: ReceitaApuracao[],
  competencia: string,           // competência sendo apurada (excluída do RBT12)
  dataInicioAtividade?: string,  // ISO; se < 12 meses, anualiza
): { rbt12: number; mesesConsiderados: number; anualizado: boolean };
  // janela: [competencia - 12 meses, competencia - 1 mês], com virada de ano correta
  // anualização: rbt12 = soma_real * (12 / mesesConsiderados) quando mesesConsiderados < 12
```

### `lib/fiscal/das-mei.ts`
Valores fixos do DAS-MEI 2026 por atividade.

```ts
export function valorDasMei(atividade: string | null | undefined): number;
  // 'Comercio ou Industria' | 'Prestacao de Servicos' | 'Comercio e Servicos'
  // valores fixos 2026 (a confirmar tabela vigente); default = serviços
```

### `lib/fiscal/apuracao.ts`
Orquestrador puro. Branch por regime; **não** depende de Supabase.

```ts
export function calcularApuracao(input: {
  regimeCode: string;          // '1' | '2' | '4'  (… '3' → erro)
  anexo: AnexoSimples | null;
  receitas: ReceitaApuracao[];
  competencia: string;
  dataInicioAtividade?: string;
}): ResultadoApuracao;
  // code '4'  → DAS-MEI (valor fixo; rbt12/aliquota = null)
  // code '1'/'2' → Simples: receitaMes (da competência) → calcularRbt12 → identificarFaixa
  //                → aliquotaEfetiva → valorImposto = receitaMes * aliquota   ← receita correta (Bug 1)
  // code '3'  → lança RegimeNaoSuportadoError ("Regime Normal não é apurado na v1")
```

### `lib/fiscal/receitas-source.ts` — a costura (decisão a/b)
Único ponto que conhece a origem dos dados. **Default provisório: opção (b)** lendo `notas_fiscais`.

```ts
// PROVISÓRIO (2026-05-29): lê de notas_fiscais (opção b). Decisão final pendente do outro dev.
// Opção (a) descartada (2026-05-31): receitas_fiscais foi descontinuada. Fonte = notas_fiscais.
export async function lerReceitasParaApuracao(
  supabase: SupabaseClient,
  companyId: string,
  ateCompetencia: string,   // inclui a competência apurada + 12 meses anteriores
): Promise<ReceitaApuracao[]>;
  // notas_fiscais: status='ativa', tipo_documento='NFSe', janela de 13 meses
  // competencia derivada do mês de data_emissao; valor = valor_total
```

### `supabase/migrations/0007_apuracoes_unique.sql`
Corrige Bug 5 (race/duplicata) e habilita upsert idempotente.

```sql
CREATE UNIQUE INDEX uniq_apuracoes_company_competencia
  ON public.apuracoes_fiscais (company_id, competencia_referencia)
  WHERE deleted_at IS NULL;
```

### `app/(auth)/impostos/actions.ts` — `iniciarApuracaoAction(competencia)`
1. Auth (session) + resolve `company_id` ativo.
2. Carrega `empresas_fiscais` (regime, anexo, data início atividade).
3. `lerReceitasParaApuracao(...)`.
4. `calcularApuracao(...)` (captura `RegimeNaoSuportadoError` → retorno de erro amigável).
5. **Upsert** em `apuracoes_fiscais` por `(company_id, competencia_referencia)` — grava `receita_mes`, `rbt12`, `aliquota_efetiva`, `valor_imposto`, `anexo_simples`, `tipo_apuracao`, `status='calculada'`, `payload_calculo` (= breakdown).
6. `revalidatePath('/impostos')`. Retorna `ResultadoApuracao`.

### `app/(auth)/impostos/novo/page.tsx` + `novo/ApuracaoWizard.tsx`
Wizard de 2 passos (client, `useActionState`):
- **Passo 1 — competência**: default mês anterior (`competenciaReferenciaBrt` deslocado -1). Botão "Calcular" chama a action → **preview** com breakdown (RBT12, faixa/anexo, alíquota efetiva, receita do mês, valor do imposto).
- **Passo 2 — confirmar**: persiste (já feito no passo 1? não — passo 1 calcula e mostra; confirmar grava). Reusa `<Loading>`, padrão `useToast()`. Sucesso → redirect `/impostos`.

> Nota de implementação: para evitar gravar antes de confirmar, a action pode ter modo `preview` (calcula, não persiste) e `commit` (persiste). Detalhe a resolver no plano.

## Fluxo de dados

```
usuário escolhe competência (default mês anterior)
  → iniciarApuracaoAction(preview)
      → empresas_fiscais + lerReceitasParaApuracao  (13 meses)
      → calcularApuracao → ResultadoApuracao
  → wizard mostra breakdown
  → usuário confirma → iniciarApuracaoAction(commit)
      → upsert apuracoes_fiscais (idempotente)
  → redirect /impostos (dashboard PR 3.1 exibe)
```

## Tratamento de erros / edge cases

- **Regime Normal (code 3):** bloqueia com mensagem; não calcula (corrige Bug 4).
- **Receitas vazias:** `receitaMes = 0`. Simples → imposto 0; MEI → valor fixo independe de receita.
- **Empresa < 12 meses:** RBT12 anualizado proporcionalmente.
- **Alíquota:** `Math.max(0, …)`; `rbt12 = 0` → alíquota 0 (sem divisão por zero).
- **Reexecução da mesma competência:** upsert atualiza, não duplica (corrige Bugs 5 e 6).
- **Competência inválida:** valida formato `YYYY-MM` na action.

## Bugs do n8n corrigidos

| # | Bug | Como corrige |
|---|---|---|
| 1 | `receita_mes` gravava o mês, não o valor | orquestrador usa receita bruta da competência |
| 2 | RBT12 cobria 13 meses incl. a atual | janela `[comp-12, comp-1]` |
| 3 | Alíquota podia ficar negativa | `Math.max(0, …)` |
| 4 | Lucro Real caía no Simples | bloqueio explícito do code 3 |
| 5 | Race/duplicata sem UNIQUE | unique index + upsert |
| 6 | UPDATE filtrava por id errado | upsert por `(company_id, competencia)` |
| ⚠1 | RBT12 não anualizava | anualização proporcional |

## Testes

Vitest no núcleo puro (~20+ casos):
- `simples.test.ts`: boundary em cada limite de faixa, clamp da alíquota, `rbt12 = 0`.
- `rbt12.test.ts`: janela de 12 meses, exclusão da competência atual, virada de ano, anualização (< 12 meses).
- `das-mei.test.ts`: 3 atividades + default.
- `apuracao.test.ts`: MEI, Simples (codes 1 e 2), Normal-bloqueado, receitas vazias.

Action e wizard: smoke leve (a definir no plano).

## Build sequence sugerido (detalhe vem no plano)

1. `apuracao-types.ts` (tipos)
2. `simples.ts` + testes
3. `rbt12.ts` + testes
4. `das-mei.ts` + testes
5. `apuracao.ts` (orquestrador) + testes
6. migration `0007`
7. `receitas-source.ts` (opção b — fonte canônica `notas_fiscais`)
8. `impostos/actions.ts`
9. `impostos/novo/*` (wizard)
