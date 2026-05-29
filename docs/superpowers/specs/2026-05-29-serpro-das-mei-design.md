# Geração de DAS-MEI via Serpro Integra Contador (v1)

> **Status:** desenho aprovado (2026-05-29). Escopo: gerar o DAS do MEI via Serpro (PGMEI/GERARDASPDF21), testável contra o **Trial**; caminho de produção fiado e **gated** (procuração + cert), sem disparar real.
>
> **Precede:** `2026-05-29-motor-apuracao-mei-simples-design.md` (motor de apuração — apuracoes_fiscais). Este spec é o passo "guias_fiscais/DAS" do Passo 3.

## Objetivo

A partir de uma competência, gerar o DAS do MEI chamando o Serpro Integra Contador (PGMEI), persistir a guia em `guias_fiscais` e exibi-la em `/impostos`. Substitui a etapa de DAS do fluxo n8n.

## Escopo

**Dentro:**
- **MEI apenas** (regime code 4). Serviço **PGMEI / `GERARDASPDF21`** (1 chamada, retorna PDF + valores).
- **Trial/Demonstração** totalmente testável (auth + envelope + emitir + parse + persistir + UI).
- Caminho de **produção fiado e gated** por flag (usa token mTLS do certificado), **sem emitir real**.
- UI: botão **"Gerar DAS"** no card de competência atual do `/impostos` (abordagem A).

**Fora (spec/PR próprio):**
- **Simples Nacional (PGDAS-D)** — fluxo de 2 passos (`TRANSDECLARACAO11` → `GERARDAS12`), declaração com breakdown por tributo.
- Disparo de DAS **real em produção** (depende de procuração eletrônica + cert registrado — ver §8).
- Pagamento da guia (Pix/linha digitável) além de exibir os dados.

## Decisões fixadas

1. **Abordagem (A)**: botão "Gerar DAS" no `/impostos` (MEI não usa o wizard de cálculo — Serpro computa o valor oficial).
2. **Valor oficial é o do Serpro** (`valores.total`), não o `valorDasMei` estimado do motor. A guia persiste os números do Serpro.
3. **PDF inline**: o base64 do DAS vai em `guias_fiscais.url_pdf` como data URI (`data:application/pdf;base64,…`). Bucket fica para depois.
4. **Env default `trial`**. Trial força inputs de demonstração (ver §3). Prod gated, sem disparo real nesta entrega.
5. **Idempotência**: 1 guia por `(company_id, competencia_referencia)` — re-gerar atualiza (migration UNIQUE análoga à de apurações).

## Achados do Serpro Integra Contador (PGMEI)

Fonte: documentação oficial Serpro (apicenter.estaleiro.serpro.gov.br) + JSON n8n.

**Request** (`POST {base}/v1/Emitir`):
```jsonc
{
  "contratante":      { "numero": "<cnpj>", "tipo": 2 },
  "autorPedidoDados": { "numero": "<cnpj>", "tipo": 2 },
  "contribuinte":     { "numero": "<cnpj>", "tipo": 2 },
  "pedidoDados": {
    "idSistema": "PGMEI",
    "idServico": "GERARDASPDF21",
    "versaoSistema": "1.0",
    "dados": "{\"periodoApuracao\":\"AAAAMM\"}"   // string JSON
  }
}
```

**Response** — `dados` é **string JSON** que, após parse, é uma lista:
```jsonc
[{
  "cnpjCompleto": "...",
  "detalhamento": [{
    "periodoApuracao": "201901",
    "numeroDocumento": "...",
    "dataVencimento": "20190220",        // AAAAMMDD
    "valores": { "principal": 55.90, "multa": 11.18, "juros": 10.71, "total": 77.79 },
    "codigoDeBarras": ["...","...","...","..."]   // 4 strings
  }],
  "pdf": "<base64>"                       // presente no GERARDASPDF21
}]
```
Envelope externo: `{ status: 200, mensagens: [...], dados: "<string acima>" }`.

**Trial/Demonstração**: base `…/integra-contador-trial`, **CNPJ `00000000000100`** nos três campos, **`periodoApuracao "201901"`**. Respostas canned; só serve pra exercitar a mecânica.

**Auth**:
- **Trial**: `bearer()` já existente em `serpro.ts` — POST `…/token` com `Basic base64(consumer_key:consumer_secret)`. Sem mTLS.
- **Prod**: token mTLS via `serpro-auth.ts` (`autenticarProcurador` com key+cert PEM do certificado A1) → `jwt_token` + `access_token` (guardados em `empresas_fiscais.certificado_jwt/certificado_access_token/certificado_token_expiration`). Chamadas prod exigem `Authorization: Bearer <access_token>` **+ header `jwt_token: <jwt>`**.

