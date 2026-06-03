# Spec — Migrar MEI (DAS) pro token_procurador + drop das colunas órfãs

> **Data:** 2026-06-03 · **Branch:** `feat/mei-token-procurador`
> **Depende de:** fluxo procurador (`garantirTokenProcurador`, `emitirComProcurador`) + emissão Simples (`gerarDasSimples`, `isNadaDevido` inline em `parseDasSimples`) — todos já mergeados.

## Problema / objetivo

O `gerarDasMeiAction` (PGMEI/GERARDASPDF21) ainda usa o **modelo de auth antigo e quebrado**: lê
`empresas_fiscais.certificado_jwt/certificado_access_token/certificado_token_expiration` (colunas que
**paramos de escrever** na migração do procurador) e tem um branch **trial/demo** (CNPJ `00000000000100`)
que só retorna 900908. Ou seja, o caminho de produção do MEI hoje **não funciona**.

Objetivo: migrar o MEI para o mesmo fluxo procurador do Simples (contratante fixo + Termo + token por
empresa), e **fechar a dívida técnica** dropando as 3 colunas órfãs.

### Limitação honesta (smoke)
**Não há MEI para testar** (sem e-CNPJ de MEI p/ assinar o Termo, sem MEI com débito real; Trial
bloqueado). O código é um espelho do Simples (já validado estruturalmente) e o `parseDasMei` é
defensivo. O "funciona em produção" do MEI fica como **item de smoke pendente** (1º MEI real).

## Decisões (brainstorming)
- **Trial/demo:** remover (procurador é prod-only). `serpro-env.ts` + `serpro-env.test.ts` saem (órfãos).
- **Drop das colunas:** nesta mesma PR (migração 0018 + remover tipos em `database.ts`).
- **UI MEI:** manter como está (`GerarDasButton` no card da competência) — único ajuste é +1 branch
  pro `semValor` (toast info), sem novo componente/layout.

## Arquitetura

### Fluxo (`gerarDasMeiAction(competencia)`)
```
GerarDasButton (MEI, card da competência)
  → gerarDasMeiAction(competencia: 'YYYYMM')
      1. auth + companyId; gate regime MEI (Code_regime_tributario === '4')
      2. gerarDasMei(supabase, companyId, competencia):
           garantirAuthContratante() + garantirTokenProcurador()
           envelope PGMEI/GERARDASPDF21 (contratante=contratante, autor=contribuinte=empresa, dados={periodoApuracao})
           emitirComProcurador(...) → resp
           isNadaDevido(resp) ? { semValor:true } : parseDasMei(resp) → { semValor:false, das }
      3. semValor → { ok:true, semValor:true } (não persiste)
         senão → upsert em guias_fiscais (valores+vencimento+barras+PDF inline) + liga apuração
      4. revalidatePath('/impostos')
```

### Componentes

| Arquivo | Tipo | Papel |
|---|---|---|
| `lib/fiscal/serpro-das-comum.ts` | puro (novo) | `isNadaDevido(resp): boolean` — extraído da lógica inline do `parseDasSimples` (dados vazio/null OU `mensagens[].codigo` com `MSG_E0139`). + teste. |
| `lib/fiscal/serpro-das-simples-parse.ts` | puro (refactor leve) | passa a usar `isNadaDevido` do módulo comum (DRY; testes existentes seguem verdes). |
| `lib/fiscal/serpro-das-mei.ts` | server-only (novo) | `gerarDasMei(supabase, companyId, competencia)` — espelho do `serpro-das-simples.ts`, mas PGMEI/GERARDASPDF21 + `parseDasMei` + `isNadaDevido`. Retorna `{ ok:true; result } | { ok:false; error }` onde `result = { semValor:true } | { semValor:false; das: DasMeiResult }`. |
| `app/(auth)/impostos/actions.ts` | server action (reescrita parcial) | `gerarDasMeiAction` reescrito: remove env/demo/certificado_*/ProdAuth/serpro.emitirDasMei/buildEnvelope; usa `gerarDasMei`; mantém o upsert + ligação da apuração. Remove imports agora não usados. |
| `app/(auth)/impostos/GerarDasButton.tsx` | client (ajuste mínimo) | +1 branch: `ok && semValor` → `toast('info', 'Sem débito em aberto para esta competência.')`; senão mantém. |
| `supabase/migrations/0018_drop_certificado_columns.sql` | migração (novo) | `DROP COLUMN` das 3 colunas órfãs em `empresas_fiscais`. |
| `docs/reference/db_atual.sql` | dump | remover as 3 linhas `certificado_*` do bloco `empresas_fiscais`. |
| `types/database.ts` | tipos | remover as 3 linhas `certificado_*`. |
| `lib/fiscal/serpro-env.ts` + `serpro-env.test.ts` | **deletar** | órfãos após remover o branch trial. |

