# Certificado A1 sem n8n — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trazer upload de certificado A1 + autenticação mTLS SERPRO para o Next/Node, cifrando o material de chave em repouso (AES-256-GCM) e descartando a senha do certificado, aposentando o workflow n8n.

**Architecture:** No upload, `node-forge` abre o PFX legado A1 (cifras que o OpenSSL 3 recusa), extrai key+cert PEM + metadados; o PEM é re-cifrado com `CERT_ENC_KEY` e guardado como blob `.enc` no bucket privado; a senha do certificado nunca persiste. Logo após salvar, a action faz best-effort mTLS na SERPRO (`autenticacao.sapi.serpro.gov.br/authenticate`, `role-type: TERCEIROS`) e cacheia o JWT em `empresas_fiscais`. Sem cron, sem n8n.

**Tech Stack:** Next.js 15 (Server Actions, runtime nodejs), `node-forge`, `node:crypto` (AES-256-GCM), `node:https` (mTLS), Supabase (Storage + Postgres), vitest.

**Spec:** `docs/superpowers/specs/2026-05-27-certificado-next-sem-n8n-design.md`

---

## Prerequisites (uma vez, antes das tasks)

**`CERT_ENC_KEY`** — chave AES-256 (32 bytes, base64) no `.env.local` do `balu-next`. Gere com:

```bash
openssl rand -base64 32
```

Adicione a linha `CERT_ENC_KEY=<saída do comando>` em `balu-next/.env.local` (gitignored — não commitar). Perder/rotacionar essa chave exige re-upload dos certificados.

> `SERPRO_CONSUMER_KEY` / `SERPRO_CONSUMER_SECRET` já estão no `.env.local` (confirmado) e são reusados de `serpro.ts`.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `balu-next/src/lib/crypto/envelope.ts` (novo) | Cifra/decifra AES-256-GCM com `CERT_ENC_KEY`. Puro, testável. |
| `balu-next/src/lib/crypto/envelope.test.ts` (novo) | Testes do envelope. |
| `balu-next/src/lib/fiscal/pkcs12.ts` (novo) | Parse PKCS#12 via node-forge → key/cert/chain PEM + metadados. Puro, testável. |
| `balu-next/src/lib/fiscal/pkcs12.test.ts` (novo) | Testes do parse (fixture forge-gerado). |
| `balu-next/src/lib/clients/serpro-auth.ts` (novo) | mTLS "autenticar procurador" + parse da resposta. `server-only`. |
| `balu-next/src/lib/clients/serpro-auth.test.ts` (novo) | Teste do parser puro da resposta. |
| `balu-next/supabase/migrations/0003_certificado_metadata.sql` (novo) | Colunas de metadados em `arquivos_auxiliares`. |
| `balu-next/src/types/database.ts` (modificar) | Tipos das novas colunas. |
| `balu-next/src/app/(auth)/configuracoes/actions.ts` (modificar) | `uploadCertificadoAction` reescrita; remove n8n. |
| `balu-next/src/lib/clients/n8n.ts` (modificar) | Remove `uploadCertificado` e `postAutenticacao`. |
| `balu-next/src/lib/clients/supabase-storage.ts` (modificar) | Remove `fileToBase64` (era só pro n8n). |
| `balu-next/src/app/(auth)/configuracoes/page.tsx` (modificar) | Lê `cert_not_after`. |
| `balu-next/src/app/(auth)/configuracoes/CertificadoForm.tsx` (modificar) | Exibe "válido até". |

Todos os comandos rodam a partir de `balu-next/`.

---

### Task 1: Adicionar dependência node-forge

**Files:**
- Modify: `balu-next/package.json`

- [ ] **Step 1: Instalar**

Run:
```bash
cd balu-next && npm install node-forge && npm install -D @types/node-forge
```
Expected: `node-forge` em `dependencies` e `@types/node-forge` em `devDependencies` no `package.json`.

- [ ] **Step 2: Verificar typecheck ainda passa**

Run: `cd balu-next && npm run typecheck`
Expected: zero erros.

- [ ] **Step 3: Commit**

