# Spec — /impostos como fila de obrigações + detalhe por competência

> **Data:** 2026-06-08
> **Regime coberto:** Simples Nacional (MEI mantém a tela atual)
> **Depende de:** PGDAS-D Fase 2 (transmissão real) para a ação "Transmitir" — até lá, a ação faz dry-run
> **Direção escolhida (brainstorming):** B — fila por estado + detalhe por rota `/impostos/[competencia]`

## Problema / objetivo

A `/impostos` ancora num card único de "competência atual" = mês corrente do calendário. Isso
quebra na vida real: numa empresa do Simples vários meses coexistem em **estados diferentes** —
um a declarar, outro a pagar, outro vencido, outros pagos — e o mês corrente nem vence ainda.
O sintoma concreto: em junho o card mostra junho (que só vence em julho), e **maio (a obrigação
realmente aberta) não aparece em lugar nenhum**.

Queremos reorganizar a página em torno de **o que precisa de ação**: uma fila de obrigações por
estado, uma prévia discreta do mês corrente, o histórico das pagas, e um detalhe completo por
competência numa rota própria.

## Decisões (do brainstorming)

1. **Transmissão:** a Balu **transmite** a PGDAS-D pela fila (ação "Transmitir PGDAS-D"). Depende
   da Fase 2 (transmit real); até ela fechar, o botão abre o **dry-run/prévia** (`previewDeclaracaoAction`).
2. **Escopo:** **só Simples**. MEI mantém a tela atual (DAS-MEI mensal + DASN-SIMEI anual).
3. **Mês corrente:** mostrado como **prévia discreta no topo** (estimativa local), separado da fila.
4. **Arquitetura (abordagem 1):** o estado de cada competência é **derivado** das tabelas existentes
   por um helper puro — **sem schema novo**.

## Modelo derivado — `ObrigacaoFiscal`

Helper puro `lib/fiscal/obrigacoes.ts`:

```ts
export type EstadoObrigacao = 'a_declarar' | 'a_pagar' | 'vencida' | 'paga';

export type ObrigacaoFiscal = {
  competencia: string;            // 'YYYYMM'
  estado: EstadoObrigacao;
  declarada: boolean;             // tem numero_declaracao
  numeroDeclaracao: string | null;
  dataTransmissao: string | null;
  numeroDas: string | null;
  valor: number | null;           // valor_total do DAS (real); null se ainda não declarada
  vencimento: string | null;      // 'YYYY-MM-DD'
  pagamento: string | null;       // 'YYYY-MM-DD'
  pdfUrl: string | null;
  estimativaLocal: number | null; // apuracoes_fiscais (cálculo das notas), p/ a_declarar/prévia
};

export function derivarObrigacoes(input: {
  hoje: Date;                     // BRT
  competenciasEsperadas: string[];// 'YYYYMM' de jan (ou início de atividade) até o último mês fechado
  declaracoes: DeclaracaoRow[];   // declaracoes_fiscais
  guias: GuiaRow[];               // guias_fiscais
  apuracoes: ApuracaoRow[];       // apuracoes_fiscais
}): ObrigacaoFiscal[];
```

### Regra do estado (ordem de prioridade, dado `hoje` BRT)

1. `paga` → existe guia com `status === 'paga'` ou `data_pagamento` preenchida.
2. `vencida` → não paga, tem `vencimento`, e `vencimento < hoje`.
3. `a_pagar` → declarada, não paga, e (sem `vencimento` ou `vencimento >= hoje`).
4. `a_declarar` → competência **fechada** e **não declarada**.

Competência que não casa com nenhuma regra (ex.: mês corrente, não fechado) **não entra na fila** —
vai pra prévia.

> **Declarada sem DAS materializado (transitório):** na prática o sync gera o DAS de toda
> competência declarada e não paga (GERARDAS12), então `a_pagar`/`vencida` sempre têm `numero_das`,
> `valor` e `vencimento`. Se o DAS ainda não estiver materializado, a competência declarada e não
> paga cai em `a_pagar` (sem `vencimento` → não é vencida) e a ação "Baixar DAS" dispara a geração.
> Ou seja: o estado depende de **declarada/paga**, não da presença do DAS.

### Enumeração de competências esperadas (resolve o "não vejo maio")

O sync (CONSDECLARACAO13) só traz meses **já declarados** (jan–abr). Maio, fechada e não declarada,
**não tem linha em nenhuma tabela**. Por isso o helper recebe `competenciasEsperadas` — geradas de
**janeiro do ano-calendário** (ou início de atividade, o que for mais tarde) até o **último mês
fechado** (mês corrente − 1, BRT). Toda esperada sem declaração vira `a_declarar`. É isso que faz
maio aparecer.

