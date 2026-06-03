# Spec — Fluxo procurador SERPRO com certificado do contratante

> **Data:** 2026-06-03 · **Branch:** `feat/serpro-procurador-contratante`
> **Origem:** ajuste de arquitetura do fluxo SERPRO antes de virar a emissão de DAS em feature.
> **Fonte da verdade do tema:** `docs/investigations/SERPRO-INVESTIGACAO.md` (rodada 6 = prova ponta a ponta em produção; rodada 7 = Trial é beco sem saída).

## Problema

O fluxo atual de autenticação SERPRO está **errado**: no upload do certificado
(`uploadCertificadoAction`), o app faz o mTLS `/authenticate` com o **certificado da própria
empresa** (`autenticarProcurador(material.keyPem, material.certPem)`) e cacheia `jwt`/`access_token`
em `empresas_fiscais.certificado_jwt/access_token/token_expiration`.

O modelo validado em produção (rodada 6) é o **procurador**:

- **Contratante** (PIPER, CNPJ 61061690000183) — cert **fixo**, único para toda a Balu, usado no
  mTLS `/authenticate` e no `/Apoiar`.
- **Empresa/cliente** — assina um **Termo de Autorização XML** (XMLDSig) com o **próprio cert**.
- O `/Apoiar` (`AUTENTICAPROCURADOR/ENVIOXMLASSINADO81`) devolve o `autenticar_procurador_token`,
  que é **por empresa** e expira na **meia-noite do dia seguinte** (Brasília — ver §Validade).

Hoje não existe lugar para guardar nem o cert do contratante nem o `token_procurador`.

## Objetivo (escopo desta entrega)

Reescrever a **autenticação + armazenamento + diagnóstico**. **Não** mexe na emissão de DAS
(`gerarDasMeiAction`) — isso vem no redesign da feature de emissão, depois.

1. No upload do certificado da empresa: autenticar com **cert do contratante** (mTLS) + assinar o
   Termo XML com o **cert da empresa** → `/Apoiar` → salvar o `token_procurador` por empresa.
2. Ajustar o status SERPRO na aba **Diagnóstico** para refletir o `token_procurador` (e gate global
   quando o contratante não está configurado).
3. Guardar o **cert + senha do contratante** numa **tabela singleton de config do sistema**.

## Não-objetivos (YAGNI)

- Reescrever `gerarDasMeiAction` / consultas para usar o `token_procurador` (feature de emissão).
- UI de admin para subir/rotacionar o cert do contratante (provisionamento por **seed manual**).
- Dropar as colunas órfãs `certificado_jwt/access_token/token_expiration` (saneamento posterior).
- Procuração e-CAC (o Termo XML assinado substitui; e-CAC fica como alternativa manual fora do app).

## Validade do `token_procurador` (confirmado na doc oficial)

> *"O token válido fica disponível até a **meia-noite do dia seguinte."*
> ([AutenticaProcurador](https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/solucoes/integra-contador-gerenciador/autenticaprocurador/))

