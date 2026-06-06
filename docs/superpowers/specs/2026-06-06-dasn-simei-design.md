# Spec — DASN-SIMEI (declaração anual do MEI) · transmitir + consultar

**Data:** 2026-06-06
**Backlog:** P1.2 — DASN-SIMEI anual (MEI).
**Base técnica:** `docs/investigations/DASN-SIMEI.md` (3 serviços, payload, erros, diferenças vs PGDAS-D).
**Padrão de referência:** fluxo SERPRO procurador da PGDAS-D ([Fase 2](2026-06-06-pgdasd-transmissao-fase1-design.md)
+ `serpro-pgdasd.ts` / `serpro-consulta.ts`).

## ⚠️ Status / bloqueio externo (2026-06-06)
A doc oficial marca **`TRANSDECLARACAO151` (entregar) como "AINDA NÃO DISPONÍVEL PARA CONTRATAÇÃO E PODE
SOFRER ALTERAÇÕES"** — e o serviço dá 101507 no Trial. Ou seja: **não dá pra transmitir a DASN-SIMEI hoje**
(nem em produção), e o **payload pode mudar**. Consequência para esta spec:
- **Camada pura (builder/receita/parser) — FEITA** (commit `a0531f1`): investimento baixo, isolado; se o
  payload mudar quando a SERPRO liberar, o ajuste é pontual.
- **Camada impura + persistência + UI de transmissão — NÃO começar** até a SERPRO liberar o serviço
  (evita construir contra um contrato instável). `CONSULTIMADECREC152` (consulta) não tem o aviso → a
  parte de **consulta/histórico** pode ir antes, se quisermos.

## Escopo

**MVP (quando liberar) = transmitir a declaração anual (`TRANSDECLARACAO151`) + consultar (`CONSULTIMADECREC152`)**, com
gate de confirmação e persistência em `declaracoes_fiscais`. **DAS de excesso (`GERARDASEXCESSO153`)
fica fora** (a SERPRO marca "ainda não disponível para contratação") — só detectamos/avisamos o excesso.

### Decisões fechadas (investigação 2026-06-06)
- **Sem dry-run.** O `TRANSDECLARACAO151` não tem `indicadorTransmissao` → a transmissão é sempre real.
  O gate de confirmação se apoia nos **nossos** valores calculados (não há preview da SERPRO como na PGDAS-D).
- **Original vs. Retificadora** detectado via `CONSULTIMADECREC152` (ano já declarado?) — mesmo padrão da
  PGDAS-D; o payload de entrada não referencia a anterior (a confirmar no 1º caso real).
- **MAED** vem na resposta (`multaAtrasoEntrega`) quando entregue após 31/05 — a SERPRO calcula; nós surfamos.
- **DAS de excesso** adiado (serviço não contratável); apenas alertar quando `excessoReceitaBruta` vier
  preenchido ou no aviso `Aviso-DASNSIMEI-10008` (desenquadramento).

### A confirmar (gate, antes de transmitir de verdade)
- [ ] Endpoint do `Declarar`/`Emitir` p/ DASNSIMEI (a PGDAS-D usa `/Declarar`; confirmar a rota do entregar).
- [ ] Retificadora referencia a anterior ou infere por cnpj+ano? (payload de entrada não mostra campo).
- [ ] Fonte de `indicadorEmpregado` (ver Insumos).

## Camada pura

### `app/src/lib/fiscal/dasn-simei.ts` (novo, TDD)
```ts
export type DasnSimeiInput = {
  cnpj: string;                  // 14 dígitos
  anoCalendario: number;         // ex.: 2025
  valorReceitaComercio: number;  // comércio + indústria + transporte de cargas
  valorReceitaServico: number;   // serviços + locação
  indicadorEmpregado: boolean;
};
export function montarDasnSimei(input: DasnSimeiInput): Record<string, unknown>; // o `dados` (JSON.stringify pelo caller)
```
Monta `{ cnpjCompleto, anoCalendario: String, declaracao: { valorReceitaComercio, valorReceitaServico,
indicadorEmpregado } }`. Puro/testável. (Sem `tipoDeclaracao` no payload — a SERPRO resolve.)

### `app/src/lib/fiscal/dasn-simei-receita.ts` (novo, TDD)
```ts
// Classifica e soma as notas do ano em comércio × serviço (por TIPO de nota: NFS-e=serviço, NF-e/NFC-e=comércio).
export function somarReceitaAnualMei(notas: Array<{ tipo: string; valor: number }>):
  { comercio: number; servico: number };
```
Puro. Reaproveita o shape de `lerReceitasParaApuracao` (agregando o ano todo).

## Camada SERPRO (impura)

### `app/src/lib/fiscal/serpro-dasn-simei.ts` — `transmitirDasnSimei` (espelha `transmitirPgdasd`)
- Lê CNPJ da empresa, `garantirAuthContratante` + `garantirTokenProcurador`.
- Agrega receita do ano (`somarReceitaAnualMei`) + `indicadorEmpregado`.
- `montarDasnSimei` → envelope (`idSistema:'DASNSIMEI'`, `idServico:'TRANSDECLARACAO151'`, v1.0,
  `dados: JSON.stringify(...)`) → `declararComProcurador` (confirmar rota).
```ts
export async function transmitirDasnSimei(supabase, companyId, anoCalendario):
  Promise<{ ok: true; result: DasnSimeiResult } | { ok: false; error: string }>;
```