> Início de atividade: hoje o schema não tem o campo confiável (ver `iniciarApuracaoAction`, que já
> ignora anualização por isso). **v1: enumerar de janeiro do ano-calendário corrente.** Quando o
> campo de início existir, restringir o começo da janela.

O helper é **puro** (sem I/O) e **testável**: a `page.tsx` gera `competenciasEsperadas` e passa as
linhas das três tabelas.

## Layout da `/impostos` (Simples, pós-sync)

O gate inicial continua mandando enquanto `sincronizacao_inicial_serpro_at` for null. Pós-sync:

```
Impostos
AL PISCINAS LTDA · Junho/2026                      [Folha (Fator R)]
───────────────────────────────────────────────────────────────────
 Mês corrente (prévia)                              ← discreto, no topo
 Junho/2026 · estimativa R$ 1.800,00  ·  não vence ainda
───────────────────────────────────────────────────────────────────
 Precisa de atenção                                 ← a FILA
 ┌───────────────────────────────────────────────────────────────┐
 │ Abril/2026     [Vencida]     R$ 11.079,48   venceu 20/05   ›   │
 │                                          [Baixar DAS]          │
 │ Maio/2026      [A declarar]  ~R$ 1.910 (estim.)  fechou    ›   │
 │                                     [Transmitir PGDAS-D]       │
 └───────────────────────────────────────────────────────────────┘
───────────────────────────────────────────────────────────────────
 Histórico                                          ← só as pagas
 Competência   Vencimento   Valor        Status
 Março/2026    20/04        12.911,50     Paga      ▸ (expande)
 Fevereiro     20/03        34.564,56     Paga      ▸
 Janeiro       20/02        12.666,19     Paga      ▸
```

- **Ordenação da fila:** vencidas no topo → a pagar (por vencimento) → a declarar (por competência).
  Fila vazia → estado "Tudo em dia".
- **Ação primária por estado:** `vencida`/`a_pagar` → **Baixar DAS** (PDF do GERARDAS12);
  `a_declarar` → **Transmitir PGDAS-D** (dry-run até a Fase 2). Item clicável → detalhe.
- **Histórico:** reusa `HistoricoGuias` (linha expansível) só com as `paga`.

### Componentes

| Arquivo | Papel |
|---|---|
| `app/(auth)/impostos/PreviaMesCorrente.tsx` | bloco discreto com a estimativa do mês corrente (reusa `calcularApuracao`/`apuracoes_fiscais`) |
| `app/(auth)/impostos/FilaObrigacoes.tsx` | recebe as obrigações em atenção (estado ≠ paga), ordena, renderiza |
| `app/(auth)/impostos/ObrigacaoItem.tsx` | um item: badge de estado + valor + vencimento + ação + link p/ detalhe |
| `app/(auth)/impostos/HistoricoGuias.tsx` | **reusado**, agora só `paga` |
| `app/(auth)/impostos/page.tsx` | gera `competenciasEsperadas`, chama `derivarObrigacoes`, separa atenção × paga, renderiza prévia + fila + histórico; mantém o gate |

## Rota de detalhe `/impostos/[competencia]`

Server component por competência: valida formato (`YYYYMM`) + ownership, carrega apuração/declaração/guia
daquela competência, deriva a `ObrigacaoFiscal` (mesmo helper) e compõe 3 seções.

```
‹ Voltar a Impostos
Maio/2026                                        [A declarar]
─────────────────────────────────────────────────────────────
 Apuração (estimativa)   Receita · Anexo · RBT12/Alíquota · Estimativa [+ por anexo]
─────────────────────────────────────────────────────────────
 Declaração (PGDAS-D)    — não transmitida —   [ Transmitir PGDAS-D ]   (dry-run até Fase 2)
─────────────────────────────────────────────────────────────
 DAS                     — nasce após a declaração —
```

Competência paga preenche as 3 seções (número da declaração + transmissão; número do DAS + valores +
vencimento/pagamento + **Baixar PDF**). O detalhe do **mês corrente** mostra só a seção Apuração (prévia).

| Arquivo | Papel |
|---|---|
| `app/(auth)/impostos/[competencia]/page.tsx` | server: valida + carrega + deriva + compõe as seções |
| `app/(auth)/impostos/SecaoApuracao.tsx` | dl da apuração + "por anexo" (migra a lógica do card atual) |
| `app/(auth)/impostos/SecaoDeclaracao.tsx` | número/data/status **ou** ação Transmitir (dry-run até Fase 2) |
| `app/(auth)/impostos/SecaoDas.tsx` | valores + vencimento/pagamento + **Baixar PDF** (reusa `GuiaActions`) |