### Tipos
```ts
// gerarDasMeiAction (mesmo arquivo das outras actions)
export type GerarDasResult = { ok: true; semValor: boolean } | { ok: false; error: string };
```
(Hoje é `{ ok:true } | { ok:false; error }`; passa a incluir `semValor` p/ o branch de "nada devido".)

`gerarDasMei` retorna `{ ok:true; result: DasMeiOutcome } | { ok:false; error }` com
`DasMeiOutcome = { semValor: true } | { semValor: false; das: DasMeiResult }` (`DasMeiResult` é o tipo
já existente em `das-mei-parse.ts`).

### Persistência (`guias_fiscais`)
Idêntica à atual do `gerarDasMeiAction` (já correta): upsert `onConflict 'company_id,competencia_referencia'`
com `numero_das`, `valor_principal/multa/juros/total`, `data_vencimento`, `linha_digitavel`,
`codigo_barras`, `url_pdf` (inline `data:`), `status:'gerada'`, `origem:'serpro'`; depois liga
`apuracoes_fiscais.guia_fiscal_id` da mesma competência (passo mantido).

## Tratamento de erros
- "nada devido" → `{ ok:true, semValor:true }` (toast info, sem persistir).
- cert ausente / procuração / falha `/Emitir` → mensagens amigáveis propagadas do `gerarDasMei`.
- Action nunca lança pro cliente.

## Testes (Vitest unit)
- `serpro-das-comum.test.ts` — `isNadaDevido`: dados `""`/null → true; `MSG_E0139` → true; resposta com `dados` populado → false.
- `serpro-das-simples-parse.test.ts` — segue verde após usar o helper compartilhado (sem mudança de comportamento).
- `serpro-env.test.ts` — removido junto com o módulo.
- `parseDasMei` — cobertura existente mantida.
- Suíte completa sem regressão.

## Sequência de implementação sugerida
1. `serpro-das-comum.ts` (`isNadaDevido`) + teste; refatorar `parseDasSimples` p/ usá-lo (testes verdes).
2. `serpro-das-mei.ts` (`gerarDasMei`).
3. Reescrever `gerarDasMeiAction` (usa `gerarDasMei`; remove imports/branches velhos).
4. Ajuste mínimo no `GerarDasButton` (branch `semValor`).
5. Deletar `serpro-env.ts` + `serpro-env.test.ts`.
6. Migração `0018` + `db_atual.sql` + remover tipos em `database.ts`.
7. `tsc` + `vitest` (sem regressão). Smoke MEI fica pendente (1º MEI real).

## Fora de escopo (YAGNI)
- Botão por linha no MEI (paridade com Simples) — UI mantida.
- Limpeza dos exports agora-órfãos de `serpro.ts` (`emitirDasMei`/`buildEnvelope`/`call`/`bearer`/`TRIAL`) — nota p/ depois, sem churn agora.
- Smoke real do MEI (sem ambiente).
