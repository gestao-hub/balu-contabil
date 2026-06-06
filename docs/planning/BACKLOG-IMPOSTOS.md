# Backlog priorizado — Impostos / DAS / Declarações

**Data:** 2026-06-04
**Base:** `docs/investigations/REVISAO-ESCOPO-IMPOSTOS.md` (revisão documentado × implementado).

Cada item: **tipo** (🔧 Correção · ✨ Feature · ⏸️ Adiar · 🧹 Limpeza), **por quê**, **esforço** (S ≤ meio dia · M ~1-2 dias · L > 2 dias), **dependências**.

Tiers: **P0** = correção/risco antes de emitir DAS de verdade · **P1** = essencial p/ fechar a V1 · **P2** = automação/UX da V1 · **P3** = adiar (V2+ ou diferido).

---

## Progresso (atualizado 2026-06-05)

**Todos os P0 fechados.**

- 🟡 **0.1** — (a) paliativo ✅: `gerarDasSimplesAction` bloqueia DAS sem PGDAS-D transmitida (`CONSDECLARACAO13`). (b) **Transmissão — Fase 1 (builder + dry-run) ✅** (2026-06-05): monta a PGDAS-D (`TRANSDECLARACAO11`) e chama `/Declarar` com `indicadorTransmissao=false` (SERPRO calcula SEM transmitir); botão "Pré-visualizar declaração" no `/impostos`; validado ao vivo (AL Piscinas 202605 → R$1.746,55, nada transmitido). Spec/plan `2026-06-05-pgdasd-transmissao-fase1*`, API `docs/investigations/PGDAS-D-TRANSDECLARACAO11.md`. (c) **Fase 2 (transmit real `indicadorTransmissao=true`) PENDENTE** — gated + sign-off do contador (caráter declaratório = confissão de dívida) + persistir em `declaracoes_fiscais` + **retificadora** (`tipoDeclaracao=2` quando a competência já tem `numeroDeclaracao` no `CONSDECLARACAO13`; substitui integral, gera DAS complementar) + **alerta de prazo/multa** (entrega até dia 20 do mês subsequente — mesmo prazo do DAS; multa conta no dia seguinte ao vencimento desde a Reforma 2026, LC 214/2025 + CGSN 183/2025) + painel de competências **pendentes / no prazo / vencidas** (derivado do `CONSDECLARACAO13`). Detalhes: `docs/investigations/PGDAS-D-TRANSDECLARACAO11.md` (§ Prazo, multa e retificadora) + spec `2026-06-06-pgdasd-transmissao-fase2-design.md`.
- ✅ **0.2** — paliativo: parser de DAS Simples falha alto + loga em formato inesperado (não grava R$0). Smoke contra DAS real ainda recomendado.
- ✅ **0.3** — **Fator R completo**: `folha_mensal` (migration 0022) + `somarFolha12`/`calcularFatorR`, resolução no `resolverAnexo`/`resolverAnexoEmpresa`, tela `/impostos/folha`. Spec/plan `2026-06-05-fator-r-calculo*`.
- ✅ **0.3 (segregação)** — **CNAE por nota + apuração segregada por anexo**: coluna `notas_fiscais.cnae` (migration 0024), dropdown na emissão de NFS-e, `calcularApuracao` fatia receita por anexo (Fator R da empresa decide III↔V). **Validado ao vivo** (emissão real em homologação na AL Piscinas → apuração segregou Anexo I × Anexo IV). Spec/plan `2026-06-05-cnae-na-nota-segregacao*`.
- ✅ **0.4** — `atividade_mei` (migration 0023) corrige a **estimativa** local de DAS-MEI; DAS real (SERPRO) já estava certo. Spec/plan `2026-06-05-atividade-mei*`.

**Próximo:** P1.1 (Declarações no `/impostos`).

---

## P0 — Correção / risco (antes de DAS em produção)

| # | Item | Tipo | Por quê | Esforço | Dep. |
|---|---|---|---|---|---|
| **0.1** | **Transmitir PGDAS-D antes de gerar DAS Simples** (`TRANSDECLARACAO11`, entrada/saída) | 🔧 | O DAS do Simples pressupõe a declaração transmitida no período. Hoje geramos o DAS pulando essa etapa → guia pode não bater / ser inválida. Scaffolding `transmitirDeclaracao` já existe em `serpro.ts` (morto). | M | proc. 00146 |
| **0.2** | **Smoke do parser de DAS Simples contra DAS real em aberto** | 🔧 | `serpro-das-simples-parse.ts` foi modelado por inferência (espelha o MEI). Valor/vencimento podem vir errados em produção. | S | empresa Simples com DAS em aberto |
| **0.3** | **Fator R: calcular e decidir anexo (III↔V)** | 🔧 | Sem Fator R, empresa de serviços pode cair no anexo errado → alíquota e valor do imposto errados. Coluna `apuracoes_fiscais.fator_r` existe e nunca é preenchida; só há a flag visual `fatorRAplicavel`. | M | folha/pró-labore na apuração |
| | ↳ **Fundação feita (2026-06-04):** modelo CNAE→anexo (`cnae_anexo` + `company_cnaes`), apuração resolve anexo pelo CNAE principal. Falta o **cálculo de Fator R** (folha÷RBT12, III↔V) e a **segregação por anexo**. Ver `docs/investigations/FATOR-R-CNAE-SEGREGACAO.md`. | ✨ | — | — |
| **0.4** | **`atividade_mei` → DAS-MEI com valor certo** | 🔧 | Falta coluna `empresas_fiscais.atividade_mei`; cálculo local sempre assume R$80,90 (serviços). Comércio/indústria/transporte saem errados. | S | migration nova |

