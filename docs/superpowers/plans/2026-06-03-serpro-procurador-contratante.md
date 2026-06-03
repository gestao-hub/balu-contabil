# Fluxo procurador SERPRO com cert do contratante — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir a autenticação SERPRO para o modelo procurador — mTLS com o cert do **contratante** (fixo, único) + Termo XML assinado pelo cert da **empresa** → `/Apoiar` → `token_procurador` por empresa; ajustar o storage e o status no Diagnóstico.

**Architecture:** Tabela singleton `serpro_contratante` guarda o PFX+senha do contratante cifrados (envelope AES-GCM). No upload do cert da empresa, um helper `garantirTokenProcurador` autentica o contratante (mTLS, cache ~1h), assina o Termo com o cert da empresa, chama `/Apoiar` e persiste `serpro_token_procurador` + expiração em `empresas_fiscais`. O Diagnóstico passa a refletir esse token e exibe um gate quando o contratante não está configurado.

**Tech Stack:** Next.js 15 (Server Actions), Supabase (service_role via `createAdminClient`), `node-forge` (PFX), `xml-crypto` (XMLDSig), `node:https` (mTLS), Vitest (unit). Spec: `docs/superpowers/specs/2026-06-03-serpro-procurador-contratante-design.md`.

**Convenções do projeto:**
- Diretório de trabalho do app: `app/`. Rodar comandos de dentro de `app/`.
- Schema real é `docs/reference/db_atual.sql` (migrations defasadas — atualizar AMBOS).
- Testes unit: `npx vitest run <arquivo>` (config em `app/vitest.config.ts`, alias `@` → `src`).
- `tsc`: `npx tsc --noEmit`. NÃO rodar `npm run build` com `next dev` ativo.
- Cifra: `encryptBlob(Buffer): Buffer` / `decryptBlob(Buffer): Buffer` em `src/lib/crypto/envelope.ts` (lê `CERT_ENC_KEY`). Para colunas `text`, guardar `.toString('base64')`.

---

## File Structure

**Criar:**
- `app/supabase/migrations/0017_serpro_contratante_e_token_procurador.sql` — tabela singleton + colunas + RLS
- `app/src/lib/fiscal/serpro-expiracao.ts` — cálculo puro da expiração do token (meia-noite SP)
- `app/src/lib/fiscal/serpro-expiracao.test.ts`
- `app/src/lib/fiscal/serpro-termo.ts` — build + sign do Termo XML (puro)
- `app/src/lib/fiscal/serpro-termo.test.ts`
- `app/src/lib/fiscal/serpro-contratante.ts` — server-only: lê singleton + garante auth do contratante
- `app/src/lib/fiscal/serpro-procurador.ts` — server-only: `garantirTokenProcurador` (orquestrador)
- `app/scripts/seed-serpro-contratante.mjs` — provisiona o singleton (manual)

**Modificar:**
- `app/src/lib/clients/serpro-auth.ts` — `autenticarContratante(pfx, passphrase)` (era `autenticarProcurador(keyPem, certPem)`)
- `app/src/lib/clients/serpro.ts` — `+ parseApoiarToken()` (puro) e `+ enviarTermoApoiar()` (mTLS https.request)
- `app/src/lib/clients/serpro.test.ts` (criar se não existir) — teste de `parseApoiarToken`
- `app/src/app/(auth)/configuracoes/actions.ts` — `uploadCertificadoAction` usa `garantirTokenProcurador`
- `app/src/lib/fiscal/saude-empresa.ts` — `SaudeState.contratanteConfigurado` + gate no `serproCheck`
- `app/src/lib/fiscal/saude-empresa.test.ts` — `BASE.contratanteConfigurado` + casos novos
- `app/src/app/(auth)/configuracoes/page.tsx` — loader lê coluna nova + presença do contratante
- `docs/reference/db_atual.sql` — refletir migration 0017

---

## Task 1: Migration + schema dump

**Files:**
- Create: `app/supabase/migrations/0017_serpro_contratante_e_token_procurador.sql`
- Modify: `docs/reference/db_atual.sql`

- [ ] **Step 1: Escrever a migration**

Create `app/supabase/migrations/0017_serpro_contratante_e_token_procurador.sql`:

```sql
-- 0017: fluxo procurador SERPRO com cert do contratante.
-- (a) tabela singleton com cert+senha do contratante (cifrados) e cache do /authenticate;
-- (b) colunas do token_procurador por empresa em empresas_fiscais.

CREATE TABLE IF NOT EXISTS public.serpro_contratante (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    cnpj character varying(20) NOT NULL,
    nome text,
    cert_pfx_enc text NOT NULL,            -- PFX cru, cifrado (envelope AES-GCM, CERT_ENC_KEY), base64
    cert_password_enc text NOT NULL,       -- senha do PFX, cifrada (envelope AES-GCM), base64
    cert_not_after timestamp with time zone,
    cert_subject_cn text,
    auth_access_token text,                -- cache do /authenticate (~1h)
    auth_jwt_token text,
    auth_token_expiration timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- Singleton: no máximo 1 linha.
CREATE UNIQUE INDEX IF NOT EXISTS serpro_contratante_singleton
    ON public.serpro_contratante ((true));

-- RLS ligada SEM policies → só service_role (que bypassa RLS) acessa.
ALTER TABLE public.serpro_contratante ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.empresas_fiscais
    ADD COLUMN IF NOT EXISTS serpro_token_procurador text,
    ADD COLUMN IF NOT EXISTS serpro_token_procurador_expiration timestamp with time zone;
```

- [ ] **Step 2: Refletir no dump do schema**

Em `docs/reference/db_atual.sql`, logo após o bloco `CREATE TABLE public.empresas_fiscais (...)` (termina na linha com `empresa_fiscal_ativada boolean\n);`), adicione as duas colunas dentro do `CREATE TABLE` — insira antes do `);` final do bloco:

```sql
    empresa_fiscal_ativada boolean,
    serpro_token_procurador text,
    serpro_token_procurador_expiration timestamp with time zone
);
```

(ou seja: troque a vírgula/fechamento atual de `empresa_fiscal_ativada boolean` para incluir as duas novas colunas). E adicione o `CREATE TABLE public.serpro_contratante` junto às outras tabelas (após o bloco `empresas_fiscais`), com as mesmas colunas do Step 1.

