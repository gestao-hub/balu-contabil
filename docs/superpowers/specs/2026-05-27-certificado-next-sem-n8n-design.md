# Certificado A1 — Balu assume o ciclo de vida (sem n8n) · design

**Data:** 2026-05-27
**Status:** aprovado (brainstorming) — pronto para writing-plans
**Branch base:** `feat/pr-1.6-certificado`
**Fontes:** PRD §8; workflow n8n `api serpro integra contador` (dissecado, `docs/n8n/`, redigido); infra existente `supabase-storage.ts`, `serpro.ts`, `n8n.ts`, tabelas `arquivos_auxiliares` / `empresas_fiscais`.

## Contexto

Hoje o upload de certificado A1 delega a parte difícil ao **n8n** (`https://webhooks.envia.click`). A dissecação do workflow revelou **dois webhooks** acoplados pelo formato de armazenamento:

1. **`/webhook/upload-certificado`** — re-encoda o PFX via `openssl pkcs12 ... -legacy` (decifra) → `-export` (re-cifra moderno), sobe o PFX convertido pro bucket `company-certificates/{uid}.pfx`, e grava `storage_key` + `cert_password` (texto puro) em `arquivos_auxiliares`.
2. **`/webhook/post-autenticacao`** — baixa o PFX convertido e faz **mTLS** contra `autenticacao.sapi.serpro.gov.br/authenticate` (`role-type: TERCEIROS`, Basic com consumer key/secret) → `{ jwt_token, access_token, expires_in }`, cacheando em `empresas_fiscais.certificado_jwt/_access_token/_token_expiration`.

**Conclusões da dissecação:**
- O certificado existe para **autenticação mTLS na SERPRO Integra Contador** (procurador de terceiros) — não para a Focus (que usa `FOCUS_NFE_TOKEN` próprio).
- O "re-encode" existe por **um único motivo**: certificados A1 brasileiros vêm com cifras PKCS#12 legadas (RC2-40 / 3DES-SHA1) que o **OpenSSL 3 (Node 17+)** recusa por padrão. O n8n contorna shelando pro `openssl -legacy`.
- O n8n foi, em essência, uma **limitação do Bubble**. Com Next/Node v22 podemos fazer tudo em processo.

**Incidente de segurança tratado (fora do escopo de código):** o export do n8n trazia secrets vivos (Supabase `service_role`, SERPRO `Consumer_Secret`, certificado real de cliente + senha). Arquivo redigido; `docs/n8n/` no `.gitignore`. **Pendente do dono:** rotacionar `service_role` do Supabase e `Consumer_Secret` da SERPRO.

## Objetivo

Aposentar o workflow n8n de certificado, trazendo **upload + autenticação mTLS SERPRO** para o Next/Node, e **endurecer a segurança em repouso**: a senha do certificado nunca mais é persistida; o material de chave fica cifrado com chave do app.

## Decisões aprovadas

1. **Migrar os dois fluxos pro Next** (upload + mTLS), aposentando o workflow n8n.
2. **Persistência = re-proteger e descartar a senha (AES-256-GCM).** No upload, abre o PFX com a senha do usuário, extrai `key+cert` PEM, **re-cifra com chave do app** e guarda o blob; a **senha original do certificado é descartada** (não persiste em lugar nenhum).
3. **node-forge** (pure-JS) para abrir o PFX legado — sem shell, sem `openssl` externo, sem arquivo temporário. Funciona apesar da política do OpenSSL 3.
4. **Sem migração de dados** — estamos em homologação, não há certificados reais. Limpar quaisquer linhas/objetos de teste.
5. **Refresh de token sob demanda** (lazy) — sem cron. Mesmo padrão do `bearer()` já existente em `serpro.ts`.

## Escopo

- `src/lib/fiscal/pkcs12.ts` (novo): parse do PFX + extração de PEM + metadados.
- `src/lib/crypto/envelope.ts` (novo): AES-256-GCM com `CERT_ENC_KEY`.
- `src/lib/clients/serpro-auth.ts` (novo): mTLS "autenticar procurador" + cache.
- `configuracoes/actions.ts`: `uploadCertificadoAction` usa o pipeline novo; remove `n8n.uploadCertificado`.
- `supabase-storage.ts`: grava/lê o blob `.enc`.
- `src/lib/clients/n8n.ts`: remove `uploadCertificado` e `postAutenticacao`.
- Migration SQL + `src/types/database.ts`: novas colunas de metadados; `cert_password` deixa de ser usado.