**Não são 24h fixas.** O token expira sempre no **00:00 do dia seguinte ao da geração**, em horário
de Brasília. Implementação: `expiration = início do próximo dia em America/Sao_Paulo` (ou seja, o
instante 00:00 da data = geração + 1 dia, no fuso de São Paulo). Gerou 00:00 → dura ~24h; gerou
23:00 → dura ~1h. Existe também um serviço oficial de **revogação explícita** ("Expirar token de
autenticação") — fora do escopo desta entrega.

## Arquitetura

### Fluxo-alvo (no upload do cert da empresa)

```
uploadCertificadoAction(file, senha)
  │ parsePkcs12 → keyPem/certPem/cnpj da EMPRESA (em memória)
  ├─ encryptBlob(PEM) → Storage (company-certificates) + metadados em arquivos_auxiliares  (igual hoje)
  └─ garantirTokenProcurador(supabase, companyId, { keyPem, certPem, cnpj, nome })   [best-effort]
       1. getContratante() → decifra PFX + senha do contratante (tabela singleton)
       2. garantirAuthContratante() → mTLS /authenticate (role-type TERCEIROS); cacheia access_token+jwt (~1h)
       3. buildTermoXml({ destinatario: contratante, autor: empresa })
       4. signTermoXml(xml, { keyPem, certPem da EMPRESA })            → XMLDSig RSA-SHA256
       5. serpro.enviarTermoApoiar({ pfx contratante, accessToken, jwt, envelope }) → autenticar_procurador_token
       6. UPDATE empresas_fiscais SET serpro_token_procurador, serpro_token_procurador_expiration
```

`garantirTokenProcurador` é **idempotente**: se já houver um `serpro_token_procurador` cujo
`expiration` ainda está no futuro (com folga), devolve o cacheado sem chamar a SERPRO. O parâmetro
`material?` é opcional — no upload passamos o material em memória (evita round-trip no Storage); no
botão de re-auth o helper lê e decifra o cert da empresa do Storage.

O contratante é **único para toda a Balu** (modelo de mercado confirmado: 1 consumer key → N
contribuintes). O `/authenticate` é caro e seus tokens valem ~1h → cacheados no nível do contratante
e reaproveitados por todas as empresas. O `/Apoiar` e o `/authenticate` são ambos **mTLS com o cert
do contratante**.

### Modelo de dados (migration `0017_serpro_contratante_e_token_procurador.sql`)

**Nova tabela singleton `public.serpro_contratante`:**

| coluna | tipo | nota |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `cnpj` | varchar(20) NOT NULL | contratante (ex.: PIPER) |
| `nome` | text | razão social (vai no Termo: `destinatario.nome`) |
| `cert_pfx_enc` | text NOT NULL | PFX **cru** cifrado (envelope AES-GCM, `CERT_ENC_KEY`), base64 |
| `cert_password_enc` | text NOT NULL | **senha** cifrada (envelope AES-GCM) |
| `cert_not_after` | timestamptz | validade do cert (diagnóstico) |
| `cert_subject_cn` | text | CN do cert (diagnóstico) |
| `auth_access_token` | text | cache do `/authenticate` |
| `auth_jwt_token` | text | cache do `/authenticate` |
| `auth_token_expiration` | timestamptz | expiração do cache (~1h) |
| `created_at`, `updated_at` | timestamptz | default `now()` |

- **Singleton** garantido por índice único parcial sobre uma constante (`CREATE UNIQUE INDEX
  serpro_contratante_singleton ON public.serpro_contratante ((true));`) — no máximo 1 linha.
- **RLS**: `ENABLE ROW LEVEL SECURITY` + **nenhuma policy** para `authenticated`/`anon` → acesso só
  via `service_role` (bypassa RLS). Leitura/escrita exclusivamente por server actions com
  `createAdminClient()` (`src/lib/supabase/admin.ts`). Guardamos PFX cru + senha porque o mTLS do
  contratante usa `pfx`+`passphrase` (como o spike), e a senha é necessária a cada `/authenticate`.

**Em `public.empresas_fiscais` (2 colunas novas):**

```sql
ALTER TABLE public.empresas_fiscais
  ADD COLUMN serpro_token_procurador text,
  ADD COLUMN serpro_token_procurador_expiration timestamptz;
```

> As colunas `certificado_jwt/certificado_access_token/certificado_token_expiration` deixam de ser
> escritas (órfãs). Drop fica para saneamento posterior (ver Não-objetivos).

A migration também atualiza `docs/reference/db_atual.sql` (fonte da verdade do schema — migrations
estão defasadas; ver memória `balu-db-source-of-truth`).

### Módulos

| Arquivo | Tipo | Papel |
|---|---|---|
| `lib/clients/serpro-auth.ts` | server-only (reescrita) | `autenticarContratante(pfx, passphrase)` — mTLS `/authenticate` com cert do **contratante**, `role-type: TERCEIROS`. `parseAuthResponse` mantido. Remove a assinatura antiga `autenticarProcurador(keyPem, certPem)`. |
| `lib/fiscal/serpro-termo.ts` | puro (novo) | `buildTermoXml({ destinatario, autor })` (template oficial Serpro) + `signTermoXml(xml, { keyPem, certPem, certDerB64 })` (XMLDSig RSA-SHA256, c14n 1.0, `xml-crypto`). Extraído do spike `test-serpro-procurador-al-piscinas.mjs`. |
| `lib/fiscal/serpro-expiracao.ts` | puro (novo) | `proximaMeiaNoiteSaoPaulo(now): string` (ISO) — calcula a expiração do `token_procurador`. |
| `lib/fiscal/serpro-contratante.ts` | server-only (novo) | `getContratante(supabase)` (lê singleton, decifra PFX+senha) · `garantirAuthContratante(supabase)` (re-autentica se `auth_token_expiration` passou; atualiza cache). |
| `lib/fiscal/serpro-procurador.ts` | server-only (novo) | **`garantirTokenProcurador(supabase, companyId, material?)`** — o orquestrador idempotente descrito acima. |
| `lib/clients/serpro.ts` | server-only (+1 método) | `enviarTermoApoiar({ pfx, passphrase, accessToken, jwt, envelope })` → POST `gateway.apiserpro.serpro.gov.br/integra-contador/v1/Apoiar`; parseia `dados.autenticar_procurador_token` (e fallback no ETag). |

### Upload (`uploadCertificadoAction`)

Substitui o bloco best-effort que chamava `autenticarProcurador(material.keyPem, material.certPem + chainPem)`
e gravava `certificado_jwt/access_token/token_expiration` por:

```ts
const r = await garantirTokenProcurador(supabaseAdmin, companyId, {
  keyPem: material.keyPem, certPem: material.certPem, cnpj: material.cnpj, nome: material.subjectCN,
});
if (!r.ok) warnings.push(r.warning); // não perde o cert salvo
```

Avisos:
- contratante não configurado → "Configure o certificado do contratante (SERPRO) para ativar a geração de guias."
- falha de auth/`/Apoiar` → "Autenticação SERPRO falhou — será refeita depois."

### Diagnóstico (`lib/fiscal/saude-empresa.ts` + página que monta `SaudeState`)

- `SaudeState.serproTokenExpiration` passa a vir de `empresas_fiscais.serpro_token_procurador_expiration`
  (era `certificado_token_expiration`).
- Novo campo `SaudeState.contratanteConfigurado: boolean`.
- `serproCheck`:
  - `!contratanteConfigurado` → **status `erro`**, label "Contratante SERPRO não configurado",
    hint "Cadastro do contratante pendente (admin)" (gate global, sem ação de cliente).
  - senão, mantém a lógica atual sobre `serproTokenExpiration`: ausente → `pendente` ("Conecte",
    action `reauth_serpro`); expirado → `atencao`; válido → `ok` (hint menciona "Termo/procuração,
    válido até …").
- A página/loader que monta `SaudeState` (em `configuracoes/`) lê a nova coluna e consulta a presença
  do contratante (via `createAdminClient`, pois a tabela é service-role-only).

### Seed (provisionamento manual)

`app/scripts/seed-serpro-contratante.mjs` — lê o PFX do contratante (PIPER) + senha
(`docs/n8n/...pfx` + `senha.json` localmente, ou args/env em produção), extrai `cnpj`/`nome`/`notAfter`/`CN`,
cifra PFX e senha com `CERT_ENC_KEY` (envelope) e faz **upsert** da linha singleton via service_role.
Rodado 1× pelo admin. Não versiona segredos.

## Tratamento de erros

- `garantirTokenProcurador` **nunca derruba** o upload do cert (best-effort, vira `warning`).
- Sem contratante configurado: helper retorna `{ ok: false, warning }` e o Diagnóstico mostra o gate.
- `/authenticate` ou `/Apoiar` ≥ 400: erro propagado como `warning`, sem persistir token.
- mTLS/timeout: `serpro-auth` e o método `/Apoiar` têm timeout (10–25s) e mensagens sem vazar segredos.

## Testes (Vitest unit, `src/**/*.test.ts`)

- `serpro-termo.test.ts` — `buildTermoXml`: papéis corretos (`destinatario` = contratante/contratante,
  `assinadoPor` = autor/autor pedido de dados), CNPJs, presença de `dataAssinatura`/`vigencia`;
  `signTermoXml`: produz `<Signature>` + `<X509Certificate>` e referência enveloped.
- `serpro-expiracao.test.ts` — `proximaMeiaNoiteSaoPaulo`: gerado 00:05 → ~24h; gerado 23:30 → mesmo
  dia 00:00 seguinte; vira corretamente o fuso São Paulo.
- `saude-empresa.test.ts` — casos novos: `contratanteConfigurado=false` → erro; token ausente →
  pendente; token expirado → atenção; token válido → ok. (Estende o arquivo de teste existente do
  `buildSaudeChecks`, se houver; senão cria.)
- `parseAuthResponse` — mantém o teste atual.

Sem teste de rede (a chamada real fica nos scripts de spike já existentes).

## Sequência de implementação sugerida

1. Migration `0017` + atualizar `db_atual.sql`.
2. Puros: `serpro-termo.ts`, `serpro-expiracao.ts` (+ testes, RED→GREEN).
3. `serpro-auth.ts` reescrito (`autenticarContratante`).
4. `serpro.ts`: método `enviarTermoApoiar`.
5. `serpro-contratante.ts` (`getContratante` + `garantirAuthContratante`).
6. `serpro-procurador.ts` (`garantirTokenProcurador`).
7. `uploadCertificadoAction`: trocar o bloco de auth.
8. `saude-empresa.ts` + loader do Diagnóstico (+ testes).
9. `seed-serpro-contratante.mjs`.
10. `tsc --noEmit` + `vitest run` + smoke manual do seed→upload (opcional, com cert real).
