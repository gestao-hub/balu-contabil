# Integração Focus NFe — cadastro automático, snapshot e painel de saúde · design

**Data:** 2026-05-28
**Status:** ✅ implementado e mergeado em `main` (Focus 1+4+3+2.0 + refactor semântico).
**Branch base:** `feat/focus-1-cadastro-empresa`
**Fontes:** [`body_focus.txt`](../../../body_focus.txt) (payload validado pelo user), Focus NFe API docs ([criar empresa](https://doc.focusnfe.com.br/reference/criar_empresa), [API v2](https://focusnfe.com.br/doc/)), [`PRD-Balu.md`](../../../PRD-Balu.md) §8.

## Contexto e gap original

Conforme [[balu-focus-cert-registration-gap]], o certificado A1 da empresa **nunca era registrado na Focus** — em nenhuma camada (Bubble, n8n, Next). A Focus era consumida só para:
- `GET /v2/cnpjs/:cnpj` (consulta CNPJ no cadastro de cliente),
- emissão NFS-e/NFe/NFCe (sempre em homologação),
- downloads PDF/XML e cancelamento.

O endpoint `POST /v2/empresas` (que registra empresa + certificado na Focus) **não aparecia em lugar nenhum**. Sem isso, emissão em produção é impossível.

Em paralelo, o PR 1.6 (certificado A1 sem n8n) decidiu **descartar a senha original do PFX** após o upload — guarda só `key+cert+chain` em PEM cifrado (`{uid}.enc`, AES-256-GCM). Isso resolveu segurança em repouso, mas criou uma dependência pra Focus: o `POST /v2/empresas` exige `arquivo_certificado_base64` + `senha_certificado`. Reconstrução do PFX seria possível, mas adicionaria um caminho que o user não pediu.

## Decisões aprovadas

1. **POST mínimo no momento do cadastro** (Focus 1) — sem o certificado, com os campos validados pelo user no painel da Focus.
2. **Reaproveitar a senha do upload do PFX** para o PUT enriquecendo (Focus 2.1, backlog) — a senha existe em memória durante a server action; manda pra Focus e descarta. Sem persistir.
3. **Falha da Focus não bloqueia o cadastro local** — grava `companies.focus_status='erro'` + `focus_last_error`. Visível no painel Saúde com botão de retry.
4. **Mesclar abas Cert + NFS-e** (Focus 4) — UX coesa e simplifica o disparo do PUT 2.1 (handler único).
5. **Painel "Saúde da empresa"** (Focus 3) — visão agregada de prontidão pra emitir; 5 checks com banner "N/5 ok".
6. **Snapshot per-empresa em `empresas_fiscais.focus_*`** (Focus 2.0) — Focus NÃO expõe metadados de município via API; o que ela expõe são flags por-empresa via `GET /v2/empresas/:id`. Snapshotamos pra evitar polling e ter fonte de verdade pra "está habilitada?".
7. **NFSe Nacional reconhecida via lista hardcoded** — Londrina/PR migrou em 01/01/2026 (Decreto 1.627/2025) e `municipios_nfse` legacy não reflete isso. Lista curta `ADERENTES_NFSEN_NACIONAL` em `lib/fiscal/municipios-nfsen-nacional.ts`; vira tabela quando tiver demanda.
8. **Ambiente do POST `/v2/empresas`: sempre `api.focusnfe.com.br`** — a "homologação" da Focus é por-EMPRESA (afeta emissões), não API namespace. O endpoint de revenda só existe em prod. (Tentar `homologacao.focusnfe.com.br/v2/empresas` retorna 404.)

## Escopo entregue (4 PRs, 10 commits)

- **Focus 1** (`0eecc7f`, `e525b78`, `27e1b62`): cadastro automático no `createCompanyAction`.
- **Focus 4** (`8149bd5`): mesclar abas em `EmissaoFiscalTab`.
- **Focus 3** (`ecaf901`, `5c55485`): aba "Saúde da empresa" + 5 checks + `RetryFocusButton`.
- **Focus 2.0** (`1931634`, `71d5e39`): snapshot + `consultarEmpresa` + `syncEmpresaNaFocus` faz GET após POST.
- **Refactor semântico** (`76569d6`): Check 1 ↔ Check 5 swap (cidade = capacidade; cadastro = agregado).

## Arquitetura

### 1. `src/lib/fiscal/focus-empresa-payload.ts` — mapeamento puro
```ts
buildFocusEmpresaPayload(company, regimeCode): FocusEmpresaPayload
```
Recebe subset de `companies` + `Code_regime_tributario` ('1'..'4'), retorna o payload conforme campos obrigatórios validados pelo user (`body_focus.txt`):
- **Obrigatórios:** nome, nome_fantasia, cnpj, regime_tributario (int), municipio, uf, logradouro, numero, bairro, cep.
- **Opcionais incluídos quando preenchidos:** complemento, email, inscricao_estadual, inscricao_municipal, telefone.
- Strip de máscaras (cnpj/cep/telefone só dígitos); `sem_numero=true` → `numero='SN'`; UF maiusculizado; nome_fantasia omitido quando igual à razão social.
- Sem deps de React/Supabase — 11 testes vitest.

### 2. `src/lib/clients/focus-nfe.ts` — métodos novos
```ts
focus.criarEmpresa(payload, _env='hom'): Promise<FocusEmpresaCriada>
focus.consultarEmpresa(id, _env='hom'): Promise<FocusEmpresaSnapshot>
```
Ambos forçam `call('prod', ...)` por design (revenda só existe em prod). 8 testes vitest cobrindo happy, 4xx, 5xx retry, URLs corretas.

### 3. `src/lib/fiscal/focus-empresa-sync.ts` — orquestrador
```ts
syncEmpresaNaFocus(supabase, companyId): Promise<SyncFocusResult>
```
Best-effort, server-only. Fluxo:
1. Lê empresa em `companies` + `Code_regime_tributario` em `empresas_fiscais`.
2. Monta payload via `buildFocusEmpresaPayload`.
3. `focus.criarEmpresa(payload, 'hom')` → grava `companies.focus_token/status/last_check/last_error`.
4. **Se sucesso e id retornado** → `focus.consultarEmpresa(id, 'hom')` → grava `empresas_fiscais.focus_empresa_id/codigo_municipio/habilita_*/sync_em`.
5. Nunca lança — toda falha capturada e expressa no return.

Consumido por:
- `createCompanyAction` (Focus 1, cadastro inicial).
- `retryFocusEmpresaAction` (Focus 3, botão "Cadastrar na Focus agora").

### 4. `src/lib/fiscal/saude-empresa.ts` — helpers do painel
```ts
buildSaudeChecks(state: SaudeState, now?: Date): CheckResult[]
```
5 checks puros + helpers (`isInFutureISO`, `daysUntilISO`). Semântica:

| Check | Pergunta | Fonte |
|---|---|---|
| 1. `cidade_nfse` | "Focus atende essa cidade?" (capacidade) | aderente NFSe Nacional → ✓ automático; senão, `municipios_nfse` |
| 2. `cert_presente` | Subimos cert? | `arquivos_auxiliares.storage_key` |
| 3. `cert_valido` | Dentro da validade? | `cert_not_after` vs `now` (alerta amarelo ≤30d) |
| 4. `serpro` | Token SERPRO ativo? | `empresas_fiscais.certificado_token_expiration` vs `now+skew` |
| 5. `focus_cadastro` | Empresa pronta pra emitir? | agregado: `focus_token` + alguma `habilita_*=true` + cert presente |

29 testes vitest cobrindo todos os caminhos.

### 5. `src/lib/fiscal/municipios-nfsen-nacional.ts` — aderência NFSe Nacional
```ts
const ADERENTES_NFSEN_NACIONAL: Map<codigoIbge, vigenteDesdeISO>
isAderenteNfsenNacional(codigoIbge, now?): boolean
```
Lista hardcoded de municípios que aderiram à NFSe Nacional. Hoje: `4113700 = Londrina/PR` desde 2026-01-01. Cresce manualmente; pode virar tabela ou cron CSV-Receita. 4 testes vitest.

### 6. UI

- **`<EmissaoFiscalTab>`** (server component): 3 seções (Cert / NFS-e / Status Focus); reusa `CertificadoForm` e `NfseForm` sem modificações internas.
- **`<SaudeEmpresaTab>`** (server component): banner agregado + lista de `<StatusItem>` (ícone + label + hint + ação contextual).
- **`<RetryFocusButton>`** (client island): `useTransition` + toast; dispara `retryFocusEmpresaAction`.

### 7. Banco — migrations

- **`0005_focus_company_token.sql`**: `companies` ganha `focus_token TEXT`, `focus_status TEXT`, `focus_last_check TIMESTAMPTZ`, `focus_last_error TEXT`.
- **`0006_focus_empresa_snapshot.sql`**: `empresas_fiscais` ganha `focus_empresa_id INT`, `focus_codigo_municipio TEXT`, `focus_habilita_nfse BOOL`, `focus_habilita_nfsen_producao BOOL`, `focus_habilita_nfsen_homologacao BOOL`, `focus_sync_em TIMESTAMPTZ`.

Ambas aplicadas no Supabase em 2026-05-28.

## Verificação

- **Vitest:** 118/118 ok (saude-empresa: 29 testes, focus-empresa-payload: 11, focus-nfe: 8, municipios-nfsen-nacional: 4 + suite pré-existente).
- **tsc --noEmit:** zero erros.
- **next build:** ok.
- **E2E manual contra AL Piscinas LTDA** (CNPJ 10358425000120):
  - `scripts/focus1-smoke.ts` → POST sucesso, Focus id=216635, token persistido.
  - `scripts/focus2-snapshot-smoke.ts` → snapshot persistido (`focus_codigo_municipio=4113700`, `focus_habilita_*=null` pendente do PUT 2.1).
  - Browser smoke da aba Saúde: Cidade ✓ "atendida via NFSe Nacional"; Cadastro ⚠ "Cadastrada na Focus, mas faltam: habilitação na Focus (NFS-e / NFSe Nacional). Será feito pelo PUT enriquecendo (Focus 2.1)".

## Pendências (em backlog)

- ~~**Focus 2.1 — PUT `/v2/empresas/:cnpj` enriquecendo**~~: **Concluído em 2026-05-28** (ver §"Continuação 2026-05-28" abaixo). PUT por **ID numérico** (não CNPJ), com payload base puro; cert e credenciais prefeitura saem em momentos dedicados (Focus 2.2).
- ~~**Focus 2.2 — Upload do certificado A1**~~: **Concluído em 2026-05-28**. Cert acoplado ao PUT como `arquivo_certificado_base64` + `senha_certificado` no momento do upload local (senha em memória). Sem reempacotar PFX, sem mudar schema.
- **Validar campos da Focus antes do PUT** (pedido do user): consultar empresas reais via `consultarEmpresa` pra mapear quais campos do snapshot são confiáveis e quais o user precisa fornecer no PUT.
- **Lista de aderentes NFSe Nacional**: expandir a partir do CSV da Receita Federal (ou tabela dedicada com cron).
- **Snapshot atualizado periodicamente**: hoje só atualiza após POST/PUT na Focus. Quando a Focus mudar algo no painel deles, nosso snapshot fica stale. Mitigação possível: botão "Atualizar status na Focus" ou TTL curto.

---

## Continuação 2026-05-28 — Focus 2.1 + 2.2

### Mudanças de design vs versão original

| Item | Versão original (planejada) | Versão entregue |
|---|---|---|
| Path do PUT | `/v2/empresas/:cnpj` | `/v2/empresas/:id` (ID numérico — empírico + doc) |
| Cert A1 | Endpoint multipart `POST .../certificado` | Campos `arquivo_certificado_base64` + `senha_certificado` no mesmo PUT (não há endpoint multipart na revenda) |
| Onde envia cert | Botão dedicado "Enviar cert pra Focus" | **No próprio `uploadCertificadoAction`** — único momento em que a senha PFX está em memória. Sem reempacotar. |
| Onde envia credenciais prefeitura | Junto do botão "Sincronizar" | **No `upsertEmpresaFiscalAction`** (save da aba NFS-e) — quando login/senha vêm no patch |
| Botão "Sincronizar" no Diagnóstico | Envia tudo (endereço + cert + credenciais) | Envia **apenas o payload base** (dados sem secrets) |

### Arquitetura final

```
                  ┌─ payload base (endereço, regime, flags) ─┐
buildFocusEmpresa │                                          │
UpdatePayload  ───┤  +withCertificado(base64, senha)         │── PUT /v2/empresas/:id
                  │  +withCredenciaisPrefeitura(login, senha)│
                  └──────────────────────────────────────────┘

Quem injeta o quê:
- syncFocusEmpresaAction (botão Diagnóstico) ────► payload base puro
- uploadCertificadoAction ────────────────────────► payload base + withCertificado
- upsertEmpresaFiscalAction (com login+senha) ────► payload base + withCredenciaisPrefeitura
```

Todas as 3 entradas chamam o mesmo helper `atualizarEmpresaNaFocus(supabase, companyId, env, extras?)`. Best-effort: erro vira `warning` na UI, não bloqueia save local.

### Drift detection

Diagnóstico compara `max(companies.updated_at, empresas_fiscais.updated_at)` vs `focus_sync_em`. Se local for mais novo > 2s, o grupo "Cadastro na Focus" vira `pendente` com meta *"Há mudanças não sincronizadas desde …"*. Sem drift mostra *"Sincronizado em …"*.

### Arquivos novos/alterados (2.1 + 2.2)

- `src/lib/fiscal/focus-empresa-update-payload.ts` — mapper puro + helpers `withCertificado` / `withCredenciaisPrefeitura` (23 testes).
- `src/lib/fiscal/focus-empresa-sync.ts` — `atualizarEmpresaNaFocus` com param `extras`.
- `src/lib/clients/focus-nfe.ts` — novo método `focus.atualizarEmpresa(id, payload, env)` (PUT, id numérico, força base prod).
- `src/lib/fiscal/saude-empresa.ts` — `detectFocusDrift` + meta no grupo focus.
- `src/app/(auth)/configuracoes/actions.ts` — `syncFocusEmpresaAction` (POST se sem token, PUT se com); upload + upsert chamam Focus best-effort.
- `src/app/(auth)/configuracoes/SyncFocusButton.tsx` — renomeado de RetryFocusButton; label "Sincronizar com Focus".
- `src/app/(auth)/configuracoes/SaudeEmpresaTab.tsx` — renderiza `group.meta`.
- `src/app/(auth)/configuracoes/NfseForm.tsx` — mostra `warning` (toast) vindo de Focus.
- `scripts/focus2.1-put-smoke.ts`, `scripts/focus2.2-cert-smoke.ts` — smokes E2E.
- `scripts/wipe-user.ts`, `scripts/wipe-companies.ts` — reset de testes.

### Verificação (2026-05-28)

- **Vitest:** 166/166 ok (helpers + drift + PUT mocked).
- **tsc --noEmit + next build:** verdes.
- **Smoke E2E real contra Focus hom (AL Piscinas, CNPJ 10358425000120):**
  - Focus 1 (POST): `id=216780`, token gerado.
  - Focus 2.2 (PUT + cert): `focus_habilita_nfsen_homologacao: true` (era null), `focus_status: ok`, `focus_last_error: null`.
  - Conclusão: empresa **pronta pra emitir NFS-e em homologação** após upload do cert.

### Decisões empíricas

- **PUT por ID numérico:** doc oficial diz CNPJ, mas tentar com CNPJ retorna `404 nao_encontrado`. ID interno (devolvido pelo POST como `resp.id`) é o que funciona. Persistido em `empresas_fiscais.focus_empresa_id`.
- **Cert via base64 no mesmo PUT:** doc da Focus revenda confirma — `arquivo_certificado_base64` + `senha_certificado` aceitam o PFX original sem reempacotar.
- **Senha PFX nunca persiste:** usada uma vez no PUT, descartada. Defesa em profundidade documentada no comentário do action.

## Premissas confirmadas

- Token Focus em `.env.local` (FOCUS_NFE_TOKEN) é da revenda — POST `/v2/empresas` retorna `id` + `token_homologacao` + `token_producao`.
- Códigos IBGE da Focus batem com os do IBGE oficial (4113700 = Londrina/PR ✓).
- Regime tributário do Balu ('1'..'4') mapeia 1:1 com o enum da Focus (integer 1..4).
- Validação do payload na Focus aceita `numero` como string ("SN" pra sem-número ✓).
