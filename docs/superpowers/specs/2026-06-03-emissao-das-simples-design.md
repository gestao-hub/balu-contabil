# Spec — Emissão de DAS (Simples) para meses em aberto

> **Data:** 2026-06-03 · **Branch:** `feat/emissao-das-simples`
> **Depende de:** fluxo procurador (`garantirTokenProcurador`) + consulta de listagem (`consultarComProcurador`, `serpro-consulta`) — ambos já mergeados.
> **Fonte da verdade SERPRO:** `docs/investigations/SERPRO-INVESTIGACAO.md`.

## Problema / objetivo

A listagem de DAS (Simples) hoje mostra só a **situação** por mês (declarado/gerado/pago), sem valores —
porque o `CONSDECLARACAO13` é um índice e os serviços de consulta de declaração devolvem só PDF
(descoberta documentada via probes ao vivo). O **único valor estruturado** que a Serpro entrega é o
**DAS a pagar de um período em aberto**, via **`GERARDAS12`** (ação `/Emitir`).

Objetivo: permitir **gerar o DAS** de um mês **não pago** direto da página de impostos, trazendo
valor + vencimento + código de barras + PDF, persistindo em `guias_fiscais` e exibindo o boleto.

### Achados dos probes (produção, AL PISCINAS)
- `GERARDAS12` período **pago** (202501) → HTTP 200, `dados: ""`, `mensagens:[{codigo:"[Aviso-PGDASD-MSG_E0139]", texto:"Não foi gerado DAS por não haver valor devido para o período informado."}]`. **Prova: gerar DAS de mês pago não tem efeito de pagamento** — a dívida vem da declaração, o DAS é só o boleto.
- Estrutura "com valor" do `GERARDAS12` **não foi capturada** (a empresa de teste está toda paga). O parser será **modelado no `parseDasMei`** (mesma família PGMEI/GERARDASPDF21) e **confirmado contra o primeiro DAS real em aberto** no smoke.

## Decisões (brainstorming)
- **Regime:** Simples (PGDAS-D / `GERARDAS12`). MEI fica no `gerarDasMeiAction` antigo (migração separada).
- **Gatilho:** botão "Gerar DAS" em **qualquer mês não pago** (`status != 'paga'`) — na listagem (`HistoricoGuias`) e no card da competência atual.
- **PDF:** inline `data:application/pdf;base64,...` em `url_pdf` (reusa o padrão do `gerarDasMeiAction`).
- **"Nada devido":** não é erro — toast informativo, sem persistir valor.

## Arquitetura

### Fluxo (`gerarDasSimplesAction(competencia)`)
```
botão "Gerar DAS" (linha não-paga, Simples)
  → gerarDasSimplesAction(competencia: 'YYYYMM')
      1. auth + companyId; gate Simples (tipoFromCode)
      2. garantirAuthContratante() + garantirTokenProcurador(supabase, companyId)
      3. envelope PGDASD/GERARDAS12 (contratante=contratante, autor=contribuinte=empresa, dados={periodoApuracao})
      4. emitirComProcurador({pfx, passphrase, accessToken, jwt, procuradorToken, envelope}) → resp
      5. parseDasSimples(resp):
           - "nada devido" (dados vazio / msg MSG_E0139) → { semValor: true }
           - com valor → { numeroDas, dataVencimento, valores{principal,multa,juros,total}, codigoDeBarras[], pdfBase64 }
      6. semValor → { ok:true, semValor:true } (não persiste); senão upsert em guias_fiscais
      7. revalidatePath('/impostos')
```

### Componentes

| Arquivo | Tipo | Papel |
|---|---|---|
| `lib/clients/serpro.ts` | server-only (refactor) | Extrair helper privado `requestComProcurador(path, params)` (o mTLS + headers Bearer/jwt/`autenticar_procurador_token` + parse, hoje duplicado em `consultarComProcurador`). `consultarComProcurador` passa a chamá-lo com `/Consultar`; **novo `emitirComProcurador`** chama com `/Emitir`. DRY, sem alterar o comportamento do consultar. |
| `lib/fiscal/serpro-das-simples-parse.ts` | puro (novo) | `parseDasSimples(resp): DasSimplesResult` — detecta "nada devido" senão extrai valores. Modelado no `parseDasMei`. + teste. |
| `lib/fiscal/serpro-das-simples.ts` | server-only (novo) | `gerarDasSimples(supabase, companyId, competencia)` — auth+token+emitir+parse. |
| `app/(auth)/impostos/actions.ts` | server action (+1) | `gerarDasSimplesAction(competencia)` — gate + orquestra + upsert. |
| `app/(auth)/impostos/GerarDasSimplesButton.tsx` | client island (novo) | botão por mês; `useTransition`+toast; trata `semValor` (toast info) vs `ok` (sucesso) vs erro. |
| `app/(auth)/impostos/HistoricoGuias.tsx` | client (modificar) | renderiza `GerarDasSimplesButton` por linha quando `isSimples && status != 'paga'` (novo prop `isSimples`). |
| `app/(auth)/impostos/CompetenciaAtualCard.tsx` | client (modificar) | renderiza o botão (Simples) quando a guia da competência não está paga. |
| `app/(auth)/impostos/page.tsx` | server (modificar) | passa `isSimples` para `HistoricoGuias` e `CompetenciaAtualCard`. |

