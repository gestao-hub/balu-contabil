# Revisão de escopo — Impostos / DAS / Declarações

**Data:** 2026-06-04
**Pergunta:** o que foi **documentado** (spec portada do Bubble + PRDs) × o que foi **implementado** no código, na área de imposto / apuração / DAS / declarações.

Fontes da análise: PRD e funcionalidades (`docs/product/*`), material extraído do Bubble (`docs/bubble-to-prd/*`), planning (`docs/planning/*`), investigações SERPRO/DB (`docs/investigations/*`); e o código em `app/src/app/(auth)/impostos/`, `app/src/lib/fiscal/`, `app/src/lib/clients/serpro*.ts`, migrations e `docs/reference/db_atual.sql`.

---

## Veredito

Existe um **núcleo de apuração + DAS sólido e bem testado**, com **duas divergências de arquitetura intencionais** (motor n8n → TypeScript; schema do banco ≠ schema do PRD) e **um gap grande de escopo nas "declarações"**: o pipeline documentado **transmite a declaração antes de gerar o DAS**, e o código pula essa etapa. DASN-SIMEI e DEFIS (prometidas na V1) não existem.

---

## Matriz de escopo — documentado × implementado

Legenda: ✅ feito · 🟡 parcial · ❌ ausente · 🔀 divergente (feito de outro jeito)

| Funcionalidade documentada | Fonte (doc) | Código | Status |
|---|---|---|---|
| Dashboard `/impostos` (competência atual + histórico guias + **histórico declarações**) | PRD §11.1; PLANO-4-DIAS PR 3.1 | `app/src/app/(auth)/impostos/page.tsx`, `CompetenciaAtualCard.tsx`, `HistoricoGuias.tsx` | 🟡 — guias ok; **seção de declarações não existe** |
| `/impostos/novo` wizard **6 etapas** (consolidar → RBT12 → PGDAS-D → **transmitir declaração** → emitir DAS → consultas) | PRD §11.2; PLANO PR 3.2 | `app/src/app/(auth)/impostos/novo/page.tsx`, `ApuracaoWizard.tsx` | 🔀/🟡 — virou *calcular → confirmar*; DAS é botão separado; **sem etapa "transmitir declaração"** |
| Apuração de receitas → `apuracoes_fiscais` | PRD §11.2; V1 §4.1 | `app/src/lib/fiscal/apuracao.ts`, `receitas-source.ts` | 🔀 — lê de `notas_fiscais` (n8n descontinuado); **sem breakdown por tributo** (IRPJ/CSLL/PIS/COFINS/INSS/ICMS/ISS) que o schema do PRD previa |
| RBT12 + alíquota efetiva por anexo | PRD §11.2/§15; V1 §4.1 | `app/src/lib/fiscal/rbt12.ts`, `simples.ts` (`TABELA_SIMPLES_2026`) | ✅ (tabela 2026 hardcoded) |
| DAS-MEI (valor fixo + SERPRO PGMEI/`GERARDASPDF21`, **sem procuração**) | V1 §4.1; SERPRO-INVESTIGACAO §3.1 | `app/src/lib/fiscal/das-mei.ts`, `serpro-das-mei.ts` | 🟡 — funciona, mas **falta `empresas_fiscais.atividade_mei`** → cálculo local sempre R$80,90 ("Prestação de Serviços") |
| DAS Simples (PGDAS-D `GERARDAS12`, **exige procuração cód. 00146**) | PRD §11.2; SERPRO §3.1 | `app/src/lib/fiscal/serpro-das-simples.ts` + fluxo procurador (`serpro-procurador.ts`) | ✅ — parser ainda por inferência (falta smoke contra DAS real em aberto) |
| **Transmissão PGDAS-D** (`TRANSDECLARACAO11`, entrada/saída) | PRD §11.2 | scaffolding morto em `serpro.ts` (`transmitirDeclaracao`, nunca chamado) | ❌ |
| **DASN-SIMEI** anual automática (MEI) | V1 §7.1 | — | ❌ — zero referências |
| **DEFIS** anual (Simples) | V1 §7.1 | — | ❌ — nem citada no código (PRD também só dá o nome) |
| Consultas SERPRO (declarações por ano / última do mês / extrato DAS) | PRD §11.2/§14 | `app/src/lib/fiscal/serpro-consulta.ts` (`CONSDECLARACAO13`) | 🟡 — só consulta de situação, **só Simples** (MEI "depois"); não traz valor/vencimento |
| Geração de guia (boleto + linha digitável + QR Pix + PDF) → `guias_fiscais` | PRD §11; V1 §4.2 | `app/src/lib/fiscal/guia.ts`, `impostos/GuiaActions.tsx` | 🟡 — PDF + linha digitável + marcar paga ✅; **QR / Pix Copia-e-Cola não** |
| Preview de imposto na emissão | V1 §3.3 | `app/src/lib/fiscal/preview-imposto.ts` | ✅ |
| Alerta de limite de faturamento | V1 §3.4 (`getLimiteStatus`) | `app/src/lib/fiscal/limite-emissao.ts` + `notas_fiscais/LimiteEmissaoBanner.tsx` | 🟡 — implementado como **banner de limite de emissão** nas Notas (nome/local diferentes), não dentro de `/impostos` |
| Explicação em pt-BR da apuração | V1 §4.3 | — | ❌ — confirmado ausente |
| Cron mensal de apuração automática | V1 §4.1; PLANO PR 3.3 | — | ❌ — só wizard manual |
| Marcação automática de "vencida" | PRD §15 | `HistoricoGuias.tsx:24-26` (só visual via `isGuiaVencida`) | ❌ — sem cron que escreva no banco |
| Alertas de vencimento (e-mail V1 / WhatsApp V2) | V1 §7.2; V2 §4 | — | ❌ |
| Fator R (cálculo / troca de anexo) | V1 §3.3; benchmark Contabilizei | `regime.ts:39` `fatorRAplicavel` (só flag visual) | ❌ — coluna `apuracoes_fiscais.fator_r` órfã, nunca calculada |