## Arquitetura

```
/impostos (CompetenciaAtualCard, MEI) ── botão "Gerar DAS"
        │
        ▼
gerarDasMeiAction(competencia)  [server action]
  auth → empresa (regime MEI) → resolve env (trial|prod)
  → buildEnvelope (PGMEI/GERARDASPDF21)  [trial: inputs demo]
  → serpro.emitirDasMei(env, envelope)
  → parseDasMei(resposta)  [puro]
  → upsert guias_fiscais  + link apuracoes_fiscais.guia_fiscal_id
  → revalidatePath('/impostos')
```

Camada de auth gated dentro de `serpro.ts.call()`: `env='trial'` → `bearer()`; `env='prod'` → token mTLS do cert + header `jwt_token`.

## Módulos

| Arquivo | Mudança |
|---|---|
| `src/lib/clients/serpro.ts` (modificar) | + `PGMEI_SERVICES = { GERAR_DAS_PDF: 'GERARDASPDF21' }`; `idSistema` PGMEI no envelope; `call()` aceita o caminho prod (jwt_token header) atrás do env; helper `emitirDasMei(env, envelope)` |
| `src/lib/fiscal/das-mei-parse.ts` (novo, puro) | `parseDasMei(resposta): { numeroDocumento, dataVencimento: string(ISO), valores:{principal,multa,juros,total}, codigoDeBarras: string[], pdfBase64: string\|null }` — faz o `JSON.parse` do `dados`, navega `[0].detalhamento[0]`, converte `AAAAMMDD`→ISO |
| `src/lib/fiscal/serpro-env.ts` (novo) | `resolveSerproEnv(): 'trial'\|'prod'` (env `SERPRO_ENV`, default `trial`); `demoInputs()` → `{ cnpj:'00000000000100', periodo:'201901' }` |
| `src/app/(auth)/impostos/actions.ts` (modificar) | + `gerarDasMeiAction(competencia)` |
| `supabase/migrations/0008_guias_unique.sql` (novo) | `UNIQUE (company_id, competencia_referencia)` em `guias_fiscais` (idempotência) |
| `src/app/(auth)/impostos/CompetenciaAtualCard.tsx` (modificar) | botão "Gerar DAS" (MEI, sem guia) + exibição da guia (valor_total, vencimento, baixar PDF) |

## Persistência — `guias_fiscais`

A tabela já existe (todas as colunas DAS presentes). `gerarDasMeiAction` upserta:
```
company_id, owner_user_id
competencia_referencia (YYYYMM), competencia_mes, competencia_ano
numero_das        ← detalhamento.numeroDocumento
valor_principal/multa/juros/total ← valores.*
data_vencimento   ← dataVencimento (ISO date)
linha_digitavel   ← codigoDeBarras.join(' ')  (as 4 partes do código de barras)
codigo_barras     ← codigoDeBarras.join('')   (sem separador)
url_pdf           ← "data:application/pdf;base64,<pdf>"  (inline)
status            ← 'gerada'
origem            ← 'serpro'
updated_at, deleted_at: null
```
E liga `apuracoes_fiscais.guia_fiscal_id = guia.id` quando há apuração na mesma competência.

## Fluxo de dados (detalhe)

1. `/impostos` mostra a competência atual. Se regime MEI e sem guia → botão "Gerar DAS".
2. Clique → `gerarDasMeiAction(competencia)`.
3. Resolve empresa via `profiles.current_company` + `empresas_fiscais` (valida regime code 4).
4. `resolveSerproEnv()`; se `trial`, usa `demoInputs()` (CNPJ `00000000000100`, período `201901`) ignorando o real; se `prod`, usa CNPJ real + período da competência.
5. `buildEnvelope` (PGMEI/GERARDASPDF21) → `serpro.emitirDasMei(env, envelope)`.
6. `parseDasMei` → upsert `guias_fiscais` → link apuração → `revalidatePath('/impostos')`.
7. Card renderiza a guia (valor total, vencimento, "Baixar PDF" via data URI).

## Tratamento de erros / edge

- **Credenciais ausentes** (`SERPRO_CONSUMER_KEY/SECRET`) → erro amigável "Serpro não configurado".
- **Regime ≠ MEI** → bloqueia ("Geração de DAS via Serpro na v1 cobre só MEI; Simples virá depois").
- **Serpro 4xx/5xx ou mensagem de erro** → toast traduzido com a mensagem do Serpro (não erro cru).
- **`dados` vazio/sem detalhamento** → erro "Serpro não retornou DAS para a competência".
- **Idempotência** → upsert por `(company_id, competencia_referencia)`; re-gerar atualiza, não duplica.
- **Prod gated**: se `SERPRO_ENV=prod` mas sem token mTLS válido → erro claro "Produção exige certificado autenticado + procuração (ver habilitação)". Não tenta silenciosamente.