### Tipos
```ts
// serpro-das-simples-parse.ts
export type DasSimplesResult =
  | { semValor: true }
  | {
      semValor: false;
      numeroDas: string | null;
      dataVencimento: string | null;          // ISO 'YYYY-MM-DD' (de AAAAMMDD)
      valores: { principal: number; multa: number; juros: number; total: number };
      codigoDeBarras: string[];
      pdfBase64: string | null;
    };
```
**Detecção "nada devido":** `dados` ausente/vazio (`""`/null) OU `mensagens[].codigo` contém `MSG_E0139` → `{ semValor: true }`.

### Refactor do serpro.ts (DRY do mTLS com procurador)
```ts
async function requestComProcurador(
  path: '/integra-contador/v1/Consultar' | '/integra-contador/v1/Emitir',
  params: { pfx: Buffer; passphrase: string; accessToken: string; jwt: string; procuradorToken: string; envelope: Envelope },
): Promise<unknown> { /* https.request mTLS + Bearer/jwt/autenticar_procurador_token, 25s, throw>=400, JSON.parse */ }

export const consultarComProcurador = (p) => requestComProcurador('/integra-contador/v1/Consultar', p);
export const emitirComProcurador   = (p) => requestComProcurador('/integra-contador/v1/Emitir', p);
```
Mantém a assinatura pública de `consultarComProcurador` (já usada por `serpro-consulta.ts`) — só muda o interno.

### Persistência (`guias_fiscais`)
Upsert `onConflict 'company_id,competencia_referencia'` (igual ao `gerarDasMeiAction`):
```ts
{
  company_id, owner_user_id,
  competencia_referencia: competencia, competencia_mes, competencia_ano,
  numero_das, valor_principal, valor_multa, valor_juros, valor_total,
  data_vencimento, linha_digitavel: codigoDeBarras.join(' '), codigo_barras: codigoDeBarras.join(''),
  url_pdf: pdfBase64 ? `data:application/pdf;base64,${pdfBase64}` : null,
  status: 'gerada', origem: 'serpro', updated_at, deleted_at: null,
}
```
(Diferente da consulta: aqui **incluímos** os valores, pois o GERARDAS12 os fornece.)

### UI
- `GerarDasSimplesButton({ competencia })`: chama `gerarDasSimplesAction(competencia)`; `ok && semValor` → toast info "Sem débito em aberto para {mês}"; `ok` → toast "DAS gerado." + `router.refresh()`; erro → toast erro.
- `HistoricoGuias`: recebe `isSimples`; por linha com `status != 'paga'`, renderiza o botão (ao lado do `GuiaActions`). Linhas pagas não mostram.
- `CompetenciaAtualCard`: recebe `isSimples`; quando a guia atual não está paga (ou não existe), mostra o botão Simples (análogo ao `GerarDasButton` do MEI já existente).
- `page.tsx`: passa `isSimples` (já calculado na feature anterior) aos dois componentes.

## Tratamento de erros
- "nada devido" → `{ ok:true, semValor:true }` (toast info, sem persistir).
- cert da empresa ausente / procuração (`ICGERENCIADOR-022`) / falha `/Emitir` → mensagens amigáveis propagadas.
- Action nunca lança pro cliente: `{ ok:true; semValor } | { ok:false; error }`.

## Testes (Vitest unit)
- `serpro-das-simples-parse.test.ts`:
  - "nada devido" — usa a **resposta real capturada** (dados `""` + `MSG_E0139`) → `{semValor:true}`.
  - com valor — fixture modelada no `parseDasMei` (detalhamento[].valores + dataVencimento AAAAMMDD + codigoDeBarras + pdf) → valores corretos, `dataVencimento` ISO, `semValor:false`.
  - defensivo: `dados` inválido / ausente → tratado (sem lançar; provavelmente `semValor:true`).
- Gate de regime: action recusa MEI (via `tipoFromCode`).
- (Sem teste de rede; estrutura "com valor" confirmada no smoke.)

## Sequência de implementação sugerida
1. Refactor `serpro.ts`: `requestComProcurador` + `emitirComProcurador` (mantendo `consultarComProcurador`). Rodar a suíte (não pode regredir a consulta).
2. `serpro-das-simples-parse.ts` + teste (TDD).
3. `serpro-das-simples.ts` (orquestrador).
4. `gerarDasSimplesAction` em `impostos/actions.ts`.
5. `GerarDasSimplesButton` + fiação em `HistoricoGuias`/`CompetenciaAtualCard`/`page.tsx`.
6. `tsc` + `vitest` + smoke (com um mês EM ABERTO real, p/ confirmar a estrutura "com valor" e ajustar o parser se preciso).

## Fora de escopo (YAGNI)
- MEI (PGMEI) — migração do `gerarDasMeiAction` pro token_procurador é outra entrega.
- Parse de PDF p/ valores históricos de meses pagos.
- Drop das colunas órfãs `certificado_*` (acoplado à migração do MEI).
- Upload de PDF no Storage (fica inline por ora).
