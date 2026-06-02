# municipios_nfse Rebuild + Cron Focus Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recriar a tabela `municipios_nfse` com schema alinhado à Focus API e adicionar cron mensal que mantém os 5.571 municípios sincronizados.

**Architecture:** Migration `0016` derruba e recria a tabela com colunas espelhando a Focus API (`codigo_ibge`, `nfse_habilitada`, `provedor_nfse`, etc.). Um novo cliente `focus-municipios.ts` pagina `GET /v2/municipios`. A rota cron `/api/cron/sync-municipios` faz upsert em lotes de 500. Sete consumers existentes têm seus nomes de campo atualizados.

**Tech Stack:** Next.js 15 App Router, Supabase (service_role para escrita), Vitest, TypeScript strict.

---

## Mapa de arquivos

| Arquivo | Ação |
|---|---|
| `supabase/migrations/0016_rebuild_municipios_nfse.sql` | CRIAR — derruba e recria tabela + RLS |
| `src/types/database.ts` | MODIFICAR — bloco `municipios_nfse` |
| `src/lib/clients/focus-municipios.ts` | CRIAR — fetch paginado Focus |
| `src/lib/clients/focus-municipios.test.ts` | CRIAR — testes do cliente |
| `src/lib/fiscal/municipio-nfse.ts` | MODIFICAR — `credenciaisDaAutenticacao` usa novo tipo |
| `src/lib/fiscal/municipio-nfse.server.ts` | MODIFICAR — tipo + query |
| `src/lib/fiscal/saude-empresa.ts` | MODIFICAR — `SaudeState.municipioInfo` + `cidadeNfseCheck` |
| `src/app/(auth)/configuracoes/page.tsx` | MODIFICAR — monta `municipioInfo` com novos campos |
| `src/app/(auth)/configuracoes/NfseForm.tsx` | MODIFICAR — tipo `MunicipioInfo`, rendering |
| `src/app/(auth)/notas_fiscais/[id]/page.tsx` | MODIFICAR — `cancelamento_so_portal` → `possui_cancelamento_nfse` |
| `src/app/(auth)/notas_fiscais/actions.ts` | MODIFICAR — idem |
| `src/app/api/cron/sync-municipios/route.ts` | CRIAR — rota cron protegida |
| `vercel.json` | CRIAR — schedule mensal |
| `.env.local` | MODIFICAR — adiciona `CRON_SECRET` |

---

## Task 1: Migration `0016` — rebuild `municipios_nfse`

**Files:**
- Create: `supabase/migrations/0016_rebuild_municipios_nfse.sql`

- [ ] **Step 1: Criar o arquivo de migration**

```sql
-- supabase/migrations/0016_rebuild_municipios_nfse.sql
-- Recria municipios_nfse com schema alinhado à Focus API /v2/municipios.
-- Dados anteriores (Bubble) eram stale e sem fonte de atualização.

drop table if exists public.municipios_nfse cascade;

create table public.municipios_nfse (
  id                                           uuid primary key default gen_random_uuid(),
  codigo_ibge                                  text unique not null,
  nome_municipio                               text not null,
  uf                                           char(2) not null,
  nome_uf                                      text,
  nfse_habilitada                              boolean not null default false,
  status_nfse                                  text,
  provedor_nfse                                text,
  requer_certificado_nfse                      boolean,
  possui_ambiente_homologacao_nfse             boolean,
  possui_cancelamento_nfse                     boolean,
  cpf_cnpj_obrigatorio_nfse                    boolean,
  endereco_obrigatorio_nfse                    boolean,
  item_lista_servico_obrigatorio_nfse          boolean,
  codigo_cnae_obrigatorio_nfse                 boolean,
  codigo_tributario_municipio_obrigatorio_nfse boolean,
  ultima_emissao_nfse                          timestamptz,
  focus_synced_at                              timestamptz,
  created_at                                   timestamptz not null default now(),
  updated_at                                   timestamptz not null default now()
);

alter table public.municipios_nfse enable row level security;

create policy municipios_nfse_select on public.municipios_nfse
  for select to authenticated using (true);
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/0016_rebuild_municipios_nfse.sql
git commit -m "feat(db): migration 0016 — rebuild municipios_nfse alinhada à Focus API"
```

---