## P1 — Essencial p/ fechar a V1

| # | Item | Tipo | Por quê | Esforço | Dep. |
|---|---|---|---|---|---|
| **1.1** | **Seção "Declarações" no dashboard `/impostos`** | ✨ | PRD §11.1 prevê histórico de declarações ao lado das guias. Hoje não existe (nem tabela `declaracoes_fiscais` no banco). | M | tabela `declaracoes_fiscais`; depende de 0.1 |
| **1.2** | **DASN-SIMEI anual (MEI)** | ✨ | V1 §7.1 promete entrega da declaração anual do MEI. Zero código hoje. Decidir: manual (botão) na v1, automação depois. | M | 1.1 |
| **1.3** | **Consulta de DAS/situação para MEI** | ✨ | `serpro-consulta.ts` só cobre Simples ("MEI virá depois", `actions.ts:234`). | S | — |
| **1.4** | **Versionar tabela Simples + salário mínimo por competência** | 🔧 | `TABELA_SIMPLES_2026` e SM R$1.518 hardcoded; quebra na virada do ano / Reforma (LC 214). | S | — |
| **1.5** | **Anualização do RBT12 p/ empresa nova (<12 meses)** | 🔧 | Falta `dataInicioAtividade` no schema → anualização nunca dispara (`apuracao.ts:111`); empresas recém-abertas calculam errado. | S | migration/campo |
| **1.6** | **DEFIS (Simples anual) — spec + fluxo** | ✨ | V1 §7.1 só dá o nome; sem endpoint/campos documentados. Primeiro definir escopo, depois implementar. | L | brainstorming/spec |

## P2 — Automação / UX da V1

| # | Item | Tipo | Por quê | Esforço | Dep. |
|---|---|---|---|---|---|
| **2.1** | **Cron mensal de apuração automática** | ✨ | V1 §4.1 / PLANO 3.3: dia 1º apura o mês anterior sem ação manual. Hoje só wizard manual. | M | apuração estável |
| **2.2** | **Marcar "vencida" automaticamente** | 🔧 | `HistoricoGuias.tsx:24` só mostra vencida visualmente; nada escreve no banco. | S | cron |
| **2.3** | **Alertas de vencimento por e-mail (7d / dia / +1d)** | ✨ | V1 §7.2. | M | cron |
| **2.4** | **QR Code / Pix Copia-e-Cola na guia** | ✨ | V1 §4.2/§5.3 preveem Pix; hoje só PDF + linha digitável + marcar paga. | S | dado vir da SERPRO |
| **2.5** | **Explicação em pt-BR da apuração** | ✨ | V1 §4.3: resumo conversacional por regime. Não existe. | S | — |
| **2.6** | **`TRIBUTO_CODIGOS`: conferir contra PRD §11.2** | 🔧 | `serpro.ts:171` marcado "conferir antes de produção". | S | — |

## P3 — Adiar (V2+ ou diferido)

| # | Item | Tipo | Por quê | Esforço | Dep. |
|---|---|---|---|---|---|
| **3.1** | Lucro Real / Presumido | ⏸️ | PRD §15 já chama de "escopo futuro do motor". | L | — |
| **3.2** | Avisos de imposto por WhatsApp | ⏸️ | V2 §4.1-4.4. | M | infra WhatsApp |
| **3.3** | Conciliação automática (Open Finance) | ⏸️ | V2 §4 (marcar pago automaticamente). | L | Open Finance |
| **3.4** | Bot WhatsApp ("qual meu imposto?") | ⏸️ | V2 §6. | L | 3.2 |
| **3.5** | Histórico de guias pagas + comprovantes | ⏸️ | V2 §4.5; `HistoricoGuias` já cobre o básico. | S | — |

## Limpeza / dívida técnica (oportunística)

| # | Item | Tipo | Por quê | Esforço |
|---|---|---|---|---|
| **L.1** | Remover catálogo legado n8n `app/src/lib/clients/_endpoints.ts` (código morto) | 🧹 | n8n descontinuado; ver `balu-n8n-em-transicao`. **Não** remover `transmitirDeclaracao` do `serpro.ts` (será usado em 0.1). | S |
| **L.2** | Anotar/alinhar `0001_init.sql` (define `apuracoes_fiscais` com `empresa_id` + RLS inexistente) | 🧹 | Migration defasada confunde; fonte real é `db_atual.sql`. | S |

---

## Sequência sugerida

1. **P0 inteiro** — é o que separa "gera DAS de teste" de "gera DAS confiável" (transmissão, smoke, Fator R, MEI). Bloqueia produção.
2. **P1.4 + P1.5** (versionamento + RBT12) junto do P0 — são correções pequenas de cálculo.
3. **P1.1 → P1.2 → P1.3** (declarações no dashboard, DASN-SIMEI, consulta MEI).
4. **P1.6 (DEFIS)** depois de um brainstorming de escopo próprio.
5. **P2** (automação) quando o cálculo manual estiver redondo.
6. **P3** fora da v1.

## Decisões que dependem de você

- **DEFIS e DASN-SIMEI entram na v1** ou são declaradas como diferidas? (Hoje estão prometidas na doc e ausentes no código, sem registro de adiamento.)
- **Transmissão PGDAS-D (0.1)**: confirmamos que é pré-requisito do DAS Simples na sua operação? (Define se é P0 mesmo.)
- **Fator R (0.3)**: de onde vem o dado de folha/pró-labore? (Sem isso não dá pra calcular.)
