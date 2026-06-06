# Spec — PGDAS-D transmissão · Fase 2 (transmit real + retificadora + alertas de prazo)

**Data:** 2026-06-06
**Backlog:** P0.1 (c) — fecha a transmissão real da PGDAS-D.
**Base técnica:** `docs/investigations/PGDAS-D-TRANSDECLARACAO11.md` (§ Prazo, multa e retificadora; payload).
**Continuação de:** `2026-06-05-pgdasd-transmissao-fase1-design.md` (builder + dry-run, ✅ feito).

## Escopo desta fase

**Fase 2 = transmitir de verdade à Receita** (`indicadorTransmissao=true`), atrás de confirmação
explícita, persistindo o resultado em `declaracoes_fiscais`. Reaproveita 100% do builder/cliente da
Fase 1 — a montagem do `dados` já está pronta e validada ao vivo. O que entra de novo:

1. **Transmit real** com gate de sign-off (a declaração é confissão de dívida).
2. **Retificadora** automática quando a competência já tem declaração.
3. **Alertas de prazo/multa** + painel de competências **pendentes / no prazo / vencidas**.

### Decisões fechadas (conversa 2026-06-06)
- **Prazo = dia 20 do mês subsequente** (mesmo do DAS). Declaração **antes** do DAS, sempre.
- **Multa 2026** (LC 214/2025 + CGSN 183/2025): conta no **dia seguinte ao vencimento**. Surfar isso.
- **Original vs. Retificadora derivado do `CONSDECLARACAO13`** (sem novo input do usuário): sem
  `numeroDeclaracao` na competência → `tipoDeclaracao=1`; com número → `tipoDeclaracao=2`.
- **Sign-off explícito** no ato de transmitir (caráter declaratório). Sem transmissão silenciosa.
- **`indicadorComparacao` segue `false` no MVP** (igual Fase 1; a SERPRO calcula). `valoresParaComparacao`
  por tributo fica como reforço futuro.

### Gate da doc SERPRO — ✅ RESOLVIDO (2026-06-06, modelo oficial do SDK Dart)
Fonte: `entregar_declaracao_request.dart` / `entregar_declaracao_response.dart` do SDK
`github.com/MarlonSantosDev/serpro_integra_contador_api`.
- [x] **Retificadora NÃO referencia a anterior.** Payload de entrada (`Declaracao`) só tem
      `tipoDeclaracao` — não há `numeroDeclaracaoAnterior`/`numeroRecibo`. Reenvia a declaração inteira
      com `tipoDeclaracao=2` p/ o mesmo `pa`; SERPRO infere por CNPJ+`pa` (última vale). → **builder só
      precisa parametrizar `tipoDeclaracao`** (sem campo de referência).
- [x] **Dry-run de retificadora funciona.** `indicadorTransmissao` (request) e `tipoDeclaracao`
      (declaração) são independentes → `previewDeclaracaoAction` cobre a conferência da retificadora.
      Resíduo barato: confirmar no 1º dry-run real (padrão da original).
- [x] **Resposta da transmissão (`DeclaracaoTransmitida`):** `idDeclaracao`, `dataHoraTransmissao`
      (`AAAAMMDDHHmmSS`), `valoresDevidos[]`, `declaracao` (PDF b64), `recibo` (PDF b64) — tudo p/ persistir.
- [x] **🔑 MAED vem na resposta:** `notificacaoMaed` (PDF, null se não houver) + `darf` (PDF da multa) +
      `detalhamentoDarfMaed`; helper `temMaed`. **A SERPRO calcula a multa por atraso** — nós só
      surfamos. Ver investigação (§ Resposta da transmissão).

## Camada pura

### `app/src/lib/fiscal/pgdasd-declaracao.ts` — `montarDeclaracaoPgdasd`
Adicionar parâmetro `tipoDeclaracao: 1 | 2` (default 1) e, se a SERPRO exigir,
`numeroDeclaracaoAnterior?: string`. Hoje crava `tipoDeclaracao: 1` (`pgdasd-declaracao.ts:68`).
Teste: monta com `tipoDeclaracao=2` (+ referência à anterior, se for o caso).