## Task 2: Atualizar tipos `database.ts`

**Files:**
- Modify: `src/types/database.ts`

- [ ] **Step 1: Localizar o bloco `municipios_nfse`**

Abra `src/types/database.ts` e encontre o bloco que começa em `municipios_nfse: {` (por volta da linha 226). O bloco atual tem campos Bubble (`municipio`, `estado`, `url`, `producao_disponivel`, etc.).

- [ ] **Step 2: Substituir o bloco inteiro**

Substitua todo o bloco `municipios_nfse: { ... }` por:

```ts
  municipios_nfse: {
    id: string;
    codigo_ibge: string;
    nome_municipio: string;
    uf: string;
    nome_uf: string | null;
    nfse_habilitada: boolean;
    status_nfse: string | null;
    provedor_nfse: string | null;
    requer_certificado_nfse: boolean | null;
    possui_ambiente_homologacao_nfse: boolean | null;
    possui_cancelamento_nfse: boolean | null;
    cpf_cnpj_obrigatorio_nfse: boolean | null;
    endereco_obrigatorio_nfse: boolean | null;
    item_lista_servico_obrigatorio_nfse: boolean | null;
    codigo_cnae_obrigatorio_nfse: boolean | null;
    codigo_tributario_municipio_obrigatorio_nfse: boolean | null;
    ultima_emissao_nfse: string | null;
    focus_synced_at: string | null;
    created_at: string;
    updated_at: string;
  };
```

Também remova a referência a `cancelamento_so_portal` em qualquer outro bloco do mesmo arquivo (há uma em `notas_fiscais` por volta da linha 109 — verifique se pertence ao schema de notas, não ao de municípios; se for, deixe como está).

- [ ] **Step 3: Verificar TypeScript**

```bash
npm run typecheck 2>&1 | head -40
```

Esperado: erros aparecem nos consumers (tasks seguintes os corrigem) — mas **não** erros dentro de `database.ts` em si.

---

## Task 3: Cliente Focus `focus-municipios.ts` + testes

**Files:**
- Create: `src/lib/clients/focus-municipios.ts`
- Create: `src/lib/clients/focus-municipios.test.ts`

- [ ] **Step 1: Escrever os testes primeiro**

```ts
// src/lib/clients/focus-municipios.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const PAGE1 = [
  {
    codigo_municipio: '4113700', nome_municipio: 'Londrina', sigla_uf: 'PR',
    nome_uf: 'Paraná', nfse_habilitada: true, status_nfse: 'ativo',
    provedor_nfse: 'Nacional', requer_certificado_nfse: true,
    possui_ambiente_homologacao_nfse: true, possui_cancelamento_nfse: true,
    cpf_cnpj_obrigatorio_nfse: null, endereco_obrigatorio_nfse: null,
    item_lista_servico_obrigatorio_nfse: null, codigo_cnae_obrigatorio_nfse: null,
    codigo_tributario_municipio_obrigatorio_nfse: null, ultima_emissao_nfse: null,
  },
];
const PAGE2 = [
  {
    codigo_municipio: '3550308', nome_municipio: 'São Paulo', sigla_uf: 'SP',
    nome_uf: 'São Paulo', nfse_habilitada: true, status_nfse: 'ativo',
    provedor_nfse: 'Betha2', requer_certificado_nfse: true,
    possui_ambiente_homologacao_nfse: false, possui_cancelamento_nfse: true,
    cpf_cnpj_obrigatorio_nfse: null, endereco_obrigatorio_nfse: null,
    item_lista_servico_obrigatorio_nfse: null, codigo_cnae_obrigatorio_nfse: null,
    codigo_tributario_municipio_obrigatorio_nfse: null, ultima_emissao_nfse: null,
  },
];

function makeFetchResponse(body: unknown, totalCount: number) {
  return {
    ok: true,
    headers: { get: (h: string) => h === 'x-total-count' ? String(totalCount) : null },
    json: async () => body,
  };
}

describe('fetchAllMunicipiosFocus', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('retorna todos os itens concatenando páginas', async () => {
    mockFetch
      .mockResolvedValueOnce(makeFetchResponse(PAGE1, 2))
      .mockResolvedValueOnce(makeFetchResponse(PAGE2, 2));

    const { fetchAllMunicipiosFocus } = await import('./focus-municipios');
    const result = await fetchAllMunicipiosFocus();

    expect(result).toHaveLength(2);
    expect(result[0].codigo_municipio).toBe('4113700');
    expect(result[1].codigo_municipio).toBe('3550308');
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenNthCalledWith(1, expect.stringContaining('offset=0'), expect.any(Object));
    expect(mockFetch).toHaveBeenNthCalledWith(2, expect.stringContaining('offset=1'), expect.any(Object));
  });

  it('retorna array vazio se total=0', async () => {
    mockFetch.mockResolvedValueOnce(makeFetchResponse([], 0));

    const { fetchAllMunicipiosFocus } = await import('./focus-municipios');
    const result = await fetchAllMunicipiosFocus();

    expect(result).toHaveLength(0);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('lança erro se resposta HTTP não for ok', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'Unauthorized' });

    const { fetchAllMunicipiosFocus } = await import('./focus-municipios');
    await expect(fetchAllMunicipiosFocus()).rejects.toThrow('Focus /v2/municipios → 401');
  });
});
```