```bash
git add balu-next/package.json balu-next/package-lock.json
git commit -m "build(cert): adiciona node-forge para parse de PKCS#12 legado"
```

---

### Task 2: Envelope AES-256-GCM

**Files:**
- Create: `balu-next/src/lib/crypto/envelope.ts`
- Test: `balu-next/src/lib/crypto/envelope.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Create `balu-next/src/lib/crypto/envelope.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { encryptBlob, decryptBlob } from './envelope';

const KEY_B64 = Buffer.alloc(32, 7).toString('base64');

beforeAll(() => {
  process.env.CERT_ENC_KEY = KEY_B64;
});
afterEach(() => {
  process.env.CERT_ENC_KEY = KEY_B64; // restaura entre casos que mexem no env
});

describe('envelope AES-256-GCM', () => {
  it('round-trip: decrypt(encrypt(x)) === x', () => {
    const plain = Buffer.from('material de chave PEM', 'utf8');
    const back = decryptBlob(encryptBlob(plain));
    expect(back.equals(plain)).toBe(true);
  });

  it('detecta adulteração (GCM authTag)', () => {
    const blob = encryptBlob(Buffer.from('abc'));
    blob[blob.length - 1] ^= 0xff; // corrompe o ciphertext
    expect(() => decryptBlob(blob)).toThrow();
  });

  it('lança se CERT_ENC_KEY ausente', () => {
    delete process.env.CERT_ENC_KEY;
    expect(() => encryptBlob(Buffer.from('x'))).toThrow(/CERT_ENC_KEY/);
  });

  it('lança se a chave não decodifica para 32 bytes', () => {
    process.env.CERT_ENC_KEY = Buffer.alloc(16, 1).toString('base64');
    expect(() => encryptBlob(Buffer.from('x'))).toThrow(/32 bytes/);
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `cd balu-next && npx vitest run src/lib/crypto/envelope.test.ts`
Expected: FAIL — `Cannot find module './envelope'`.

- [ ] **Step 3: Implementar**

Create `balu-next/src/lib/crypto/envelope.ts`:
```ts
// @custom — cifra em repouso do material de certificado (AES-256-GCM).
// Puro (sem server-only) para ser testável; só lê CERT_ENC_KEY (segredo de server).
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

function key(): Buffer {
  const b64 = process.env.CERT_ENC_KEY;
  if (!b64) {
    throw new Error('CERT_ENC_KEY não configurado — cifra de certificado exige chave de 32 bytes (base64).');
  }
  const k = Buffer.from(b64, 'base64');
  if (k.length !== 32) {
    throw new Error('CERT_ENC_KEY deve decodificar para 32 bytes (AES-256).');
  }
  return k;
}

/** Retorna `iv(12) ∥ authTag(16) ∥ ciphertext`. */
export function encryptBlob(plaintext: Buffer): Buffer {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

export function decryptBlob(blob: Buffer): Buffer {
  const iv = blob.subarray(0, IV_LEN);
  const tag = blob.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = blob.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `cd balu-next && npx vitest run src/lib/crypto/envelope.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add balu-next/src/lib/crypto/envelope.ts balu-next/src/lib/crypto/envelope.test.ts
git commit -m "feat(cert): envelope AES-256-GCM para cifra do material de chave em repouso"
```

---

### Task 2.5: Setup do CERT_ENC_KEY no ambiente

**Files:** nenhum versionado (`.env.local` é gitignored).

- [ ] **Step 1: Gerar e gravar a chave**

Run:
```bash
echo "CERT_ENC_KEY=$(openssl rand -base64 32)" >> balu-next/.env.local
```
Expected: linha `CERT_ENC_KEY=...` adicionada ao `.env.local`.

- [ ] **Step 2: Confirmar (sem imprimir o valor)**

Run: `grep -c '^CERT_ENC_KEY=' balu-next/.env.local`
Expected: `1`.

> Sem commit — `.env.local` é gitignored.

---

### Task 3: Parse PKCS#12 (node-forge)

**Files:**
- Create: `balu-next/src/lib/fiscal/pkcs12.ts`
- Test: `balu-next/src/lib/fiscal/pkcs12.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Create `balu-next/src/lib/fiscal/pkcs12.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import forge from 'node-forge';
import { parsePkcs12 } from './pkcs12';

// Gera um PFX de teste (3DES — cifra legada, bom proxy do A1 real) com senha conhecida.
function makeP12(password: string, validForDays = 365): Buffer {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  const now = Date.now();
  cert.validity.notBefore = new Date(now - 86_400_000);
  cert.validity.notAfter = new Date(now + validForDays * 86_400_000);
  const attrs = [{ name: 'commonName', value: 'EMPRESA TESTE LTDA:12345678000159' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, { algorithm: '3des' });
  return Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary');
}

describe('parsePkcs12', () => {
  it('extrai key+cert PEM e metadados com a senha correta', () => {
    const pfx = makeP12('segredo');
    const m = parsePkcs12(pfx, 'segredo');
    expect(m.keyPem).toContain('BEGIN RSA PRIVATE KEY');
    expect(m.certPem).toContain('BEGIN CERTIFICATE');
    expect(m.subjectCN).toBe('EMPRESA TESTE LTDA:12345678000159');
    expect(m.cnpj).toBe('12345678000159');
    expect(new Date(m.notAfter).getTime()).toBeGreaterThan(Date.now());
    expect(m.fingerprintSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('lança com senha incorreta', () => {
    const pfx = makeP12('certo');
    expect(() => parsePkcs12(pfx, 'errado')).toThrow();
  });

  it('expõe notAfter no passado para cert expirado', () => {
    const pfx = makeP12('s', -10); // expirou há 10 dias
    const m = parsePkcs12(pfx, 's');
    expect(new Date(m.notAfter).getTime()).toBeLessThan(Date.now());
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `cd balu-next && npx vitest run src/lib/fiscal/pkcs12.test.ts`
Expected: FAIL — `Cannot find module './pkcs12'`.

- [ ] **Step 3: Implementar**

Create `balu-next/src/lib/fiscal/pkcs12.ts`:
```ts
// @custom — parse de certificado A1 (.pfx/.p12) via node-forge.
// node-forge lê as cifras PKCS#12 legadas (RC2-40/3DES-SHA1) que o OpenSSL 3 (Node 22) recusa.
// Puro (sem server-only) para ser testável.
import forge from 'node-forge';

export type CertMaterial = {
  keyPem: string;
  certPem: string;
  chainPem: string;       // intermediários concatenados; '' se não houver
  notBefore: string;      // ISO
  notAfter: string;       // ISO
  subjectCN: string;
  cnpj: string | null;    // 14 dígitos quando presente no CN (padrão e-CNPJ "NOME:CNPJ")
  fingerprintSha256: string;
};

function findPrivateKey(p12: forge.pkcs12.Pkcs12Pfx): forge.pki.PrivateKey {
  for (const oid of [forge.pki.oids.pkcs8ShroudedKeyBag, forge.pki.oids.keyBag]) {
    const bags = p12.getBags({ bagType: oid })[oid] ?? [];
    const key = bags[0]?.key;
    if (key) return key;
  }
  throw new Error('Chave privada não encontrada no certificado.');
}

export function parsePkcs12(pfx: Buffer, senha: string): CertMaterial {
  const der = forge.util.createBuffer(pfx.toString('binary'));
  const asn1 = forge.asn1.fromDer(der);
  // Senha incorreta lança "PKCS#12 MAC could not be verified. Invalid password?".
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, senha);

  const privateKey = findPrivateKey(p12);
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  if (certBags.length === 0 || !certBags[0].cert) {
    throw new Error('Certificado não encontrado no arquivo.');
  }
  const leaf = certBags[0].cert;

  const keyPem = forge.pki.privateKeyToPem(privateKey);
  const certPem = forge.pki.certificateToPem(leaf);
  const chainPem = certBags
    .slice(1)
    .map((b) => (b.cert ? forge.pki.certificateToPem(b.cert) : ''))
    .join('');

  const cn = (leaf.subject.getField('CN')?.value as string | undefined) ?? '';
  const cnpjMatch = cn.match(/(\d{14})\s*$/);

  const derCert = forge.asn1.toDer(forge.pki.certificateToAsn1(leaf)).getBytes();
  const md = forge.md.sha256.create();
  md.update(derCert);

  return {
    keyPem,
    certPem,
    chainPem,
    notBefore: leaf.validity.notBefore.toISOString(),
    notAfter: leaf.validity.notAfter.toISOString(),
    subjectCN: cn,
    cnpj: cnpjMatch ? cnpjMatch[1] : null,
    fingerprintSha256: md.digest().toHex(),
  };
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `cd balu-next && npx vitest run src/lib/fiscal/pkcs12.test.ts`
Expected: PASS (3 testes). Se algum tipo do node-forge reclamar no editor, o typecheck do passo seguinte é a fonte de verdade.

- [ ] **Step 5: typecheck**

Run: `cd balu-next && npm run typecheck`
Expected: zero erros.

- [ ] **Step 6: Commit**

```bash
git add balu-next/src/lib/fiscal/pkcs12.ts balu-next/src/lib/fiscal/pkcs12.test.ts
git commit -m "feat(cert): parse de PKCS#12 legado via node-forge (key/cert PEM + metadados)"
```

---

### Task 4: Migration + tipos das colunas de metadados

**Files:**
- Create: `balu-next/supabase/migrations/0003_certificado_metadata.sql`
- Modify: `balu-next/src/types/database.ts` (bloco `arquivos_auxiliares`, ~linhas 213-223)

- [ ] **Step 1: Escrever a migration**

Create `balu-next/supabase/migrations/0003_certificado_metadata.sql`:
```sql
-- Customização 0003: metadados do certificado A1 extraídos no upload (Next/node-forge).
-- A senha (cert_password) deixa de ser usada — o material de chave passa a ser cifrado
-- e guardado como blob .enc no Storage (ver supabase_file_path). Mantemos a coluna
-- cert_password por ora (limpeza futura) mas o app passa a gravar NULL.

alter table public.arquivos_auxiliares
  add column if not exists cert_not_after   timestamp with time zone,
  add column if not exists cert_subject_cn  text,
  add column if not exists cert_cnpj        text,
  add column if not exists cert_fingerprint text;
```

- [ ] **Step 2: Aplicar no banco (fonte de verdade)**

Aplique a migration no Supabase (CLI `supabase db push`, ou cole o SQL no SQL Editor do dashboard). Confirme que as 4 colunas existem:
```sql
select column_name from information_schema.columns
where table_name = 'arquivos_auxiliares' and column_name like 'cert_%';
```
Expected: `cert_password`, `cert_not_after`, `cert_subject_cn`, `cert_cnpj`, `cert_fingerprint`.

- [ ] **Step 3: Atualizar os tipos**

In `balu-next/src/types/database.ts`, replace the `arquivos_auxiliares` block:
```ts
  arquivos_auxiliares: {
    id: string;
    unique_id_bubble: string | null;
    unique_id_empresa: string | null;
    supabase_file_path: string | null;
    storage_key: string | null;
    cert_password: string | null;
    created_at: string | null;
    updated_at: string | null;
    deleted_at: string | null;
  };
```
with:
```ts
  arquivos_auxiliares: {
    id: string;
    unique_id_bubble: string | null;
    unique_id_empresa: string | null;
    supabase_file_path: string | null;
    storage_key: string | null;
    cert_password: string | null;
    cert_not_after: string | null;
    cert_subject_cn: string | null;
    cert_cnpj: string | null;
    cert_fingerprint: string | null;
    created_at: string | null;
    updated_at: string | null;
    deleted_at: string | null;
  };
```

- [ ] **Step 4: typecheck**

Run: `cd balu-next && npm run typecheck`
Expected: zero erros.

- [ ] **Step 5: Commit**

```bash
git add balu-next/supabase/migrations/0003_certificado_metadata.sql balu-next/src/types/database.ts
git commit -m "feat(cert): migration + tipos das colunas de metadados do certificado"
```

---

### Task 5: Cliente de autenticação SERPRO (mTLS)

**Files:**
- Create: `balu-next/src/lib/clients/serpro-auth.ts`
- Test: `balu-next/src/lib/clients/serpro-auth.test.ts`

> A chamada mTLS em si (`autenticarProcurador`) é validada manualmente (premissa do spec). O parser puro `parseAuthResponse` é o que tem teste unitário.

- [ ] **Step 1: Escrever o teste que falha**

Create `balu-next/src/lib/clients/serpro-auth.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseAuthResponse } from './serpro-auth';

describe('parseAuthResponse', () => {
  it('mapeia jwt_token/access_token/expires_in', () => {
    const t = parseAuthResponse({ jwt_token: 'JWT', access_token: 'AT', expires_in: 3600 });
    expect(t.jwt).toBe('JWT');
    expect(t.accessToken).toBe('AT');
    expect(new Date(t.expiration).getTime()).toBeGreaterThan(Date.now());
  });

  it('usa TTL default de 3600s quando expires_in ausente', () => {
    const t = parseAuthResponse({ jwt_token: 'J', access_token: 'A' });
    const deltaMs = new Date(t.expiration).getTime() - Date.now();
    expect(deltaMs).toBeGreaterThan(3_500_000);
    expect(deltaMs).toBeLessThan(3_700_000);
  });

  it('lança quando faltam tokens', () => {
    expect(() => parseAuthResponse({ foo: 'bar' })).toThrow();
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `cd balu-next && npx vitest run src/lib/clients/serpro-auth.test.ts`
Expected: FAIL — `Cannot find module './serpro-auth'`.

- [ ] **Step 3: Implementar**

Create `balu-next/src/lib/clients/serpro-auth.ts`:
```ts
// @custom — Autenticar Procurador na SERPRO Integra Contador via mTLS com o certificado A1.
// Substitui o webhook n8n /post-autenticacao. server-only (faz I/O de rede com material de chave).
import 'server-only';
import https from 'node:https';

const AUTH_HOST = 'autenticacao.sapi.serpro.gov.br';
const AUTH_PATH = '/authenticate';

export type ProcuradorTokens = { jwt: string; accessToken: string; expiration: string };

/** Parser puro da resposta do /authenticate. Testável sem rede. */
export function parseAuthResponse(raw: unknown): ProcuradorTokens {
  const r = raw as { jwt_token?: unknown; access_token?: unknown; expires_in?: unknown };
  if (!r || typeof r.jwt_token !== 'string' || typeof r.access_token !== 'string') {
    throw new Error('Resposta de autenticação SERPRO inválida (sem jwt_token/access_token).');
  }
  const ttlMs = (typeof r.expires_in === 'number' ? r.expires_in : 3600) * 1000;
  return {
    jwt: r.jwt_token,
    accessToken: r.access_token,
    expiration: new Date(Date.now() + ttlMs).toISOString(),
  };
}

/**
 * mTLS: usa key+cert do certificado da empresa como cert cliente TLS.
 * `consumer key/secret` globais do Baly via env (Basic auth), role-type TERCEIROS.
 */
export async function autenticarProcurador(keyPem: string, certPem: string): Promise<ProcuradorTokens> {
  const ck = process.env.SERPRO_CONSUMER_KEY;
  const cs = process.env.SERPRO_CONSUMER_SECRET;
  if (!ck || !cs) throw new Error('SERPRO_CONSUMER_KEY / SERPRO_CONSUMER_SECRET não configurados');

  const basic = 'Basic ' + Buffer.from(`${ck}:${cs}`).toString('base64');
  const body = 'grant_type=client_credentials';

  const raw = await new Promise<string>((resolve, reject) => {
    const req = https.request(
      {
        host: AUTH_HOST,
        path: AUTH_PATH,
        method: 'POST',
        key: keyPem,
        cert: certPem,
        headers: {
          Authorization: basic,
          'role-type': 'TERCEIROS',
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve(data));
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`SERPRO /authenticate retornou não-JSON: ${raw.slice(0, 200)}`);
  }
  return parseAuthResponse(json);
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `cd balu-next && npx vitest run src/lib/clients/serpro-auth.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add balu-next/src/lib/clients/serpro-auth.ts balu-next/src/lib/clients/serpro-auth.test.ts
git commit -m "feat(cert): cliente de autenticação SERPRO mTLS (substitui post-autenticacao do n8n)"
```

---

### Task 6: Reescrever `uploadCertificadoAction`

**Files:**
- Modify: `balu-next/src/app/(auth)/configuracoes/actions.ts` (imports + função `uploadCertificadoAction`, linhas 9-11 e 93-174)

- [ ] **Step 1: Trocar os imports do topo**

In `balu-next/src/app/(auth)/configuracoes/actions.ts`, replace:
```ts
import { uploadCertificado as storageUploadCertificado, removeCertificado as storageRemoveCertificado } from '@/lib/clients/supabase-storage';
import { n8n } from '@/lib/clients/n8n';
import { validateCertificadoUpload } from '@/lib/fiscal/certificado';
```
with:
```ts
import { uploadCertificado as storageUploadCertificado } from '@/lib/clients/supabase-storage';
import { validateCertificadoUpload } from '@/lib/fiscal/certificado';
import { parsePkcs12, type CertMaterial } from '@/lib/fiscal/pkcs12';
import { encryptBlob } from '@/lib/crypto/envelope';
import { autenticarProcurador } from '@/lib/clients/serpro-auth';
```

- [ ] **Step 2: Substituir o corpo de `uploadCertificadoAction`**

Replace the entire `uploadCertificadoAction` function (the `export async function uploadCertificadoAction(...) { ... }` block) with:
```ts
export async function uploadCertificadoAction(
  formData: FormData,
): Promise<{ ok: true; warning?: string } | { ok: false; error: string }> {
  const file = formData.get('file');
  const senha = String(formData.get('senha') ?? '');
  if (!(file instanceof File)) return { ok: false, error: 'Selecione o arquivo do certificado.' };

  const v = validateCertificadoUpload({ name: file.name, size: file.size, senha });
  if (!v.ok) return v;

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };
  const { data: profile } = await supabase
    .from('profiles')
    .select('current_company')
    .eq('user_id', user.id)
    .single();
  const companyId = (profile?.current_company ?? null) as string | null;
  if (!companyId) return { ok: false, error: 'Nenhuma empresa selecionada.' };

  // Abre o PFX legado com node-forge (valida a senha de verdade) e extrai metadados.
  const buf = Buffer.from(await file.arrayBuffer());
  let material: CertMaterial;
  try {
    material = parsePkcs12(buf, senha);
  } catch {
    return { ok: false, error: 'Não foi possível abrir o certificado. Verifique o arquivo e a senha.' };
  }
  if (new Date(material.notAfter).getTime() < Date.now()) {
    return { ok: false, error: `Certificado expirado em ${new Date(material.notAfter).toLocaleDateString('pt-BR')}.` };
  }

  // Re-cifra o material de chave (key+cert+cadeia) com a chave do app; a senha do cert é descartada.
  const blob = encryptBlob(
    Buffer.from(JSON.stringify({ keyPem: material.keyPem, certPem: material.certPem, chainPem: material.chainPem }), 'utf8'),
  );

  // Reaproveita unique_id_bubble se já existe registro pra empresa.
  const { data: existing } = await supabase
    .from('arquivos_auxiliares')
    .select('id, unique_id_bubble')
    .eq('unique_id_empresa', companyId)
    .is('deleted_at', null)
    .maybeSingle();
  const uniqueIdBubble = (existing?.unique_id_bubble as string | null) ?? crypto.randomUUID();

  let path: string;
  try {
    ({ path } = await storageUploadCertificado(blob, `${uniqueIdBubble}.enc`, companyId));
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Falha ao enviar o arquivo.' };
  }

  const row = {
    supabase_file_path: path,
    storage_key: path,
    cert_password: null,
    cert_not_after: material.notAfter,
    cert_subject_cn: material.subjectCN,
    cert_cnpj: material.cnpj,
    cert_fingerprint: material.fingerprintSha256,
    updated_at: new Date().toISOString(),
  };
  if (existing) {
    const { error } = await supabase.from('arquivos_auxiliares').update(row).eq('id', (existing as { id: string }).id);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await supabase
      .from('arquivos_auxiliares')
      .insert({ unique_id_empresa: companyId, unique_id_bubble: uniqueIdBubble, ...row });
    if (error) return { ok: false, error: error.message };
  }

  // Best-effort: autentica na SERPRO e cacheia o JWT. Falha não perde o certificado.
  let warning: string | undefined;
  try {
    const tokens = await autenticarProcurador(material.keyPem, material.certPem + material.chainPem);
    await supabase
      .from('empresas_fiscais')
      .update({
        certificado_jwt: tokens.jwt,
        certificado_access_token: tokens.accessToken,
        certificado_token_expiration: tokens.expiration,
        updated_at: new Date().toISOString(),
      })
      .eq('empresa_id', companyId);
  } catch {
    warning = 'Certificado salvo, mas a autenticação na SERPRO falhou — será refeita depois.';
  }

  revalidatePath('/configuracoes');
  return { ok: true, warning };
}
```

- [ ] **Step 3: typecheck**

Run: `cd balu-next && npm run typecheck`
Expected: zero erros. (Confirma que `n8n` e `storageRemoveCertificado` não são mais referenciados nesta action.)

- [ ] **Step 4: Rodar a suíte unitária inteira**

Run: `cd balu-next && npm test -- --run`
Expected: PASS (envelope, pkcs12, serpro-auth, certificado e demais existentes).

- [ ] **Step 5: Commit**

```bash
git add balu-next/src/app/(auth)/configuracoes/actions.ts
git commit -m "feat(cert): upload em Next — node-forge + cifra + auth SERPRO, sem n8n"
```

---

### Task 7: Limpeza do n8n e helper morto

**Files:**
- Modify: `balu-next/src/lib/clients/n8n.ts` (remove `uploadCertificado` e `postAutenticacao`)
- Modify: `balu-next/src/lib/clients/supabase-storage.ts` (remove `fileToBase64`)

- [ ] **Step 1: Remover métodos do n8n**

In `balu-next/src/lib/clients/n8n.ts`, delete these two lines from the `export const n8n = { ... }` object:
```ts
  postAutenticacao:    (p: { empresa_id: string; consumer_key: string; consumer_secret: string }) => post('/webhook/post-autenticacao', p),
  uploadCertificado:   (p: { unique_id_empresa: string; unique_id_bubble: string; file_base64: string; cert_password: string }) => post('/webhook/upload-certificado', p),
```
Keep `consolidarReceitas`, `calcularRbt12`, `consultaDasMei` (outros workflows, fora de escopo).

- [ ] **Step 2: Remover `fileToBase64` (era só pro payload n8n)**

In `balu-next/src/lib/clients/supabase-storage.ts`, delete the entire `fileToBase64` function (the block starting at the `/** Converte um File ... */` comment through its closing `}`).

- [ ] **Step 3: Confirmar que nada referencia o removido**

Run:
```bash
cd balu-next && grep -rn "n8n\.uploadCertificado\|n8n\.postAutenticacao\|fileToBase64" src/ || echo "limpo"
```
Expected: `limpo` — nenhuma chamada aos métodos n8n removidos nem ao `fileToBase64`. (O `uploadCertificado` do supabase-storage e a action `uploadCertificadoAction` permanecem e não casam com esses padrões.)

- [ ] **Step 4: typecheck**

Run: `cd balu-next && npm run typecheck`
Expected: zero erros.

- [ ] **Step 5: Commit**

```bash
git add balu-next/src/lib/clients/n8n.ts balu-next/src/lib/clients/supabase-storage.ts
git commit -m "refactor(cert): remove métodos n8n de certificado e helper fileToBase64 órfão"
```

---

### Task 8: Exibir validade do certificado na UI

**Files:**
- Modify: `balu-next/src/app/(auth)/configuracoes/page.tsx` (query do cert, ~linhas 63-71 e render ~155)
- Modify: `balu-next/src/app/(auth)/configuracoes/CertificadoForm.tsx` (props + status)

- [ ] **Step 1: Ler `cert_not_after` na page**

In `balu-next/src/app/(auth)/configuracoes/page.tsx`, replace the cert query block:
```ts
  if (active === 'certificado' && company) {
    const { data: cert } = await supabase
      .from('arquivos_auxiliares')
      .select('created_at, updated_at')
      .eq('unique_id_empresa', company.id as string)
      .is('deleted_at', null)
      .maybeSingle();
    certEnviadoEm = (cert?.updated_at as string | null) ?? (cert?.created_at as string | null) ?? null;
  }
```
with:
```ts
  let certValidoAte: string | null = null;
  if (active === 'certificado' && company) {
    const { data: cert } = await supabase
      .from('arquivos_auxiliares')
      .select('created_at, updated_at, cert_not_after')
      .eq('unique_id_empresa', company.id as string)
      .is('deleted_at', null)
      .maybeSingle();
    certEnviadoEm = (cert?.updated_at as string | null) ?? (cert?.created_at as string | null) ?? null;
    certValidoAte = (cert?.cert_not_after as string | null) ?? null;
  }
```

- [ ] **Step 2: Passar a prop no render**

In the same file, replace:
```tsx
        <CertificadoForm key={company.id as string} enviadoEm={certEnviadoEm} />
```
with:
```tsx
        <CertificadoForm key={company.id as string} enviadoEm={certEnviadoEm} validoAte={certValidoAte} />
```

- [ ] **Step 3: Aceitar e exibir a prop no form**

In `balu-next/src/app/(auth)/configuracoes/CertificadoForm.tsx`, replace the component signature:
```tsx
export default function CertificadoForm({ enviadoEm }: { enviadoEm: string | null }) {
```
with:
```tsx
export default function CertificadoForm({ enviadoEm, validoAte }: { enviadoEm: string | null; validoAte?: string | null }) {
```

Then, in the status box, replace:
```tsx
        <span className="text-zinc-700">
          {enviadoEm
            ? `Certificado enviado em ${new Date(enviadoEm).toLocaleString('pt-BR')}.`
            : 'Nenhum certificado enviado.'}
        </span>
```
with:
```tsx
        <span className="text-zinc-700">
          {enviadoEm
            ? `Certificado enviado em ${new Date(enviadoEm).toLocaleString('pt-BR')}.${
                validoAte ? ` Válido até ${new Date(validoAte).toLocaleDateString('pt-BR')}.` : ''
              }`
            : 'Nenhum certificado enviado.'}
        </span>
```

- [ ] **Step 4: typecheck**

Run: `cd balu-next && npm run typecheck`
Expected: zero erros.

- [ ] **Step 5: Commit**

```bash
git add "balu-next/src/app/(auth)/configuracoes/page.tsx" "balu-next/src/app/(auth)/configuracoes/CertificadoForm.tsx"
git commit -m "feat(cert): exibe validade do certificado na aba Certificado A1"
```

---

## Verificação final (manual)

Após todas as tasks, com a app rodando (`npm run dev`) e logado numa empresa de teste:

1. Aba **Certificado A1** → enviar um `.pfx`/`.p12` de teste + senha correta.
2. Conferir no Supabase:
   - **Storage** `company-certificates/{companyId}/{uid}.enc` existe (blob cifrado, não um PFX legível).
   - **`arquivos_auxiliares`**: linha da empresa com `supabase_file_path`/`storage_key` apontando pro `.enc`, `cert_not_after`/`cert_subject_cn`/`cert_cnpj`/`cert_fingerprint` preenchidos e **`cert_password = NULL`**.
3. Senha errada → erro "Não foi possível abrir o certificado…". Certificado expirado → erro com a data.
4. Status passa a "Certificado enviado em … Válido até …".
5. SERPRO: se as credenciais/endpoint estiverem ok, `empresas_fiscais.certificado_jwt/_access_token/_token_expiration` preenchidos; senão, toast de aviso (esperado) e o certificado **continua salvo**.
6. **Validar a premissa mTLS** com um A1 real (homologação): confirmar que `node-forge` abre o certificado real e que o `/authenticate` responde 200 — ajustar header/endpoint se a SERPRO divergir do workflow n8n.

## Pós-implementação (fora do código)
- Desativar/deletar os webhooks `upload-certificado` e `post-autenticacao` no n8n **só após** a verificação acima passar em produção.
- Rotacionar `service_role` do Supabase e `Consumer_Secret` da SERPRO (vazaram no export).