Navegação: itens da fila e linhas do histórico linkam pra cá; "‹ Voltar a Impostos" retorna. O
`CompetenciaAtualCard` (card único) é **aposentado** — suas peças migram pra `SecaoApuracao`/`SecaoDas`.

## Ações & erros

| Ação | Onde | O que faz | Erro |
|---|---|---|---|
| Transmitir PGDAS-D | item `a_declarar` + `SecaoDeclaracao` | até a Fase 2: dry-run (`previewDeclaracaoAction`, `indicadorTransmissao=false`). Pós-Fase 2: transmit real gated, que grava declaração + gera DAS | mensagens amigáveis existentes |
| Baixar PDF | item `a_pagar`/`vencida` + `SecaoDas` | abre o data-URI de `guias_fiscais.url_pdf` | sem SERPRO → sem erro |
| Atualizar (1º sync) | gate | inalterado (CONSDECLARACAO13 + PAGAMENTOS71 [fatal] + GERARDAS12) | já tratado |

- **Freshness:** a fila deriva do banco. `a_declarar` é **calculado ao vivo** (calendário − declaradas)
  → maio aparece sem novo sync. "Virou paga" depende do sync/cron (futuro). Transmitir grava a
  competência na hora.
- **Sem migração** — tudo deriva das tabelas atuais.
- **Detalhe:** competência inválida ou de outra empresa → redirect pra `/impostos`.

## Testes

- **`lib/fiscal/obrigacoes.test.ts`** (núcleo): unit fixture-based do `derivarObrigacoes` cobrindo
  cada transição — `paga` (via `data_pagamento`), `vencida` (venc < hoje, não paga), `a_pagar`
  (venc ≥ hoje), `a_declarar` (mês fechado sem declaração), mês corrente **fora** da fila, e a
  ordenação (vencida → a_pagar → a_declarar). Inclui o caso "esperada sem declaração → a_declarar".
- Testes atuais (`guia`, `serpro-das-simples-parse`) seguem.
- **Smoke manual:** gate → sync → fila com Maio `a_declarar` + Abril `vencida` + histórico Jan–Mar;
  clicar num item → detalhe.
- Sem teste de rede (helper puro; SERPRO já coberto por scripts).

## Sequência de implementação sugerida

1. `lib/fiscal/obrigacoes.ts` + teste (TDD, o núcleo).
2. `page.tsx`: gerar `competenciasEsperadas`, derivar, separar atenção × paga.
3. `PreviaMesCorrente` + `FilaObrigacoes` + `ObrigacaoItem`; reusar `HistoricoGuias` (só pagas).
4. Rota `[competencia]/page.tsx` + `SecaoApuracao`/`SecaoDeclaracao`/`SecaoDas`; aposentar `CompetenciaAtualCard`.
5. `tsc` + `vitest` + smoke manual (AL PISCINAS).

## Fora de escopo (YAGNI)

- **MEI** (mantém a tela atual).
- **Transmissão real da PGDAS-D** (Fase 2) — a ação fica como dry-run até a Fase 2 fechar; este spec
  só prepara o slot.
- **Cron de atualização** (freshness recorrente) — feature separada.
- **Campo de início de atividade** — v1 enumera de janeiro do ano-calendário; restringir quando o
  campo existir.
- **Multi-ano** — a fila/histórico cobrem o ano-calendário corrente (igual ao sync).

---

## Status de implementação (2026-06-08) — FEITO

Branch `feat/remove-serpro-buttons`. Implementado via subagent-driven (plano
`docs/superpowers/plans/2026-06-08-impostos-fila-obrigacoes.md`), validado na UI com a AL PISCINAS
(dados reais seedados). `tsc` limpo, helper com 11 testes.

**Code review aplicado:** (1) mês corrente filtrado das guias/declarações antes de derivar (não vaza
pra fila via união defensiva); (2) detalhe do mês corrente mostra só Apuração; (3) item vencido diz
"venceu" (não "vence"); (4) teste da união defensiva.

**Adição — botão Apurar/Recalcular (`ApurarButton`):** a seção Apuração ganhou um botão para meses
**não transmitidos** (`a_declarar`, incl. mês corrente) que roda `iniciarApuracaoAction('commit')` —
cálculo interno das notas, **idempotente, sem SERPRO** (pode apurar quantas vezes quiser). Label
"Apurar" quando não há apuração, "Recalcular apuração" quando já existe.

**Fora deste spec mas no mesmo branch (contexto):** remoção dos botões que disparam SERPRO por clique
(Gerar DAS / Consultar na SERPRO / Marcar paga / Copiar linha) e o sync trazendo a DAS em aberto via
GERARDAS12 — ver `2026-06-03-consulta-listagem-das-simples-design.md` e `SERPRO-INVESTIGACAO.md`.