- [ ] **Step 2: Rodar o teste para confirmar que falha**

```bash
npm test -- focus-municipios 2>&1 | tail -20
```

Esperado: `FAIL` — `fetchAllMunicipiosFocus` não existe ainda.

- [ ] **Step 3: Implementar o cliente**

```ts
// src/lib/clients/focus-municipios.ts
import 'server-only';

const BASE = 'https://api.focusnfe.com.br';
const PAGE_SIZE = 100;

export type FocusMunicipio = {
  codigo_municipio: string;
  nome_municipio: string;
  sigla_uf: string;
  nome_uf: string;
  nfse_habilitada: boolean;
  status_nfse: string;
  provedor_nfse?: string;
  requer_certificado_nfse?: boolean;
  possui_ambiente_homologacao_nfse?: boolean;
  possui_cancelamento_nfse?: boolean;
  cpf_cnpj_obrigatorio_nfse?: boolean | null;
  endereco_obrigatorio_nfse?: boolean | null;
  item_lista_servico_obrigatorio_nfse?: boolean | null;
  codigo_cnae_obrigatorio_nfse?: boolean | null;
  codigo_tributario_municipio_obrigatorio_nfse?: boolean | null;
  ultima_emissao_nfse?: string | null;
};

function authHeader(): string {
  const token = process.env.FOCUS_NFE_TOKEN;
  if (!token) throw new Error('FOCUS_NFE_TOKEN não configurado');
  return 'Basic ' + Buffer.from(`${token}:`).toString('base64');
}

async function fetchPage(offset: number): Promise<{ items: FocusMunicipio[]; total: number }> {
  const url = `${BASE}/v2/municipios?offset=${offset}`;
  const res = await fetch(url, {
    headers: { Authorization: authHeader() },
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Focus /v2/municipios → ${res.status}: ${body}`);
  }
  const total = Number(res.headers.get('x-total-count') ?? 0);
  const items = (await res.json()) as FocusMunicipio[];
  return { items, total };
}

/** Busca todos os municípios da Focus paginando até x-total-count. */
export async function fetchAllMunicipiosFocus(): Promise<FocusMunicipio[]> {
  const { items: first, total } = await fetchPage(0);
  if (total <= PAGE_SIZE) return first;

  const pages: FocusMunicipio[][] = [first];
  const remaining = total - PAGE_SIZE;
  const extraCalls = Math.ceil(remaining / PAGE_SIZE);

  await Promise.all(
    Array.from({ length: extraCalls }, (_, i) =>
      fetchPage((i + 1) * PAGE_SIZE).then(({ items }) => { pages[i + 1] = items; }),
    ),
  );

  return pages.flat();
}
```

- [ ] **Step 4: Rodar os testes**

```bash
npm test -- focus-municipios 2>&1 | tail -20
```

Esperado: `3 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/clients/focus-municipios.ts src/lib/clients/focus-municipios.test.ts
git commit -m "feat(fiscal): cliente Focus /v2/municipios com paginação automática"
```

---

## Task 4: Atualizar `municipio-nfse.ts` e `municipio-nfse.server.ts`

**Files:**
- Modify: `src/lib/fiscal/municipio-nfse.ts`
- Modify: `src/lib/fiscal/municipio-nfse.server.ts`

- [ ] **Step 1: Atualizar `credenciaisDaAutenticacao` em `municipio-nfse.ts`**

A função atual recebe a string `autenticacao` (campo Bubble que deixa de existir). Substitua sua assinatura para receber o novo tipo — use `provedor_nfse` para inferir login/token e `requer_certificado_nfse` para cert.

Substitua o conteúdo de `src/lib/fiscal/municipio-nfse.ts`:

```ts
// @custom — PR 1.5: helpers puros de município/autenticação NFS-e (sem deps de server/React).