- [ ] **Step 3: Aplicar a migration no banco hospedado**

A aplicação real no Supabase é manual (ver memória `balu-db-source-of-truth`). Marque para rodar o SQL do Step 1 no SQL editor do Supabase. Não bloqueia o resto do plano (código novo só lê/escreve as colunas quando exercitado).

- [ ] **Step 4: Commit**

```bash
cd /home/allan/Projetos/claude/balu
git add app/supabase/migrations/0017_serpro_contratante_e_token_procurador.sql docs/reference/db_atual.sql
git commit -m "feat(serpro): migration 0017 — tabela serpro_contratante + colunas token_procurador"
```

---

## Task 2: Cálculo puro da expiração (meia-noite São Paulo)

**Files:**
- Create: `app/src/lib/fiscal/serpro-expiracao.ts`
- Test: `app/src/lib/fiscal/serpro-expiracao.test.ts`

Regra da doc oficial: o `token_procurador` vale **até a meia-noite do dia seguinte** (Brasília, UTC-3 fixo). Expira no `00:00` do dia seguinte ao da geração, em SP.

- [ ] **Step 1: Escrever o teste (falhando)**

Create `app/src/lib/fiscal/serpro-expiracao.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { proximaMeiaNoiteSaoPaulo } from './serpro-expiracao';

describe('proximaMeiaNoiteSaoPaulo', () => {
  it('gerado 00:05 SP → expira ~24h depois (00:00 SP do dia seguinte)', () => {
    // 2026-06-03T03:05:00Z == 00:05 em SP (UTC-3) no dia 03
    const exp = proximaMeiaNoiteSaoPaulo(new Date('2026-06-03T03:05:00Z'));
    expect(exp).toBe('2026-06-04T03:00:00.000Z'); // 00:00 SP do dia 04
  });

  it('gerado 23:00 SP → expira ~1h depois (mesma virada de dia)', () => {
    // 2026-06-04T02:00:00Z == 23:00 em SP no dia 03
    const exp = proximaMeiaNoiteSaoPaulo(new Date('2026-06-04T02:00:00Z'));
    expect(exp).toBe('2026-06-04T03:00:00.000Z'); // 00:00 SP do dia 04
  });

  it('vira o mês corretamente', () => {
    // 2026-06-30T12:00:00Z == 09:00 SP do dia 30/06
    const exp = proximaMeiaNoiteSaoPaulo(new Date('2026-06-30T12:00:00Z'));
    expect(exp).toBe('2026-07-01T03:00:00.000Z'); // 00:00 SP do dia 01/07
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd app && npx vitest run src/lib/fiscal/serpro-expiracao.test.ts`
Expected: FAIL — `Failed to resolve import "./serpro-expiracao"`.

- [ ] **Step 3: Implementar**

Create `app/src/lib/fiscal/serpro-expiracao.ts`:

```ts
// Puro (sem server-only) — testável. Calcula a expiração do autenticar_procurador_token.
// Regra oficial Serpro: "o token válido fica disponível até a meia-noite do dia seguinte"
// (horário de Brasília, UTC-3 fixo desde 2019 — sem horário de verão).

const SP_OFFSET_MS = 3 * 60 * 60 * 1000; // UTC-3

/**
 * Retorna (ISO) o instante 00:00 do dia seguinte ao da geração, em São Paulo.
 * Gerou 00:05 → ~24h; gerou 23:00 → ~1h. Determinístico via `now` injetável.
 */
export function proximaMeiaNoiteSaoPaulo(now: Date = new Date()): string {
  // Desloca pra "relógio de parede" de SP tratando como UTC para extrair a data local.
  const sp = new Date(now.getTime() - SP_OFFSET_MS);
  const y = sp.getUTCFullYear();
  const m = sp.getUTCMonth();
  const d = sp.getUTCDate();
  // 00:00 SP do dia seguinte, expresso como wall-clock; volta pra UTC somando o offset.
  const wallNextMidnight = Date.UTC(y, m, d + 1, 0, 0, 0, 0);
  return new Date(wallNextMidnight + SP_OFFSET_MS).toISOString();
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd app && npx vitest run src/lib/fiscal/serpro-expiracao.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/fiscal/serpro-expiracao.ts app/src/lib/fiscal/serpro-expiracao.test.ts
git commit -m "feat(serpro): helper puro proximaMeiaNoiteSaoPaulo (expiração do token_procurador)"
```

---

## Task 3: Build + assinatura do Termo XML

**Files:**
- Create: `app/src/lib/fiscal/serpro-termo.ts`
- Test: `app/src/lib/fiscal/serpro-termo.test.ts`

Extraído do spike `app/scripts/test-serpro-procurador-al-piscinas.mjs` (funções `buildTermo` + `signTermo`), agora em TS testável. `signTermoXml` aceita apenas `keyPem` + `certPem` (deriva o DER base64 do PEM por string-strip — sem dependência extra).

- [ ] **Step 1: Escrever o teste (falhando)**

Create `app/src/lib/fiscal/serpro-termo.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { buildTermoXml, signTermoXml } from './serpro-termo';

// Gera um par de chaves + um "certPem" sintético (PEM qualquer) só para exercitar a assinatura.
// XMLDSig aqui não valida a cadeia — só precisamos de uma key RSA e um PEM com corpo base64.
function fakeCertPem(): string {
  const body = Buffer.from('cert-de-teste').toString('base64');
  return `-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----\n`;
}

describe('buildTermoXml', () => {
  const xml = buildTermoXml({
    destinatario: { cnpj: '61061690000183', nome: 'PIPER LTDA' },
    autor: { cnpj: '10358425000120', nome: 'AL PISCINAS LTDA' },
    hoje: new Date('2026-06-03T12:00:00Z'),
  });

  it('põe o contratante como destinatário e a empresa como autor', () => {
    expect(xml).toContain('numero="61061690000183"');
    expect(xml).toContain('papel="contratante"');
    expect(xml).toContain('numero="10358425000120"');
    expect(xml).toContain('papel="autor pedido de dados"');
  });

  it('tem dataAssinatura e vigencia no formato YYYYMMDD', () => {
    expect(xml).toContain('data="20260603"'); // dataAssinatura
    expect(xml).toMatch(/vigencia data="\d{8}"/);
  });
});

describe('signTermoXml', () => {
  it('produz uma assinatura enveloped com X509Certificate', () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    const xml = buildTermoXml({
      destinatario: { cnpj: '61061690000183', nome: 'PIPER LTDA' },
      autor: { cnpj: '10358425000120', nome: 'AL PISCINAS LTDA' },
      hoje: new Date('2026-06-03T12:00:00Z'),
    });
    const signed = signTermoXml(xml, { keyPem, certPem: fakeCertPem() });
    expect(signed).toMatch(/<(\w+:)?Signature/);
    expect(signed).toContain('<X509Certificate>');
    expect(signed).toContain(Buffer.from('cert-de-teste').toString('base64'));
  });

  // garante que a referência funciona: usar createSign manualmente não é necessário —
  // só validamos que o xml-crypto inseriu o bloco de assinatura no nó certo.
  it('mantém o elemento termoDeAutorizacao', () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    const xml = buildTermoXml({
      destinatario: { cnpj: '1', nome: 'A' },
      autor: { cnpj: '2', nome: 'B' },
      hoje: new Date('2026-06-03T12:00:00Z'),
    });
    const signed = signTermoXml(xml, { keyPem, certPem: fakeCertPem() });
    expect(signed).toContain('termoDeAutorizacao');
  });
});
```

