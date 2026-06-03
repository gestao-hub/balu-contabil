# Spec — Consulta de listagem de DAS (Simples) na página de impostos

> **Data:** 2026-06-03 · **Branch:** `feat/consulta-das-simples`
> **Depende de:** fluxo procurador (`garantirTokenProcurador`) já mergeado — spec `2026-06-03-serpro-procurador-contratante-design.md`.
> **Fonte da verdade SERPRO:** `docs/investigations/SERPRO-INVESTIGACAO.md` (rodada 6 = prova prod).

## Problema / objetivo

A página `/impostos` lista hoje só o que está em `guias_fiscais` (geradas localmente). Queremos uma
**consulta read-only à SERPRO** que busca a **listagem de declarações/DAS do ano-calendário atual**
de uma empresa do **Simples (PGDAS-D)** e a apresenta na página. É o **primeiro consumidor real** do
`token_procurador` num caminho que não é o upload de certificado.

Escopo decidido (brainstorming):
- **Regime:** Simples (PGDAS-D / `CONSDECLARACAO13`) — caminho provado em produção (AL PISCINAS).
- **Resultado:** consulta ao vivo **+ upsert** em `guias_fiscais` (reusa a UI `HistoricoGuias`).
- **Período:** ano-calendário atual (fixo).
- **Disparo:** **botão explícito** "Consultar na SERPRO" (não auto-load — evita chamada/custo/latência a cada visita).

## Descoberta-chave (resposta real do CONSDECLARACAO13)

Capturada ao vivo (read-only) via `scripts/test-serpro-procurador-al-piscinas.mjs`. O envelope SERPRO
é `{contratante, autorPedidoDados, contribuinte, pedidoDados, status, responseId, responseDateTime, dados}`
onde `dados` é uma **string JSON**:

```json
{
  "anoCalendario": 2025,
  "periodos": [
    {
      "periodoApuracao": 202501,
      "operacoes": [
        { "tipoOperacao": "Original", "indiceDeclaracao": { "numeroDeclaracao": "10358425202501001", "dataHoraTransmissao": "20250214101623", "malha": "" }, "indiceDas": null },
        { "tipoOperacao": "Geração de DAS", "indiceDeclaracao": null, "indiceDas": { "numeroDas": "07202504580937145", "datahoraEmissaoDas": "20250214101627", "dasPago": true } }
      ]
    }
    // ... um objeto por mês ...
  ]
}
```

**O `CONSDECLARACAO13` é um índice de SITUAÇÃO** — por período traz: declaração transmitida
(`numeroDeclaracao` + `dataHoraTransmissao`), DAS gerado (`numeroDas` + `datahoraEmissaoDas`) e
**`dasPago` (bool)**. **NÃO traz valor (R$), vencimento, nem código de barras/PDF** — esses vêm de
outro serviço (emissão `GERARDAS12` / obter declaração), fora deste escopo.

## Arquitetura

### Fluxo (action `consultarDeclaracoesAction`)

```
botão "Consultar na SERPRO"  (Simples)
  → consultarDeclaracoesAction(ano?)
      1. auth + companyId; gate regime Simples (Code ∈ {1,2,3})
      2. garantirAuthContratante()      → { accessToken, jwt, pfx, passphrase, cnpj (contratante) }
      3. garantirTokenProcurador(supabase, companyId)  → token_procurador (idempotente; lê cert da empresa do Storage)
      4. envelope PGDASD/CONSDECLARACAO13 (contratante=contratante, autor=contribuinte=empresa, dados={anoCalendario})
      5. serpro.consultarComProcurador({ pfx, passphrase, accessToken, jwt, procuradorToken, envelope }) → resp
      6. parseConsultaDeclaracoes(resp) → SituacaoPeriodo[]
      7. upsert em guias_fiscais (campos de situação; preserva valor existente)
      8. revalidatePath('/impostos')
```

### Componentes

| Arquivo | Tipo | Papel |
|---|---|---|
| `lib/fiscal/serpro-consulta-parse.ts` | puro (novo) | `parseConsultaDeclaracoes(resp): SituacaoPeriodo[]` — desempacota o envelope + `dados` (string JSON), normaliza por período. |
| `lib/clients/serpro.ts` | server-only (+1 método) | `consultarComProcurador({ pfx, passphrase, accessToken, jwt, procuradorToken, envelope })` → `https.request` mTLS POST `/integra-contador/v1/Consultar` com headers `Authorization: Bearer`, `jwt_token`, **`autenticar_procurador_token`**. Devolve o JSON do envelope. Lança em status ≥ 400. |
| `lib/fiscal/serpro-consulta.ts` | server-only (novo) | `consultarDeclaracoesSimples(supabase, companyId, ano): Promise<{ ok:true; situacoes } | { ok:false; error }>` — orquestra passos 2-6 (auth contratante + token procurador + envelope + consult + parse). Não persiste (a action faz o upsert). |
| `app/(auth)/impostos/actions.ts` | server action (+1) | `consultarDeclaracoesAction(ano?: number)` — gate regime + chama o orquestrador + upsert em `guias_fiscais` + revalidate. |
| `app/(auth)/impostos/ConsultarSerproButton.tsx` | client island (novo) | botão "Consultar na SERPRO" (`useTransition` + toast); só renderizado p/ Simples. |
| `app/(auth)/impostos/page.tsx` | modificar | renderiza o botão na seção "Histórico de guias" quando `isSimples`; passa `ano` atual. |