// Normaliza nome de município p/ comparação: minúsculo, sem acento, trim.
export function normalizeNome(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

export type CredenciaisNfse = { login: boolean; token: boolean; certificado: boolean };

/**
 * Deriva quais credenciais o município exige a partir dos campos da Focus API.
 * Provedores "Nacional*" usam só certificado (sem login/senha/token).
 * Provedores legados geralmente aceitam login+senha e/ou token — mostramos ambos
 * e o usuário preenche o que o provedor exige.
 */
export function credenciaisDaAutenticacao(
  municipio: { provedor_nfse: string | null; requer_certificado_nfse: boolean | null } | null | undefined,
): CredenciaisNfse {
  if (!municipio) return { login: false, token: false, certificado: false };
  const isNacional = (municipio.provedor_nfse ?? '').startsWith('Nacional');
  return {
    login: !isNacional,
    token: !isNacional,
    certificado: municipio.requer_certificado_nfse === true,
  };
}
```

- [ ] **Step 2: Atualizar `municipio-nfse.server.ts`**

Substitua o conteúdo completo de `src/lib/fiscal/municipio-nfse.server.ts`:

```ts
import 'server-only';
// @custom — PR 1.5: resolver de município NFS-e (server-only, Supabase).
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeNome } from './municipio-nfse';

export type MunicipioNfse = {
  id: string;
  codigo_ibge: string;
  nome_municipio: string;
  uf: string;
  nfse_habilitada: boolean;
  status_nfse: string | null;
  provedor_nfse: string | null;
  requer_certificado_nfse: boolean | null;
  possui_ambiente_homologacao_nfse: boolean | null;
  possui_cancelamento_nfse: boolean | null;
};

// Resolve a linha de municipios_nfse pelo município + UF do endereço da empresa.
// Match por nome normalizado; homônimos desambiguados pela UF.
export async function resolveMunicipioNfse(
  supabase: SupabaseClient,
  municipio: string | null | undefined,
  uf: string | null | undefined,
): Promise<MunicipioNfse | null> {
  if (!municipio || !uf) return null;
  const { data } = await supabase
    .from('municipios_nfse')
    .select(
      'id, codigo_ibge, nome_municipio, uf, nfse_habilitada, status_nfse, provedor_nfse, requer_certificado_nfse, possui_ambiente_homologacao_nfse, possui_cancelamento_nfse',
    )
    .eq('uf', uf.trim().toUpperCase())
    .eq('nfse_habilitada', true);  // cidades não habilitadas retornam null → cidadeNfseCheck mostra "não atendida"
  const alvo = normalizeNome(municipio);
  const rows = (data ?? []) as MunicipioNfse[];
  return rows.find((m) => normalizeNome(m.nome_municipio) === alvo) ?? null;
}
```

- [ ] **Step 3: Rodar typecheck**

```bash
npm run typecheck 2>&1 | grep "municipio-nfse" | head -20
```

Esperado: erros apenas nos consumers (tasks seguintes), não dentro desses dois arquivos.

- [ ] **Step 4: Commit**

```bash
git add src/lib/fiscal/municipio-nfse.ts src/lib/fiscal/municipio-nfse.server.ts
git commit -m "refactor(fiscal): municipio-nfse alinhado ao schema Focus (codigo_ibge, provedor_nfse, possui_cancelamento_nfse)"
```

---

## Task 5: Atualizar `saude-empresa.ts`

**Files:**
- Modify: `src/lib/fiscal/saude-empresa.ts`

- [ ] **Step 1: Atualizar o tipo `SaudeState.municipioInfo`**

No arquivo `src/lib/fiscal/saude-empresa.ts`, localize o bloco (linhas ~34-38):

```ts
  municipioInfo: {
    producao_disponivel: string | null;
    homologacao_disponivel: string | null;
    provedor: string | null;
  } | null;