## Testes

- **Puro** `das-mei-parse.test.ts`: resposta real do doc (com PDF, com código de barras de 4 partes, valores), conversão `AAAAMMDD`→ISO, caso `dados` vazio, `pdf` ausente.
- **`serpro-env.test.ts`**: default trial; `SERPRO_ENV=prod`; demoInputs corretos.
- **Smoke runtime (Trial real)**: botão "Gerar DAS" → Serpro Trial (CNPJ demo) → guia persiste com `valores.total` do Serpro → aparece em `/impostos` → "Baixar PDF" abre o data URI. Idempotência: gerar 2× não duplica.

## §8 — Gap de habilitação de produção (documentado, não resolvido)

Emitir DAS **real** exige, fora do código:
1. **Certificado A1 válido** registrado/autenticável via mTLS (o token atual da AL PISCINAS está expirado; renova na chamada, mas precisa de cert válido).
2. **Procuração eletrônica** (e-CAC) do contribuinte para o contratante (Balu/contador) — sem ela, o Serpro prod nega autorização.
3. Confirmar `idSistema/versaoSistema` e o serviço prod (`GERARDASPDF21`) contra o catálogo de produção.

Mesma natureza do gap do Focus (cert nunca registrado — ver memória). **Não disparar DAS real até (1)+(2) confirmados** — DAS é documento fiscal real.

## Build sequence (detalhe no plano)

1. `das-mei-parse.ts` + testes (puro)
2. `serpro-env.ts` + testes
3. `serpro.ts`: PGMEI service + `emitirDasMei` + caminho prod gated em `call()`
4. migration `0008_guias_unique.sql`
5. `gerarDasMeiAction` em `impostos/actions.ts`
6. UI: botão "Gerar DAS" + exibição da guia no `CompetenciaAtualCard`
7. Smoke Trial

## §9 — Status de implementação e smoke (2026-05-29)

**Implementado e mergeado em `main`.** 7 tasks (TDD onde aplicável), code review final (0 Critical; corrigidos: `download`+scheme guard no link do PDF, `exp` inválida tratada como expirada, comentário no alias `emitirDasMei`). Migration `0008` aplicada no Supabase. Suíte: 272 testes verdes; `tsc` limpo.

**Smoke runtime (Trial, 2026-05-29):** a mecânica funciona até a fronteira de autorização do Serpro:
- ✅ Botão "Gerar DAS" com gating MEI; token Serpro obtido (`POST /token` → 200); envelope PGMEI + endpoint corretos; tratamento de erro (403 vira `{ok:false}` → toast, sem crash).
- ❌ **DAS não gerado** — Serpro responde **403 `{"code":"900908"}` "API Subscription validation failed"**: o app (consumer key) **não está inscrito no produto Integra Contador Trial**. **Gap de conta/assinatura Serpro, não de código.**

### Pontos de atenção (consolidado)

| # | Ponto | Natureza | Ação |
|---|---|---|---|
| 1 | **Assinatura Serpro Trial** ausente → 403 900908 | Conta Serpro | Inscrever o app (consumer key) no produto Integra Contador Trial em loja.serpro.gov.br, depois re-rodar o smoke |
| 2 | **Produção real**: mTLS com cert A1 válido (token atual expira) **+ procuração eletrônica** (e-CAC) | Habilitação externa | Ver §8. Não disparar DAS real antes |
| 3 | **Trial usa CNPJ/período de demonstração fixos** (`00000000000100`/`201901`) | Limitação Serpro | Valores são canned; não refletem a empresa real |
| 4 | **Valor da guia vem do Serpro** (`valores.total`), não da estimativa `valorDasMei` | Decisão de design | — |
| 5 | **Refresh mTLS on-demand não implementado** — prod lê token de `empresas_fiscais` e exige válido, senão erro gated | Escopo diferido | Implementar `serpro-auth.ts → call()` quando produção for habilitada |
| 6 | **Só MEI** — Simples (PGDAS-D, 2 passos) fica em spec próprio | Escopo | Próximo PR de impostos |

### Pendências fora deste spec (do épico de impostos)
- **`receitas_fiscais` a/b** segue pendente do outro dev (apuração v1 lê de `notas_fiscais`, opção b provisória).
- **DAS-MEI 2026** (`das-mei.ts`): valores a confirmar com o salário mínimo oficial de 2026.
- **Anualização do RBT12** não acionada (falta campo de data de início de atividade no schema).