### Tipos

```ts
// serpro-consulta-parse.ts
export type SituacaoPeriodo = {
  competencia: string;          // 'YYYYMM' (= String(periodoApuracao))
  numeroDeclaracao: string | null;
  dataTransmissao: string | null;  // ISO (parse de 'YYYYMMDDHHmmss'); null se ausente
  numeroDas: string | null;
  dasPago: boolean | null;       // null quando não há DAS gerado
  status: 'paga' | 'gerada' | 'pendente';
};
```

**Mapeamento de status:** `dasPago === true` → `'paga'`; há `numeroDas` mas não pago → `'gerada'`;
só declaração (sem DAS) → `'pendente'`. Período sem declaração nem DAS → ignorado.

**Múltiplas operações por período:** percorrer `operacoes[]`, pegar a ÚLTIMA `indiceDeclaracao`
não-nula (numeroDeclaracao/dataTransmissao) e a ÚLTIMA `indiceDas` não-nula (numeroDas/dasPago).

### Persistência (`guias_fiscais` — sem schema novo)

Por `SituacaoPeriodo`, upsert com `onConflict: 'company_id,competencia_referencia'`:
```ts
{
  company_id, owner_user_id,
  competencia_referencia: s.competencia,           // 'YYYYMM'
  competencia_mes: Number(s.competencia.slice(4,6)),
  competencia_ano: Number(s.competencia.slice(0,4)),
  numero_das: s.numeroDas,                          // pode ser null
  status: s.status,
  origem: 'serpro',
  updated_at: <now>,
  deleted_at: null,
}
```
**Não inclui `valor_*`/`data_vencimento`/`codigo_barras`** — no upsert do PostgREST as colunas ausentes
do payload **não entram no SET** → numa guia já existente (ex.: emitida com valor) esses campos são
**preservados**; em insert novo ficam no default (`valor_* = 0`, datas null). `HistoricoGuias` já
renderiza `valor`/`vencimento` ausentes como "—".

### UI

`ConsultarSerproButton` na seção "Histórico de guias" (só Simples). `HistoricoGuias` reusado sem
mudança: `numero` ← `numero_das`, badge de `status` (`statusGuiaBadge` já cobre paga/gerada/pendente),
`valor`/`vencimento` = "—". Após a action, `revalidatePath` recarrega o server component.

### Gate de regime + erros

- Gate: `tipoFromCode(code) === 'simples'` (helper existente em `lib/fiscal/regime.ts`: codes 1-3 → simples, 4 → mei); MEI (`'4'`) → `{ ok:false, error:'A consulta de listagem cobre Simples (PGDAS-D); MEI virá depois.' }`.
- Erros amigáveis propagados pela action:
  - cert da empresa ausente no Storage → "Envie o certificado A1 da empresa antes de consultar." (vem do `garantirTokenProcurador`).
  - token procurador falhou / `ICGERENCIADOR-022` → "A empresa ainda não autorizou a Balu (Termo/procuração) na SERPRO."
  - status ≥ 400 no `/Consultar` → mensagem com o trecho do corpo (sem segredos).

### Pré-condições operacionais (não-código)

- Empresa precisa ter **certificado A1 enviado** (Storage) — `garantirTokenProcurador` assina o Termo com ele.
- Contratante provisionado (já feito: seed PIPER).

## Tratamento de erros

A action nunca lança pro cliente: sempre `{ ok:true } | { ok:false; error }`. Falha de rede/timeout
no `/Consultar` tem timeout (25s) e mensagem sem vazar segredos. Falha de upsert → `{ ok:false }`.

## Testes (Vitest unit)

- `serpro-consulta-parse.test.ts` — usa a **resposta real capturada** (fixture inline com ≥3 meses):
  - 12 períodos → 12 `SituacaoPeriodo` (ou N conforme fixture); `competencia` = 'YYYYMM'.
  - `dasPago:true` → `status:'paga'`; mês só com declaração → `'pendente'`; mês com DAS não pago → `'gerada'`.
  - `dataTransmissao` parseada de `'YYYYMMDDHHmmss'` → ISO; `numeroDas`/`numeroDeclaracao` corretos.
  - envelope sem `dados`/`dados` inválido → `[]` (defensivo, não lança).
- Gate de regime: action recusa MEI (via `tipoFromCode` do `regime.ts`, já testado).

Sem teste de rede (a chamada real fica nos scripts de spike).

## Sequência de implementação sugerida

1. `serpro-consulta-parse.ts` + teste (TDD, fixture real).
2. `serpro.ts`: `consultarComProcurador`.
3. `serpro-consulta.ts`: `consultarDeclaracoesSimples` (orquestra auth+token+consult+parse).
4. `impostos/actions.ts`: `consultarDeclaracoesAction` (gate + upsert + revalidate).
5. `ConsultarSerproButton.tsx` + fiação no `page.tsx` (só Simples).
6. `tsc --noEmit` + `vitest run` + smoke manual (com AL PISCINAS, cert enviado).

## Fora de escopo (YAGNI)

- Valores/vencimento/PDF das DAS (vêm na feature de emissão / obter declaração).
- MEI (PGMEI).
- Seleção de ano (fixo: ano-calendário atual).
- Reescrita do `gerarDasMeiAction` e drop das colunas órfãs `certificado_*` (feature de emissão).