```

Substitua por:

```ts
  municipioInfo: {
    nfse_habilitada: boolean;
    status_nfse: string | null;
    provedor_nfse: string | null;
    possui_ambiente_homologacao_nfse: boolean | null;
  } | null;
```

- [ ] **Step 2: Atualizar `cidadeNfseCheck()`**

Localize a função `cidadeNfseCheck` (por volta da linha 254). Encontre as linhas:

```ts
  const isSim = (v: string | null) => !!v && v.trim().toLowerCase() === 'sim';
  const prodOk = isSim(state.municipioInfo.producao_disponivel);
  const homOk = isSim(state.municipioInfo.homologacao_disponivel);
  const provedor = state.municipioInfo.provedor;
```

Substitua por:

```ts
  const prodOk = state.municipioInfo.nfse_habilitada && state.municipioInfo.status_nfse === 'ativo';
  const homOk = state.municipioInfo.possui_ambiente_homologacao_nfse === true;
  const provedor = state.municipioInfo.provedor_nfse;
```

A linha com `isSim` é removida completamente — não é usada em mais nenhum outro lugar dentro desta função.

- [ ] **Step 3: Rodar typecheck e testes**

```bash
npm run typecheck 2>&1 | grep "saude-empresa" | head -20
npm test -- saude-empresa 2>&1 | tail -20
```

Esperado para typecheck: sem erros em `saude-empresa.ts`.
Esperado para testes: todos os testes de `saude-empresa.test.ts` passando (os testes existentes usam o `SaudeState` diretamente — confirme que os campos passados nos fixtures batem com o novo tipo).

**Nota:** se `saude-empresa.test.ts` tiver fixtures com `producao_disponivel`/`homologacao_disponivel`/`provedor`, atualize-os para `nfse_habilitada`/`status_nfse`/`provedor_nfse`/`possui_ambiente_homologacao_nfse`. Exemplo de atualização de fixture:

```ts
// antes
municipioInfo: { producao_disponivel: 'Sim', homologacao_disponivel: 'Não', provedor: 'Betha2' }
// depois
municipioInfo: { nfse_habilitada: true, status_nfse: 'ativo', provedor_nfse: 'Betha2', possui_ambiente_homologacao_nfse: false }
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/fiscal/saude-empresa.ts src/lib/fiscal/saude-empresa.test.ts
git commit -m "refactor(fiscal): saude-empresa usa campos booleanos Focus (sem isSim)"
```

---

## Task 6: Atualizar `configuracoes/page.tsx` e `NfseForm.tsx`

**Files:**
- Modify: `src/app/(auth)/configuracoes/page.tsx`
- Modify: `src/app/(auth)/configuracoes/NfseForm.tsx`

- [ ] **Step 1: Atualizar `page.tsx` — montagem de `municipioInfo`**

Localize as linhas 118-124 (bloco `municipioInfo: municipioNfse ? { ... } : null`):

```ts
      municipioInfo: municipioNfse
        ? {
            producao_disponivel: (municipioNfse as { producao_disponivel?: string | null }).producao_disponivel ?? null,
            homologacao_disponivel: (municipioNfse as { homologacao_disponivel?: string | null }).homologacao_disponivel ?? null,
            provedor: (municipioNfse as { provedor?: string | null }).provedor ?? null,
          }
        : null,
```

Substitua por:

```ts
      municipioInfo: municipioNfse
        ? {
            nfse_habilitada: municipioNfse.nfse_habilitada,
            status_nfse: municipioNfse.status_nfse,
            provedor_nfse: municipioNfse.provedor_nfse,
            possui_ambiente_homologacao_nfse: municipioNfse.possui_ambiente_homologacao_nfse,
          }
        : null,