(O `createSign` import é tolerado mesmo sem uso direto; se o linter reclamar, remova-o.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd app && npx vitest run src/lib/fiscal/serpro-termo.test.ts`
Expected: FAIL — `Failed to resolve import "./serpro-termo"`.

- [ ] **Step 3: Implementar**

Create `app/src/lib/fiscal/serpro-termo.ts`:

```ts
// Termo de Autorização SERPRO (AUTENTICAPROCURADOR/ENVIOXMLASSINADO81).
// Build + assinatura XMLDSig (RSA-SHA256, c14n 1.0 inclusiva). Puro/testável.
// Extraído do spike app/scripts/test-serpro-procurador-al-piscinas.mjs.
import { SignedXml } from 'xml-crypto';

export type TermoParte = { cnpj: string; nome: string };

const ymd = (d: Date) =>
  `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;

const TERMO =
  'Autorizo a empresa CONTRATANTE, identificada neste termo de autorização como DESTINATÁRIO, a executar as requisições dos serviços web disponibilizados pela API INTEGRA CONTADOR, onde terei o papel de AUTOR PEDIDO DE DADOS no corpo da mensagem enviada na requisição do serviço web. Esse termo de autorização está assinado digitalmente com o certificado digital do PROCURADOR ou OUTORGADO DO CONTRIBUINTE responsável, identificado como AUTOR DO PEDIDO DE DADOS.';
const AVISO =
  'O acesso a estas informações foi autorizado pelo próprio PROCURADOR ou OUTORGADO DO CONTRIBUINTE, responsável pela informação, via assinatura digital. É dever do destinatário da autorização e consumidor deste acesso observar a adoção de base legal para o tratamento dos dados recebidos conforme artigos 7º ou 11º da LGPD (Lei n.º 13.709, de 14 de agosto de 2018), aos direitos do titular dos dados (art. 9º, 17 e 18, da LGPD) e aos princípios que norteiam todos os tratamentos de dados no Brasil (art. 6º, da LGPD).';
const FINAL =
  'A finalidade única e exclusiva desse TERMO DE AUTORIZAÇÃO, é garantir que o CONTRATANTE apresente a API INTEGRA CONTADOR esse consentimento do PROCURADOR ou OUTORGADO DO CONTRIBUINTE assinado digitalmente, para que possa realizar as requisições dos serviços web da API INTEGRA CONTADOR em nome do AUTOR PEDIDO DE DADOS (PROCURADOR ou OUTORGADO DO CONTRIBUINTE).';

/** Monta o XML do Termo (destinatário=contratante, assinadoPor=autor/empresa). */
export function buildTermoXml(params: {
  destinatario: TermoParte;
  autor: TermoParte;
  hoje?: Date;
  vigenciaDias?: number;
}): string {
  const hoje = params.hoje ?? new Date();
  const vig = new Date(hoje.getTime());
  vig.setUTCDate(vig.getUTCDate() + (params.vigenciaDias ?? 365));
  const d = params.destinatario;
  const a = params.autor;
  return `<?xml version="1.0" encoding="UTF-8"?><termoDeAutorizacao><dados><sistema id="API Integra Contador"/><termo texto="${TERMO}"/><avisoLegal texto="${AVISO}"/><finalidade texto="${FINAL}"/><dataAssinatura data="${ymd(hoje)}"/><vigencia data="${ymd(vig)}"/><destinatario numero="${d.cnpj}" nome="${d.nome}" tipo="PJ" papel="contratante"/><assinadoPor numero="${a.cnpj}" nome="${a.nome}" tipo="PJ" papel="autor pedido de dados"/></dados></termoDeAutorizacao>`;
}

/** DER base64 a partir do PEM (corpo entre os marcadores, sem espaços). */
function certPemToDerB64(certPem: string): string {
  return certPem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
}

/** Assina o Termo (XMLDSig enveloped, RSA-SHA256) com a chave da empresa. */
export function signTermoXml(xml: string, signer: { keyPem: string; certPem: string }): string {
  const certDerB64 = certPemToDerB64(signer.certPem);
  const sig = new SignedXml({
    privateKey: signer.keyPem,
    publicCert: signer.certPem,
    signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
  });
  sig.addReference({
    xpath: "//*[local-name(.)='termoDeAutorizacao']",
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    ],
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    uri: '',
    isEmptyUri: true,
  });
  sig.getKeyInfoContent = () => `<X509Data><X509Certificate>${certDerB64}</X509Certificate></X509Data>`;
  sig.computeSignature(xml, {
    location: { reference: "//*[local-name(.)='termoDeAutorizacao']", action: 'append' },
  });
  return sig.getSignedXml();
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd app && npx vitest run src/lib/fiscal/serpro-termo.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/fiscal/serpro-termo.ts app/src/lib/fiscal/serpro-termo.test.ts
git commit -m "feat(serpro): serpro-termo (build + assinatura XMLDSig do Termo de Autorização)"
```

---

## Task 4: Reescrever serpro-auth → autenticarContratante

**Files:**
- Modify: `app/src/lib/clients/serpro-auth.ts`

O mTLS agora usa o **PFX do contratante** (não mais key/cert PEM da empresa). `parseAuthResponse` é mantido (já tem teste no arquivo `serpro-auth.test.ts`, se existir; senão não há regressão).

- [ ] **Step 1: Reescrever a função de autenticação**

Substitua a função `autenticarProcurador` (linhas ~25-79) por `autenticarContratante`, mantendo `parseAuthResponse` e o tipo `ProcuradorTokens`:

```ts
/**
 * mTLS com o PFX do CONTRATANTE (cert fixo da Balu). Consumer key/secret globais via env.
 * role-type TERCEIROS (modelo software-house / Termo de Autorização).
 */
export async function autenticarContratante(pfx: Buffer, passphrase: string): Promise<ProcuradorTokens> {
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
        pfx,
        passphrase,
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
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`SERPRO /authenticate → ${res.statusCode}: ${data.slice(0, 200)}`));
          } else {
            resolve(data);
          }
        });
      },
    );
    req.setTimeout(10_000, () => req.destroy(new Error('SERPRO /authenticate: timeout (10s).')));
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

Atualize o comentário do topo do arquivo de "via mTLS com o certificado A1" para "via mTLS com o certificado do contratante".

- [ ] **Step 2: Conferir tipos**

Run: `cd app && npx tsc --noEmit 2>&1 | grep -E "serpro-auth|autenticarProcurador" || echo "sem erros nesse arquivo (ainda há callers a ajustar nas próximas tasks)"`
Expected: o único erro restante é em `configuracoes/actions.ts` (caller antigo) — será corrigido na Task 8. Se `serpro-auth.test.ts` existir e só testar `parseAuthResponse`, segue passando.

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/clients/serpro-auth.ts
git commit -m "refactor(serpro): autenticarContratante usa PFX do contratante no mTLS"
```

---

## Task 5: serpro.ts — parseApoiarToken + enviarTermoApoiar

**Files:**
- Modify: `app/src/lib/clients/serpro.ts`
- Test: `app/src/lib/clients/serpro.test.ts` (criar)

O `/Apoiar` é mTLS (como o spike) → usa `https.request` com o PFX do contratante (NÃO o `fetch` do `call()`). Extraímos a leitura do token num helper puro testável.

- [ ] **Step 1: Escrever o teste (falhando)**

Create `app/src/lib/clients/serpro.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseApoiarToken } from './serpro';

describe('parseApoiarToken', () => {
  it('extrai de dados.autenticar_procurador_token (corpo 200)', () => {
    const body = JSON.stringify({ dados: JSON.stringify({ autenticar_procurador_token: 'tok-123' }) });
    expect(parseApoiarToken(body, undefined)).toBe('tok-123');
  });

  it('extrai de autenticarProcuradorToken no topo do JSON', () => {
    const body = JSON.stringify({ autenticarProcuradorToken: 'tok-abc' });
    expect(parseApoiarToken(body, undefined)).toBe('tok-abc');
  });

  it('cai pro ETag quando o corpo não traz token (304)', () => {
    const etag = '"autenticar_procurador_token:tok-etag"';
    expect(parseApoiarToken('', etag)).toBe('tok-etag');
  });

  it('retorna null quando não há token', () => {
    expect(parseApoiarToken('{}', undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd app && npx vitest run src/lib/clients/serpro.test.ts`
Expected: FAIL — `parseApoiarToken` não exportado.

- [ ] **Step 3: Implementar no serpro.ts**

Em `app/src/lib/clients/serpro.ts`, adicione (após o `export const serpro = {...}`):

```ts
import https from 'node:https';

/** Lê o autenticar_procurador_token do corpo (200) ou do ETag (304). Puro. */
export function parseApoiarToken(body: string, etag: string | undefined): string | null {
  try {
    const j = JSON.parse(body) as { dados?: string; autenticarProcuradorToken?: string };
    const d = j.dados ? (JSON.parse(j.dados) as { autenticar_procurador_token?: string }) : {};
    const tok = d.autenticar_procurador_token || j.autenticarProcuradorToken || null;
    if (tok) return tok;
  } catch {
    // corpo vazio/não-JSON → tenta ETag abaixo
  }
  if (etag) {
    const m = String(etag).match(/autenticar_procurador_token:([^"]+)/);
    if (m) return m[1];
  }
  return null;
}

/**
 * POST /Apoiar (AUTENTICAPROCURADOR/ENVIOXMLASSINADO81) em produção, mTLS com o cert do contratante.
 * Devolve o autenticar_procurador_token. Lança em status >= 400.
 */
export async function enviarTermoApoiar(params: {
  pfx: Buffer;
  passphrase: string;
  accessToken: string;
  jwt: string;
  envelope: Envelope;
}): Promise<string> {
  const body = JSON.stringify(params.envelope);
  const { status, body: respBody, etag } = await new Promise<{ status: number; body: string; etag?: string }>(
    (resolve, reject) => {
      const req = https.request(
        {
          host: 'gateway.apiserpro.serpro.gov.br',
          path: '/integra-contador/v1/Apoiar',
          method: 'POST',
          pfx: params.pfx,
          passphrase: params.passphrase,
          headers: {
            Authorization: `Bearer ${params.accessToken}`,
            jwt_token: params.jwt,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          let d = '';
          res.on('data', (c) => (d += c));
          res.on('end', () =>
            resolve({ status: res.statusCode ?? 0, body: d, etag: res.headers.etag as string | undefined }),
          );
        },
      );
      req.setTimeout(25_000, () => req.destroy(new Error('SERPRO /Apoiar: timeout (25s).')));
      req.on('error', reject);
      req.write(body);
      req.end();
    },
  );
  if (status >= 400) throw new Error(`SERPRO /Apoiar → ${status}: ${respBody.slice(0, 200)}`);
  const token = parseApoiarToken(respBody, etag);
  if (!token) throw new Error(`SERPRO /Apoiar não retornou autenticar_procurador_token: ${respBody.slice(0, 200)}`);
  return token;
}
```

> O `Envelope` já é um tipo do módulo (usado em `buildEnvelope`/`call`). Se não estiver exportado, exporte-o (`export type Envelope = ...`) para uso na assinatura acima.

- [ ] **Step 4: Rodar e ver passar**

Run: `cd app && npx vitest run src/lib/clients/serpro.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/clients/serpro.ts app/src/lib/clients/serpro.test.ts
git commit -m "feat(serpro): enviarTermoApoiar (mTLS /Apoiar) + parseApoiarToken"
```

---

## Task 6: serpro-contratante (server-only) — ler singleton + garantir auth

**Files:**
- Create: `app/src/lib/fiscal/serpro-contratante.ts`

Lê o singleton via `createAdminClient` (tabela é service-role-only), decifra PFX+senha, e garante um par `access_token`/`jwt` válido (re-autentica se o cache expirou). Sem teste de rede; coberto por `tsc` + smoke manual.

- [ ] **Step 1: Implementar**

Create `app/src/lib/fiscal/serpro-contratante.ts`:

```ts
import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { decryptBlob, encryptBlob } from '@/lib/crypto/envelope';
import { autenticarContratante } from '@/lib/clients/serpro-auth';
import { isInFutureISO } from '@/lib/fiscal/saude-empresa';

export type Contratante = {
  id: string;
  cnpj: string;
  nome: string;
  pfx: Buffer;
  senha: string;
  authAccessToken: string | null;
  authJwt: string | null;
  authExpiration: string | null;
};

/** Lê o singleton e decifra PFX+senha. Retorna null se não houver contratante configurado. */
export async function getContratante(): Promise<Contratante | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('serpro_contratante')
    .select('id, cnpj, nome, cert_pfx_enc, cert_password_enc, auth_access_token, auth_jwt_token, auth_token_expiration')
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const pfx = decryptBlob(Buffer.from(data.cert_pfx_enc as string, 'base64'));
  const senha = decryptBlob(Buffer.from(data.cert_password_enc as string, 'base64')).toString('utf8');
  return {
    id: data.id as string,
    cnpj: data.cnpj as string,
    nome: (data.nome as string | null) ?? '',
    pfx,
    senha,
    authAccessToken: (data.auth_access_token as string | null) ?? null,
    authJwt: (data.auth_jwt_token as string | null) ?? null,
    authExpiration: (data.auth_token_expiration as string | null) ?? null,
  };
}

/** Helper de provisionamento/seed: cifra e faz upsert do singleton. */
export async function upsertContratante(params: {
  cnpj: string;
  nome: string;
  pfx: Buffer;
  senha: string;
  certNotAfter: string | null;
  certSubjectCn: string | null;
}): Promise<void> {
  const admin = createAdminClient();
  const { data: existing } = await admin.from('serpro_contratante').select('id').limit(1).maybeSingle();
  const row = {
    cnpj: params.cnpj,
    nome: params.nome,
    cert_pfx_enc: encryptBlob(params.pfx).toString('base64'),
    cert_password_enc: encryptBlob(Buffer.from(params.senha, 'utf8')).toString('base64'),
    cert_not_after: params.certNotAfter,
    cert_subject_cn: params.certSubjectCn,
    updated_at: new Date().toISOString(),
  };
  if (existing) {
    const { error } = await admin.from('serpro_contratante').update(row).eq('id', (existing as { id: string }).id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await admin.from('serpro_contratante').insert(row);
    if (error) throw new Error(error.message);
  }
}

/**
 * Garante um par access_token/jwt válido do contratante. Reusa o cache (~1h) ou re-autentica
 * via mTLS e atualiza o singleton. Devolve também pfx/senha para uso no /Apoiar.
 */
export async function garantirAuthContratante(): Promise<{
  accessToken: string;
  jwt: string;
  pfx: Buffer;
  passphrase: string;
  cnpj: string;
  nome: string;
} | null> {
  const c = await getContratante();
  if (!c) return null;

  const SKEW_MS = 60 * 1000;
  if (c.authAccessToken && c.authJwt && isInFutureISO(c.authExpiration, new Date(), SKEW_MS)) {
    return { accessToken: c.authAccessToken, jwt: c.authJwt, pfx: c.pfx, passphrase: c.senha, cnpj: c.cnpj, nome: c.nome };
  }

  const tokens = await autenticarContratante(c.pfx, c.senha);
  const admin = createAdminClient();
  await admin
    .from('serpro_contratante')
    .update({
      auth_access_token: tokens.accessToken,
      auth_jwt_token: tokens.jwt,
      auth_token_expiration: tokens.expiration,
      updated_at: new Date().toISOString(),
    })
    .eq('id', c.id);
  return { accessToken: tokens.accessToken, jwt: tokens.jwt, pfx: c.pfx, passphrase: c.senha, cnpj: c.cnpj, nome: c.nome };
}
```

- [ ] **Step 2: Conferir tipos**

Run: `cd app && npx tsc --noEmit 2>&1 | grep "serpro-contratante" || echo "ok"`
Expected: `ok` (sem erros nesse arquivo).

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/fiscal/serpro-contratante.ts
git commit -m "feat(serpro): serpro-contratante (singleton: ler/decifrar + garantir auth + upsert)"
```

---

## Task 7: serpro-procurador — garantirTokenProcurador (orquestrador)

**Files:**
- Create: `app/src/lib/fiscal/serpro-procurador.ts`

Orquestra: garante auth do contratante → assina Termo com cert da empresa → `/Apoiar` → persiste token. Idempotente (reusa token vigente). Aceita `material` em memória (upload) ou lê do Storage.

- [ ] **Step 1: Implementar**

Create `app/src/lib/fiscal/serpro-procurador.ts`:

```ts
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { downloadCertificado } from '@/lib/clients/supabase-storage';
import { decryptBlob } from '@/lib/crypto/envelope';
import { garantirAuthContratante } from '@/lib/fiscal/serpro-contratante';
import { buildTermoXml, signTermoXml } from '@/lib/fiscal/serpro-termo';
import { proximaMeiaNoiteSaoPaulo } from '@/lib/fiscal/serpro-expiracao';
import { enviarTermoApoiar } from '@/lib/clients/serpro';
import { Tipo } from '@/lib/clients/serpro';
import { isInFutureISO } from '@/lib/fiscal/saude-empresa';

type Material = { keyPem: string; certPem: string; cnpj: string | null; nome: string };
type Result = { ok: true; token: string; expiration: string } | { ok: false; warning: string };

/**
 * Garante um autenticar_procurador_token válido para a empresa. Idempotente: se o token
 * persistido ainda estiver no futuro, devolve sem chamar a SERPRO.
 * `material` opcional evita o round-trip de Storage no fluxo de upload.
 */
export async function garantirTokenProcurador(
  supabase: SupabaseClient,
  companyId: string,
  material?: Material,
): Promise<Result> {
  // 1. Token vigente? (idempotência)
  const { data: fiscal } = await supabase
    .from('empresas_fiscais')
    .select('serpro_token_procurador, serpro_token_procurador_expiration, cnpj')
    .eq('empresa_id', companyId)
    .is('deleted_at', null)
    .maybeSingle();

  if (
    fiscal?.serpro_token_procurador &&
    isInFutureISO(fiscal.serpro_token_procurador_expiration as string | null, new Date(), 60 * 1000)
  ) {
    return {
      ok: true,
      token: fiscal.serpro_token_procurador as string,
      expiration: fiscal.serpro_token_procurador_expiration as string,
    };
  }

  // 2. Material da empresa (memória no upload, senão Storage).
  let mat = material;
  if (!mat) {
    const admin = createAdminClient();
    const { data: aux } = await admin
      .from('arquivos_auxiliares')
      .select('storage_key, cert_cnpj, cert_subject_cn')
      .eq('company_id', companyId)
      .is('deleted_at', null)
      .maybeSingle();
    if (!aux?.storage_key) return { ok: false, warning: 'Certificado da empresa não encontrado.' };
    let pemJson: { keyPem: string; certPem: string };
    try {
      const blob = await downloadCertificado(aux.storage_key as string);
      pemJson = JSON.parse(decryptBlob(blob).toString('utf8'));
    } catch {
      return { ok: false, warning: 'Falha ao ler o certificado da empresa.' };
    }
    mat = {
      keyPem: pemJson.keyPem,
      certPem: pemJson.certPem,
      cnpj: (aux.cert_cnpj as string | null) ?? (fiscal?.cnpj as string | null) ?? null,
      nome: (aux.cert_subject_cn as string | null) ?? '',
    };
  }
  const empresaCnpj = (mat.cnpj ?? (fiscal?.cnpj as string | null) ?? '').replace(/\D+/g, '');
  if (!empresaCnpj) return { ok: false, warning: 'CNPJ da empresa ausente no certificado.' };

  // 3. Auth do contratante (mTLS, cache).
  const auth = await garantirAuthContratante();
  if (!auth) return { ok: false, warning: 'Configure o certificado do contratante (SERPRO) para ativar a geração de guias.' };

  // 4. Termo XML assinado pela empresa.
  let token: string;
  try {
    const xml = buildTermoXml({
      destinatario: { cnpj: auth.cnpj, nome: auth.nome },
      autor: { cnpj: empresaCnpj, nome: mat.nome },
    });
    const signed = signTermoXml(xml, { keyPem: mat.keyPem, certPem: mat.certPem });
    const xmlB64 = Buffer.from(signed, 'utf8').toString('base64');

    // 5. /Apoiar
    token = await enviarTermoApoiar({
      pfx: auth.pfx,
      passphrase: auth.passphrase,
      accessToken: auth.accessToken,
      jwt: auth.jwt,
      envelope: {
        contratante: { numero: auth.cnpj, tipo: Tipo.CNPJ },
        autorPedidoDados: { numero: empresaCnpj, tipo: Tipo.CNPJ },
        contribuinte: { numero: empresaCnpj, tipo: Tipo.CNPJ },
        pedidoDados: {
          idSistema: 'AUTENTICAPROCURADOR',
          idServico: 'ENVIOXMLASSINADO81',
          versaoSistema: '1.0',
          dados: JSON.stringify({ xml: xmlB64 }),
        },
      },
    });
  } catch (e) {
    return { ok: false, warning: `Autenticação SERPRO (procurador) falhou — será refeita depois: ${e instanceof Error ? e.message.slice(0, 160) : ''}` };
  }

  // 6. Persiste.
  const expiration = proximaMeiaNoiteSaoPaulo();
  await supabase
    .from('empresas_fiscais')
    .update({
      serpro_token_procurador: token,
      serpro_token_procurador_expiration: expiration,
      updated_at: new Date().toISOString(),
    })
    .eq('empresa_id', companyId);

  return { ok: true, token, expiration };
}
```

- [ ] **Step 2: Verificar dependências citadas**

Confirme que existe `downloadCertificado(path: string): Promise<Buffer>` em `src/lib/clients/supabase-storage.ts`. Se o nome diferir:

Run: `cd app && grep -nE "export.*(download|baixar|getCertificado|remove)" src/lib/clients/supabase-storage.ts`

Se não houver função de download, adicione em `supabase-storage.ts`:

```ts
export async function downloadCertificado(path: string): Promise<Buffer> {
  const admin = createAdminClient(); // ou o client de storage já usado no módulo
  const { data, error } = await admin.storage.from('company-certificates').download(path);
  if (error || !data) throw new Error(error?.message ?? 'Falha ao baixar certificado.');
  return Buffer.from(await data.arrayBuffer());
}
```

(Use o mesmo client/bucket que `uploadCertificado` já usa nesse arquivo.)

- [ ] **Step 3: Conferir tipos**

Run: `cd app && npx tsc --noEmit 2>&1 | grep -E "serpro-procurador|supabase-storage" || echo "ok"`
Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
git add app/src/lib/fiscal/serpro-procurador.ts app/src/lib/clients/supabase-storage.ts
git commit -m "feat(serpro): garantirTokenProcurador (orquestra Termo→/Apoiar→persistência)"
```

---

## Task 8: Trocar a auth no uploadCertificadoAction

**Files:**
- Modify: `app/src/app/(auth)/configuracoes/actions.ts`

- [ ] **Step 1: Trocar o import**

Em `app/src/app/(auth)/configuracoes/actions.ts`, troque:

```ts
import { autenticarProcurador } from '@/lib/clients/serpro-auth';
```

por:

```ts
import { garantirTokenProcurador } from '@/lib/fiscal/serpro-procurador';
```

- [ ] **Step 2: Substituir o bloco best-effort**

Substitua todo o bloco (linhas ~213-232) que começa em `// Best-effort: autentica na SERPRO e cacheia o JWT.` e termina no `catch { warnings.push('Autenticação na SERPRO falhou — será refeita depois.'); }` por:

```ts
  // Best-effort: gera o token_procurador (mTLS contratante + Termo assinado pela empresa).
  // Falha não perde o certificado.
  const warnings: string[] = [];
  {
    const r = await garantirTokenProcurador(supabase, companyId, {
      keyPem: material.keyPem,
      certPem: material.certPem,
      cnpj: material.cnpj,
      nome: material.subjectCN,
    });
    if (!r.ok) warnings.push(r.warning);
  }
```

> Observação: a declaração `const warnings: string[] = [];` deve aparecer **uma única vez**. Se já existir antes do bloco Focus, não duplique — mantenha a existente e remova a daqui.

- [ ] **Step 3: Conferir tipos e ausência de referências órfãs**

Run: `cd app && npx tsc --noEmit 2>&1 | grep -E "configuracoes/actions|autenticarProcurador|certificado_jwt" || echo "ok"`
Expected: `ok` (nenhuma referência a `autenticarProcurador` ou às colunas `certificado_*` restou nesse arquivo).

- [ ] **Step 4: Commit**

```bash
git add "app/src/app/(auth)/configuracoes/actions.ts"
git commit -m "feat(serpro): upload do cert gera token_procurador (modelo contratante)"
```

---

## Task 9: Diagnóstico — gate do contratante + fonte do token

**Files:**
- Modify: `app/src/lib/fiscal/saude-empresa.ts`
- Modify: `app/src/lib/fiscal/saude-empresa.test.ts`

- [ ] **Step 1: Adicionar o campo ao SaudeState**

Em `saude-empresa.ts`, no tipo `SaudeState` (bloco SERPRO, ~linha 62), adicione abaixo de `serproTokenExpiration`:

```ts
  // SERPRO (empresas_fiscais)
  serproTokenExpiration: string | null; // ISO; null se nunca autenticado (= serpro_token_procurador_expiration)
  /** Contratante SERPRO provisionado no sistema (tabela singleton). Gate global. */
  contratanteConfigurado: boolean;
```

- [ ] **Step 2: Escrever os testes (falhando)**

Em `saude-empresa.test.ts`: adicione `contratanteConfigurado: true` ao objeto `BASE` (perto de `serproTokenExpiration` na linha ~19). Depois adicione, dentro do bloco `describe` dos checks SERPRO (ou crie um novo):

```ts
describe('serproCheck — gate do contratante', () => {
  it('contratante não configurado → erro (gate global)', () => {
    const checks = buildSaudeChecks({ ...BASE, contratanteConfigurado: false }, NOW);
    const serpro = checks.find((c) => c.key === 'serpro')!;
    expect(serpro.status).toBe('erro');
    expect(serpro.label).toBe('Contratante SERPRO não configurado');
  });

  it('contratante ok + token válido → ok', () => {
    const checks = buildSaudeChecks(
      { ...BASE, contratanteConfigurado: true, serproTokenExpiration: '2026-05-28T13:00:00Z' },
      NOW,
    );
    expect(checks.find((c) => c.key === 'serpro')!.status).toBe('ok');
  });
});
```

(Confirme o valor de `NOW` já definido no arquivo de teste; use o existente.)

- [ ] **Step 3: Rodar e ver falhar**

Run: `cd app && npx vitest run src/lib/fiscal/saude-empresa.test.ts`
Expected: FAIL — o gate `contratanteConfigurado` ainda não existe no `serproCheck`.

- [ ] **Step 4: Adicionar o gate no serproCheck**

Em `saude-empresa.ts`, no início da função `serproCheck` (linha ~417), antes do `if (!state.serproTokenExpiration)`:

```ts
function serproCheck(state: SaudeState, now: Date): CheckResult {
  if (!state.contratanteConfigurado) {
    return {
      key: 'serpro',
      label: 'Contratante SERPRO não configurado',
      status: 'erro',
      hint: 'Cadastro do certificado do contratante pendente (ação do admin).',
      action: null,
    };
  }
  if (!state.serproTokenExpiration) {
```

Atualize também o hint do caso "ok" para mencionar o Termo, se desejar (opcional): `hint: \`Termo/procuração válido até ${formatBR(state.serproTokenExpiration)}.\``.

- [ ] **Step 5: Rodar e ver passar**

Run: `cd app && npx vitest run src/lib/fiscal/saude-empresa.test.ts`
Expected: PASS (incluindo os casos antigos com `BASE.contratanteConfigurado: true`).

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/fiscal/saude-empresa.ts app/src/lib/fiscal/saude-empresa.test.ts
git commit -m "feat(serpro): Diagnóstico reflete token_procurador + gate do contratante"
```

---

## Task 10: Loader do Diagnóstico (page.tsx)

**Files:**
- Modify: `app/src/app/(auth)/configuracoes/page.tsx`

- [ ] **Step 1: Trocar a fonte do serproTokenExpiration + adicionar contratanteConfigurado**

Em `page.tsx`, dentro do bloco que monta `saudeState` (linha ~128), troque:

```ts
      serproTokenExpiration: (empresaFiscal?.certificado_token_expiration as string | null) ?? null,
```

por:

```ts
      serproTokenExpiration: (empresaFiscal?.serpro_token_procurador_expiration as string | null) ?? null,
      contratanteConfigurado,
```

- [ ] **Step 2: Calcular contratanteConfigurado antes do objeto saudeState**

Logo antes de `let saudeState: SaudeState | null = null;` (linha ~107), adicione:

```ts
  // Contratante SERPRO é global (tabela singleton, service-role-only).
  let contratanteConfigurado = false;
  if (active === 'diagnostico' && company) {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const { count } = await createAdminClient()
      .from('serpro_contratante')
      .select('id', { count: 'exact', head: true });
    contratanteConfigurado = (count ?? 0) > 0;
  }
```

- [ ] **Step 3: Garantir que o select de empresaFiscal traz a coluna nova**

Run: `cd app && grep -nE "serpro_token_procurador_expiration|empresaFiscal|\.from\('empresas_fiscais'\)" "src/app/(auth)/configuracoes/page.tsx" | head`

Se o `empresaFiscal` for carregado com um `.select('...')` explícito que NÃO inclui `serpro_token_procurador_expiration`, adicione a coluna a esse select. Se usar `select('*')`, nada a fazer.

- [ ] **Step 4: Conferir tipos + build de tipos**

Run: `cd app && npx tsc --noEmit 2>&1 | grep -E "configuracoes/page" || echo "ok"`
Expected: `ok`.

- [ ] **Step 5: Commit**

```bash
git add "app/src/app/(auth)/configuracoes/page.tsx"
git commit -m "feat(serpro): loader do Diagnóstico lê token_procurador + presença do contratante"
```

---

## Task 11: Seed do contratante (provisionamento manual)

**Files:**
- Create: `app/scripts/seed-serpro-contratante.mjs`

- [ ] **Step 1: Escrever o script**

Create `app/scripts/seed-serpro-contratante.mjs`:

```js
/**
 * Seed (manual) do contratante SERPRO na tabela singleton serpro_contratante.
 * Lê o PFX + senha do contratante, cifra com CERT_ENC_KEY (envelope) e faz upsert
 * via service_role. Rodar 1× pelo admin. NÃO versiona segredos.
 *
 * Uso:
 *   node scripts/seed-serpro-contratante.mjs <caminho.pfx> <senha>
 * (defaults: PIPER em docs/n8n, senha_me de senha.json — só p/ ambiente local)
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import forge from 'node-forge';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
for (const line of fs.readFileSync(path.resolve(__dirname, '../.env.local'), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#')) continue;
  const eq = t.indexOf('='); if (eq < 0) continue;
  const k = t.slice(0, eq).trim(), v = t.slice(eq + 1).trim();
  if (!process.env[k]) process.env[k] = v;
}

const PFX = process.argv[2] || path.join(ROOT, 'docs/n8n/PIPER AUTOMACOES E INTEGRACOES LTDA 2026-2027 (123456).pfx');
let SENHA = process.argv[3];
if (!SENHA) {
  const s = fs.readFileSync(path.join(ROOT, 'docs/n8n/senha.json'), 'utf8');
  SENHA = String(JSON.parse(s).senha_me);
}

// envelope AES-256-GCM compatível com src/lib/crypto/envelope.ts (iv|tag|ct).
function encryptBlob(plaintext) {
  const keyB64 = process.env.CERT_ENC_KEY;
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) throw new Error('CERT_ENC_KEY deve decodificar p/ 32 bytes.');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

function certMeta(pfxBuf, senha) {
  const der = forge.util.createBuffer(pfxBuf.toString('binary'));
  const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(der), senha);
  const cert = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag][0].cert;
  const cn = cert.subject.getField('CN').value;
  return {
    cnpj: cn.replace(/\D+/g, '').slice(-14),
    nome: cn.replace(/:\d+\s*$/, '').trim(),
    notAfter: cert.validity.notAfter.toISOString(),
    subjectCn: cn,
  };
}

async function main() {
  const pfxBuf = fs.readFileSync(PFX);
  const meta = certMeta(pfxBuf, SENHA);
  console.log('Contratante:', meta.cnpj, '—', meta.nome, '| validade', meta.notAfter);

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const row = {
    cnpj: meta.cnpj,
    nome: meta.nome,
    cert_pfx_enc: encryptBlob(pfxBuf).toString('base64'),
    cert_password_enc: encryptBlob(Buffer.from(SENHA, 'utf8')).toString('base64'),
    cert_not_after: meta.notAfter,
    cert_subject_cn: meta.subjectCn,
    updated_at: new Date().toISOString(),
  };
  const { data: existing } = await supabase.from('serpro_contratante').select('id').limit(1).maybeSingle();
  const res = existing
    ? await supabase.from('serpro_contratante').update(row).eq('id', existing.id)
    : await supabase.from('serpro_contratante').insert(row);
  if (res.error) throw new Error(res.error.message);
  console.log('✅ contratante', existing ? 'atualizado' : 'inserido', 'no singleton.');
}
main().catch((e) => { console.error('❌', e?.message || e); process.exit(1); });
```

- [ ] **Step 2: Rodar o seed (após aplicar a migration 0017 no banco)**

Run: `cd app && node scripts/seed-serpro-contratante.mjs`
Expected: `✅ contratante inserido no singleton.` (exige `CERT_ENC_KEY` e `SUPABASE_SERVICE_ROLE_KEY` no `.env.local`, e a tabela criada). Se a migration ainda não foi aplicada, falha com "relation serpro_contratante does not exist" — aplique a 0017 primeiro.

- [ ] **Step 3: Commit**

```bash
git add app/scripts/seed-serpro-contratante.mjs
git commit -m "chore(serpro): script de seed do contratante (singleton)"
```

---

## Task 12: Verificação final

**Files:** nenhum (verificação)

- [ ] **Step 1: TypeScript limpo**

Run: `cd app && npx tsc --noEmit`
Expected: zero erros.

- [ ] **Step 2: Toda a suíte unit**

Run: `cd app && npx vitest run`
Expected: PASS — incluindo `serpro-expiracao`, `serpro-termo`, `serpro` (parseApoiarToken), `saude-empresa` (com gate), e os testes pré-existentes.

- [ ] **Step 3: Smoke manual opcional (com cert real)**

Com a migration aplicada + seed rodado: subir o cert da AL PISCINAS em Configurações → Emissão fiscal → verificar no Diagnóstico que "SERPRO conectada" fica `ok` e que `empresas_fiscais.serpro_token_procurador` foi populado. (Opcional — depende de ambiente real.)

- [ ] **Step 4: Atualizar a memória do tema**

Anotar na memória `balu-serpro-procuracao-investigacao` (e no `SERPRO-INVESTIGACAO.md`) que o fluxo procurador virou feature de auth/storage/diagnóstico (não a emissão), com a tabela singleton + colunas token_procurador.

- [ ] **Step 5: Commit final (se houve ajustes na verificação)**

```bash
git add -A && git commit -m "test(serpro): verificação final do fluxo procurador (auth+storage+diagnóstico)" || echo "nada a commitar"
```

---

## Self-review (cobertura do spec)

- ✅ Cert+senha do contratante em tabela singleton cifrada → Task 1 + 6 + 11
- ✅ Auth no upload com cert do contratante + Termo assinado pela empresa → Task 4 + 5 + 7 + 8
- ✅ Salvar token_procurador por empresa → Task 1 (colunas) + 7 (persistência)
- ✅ Validade meia-noite SP → Task 2
- ✅ Diagnóstico reflete token_procurador + gate contratante → Task 9 + 10
- ✅ Seed manual (sem UI) → Task 11
- ✅ Não mexe na emissão de DAS (fora do escopo) → nenhuma task toca `gerarDasMeiAction`
- ✅ Colunas `certificado_*` órfãs deixam de ser escritas (sem drop) → Task 8 remove a escrita
```