### `app/src/lib/fiscal/serpro-dasn-simei-parse.ts` — `parseDasnSimei` (TDD)
```ts
export type DasnSimeiResult = {
  numeroDeclaracao: string | null;       // idDeclaracao
  dataTransmissao: string | null;        // ISO
  tipoDeclaracao: number | null;         // codigoTipoDeclaracao (1/2)
  nomeEmpresarial?: string | null;
  reciboPdfBase64?: string | null;
  excessoReceitaBruta?: { valor: number | null; pdfBase64?: string | null } | null;
  maed?: { notificacaoPdfBase64: string; darfPdfBase64: string } | null; // null se no prazo
  desenquadramento?: boolean;            // Aviso-DASNSIMEI-10008
  mensagens?: string[];                  // Aviso-/Erro-DASNSIMEI-*
};
```
Tolerante a formato inesperado (lança + loga; padrão `serpro-das-simples-parse.ts`).

### Consulta — estender `serpro-consulta.ts` (fecha P1.3 do MEI também)
`consultarDasnSimei(supabase, companyId, ano)` espelhando `consultarDeclaracoesSimples`, com
`idSistema:'DASNSIMEI'`, `idServico:'CONSULTIMADECREC152'` via `consultarComProcurador`. Usado p/
detectar Original×Retificadora e listar o histórico anual.

## Persistência — `declaracoes_fiscais`
Gravar no transmit: `company_id`, `tipo` = `DASN-SIMEI`, `competencia`/`ano_calendario` (ano), `numero_declaracao`,
`tipo_declaracao` (1/2), `valor_total` (ou receitas), `transmitida_em`. PDFs (recibo/DARF MAED) → **Storage**
(bucket por empresa, padrão do certificado), não inline. Conferir shape real da 0025 (`balu-declaracoes-impostos`
/ `DB-DIVERGENCIA.md`); migration aditiva se faltar coluna de ano/tipo MEI.

## Action + UI

### `app/src/app/(auth)/impostos/actions.ts`
```ts
export async function transmitirDasnSimeiAction(anoCalendario: number, opts: { confirmado: true }):
  Promise<{ ok: true; result: DasnSimeiResult } | { ok: false; error: string }>;
```
- Valida sessão + empresa ativa + **regime MEI** (Simples fora).
- Exige `opts.confirmado` (sem dry-run → o sign-off é a única barreira). Sem isso → erro.
- Calcula receitas + flag, transmite, persiste, `revalidatePath('/impostos')`.
- (P1.3) `consultarDasnSimeiAction` opcional p/ histórico.

### UI — seção "Declaração anual (DASN-SIMEI)" no `/impostos`, só p/ MEI
- Mostra **prazo 31/05** do ano seguinte: badge `No prazo` / `Vencida — multa (MAED) no envio`.
- Pré-cálculo: nossos `valorReceitaComercio`/`valorReceitaServico` (somados das notas) + flag empregado,
  **editáveis** antes de confirmar (não há preview da SERPRO).
- Se já declarado (consulta): rótulo **"Retificar"** + aviso; senão **"Transmitir"**.
- Modal de confirmação (valores + texto declaratório) → `transmitirDasnSimeiAction`.
- Pós-sucesso: `numeroDeclaracao` + recibo (download). Se veio **MAED**: banner da multa + DARF. Se veio
  **excesso/desenquadramento** (`10008`): alerta forte ("receita acima do teto MEI — desenquadramento").

## Fora de escopo (futuro)
- `GERARDASEXCESSO153` (DAS de excesso) — quando a SERPRO liberar p/ contratação.
- Cálculo/condução do **desenquadramento** (só alertamos).
- Automação por cron (entregar em lote em maio) — é o P2.x.

## Testes (TDD)
- `montarDasnSimei`: estrutura correta (anoCalendario string, declaração com os 3 campos).
- `somarReceitaAnualMei`: classifica NFS-e→serviço, NF-e/NFC-e→comércio; soma o ano; zera lados vazios.
- `parseDasnSimei`: extrai número/data/tipo/recibo; caso **com MAED** e **sem**; caso **com excesso**;
  caso aviso `10008` → `desenquadramento=true`; lança em formato inesperado.
- ⚠️ **DASN-SIMEI NÃO está no Trial** (testado 2026-06-06: `101507 Error in Sender` nos 3 serviços, vs
  PGMEI 200). Logo o `parseDasnSimei` é **modelado pela doc** (não há resposta real p/ fixture agora) e o
  **smoke estrutural fica adiado p/ e-CNPJ MEI real**. Builder/receita/parser puros seguem 100% testáveis
  por unit test (fixture modelada pela doc, marcada como tal). Ver [[balu-serpro-subscription-gap]].
- Validação ao vivo final (com sign-off, dados reais): precisa de **e-CNPJ MEI real**.

## Arquivos
- **Create** `app/src/lib/fiscal/dasn-simei.ts` + teste
- **Create** `app/src/lib/fiscal/dasn-simei-receita.ts` + teste
- **Create** `app/src/lib/fiscal/serpro-dasn-simei.ts`
- **Create** `app/src/lib/fiscal/serpro-dasn-simei-parse.ts` + teste
- **Modify** `app/src/lib/fiscal/serpro-consulta.ts` (`consultarDasnSimei`)
- **Modify** `app/src/lib/clients/serpro.ts` (constantes DASNSIMEI; confirmar rota do entregar)
- **Modify** `app/src/app/(auth)/impostos/actions.ts` (`transmitirDasnSimeiAction`)
- **Create** UI: seção DASN-SIMEI (badge de prazo, form editável, modal, MAED/excesso) p/ MEI
- **Maybe** migration aditiva (ano_calendario / tipo MEI em `declaracoes_fiscais`)