```

Os casts `as { ... }` são removidos — `municipioNfse` agora é `MunicipioNfse` com tipos corretos (vindo do import de `resolveMunicipioNfse`).

- [ ] **Step 2: Atualizar `NfseForm.tsx` — tipo `MunicipioInfo`**

Localize o tipo `MunicipioInfo` no topo do arquivo (linhas 11-20):

```ts
export type MunicipioInfo = {
  id: string;
  municipio: string | null;
  estado: string | null;
  provedor: string | null;
  autenticacao: string | null;
  cancelamento: string | null;
  cancelamento_so_portal: boolean | null;
  requer_liberacao_rps: boolean | null;
};
```

Substitua por:

```ts
export type MunicipioInfo = {
  id: string;
  nome_municipio: string;
  uf: string;
  provedor_nfse: string | null;
  requer_certificado_nfse: boolean | null;
  possui_cancelamento_nfse: boolean | null;
};
```

- [ ] **Step 3: Atualizar o rendering em `NfseForm.tsx`**

Localize a linha com `municipio.municipio/{municipio.estado}` (linha ~106):

```tsx
        <p className="mt-1 text-foreground">{municipio.municipio}/{municipio.estado}</p>
```

Substitua por:

```tsx
        <p className="mt-1 text-foreground">{municipio.nome_municipio}/{municipio.uf}</p>
```

Localize o bloco do grid (linhas ~107-112):

```tsx
        <div className="mt-3 grid grid-cols-2 gap-2 text-muted-foreground-2">
          <span>Provedor: <strong>{municipio.provedor ?? '—'}</strong></span>
          <span>Autenticação: <strong>{municipio.autenticacao ?? '—'}</strong></span>
          <span>Cancelamento: <strong>{municipio.cancelamento ?? '—'}{municipio.cancelamento_so_portal ? ' (só portal)' : ''}</strong></span>
          <span>Liberação RPS: <strong>{municipio.requer_liberacao_rps ? 'requer' : 'não'}</strong></span>
        </div>
```

Substitua por:

```tsx
        <div className="mt-3 grid grid-cols-2 gap-2 text-muted-foreground-2">
          <span>Provedor: <strong>{municipio.provedor_nfse ?? '—'}</strong></span>
          <span>Cancelamento via portal: <strong>{municipio.possui_cancelamento_nfse ? 'sim' : 'não'}</strong></span>
        </div>
```

- [ ] **Step 4: Atualizar chamada `credenciaisDaAutenticacao` em `NfseForm.tsx`**

Localize a linha (linha ~60):

```ts
  const cred = credenciaisDaAutenticacao(municipio.autenticacao);
```

Substitua por:

```ts
  const cred = credenciaisDaAutenticacao(municipio);
```

- [ ] **Step 5: Remover `nfse_autenticacao_tipo` do submit**

Localize dentro de `handleSubmit` (linha ~84):

```ts
        nfse_autenticacao_tipo: mun.autenticacao ?? null,
```

Remova essa linha. O campo `autenticacao` não existe mais.

- [ ] **Step 6: Verificar que o page.tsx passa `municipioNfse` com o tipo correto**

No `page.tsx`, o `municipioNfse` retornado por `resolveMunicipioNfse` agora é `MunicipioNfse` (que tem `id`, `nome_municipio`, `uf`, `provedor_nfse`, `requer_certificado_nfse`, `possui_cancelamento_nfse`). A prop `municipio` do `NfseForm` espera `MunicipioInfo`.

Verifique se a passagem da prop está correta. Localize onde `NfseForm` é montado em `page.tsx` e confirme que `municipioNfse` é passado diretamente (os campos já batem). Se não houver conversão, o TypeScript apontará. Exemplo da prop:

```tsx
<NfseForm
  initial={...}
  municipio={municipioNfse}   {/* MunicipioNfse satisfaz MunicipioInfo após os steps acima */}
  cidade={company.municipio as string ?? ''}
  uf={company.uf as string ?? ''}
/>
```

- [ ] **Step 7: Rodar typecheck**

```bash
npm run typecheck 2>&1 | grep -E "configuracoes|NfseForm" | head -20
```

Esperado: sem erros nessas rotas.

- [ ] **Step 8: Commit**

```bash
git add src/app/\(auth\)/configuracoes/page.tsx src/app/\(auth\)/configuracoes/NfseForm.tsx
git commit -m "refactor(configuracoes): municipio usa campos Focus (provedor_nfse, possui_cancelamento_nfse)"
```

---

## Task 7: Atualizar `notas_fiscais/[id]/page.tsx` e `actions.ts`

**Files:**
- Modify: `src/app/(auth)/notas_fiscais/[id]/page.tsx`
- Modify: `src/app/(auth)/notas_fiscais/actions.ts`

- [ ] **Step 1: Atualizar `page.tsx`**

Localize a linha (linha ~51):

```ts
  const cancelSoPortal = cancelamentoSoPortal(nota.tipo_documento as string, muni?.cancelamento_so_portal);