### Fora de escopo
- *Wire* do `certificado_jwt` cacheado nas chamadas `Declarar/Emitir/Consultar` do `serpro.ts` (gap pré-existente — o n8n também só produzia o token; não consumia). Tratar downstream.
- Demais workflows n8n (`consolidar_receitas_fiscais`, `calcular_rbt12`, `consulta_das_mei`) — permanecem.
- Credenciais Focus / registro de empresa na Focus — não fazem parte deste fluxo.
- Rotação automática de `CERT_ENC_KEY` (documentar processo manual; não automatizar agora).

## Arquitetura

### 1. `src/lib/fiscal/pkcs12.ts` (novo) — parsing PKCS#12
```ts
export type CertMaterial = {
  keyPem: string;        // chave privada
  certPem: string;       // certificado do titular
  chainPem: string;      // cadeia (intermediários), pode ser vazio
  notAfter: string;      // ISO — validade
  notBefore: string;     // ISO
  subjectCN: string;
  cnpj: string | null;   // extraído do subject/SAN quando presente
  fingerprintSha256: string;
};
export function parsePkcs12(pfx: Buffer, senha: string): CertMaterial;
```
- Usa `node-forge`: `forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(der), senha)`.
- Senha errada → `forge` lança → mapear para erro de domínio (`Senha do certificado incorreta.`).
- Lê as cifras legadas (RC2/3DES-SHA1) que o OpenSSL 3 recusa — é o motivo de usar forge em vez de `node:crypto`/`tls`.
- Extrai metadados do X.509 (validade, CN, CNPJ quando presente no subject/SAN, fingerprint SHA-256).
- **Puro** (sem `server-only`/React) → testável com vitest usando os `.pfx` de teste.

### 2. `src/lib/crypto/envelope.ts` (novo) — cifra em repouso
```ts
export function encryptBlob(plaintext: Buffer): Buffer;  // iv(12) ∥ tag(16) ∥ ciphertext
export function decryptBlob(blob: Buffer): Buffer;
```
- AES-256-GCM via `node:crypto`. Chave: `process.env.CERT_ENC_KEY` (32 bytes, base64). Ausente → lança (padrão do `N8N_WEBHOOK_SECRET`).
- `server-only`. Formato do blob auto-descritivo (`iv ∥ authTag ∥ ciphertext`).

### 3. `src/lib/clients/serpro-auth.ts` (novo) — mTLS autenticar procurador
```ts
export type ProcuradorTokens = { jwt: string; accessToken: string; expiration: string };
export async function autenticarProcurador(material: CertMaterial): Promise<ProcuradorTokens>;
```
- `https.request` com `Agent({ key: material.keyPem, cert: material.certPem + chainPem })`, host `autenticacao.sapi.serpro.gov.br`, path `/authenticate`, método POST, body `grant_type=client_credentials`.
- Headers: `Authorization: Basic base64(SERPRO_CONSUMER_KEY:SERPRO_CONSUMER_SECRET)`, `role-type: TERCEIROS`, `Content-Type: application/x-www-form-urlencoded`.
- Resposta `{ jwt_token, access_token, expires_in }` → `expiration = now + expires_in*1000` (ISO).
- `server-only`.

### 4. `configuracoes/actions.ts` — `uploadCertificadoAction` (reescrito)
1. Valida arquivo + senha (validador puro atual, `certificado.ts`).
2. Resolve `user` + `current_company` (companyId).
3. `buf = await file.arrayBuffer()`; `material = parsePkcs12(buf, senha)`.
   - Senha incorreta → `{ ok:false, error:'Senha do certificado incorreta.' }`.
   - `material.notAfter < now` → `{ ok:false, error:'Certificado expirado em <data>.' }` (bloqueia).
4. `blob = encryptBlob(Buffer.concat([keyPem, certPem, chainPem]))` (PEM concatenado, separável na leitura).
5. `storageUpload(blob, '{uid}.enc', companyId)` no bucket privado (service_role).
6. Upsert em `arquivos_auxiliares` por `unique_id_empresa = companyId`: `storage_key`, `cert_not_after`, `cert_subject_cn`, `cert_cnpj`, `cert_fingerprint`, `cert_password = null`, `updated_at`.
7. `revalidatePath('/configuracoes')`. **Não chama n8n.**
- Falha de SERPRO **não** participa do upload (auth é lazy/separada) → upload bem-sucedido independe da SERPRO no ar (mantém princípio "salva primeiro").