### `app/src/lib/fiscal/pgdasd-prazo.ts` (novo, puro/TDD)
```ts
export type SituacaoPrazo = 'no_prazo' | 'vence_hoje' | 'vencida';
// venc = dia 20 do mês seguinte à competência (YYYYMM). Recebe "hoje" injetado (testável).
export function vencimentoDeclaracao(competencia: string): string;          // YYYY-MM-DD (dia 20)
export function situacaoPrazo(competencia: string, hoje: string): { situacao: SituacaoPrazo; diasRestantes: number };
```
Regras: vencimento = `competência + 1 mês`, dia 20. `vencida` se `hoje > venc`; `vence_hoje` se igual;
senão `no_prazo` com `diasRestantes`. (Nesta fase: dia 20 fixo, sem ajuste de dia útil/feriado — anotar
como refinamento; a Receita prorroga p/ próximo dia útil quando 20 cai em fim de semana/feriado.)

## Camada SERPRO (impura)

### `app/src/lib/fiscal/serpro-pgdasd.ts` — `transmitirPgdasd`
Já existe e recebe `{ indicadorTransmissao }`. Estender para:
- Antes de montar: consultar `CONSDECLARACAO13` da competência → existe `numeroDeclaracao`?
  define `tipoDeclaracao` (1/2) e (se necessário) `numeroDeclaracaoAnterior`.
- No transmit real (`indicadorTransmissao=true`): após `/Declarar`, o parse devolve `numeroDeclaracao`
  + recibo + total devido.

### `app/src/lib/fiscal/serpro-pgdasd-parse.ts` — `parseDeclaracaoPgdasd`
Já extrai `numeroDeclaracao` (`idDeclaracao`) e `transmitida`. Estender o tipo p/ o envelope real de
transmissão (`DeclaracaoTransmitida`):
```ts
export type DeclaracaoPgdasdResult = {
  transmitida: boolean;
  numeroDeclaracao: string | null;
  dataHoraTransmissao: string | null;   // ISO (parse de AAAAMMDDHHmmSS)
  valorTotalDevido: number | null;
  tributos: Array<{ codigo: number; nome: string; valor: number }>;
  reciboPdfBase64?: string | null;      // PDF do recibo
  declaracaoPdfBase64?: string | null;  // PDF da declaração
  maed?: { notificacaoPdfBase64: string; darfPdfBase64: string; detalhamento?: unknown } | null; // null se sem atraso
  mensagens?: string[];
};
```
Tolerante a formato inesperado (lança + loga). No dry-run, os PDFs/`maed` vêm ausentes.

## Persistência

### `declaracoes_fiscais` (tabela já existe — migration 0025)
Gravar no transmit real: `company_id`, `competencia`, `tipo` (PGDAS-D), `numero_declaracao`,
`tipo_declaracao` (1/2), `valor_total`, `transmitida_em` (de `dataHoraTransmissao`), vínculo à anterior
em retificadora (`retifica_numero` / `retifica_id` — conferir colunas existentes; se faltar, **migration
aditiva 0026**) e flag/valor de **MAED** quando `temMaed` (multa por atraso). Reconferir o shape real da
0025 antes (ver `balu-declaracoes-impostos` / `DB-DIVERGENCIA.md`).
PDFs (recibo/declaração/DARF MAED) são base64 grandes — **decidir**: guardar no Storage (bucket por
empresa, padrão do certificado) e referenciar, **não** inline na tabela.

## Action + UI

### `app/src/app/(auth)/impostos/actions.ts` — `transmitirDeclaracaoAction`
```ts
export async function transmitirDeclaracaoAction(competencia: string, opts: { confirmado: true }):
  Promise<{ ok: true; result: DeclaracaoPgdasdResult } | { ok: false; error: string }>;
```
- Valida sessão + empresa ativa + regime Simples (MEI fora).
- Exige `opts.confirmado` (sign-off do contador). Sem isso → erro/no-op.
- Chama `transmitirPgdasd(..., { indicadorTransmissao: true })`, persiste em `declaracoes_fiscais`,
  `revalidatePath('/impostos')`.