```

Substitua por:

```ts
  const cancelSoPortal = cancelamentoSoPortal(nota.tipo_documento as string, muni?.possui_cancelamento_nfse);
```

- [ ] **Step 2: Atualizar `actions.ts`**

Localize a linha (linha ~448):

```ts
  if (cancelamentoSoPortal(tipo, muni?.cancelamento_so_portal)) {
```

Substitua por:

```ts
  if (cancelamentoSoPortal(tipo, muni?.possui_cancelamento_nfse)) {
```

- [ ] **Step 3: Rodar typecheck completo**

```bash
npm run typecheck 2>&1 | head -40
```

Esperado: **zero erros**. Se houver erros residuais, corrija antes de prosseguir.

- [ ] **Step 4: Rodar todos os testes**

```bash
npm test 2>&1 | tail -30
```

Esperado: todos passando (incluindo `saude-empresa.test.ts` e `focus-municipios.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add src/app/\(auth\)/notas_fiscais/\[id\]/page.tsx src/app/\(auth\)/notas_fiscais/actions.ts
git commit -m "refactor(notas): cancelamento_so_portal → possui_cancelamento_nfse (schema Focus)"
```

---

## Task 8: Rota cron `sync-municipios`

**Files:**
- Create: `src/app/api/cron/sync-municipios/route.ts`

- [ ] **Step 1: Criar o diretório**

```bash
mkdir -p src/app/api/cron/sync-municipios
```

- [ ] **Step 2: Implementar a rota**

```ts
// src/app/api/cron/sync-municipios/route.ts
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchAllMunicipiosFocus } from '@/lib/clients/focus-municipios';

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET não configurado' }, { status: 500 });
  }

  const auth = req.headers.get('authorization') ?? '';
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  const start = Date.now();

  const municipios = await fetchAllMunicipiosFocus();

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const now = new Date().toISOString();
  const rows = municipios.map((m) => ({
    codigo_ibge: m.codigo_municipio,
    nome_municipio: m.nome_municipio,
    uf: m.sigla_uf,
    nome_uf: m.nome_uf,
    nfse_habilitada: m.nfse_habilitada,
    status_nfse: m.status_nfse,
    provedor_nfse: m.provedor_nfse ?? null,
    requer_certificado_nfse: m.requer_certificado_nfse ?? null,
    possui_ambiente_homologacao_nfse: m.possui_ambiente_homologacao_nfse ?? null,
    possui_cancelamento_nfse: m.possui_cancelamento_nfse ?? null,
    cpf_cnpj_obrigatorio_nfse: m.cpf_cnpj_obrigatorio_nfse ?? null,
    endereco_obrigatorio_nfse: m.endereco_obrigatorio_nfse ?? null,
    item_lista_servico_obrigatorio_nfse: m.item_lista_servico_obrigatorio_nfse ?? null,
    codigo_cnae_obrigatorio_nfse: m.codigo_cnae_obrigatorio_nfse ?? null,
    codigo_tributario_municipio_obrigatorio_nfse: m.codigo_tributario_municipio_obrigatorio_nfse ?? null,
    ultima_emissao_nfse: m.ultima_emissao_nfse ?? null,
    focus_synced_at: now,
    updated_at: now,
  }));

  let upserted = 0;
  let failed = 0;

  for (const chunk of chunkArray(rows, 500)) {
    const { error } = await supabase
      .from('municipios_nfse')
      .upsert(chunk, { onConflict: 'codigo_ibge' });
    if (error) {
      console.error('[sync-municipios] chunk error:', error.message);
      failed += chunk.length;
    } else {
      upserted += chunk.length;
    }
  }

  const duration_ms = Date.now() - start;

  if (failed > 0) {
    return NextResponse.json({ ok: false, total: municipios.length, upserted, failed, duration_ms }, { status: 207 });
  }

  return NextResponse.json({ ok: true, total: municipios.length, upserted, duration_ms });
}
```

- [ ] **Step 3: Adicionar `CRON_SECRET` ao `.env.local`**

Abra `.env.local` e adicione:

```
# Proteção das rotas de cron (Vercel injeta automaticamente em produção)
CRON_SECRET=dev-cron-secret-local
```

- [ ] **Step 4: Testar a rota manualmente**

Com o dev server rodando (`npm run dev`), execute:

```bash
# Sem header → 401
curl -s http://localhost:3002/api/cron/sync-municipios | python3 -c "import json,sys; print(json.load(sys.stdin))"