### 5. Auth SERPRO sob demanda
- Função (em `serpro-auth.ts` ou helper): dado `companyId`, lê `empresas_fiscais.certificado_*`; se `certificado_token_expiration` válido (com skew) → retorna cache; senão → baixa `.enc`, `decryptBlob`, separa PEM, `autenticarProcurador`, grava tokens em `empresas_fiscais`, retorna.
- Sem cron: renova quando uma chamada precisar e o cache estiver vencido.

### 6. `supabase-storage.ts` — ajuste
- `uploadCertificado(blob, '{uid}.enc', companyId)` grava o blob cifrado.
- `downloadCertificado(storageKey) → Buffer` (novo) para a auth lazy.
- Continua usando service_role; bucket permanece privado.

### 7. Banco — migration + tipos
- Migration SQL (DB é fonte de verdade [[balu-db-source-of-truth]]): `ALTER TABLE arquivos_auxiliares ADD COLUMN cert_not_after timestamptz, cert_subject_cn text, cert_cnpj text, cert_fingerprint text;`
- `cert_password` deixa de ser escrito (mantém a coluna por ora; pode virar `DROP` em PR de limpeza futura).
- Atualizar `src/types/database.ts`.

### 8. Remoção do n8n
- `n8n.ts`: remove `uploadCertificado` e `postAutenticacao`.
- Desativar/deletar os webhooks no n8n **só após** o Next validado em produção.

## Fluxo de dados
**Upload:** form → `uploadCertificadoAction` → `parsePkcs12` (valida senha/validade) → `encryptBlob` → bucket `{uid}.enc` → upsert metadados (`cert_password=null`) → revalidate.
**Auth:** chamada SERPRO precisa do JWT → cache em `empresas_fiscais` vencido? → download `.enc` → `decryptBlob` → `autenticarProcurador` (mTLS) → grava tokens → usa.

## Tratamento de erro
- Arquivo inválido / senha vazia → validador puro (toast).
- Senha incorreta → "Senha do certificado incorreta." (forge lança).
- Certificado expirado → bloqueia com data.
- `CERT_ENC_KEY` ausente → erro de configuração (lança).
- Falha de Storage → erro (upload não persiste).
- Falha de mTLS SERPRO → **não** afeta o upload; só falha no momento da auth lazy (erro propagado para o fluxo fiscal que a invocou).

## Segurança
- Senha do certificado **nunca persiste**. Material de chave cifrado AES-256-GCM.
- `CERT_ENC_KEY` no env, **fora do DB** → vazamento só do banco não expõe chave (defesa em profundidade). Supera o estado atual ([[balu-nfse-credenciais-plaintext]] continua valendo para credenciais NFS-e — fora deste escopo).
- Bucket `company-certificates` privado, acesso via service_role.
- Perder/rotacionar `CERT_ENC_KEY` ⇒ re-upload dos certificados (documentar).

## Verificação
- **vitest:** `pkcs12.test.ts` (PFX de teste em `.playwright-mcp/` → key/cert/metadados; senha errada → lança; cert expirado detectado); `envelope.test.ts` (round-trip encrypt/decrypt; key ausente → lança); `serpro-auth` com `https` mockado.
- `tsc --noEmit` zero erros.
- **Manual:** upload de `.pfx` de teste → objeto `{uid}.enc` no bucket; `arquivos_auxiliares` com metadados e `cert_password = null`; disparar auth lazy → `empresas_fiscais.certificado_*` preenchido; toast de sucesso.

## Premissas
**Confirmada:**
- `SERPRO_CONSUMER_KEY/SECRET` são **globais do Balu** (contratante), reusados de `serpro.ts`, já presentes no `.env.local`. (No n8n vinham no body, mas são as credenciais globais.)

**A verificar na implementação:**
- Endpoint/headers de autenticação SERPRO conforme o `jsCode` `autenticacao_mTLS` do workflow (`autenticacao.sapi.serpro.gov.br/authenticate`, `role-type: TERCEIROS`).
- `node-forge` abre os PFX A1 de teste sem necessidade de re-export (key+cert PEM bastam para o mTLS do Node).

## Sequência de build sugerida
1. `envelope.ts` + teste (isolado, sem deps externas).
2. `pkcs12.ts` + teste (com fixtures `.pfx`).
3. Migration + `database.ts`.
4. `supabase-storage.ts` (blob `.enc`).
5. `uploadCertificadoAction` reescrito (remove n8n).
6. `serpro-auth.ts` + auth lazy.
7. Limpeza de `n8n.ts` + remoção dos webhooks no n8n (último, pós-validação).