---

## Divergências de arquitetura (intencionais, mas não refletidas na doc)

1. **Motor fiscal n8n → TypeScript puro.** O PRD §11/§14 descreve o cálculo via webhooks n8n (`consolidar_receitas_fiscais`, `calcular_rbt12`, `consulta_das_mei`) + Supabase secundário "MOTOR". O código **reimplementou tudo em `app/src/lib/fiscal/`** e o n8n foi descontinuado. A doc está obsoleta nesse ponto; `app/src/lib/clients/_endpoints.ts` é catálogo legado (código morto). Ver memória `balu-n8n-em-transicao`.

2. **Schema do banco divergiu do PRD.** O PRD prevê `apuracoes_fiscais` / `declaracoes_fiscais` / `guias_fiscais` com `empresa_id` e colunas por tributo. O banco real (fonte de verdade: `docs/reference/db_atual.sql`) usa `company_id` + colunas diferentes; **`declaracoes_fiscais` não existe**; `apuracoes_fiscais` não guarda breakdown por tributo. A migration `0001_init.sql` está defasada (define `apuracoes_fiscais` com `empresa_id` + RLS por `empresa_id` inexistente). Ver memória `balu-db-source-of-truth`.

---

## Gaps de fidelidade no cálculo (citados no código)

- **DAS-MEI local sempre R$80,90** — falta `empresas_fiscais.atividade_mei` (`actions.ts:110`, `das-mei.ts:14`). A emissão SERPRO real usa o valor da Receita, não esse default.
- **RBT12 nunca anualiza** na prática — falta `dataInicioAtividade` no schema (`apuracao.ts:111`); sempre assume 12 meses.
- **Fator R não calculado** — só flag visual; coluna `fator_r` órfã.
- **Tabelas hardcoded 2026** sem versionamento efetivo por competência — `simples.ts:49` (default `'202601'`), `das-mei.ts` (salário mínimo R$1.518/2025, "CONFERIR p/ 2026").
- **Parser do DAS Simples por inferência** — `serpro-das-simples-parse.ts:3-4`, ainda sem smoke contra um DAS real em aberto.
- **`TRIBUTO_CODIGOS`** "conferir contra PRD §11.2 antes de produção" — `serpro.ts:171`.
- **Consulta de listagem só Simples** (MEI pendente) — `actions.ts:234`.

---

## Os 3 pontos que merecem decisão

1. **Declarações (maior gap).** A V1 promete PGDAS-D (transmissão mensal), DASN-SIMEI e DEFIS. Hoje **nada disso transmite** — só geramos/consultamos DAS. Para Simples é questão de *correção*, não só de escopo: o DAS do PGDAS-D pressupõe a declaração transmitida no período. **Decidir:** entra na v1 ou vira escopo declarado-como-futuro? Hoje está em limbo (prometido na doc, ausente no código, sem registro de adiamento).

2. **Fidelidade do cálculo:** `atividade_mei`, Fator R, anualização do RBT12, versionamento das tabelas, smoke do parser Simples.

3. **Automação e UX prometidas e ausentes:** cron de apuração, "vencida" automática, alertas de vencimento, explicação pt-BR, QR/Pix Copia-e-Cola. (Limite de faturamento já existe como banner nas Notas.)

---

## Lacunas na própria documentação

- O slice do Bubble (`docs/bubble-to-prd/slices/01_pages.json`) **não detalha campos/elementos internos** das telas `impostos`/`impostos_new` — foi podado a top-level. A spec de UI vive só na prosa do PRD §11 e no PLANO.
- **DEFIS** aparece só como nome (V1 §7.1) — sem fluxo, endpoint ou campos.
- **Lucro Real/Presumido** explicitamente diferido ("escopo futuro do motor", PRD §15).
- `calcular_apuracao_pgdasd` no api_connector aponta para a URL de `consulta_das_mei` — possível inconsistência de naming herdada do Bubble.

---

## Cobertura de testes existente (área fiscal)

`apuracao.test.ts`, `simples.test.ts`, `rbt12.test.ts`, `das-mei.test.ts`, `das-mei-parse.test.ts`, `serpro-das-simples-parse.test.ts`, `serpro-das-comum.test.ts`, `serpro-consulta-parse.test.ts`, `serpro-termo.test.ts`, `serpro-expiracao.test.ts`, `serpro-auth.test.ts`, `serpro.test.ts`, `guia.test.ts`, `preview-imposto.test.ts`, `regime.test.ts` — todos em `app/src/lib/fiscal/` e `app/src/lib/clients/`.