# Header errado → 401
curl -s -H "Authorization: Bearer errado" http://localhost:3002/api/cron/sync-municipios | python3 -c "import json,sys; print(json.load(sys.stdin))"

# Header correto → 200 (busca ~5571 municípios, leva alguns segundos)
curl -s -H "Authorization: Bearer dev-cron-secret-local" http://localhost:3002/api/cron/sync-municipios | python3 -c "import json,sys; d=json.load(sys.stdin); print(d)"
```

Esperado para o terceiro: `{'ok': True, 'total': 5571, 'upserted': 5571, 'duration_ms': ...}` (pode variar).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cron/sync-municipios/route.ts .env.local
git commit -m "feat(cron): rota /api/cron/sync-municipios — upsert municipios Focus em lotes de 500"
```

---

## Task 9: `vercel.json` com schedule mensal

**Files:**
- Create: `vercel.json`

- [ ] **Step 1: Verificar se `vercel.json` já existe**

```bash
ls vercel.json 2>/dev/null && echo "existe" || echo "nao existe"
```

- [ ] **Step 2: Criar/atualizar `vercel.json`**

Se não existir, crie. Se já existir, merge o array `crons`:

```json
{
  "crons": [
    {
      "path": "/api/cron/sync-municipios",
      "schedule": "0 5 1 * *"
    }
  ]
}
```

Agenda: dia 1 de cada mês, 05:00 UTC.

- [ ] **Step 3: Commit**

```bash
git add vercel.json
git commit -m "chore(vercel): cron sync-municipios dia 1 de cada mês 05:00 UTC"
```

---

## Task 10: Verificação final

**Files:** nenhum novo.

- [ ] **Step 1: typecheck limpo**

```bash
npm run typecheck 2>&1
```

Esperado: `Found 0 errors`.

- [ ] **Step 2: Todos os testes passando**

```bash
npm test 2>&1 | tail -20
```

Esperado: todos passando (sem regressões).

- [ ] **Step 3: Verificar tela `/configuracoes` no browser**

Acesse `http://localhost:3002/configuracoes` logado.

- Aba "Emissão fiscal" → seção NFS-e deve renderizar sem erros de hydration.
- Se o banco já tiver a migration 0016 aplicada: seção NFS-e mostra `NFS-e indisponível` (tabela vazia) até o cron rodar.
- Se o banco ainda não tiver a migration: a seção vai retornar erro de coluna — aplique a migration no Supabase hospedado antes de testar em produção.

- [ ] **Step 4: Verificar tela `/notas_fiscais/[id]` no browser**

Abra uma nota NFS-e. O botão de cancelamento deve aparecer (ou ficar desabilitado conforme a flag `possui_cancelamento_nfse`).

- [ ] **Step 5: Commit final (se houver ajustes)**

```bash
git add -p
git commit -m "fix: ajustes pós-verificação final municipios_nfse sync"
```

---

## Observações

**Aplicar migration no banco hospedado:** O Supabase hospedado precisa da migration `0016` antes do deploy. Execute pelo Supabase Dashboard → SQL Editor, ou via `supabase db push` se o CLI estiver configurado.

**Primeira carga de dados:** Após a migration, a tabela fica vazia. Dispare o cron manualmente uma vez para popular:

```bash
curl -H "Authorization: Bearer <CRON_SECRET_PROD>" https://seu-app.vercel.app/api/cron/sync-municipios
```

**`CRON_SECRET` em produção:** Adicione a variável nas configurações da Vercel (Settings → Environment Variables). A Vercel injeta automaticamente em chamadas vindas do agendador interno.