### UI — botão "Transmitir declaração" (gated)
Na seção "Declarações" / "Competência atual" do `/impostos`, só p/ Simples:
- Mostra **situação de prazo** da competência: badge `No prazo (faltam N dias)` / `Vence hoje` /
  **`Vencida — multa em curso`** (vermelho).
- Se já há declaração na competência: rótulo **"Retificar"** + aviso *"vai substituir a declaração de
  DD/MM"*; senão **"Transmitir"**.
- Fluxo: **dry-run primeiro** (reaproveita `previewDeclaracaoAction`) → mostra valores → **modal de
  confirmação** com os números + texto de confissão de dívida → só então `transmitirDeclaracaoAction`.
- Pós-sucesso: mostra `numeroDeclaracao` + recibo; libera o "Gerar DAS" (a ordem declaração→DAS fica
  garantida).
- **Se veio MAED** (transmissão atrasada): banner *"Multa por atraso na entrega (MAED) — R$X"* + link
  p/ o **DARF da multa** (a SERPRO já calculou; nós só surfamos). A badge "vencida" da competência
  passa a refletir a multa real, não só o aviso.

### Painel "Declarações" — pendentes / no prazo / vencidas
Listar competências com receita (apuração) e cruzar com `CONSDECLARACAO13`:
- **Pendente + vencida** (sem declaração e `hoje > 20`) → alerta vermelho no topo do `/impostos`.
- **Pendente no prazo** → aviso com dias restantes.
- **Transmitida** → número + data + valor.

## Fora de escopo (refinamento futuro)
- Ajuste de vencimento p/ dia útil (feriado/fim de semana).
- `indicadorComparacao=true` + `valoresParaComparacao` (repartição por tributo).
- Alertas proativos de prazo por e-mail (é o P2.3 do backlog).
- Override `id_atividade_pgdas` por CNAE; múltiplas filiais via fonte própria (hoje retry pelo erro).

## Testes (TDD)
- `vencimentoDeclaracao` / `situacaoPrazo`: viradas de mês/ano, `no_prazo`/`vence_hoje`/`vencida`,
  `diasRestantes` (hoje injetado).
- `montarDeclaracaoPgdasd` com `tipoDeclaracao=2` (+ referência à anterior, se exigida).
- `parseDeclaracaoPgdasd` contra envelope de transmissão real (número/recibo/dataHora); caso **com MAED**
  (notificacaoMaed+darf presentes → `maed` preenchido) e **sem MAED** (campos null → `maed: null`).
- Validação ao vivo (manual, com sign-off): **AL Piscinas 202605** — transmitir Original de verdade,
  conferir `numeroDeclaracao` no `CONSDECLARACAO13`, depois gerar o DAS. Em seguida, exercitar uma
  **retificadora** (`tipoDeclaracao=2`) e confirmar substituição.

## Arquivos
- **Create** `app/src/lib/fiscal/pgdasd-prazo.ts` + teste
- **Modify** `app/src/lib/fiscal/pgdasd-declaracao.ts` (`tipoDeclaracao` parametrizado) + teste
- **Modify** `app/src/lib/fiscal/serpro-pgdasd.ts` (detecção Original/Retificadora via `CONSDECLARACAO13`)
- **Modify** `app/src/lib/fiscal/serpro-pgdasd-parse.ts` (recibo da transmissão) + teste
- **Modify** `app/src/app/(auth)/impostos/actions.ts` (`transmitirDeclaracaoAction`)
- **Create** UI: botão/modal de transmissão gated + badges de prazo na seção "Declarações"
- **Maybe** migration aditiva `0026` (colunas de retificação em `declaracoes_fiscais`, se faltarem)
