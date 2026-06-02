# Design: Rebuild `municipios_nfse` + Cron de Sincronização Focus

**Data:** 2026-06-02  
**Branch:** `feat/municipios-nfse-sync`  
**Fonte:** API Focus NFe `GET /v2/municipios` (5.571 municípios, paginado 100/request)

---

## Contexto

A tabela `municipios_nfse` veio do Bubble com um schema legado (`municipio`, `estado`, `producao_disponivel` como string "Sim"/"Não", etc.) e dados estáticos nunca mais atualizados. A Focus NFe expõe um endpoint completo com todos os municípios do Brasil e seus status de suporte a NFS-e — que é exatamente o que o Balu precisa para:

1. **`/configuracoes` → Diagnóstico** — verificar se a cidade da empresa é atendida (`cidadeNfseCheck`), exibindo badge com `status_nfse` (verde/amarelo/vermelho)
2. **`/configuracoes` → NFS-e** — mostrar provedor e flags de cancelamento do município; campos de credenciais só para provedores legados (não Nacional)
3. **`/notas_fiscais/[id]`** e **cancelamento** — saber se o cancelamento é só pelo portal municipal
4. **Gate de emissão NFS-e** — `emitirNotaAction` e `emissao/nfse/page.tsx` bloqueiam quando `status_nfse !== 'ativo'`, com mensagem específica por status (fora_do_ar, pausado, em_implementacao, etc.). Substitui o toggle manual `empresa_fiscal_ativada` que era escolha do usuário.

O cron roda diariamente (00:00 UTC) via Supabase Edge Function e mantém a tabela sempre alinhada com o catálogo da Focus.

**`status_nfse` — valores possíveis:**

| Valor | Significado | Badge |
|---|---|---|
| `ativo` | Focus emitindo normalmente | 🟢 verde |
| `fora_do_ar` | Servidor do município temporariamente indisponível | 🔴 vermelho |
| `pausado` | Emissão pausada na Focus | 🟡 amarelo |
| `em_implementacao` | Município sendo implementado | 🟡 amarelo |
| `em_reimplementacao` | Município em reimplementação | 🟡 amarelo |
| `inativo` | NFS-e desativada na Focus | 🔴 vermelho |
| `nao_implementado` | Município não suportado | 🔴 vermelho |

---

## Schema Novo (migration `0015`)

A tabela é recriada do zero — os dados Bubble são stale e não têm fonte para atualização.

```sql
DROP TABLE IF EXISTS municipios_nfse CASCADE;

CREATE TABLE public.municipios_nfse (
  id                                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo_ibge                                  text UNIQUE NOT NULL,
  nome_municipio                               text NOT NULL,
  uf                                           char(2) NOT NULL,
  nome_uf                                      text,
  nfse_habilitada                              boolean NOT NULL DEFAULT false,
  status_nfse                                  text,       -- 'ativo' | 'nao_implementado' | 'desativado'
  provedor_nfse                                text,
  requer_certificado_nfse                      boolean,
  possui_ambiente_homologacao_nfse             boolean,
  possui_cancelamento_nfse                     boolean,    -- era cancelamento_so_portal
  cpf_cnpj_obrigatorio_nfse                    boolean,
  endereco_obrigatorio_nfse                    boolean,
  item_lista_servico_obrigatorio_nfse          boolean,
  codigo_cnae_obrigatorio_nfse                 boolean,
  codigo_tributario_municipio_obrigatorio_nfse boolean,
  ultima_emissao_nfse                          timestamptz,
  focus_synced_at                              timestamptz,
  created_at                                   timestamptz NOT NULL DEFAULT now(),
  updated_at                                   timestamptz NOT NULL DEFAULT now()
);

-- RLS: leitura para autenticados, escrita só via service_role
ALTER TABLE public.municipios_nfse ENABLE ROW LEVEL SECURITY;
CREATE POLICY municipios_nfse_select ON public.municipios_nfse
  FOR SELECT TO authenticated USING (true);
```

### Mapeamento Focus API → colunas

| Campo Focus | Coluna nova | Coluna antiga (removida) |
|---|---|---|
| `codigo_municipio` | `codigo_ibge` | — |
| `nome_municipio` | `nome_municipio` | `municipio` |
| `sigla_uf` | `uf` | `estado` |
| `nome_uf` | `nome_uf` | — |
| `nfse_habilitada` | `nfse_habilitada` | *(derivado de `producao_disponivel == 'Sim'`)* |
| `status_nfse` | `status_nfse` | — |
| `provedor_nfse` | `provedor_nfse` | `provedor` |
| `requer_certificado_nfse` | `requer_certificado_nfse` | `requer_certificado` |
| `possui_ambiente_homologacao_nfse` | `possui_ambiente_homologacao_nfse` | `homologacao_disponivel` |
| `possui_cancelamento_nfse` | `possui_cancelamento_nfse` | `cancelamento_so_portal` |
| `cpf_cnpj_obrigatorio_nfse` | `cpf_cnpj_obrigatorio_nfse` | — |
| `endereco_obrigatorio_nfse` | `endereco_obrigatorio_nfse` | — |
| `item_lista_servico_obrigatorio_nfse` | `item_lista_servico_obrigatorio_nfse` | — |
| `codigo_cnae_obrigatorio_nfse` | `codigo_cnae_obrigatorio_nfse` | — |
| `codigo_tributario_municipio_obrigatorio_nfse` | `codigo_tributario_municipio_obrigatorio_nfse` | — |
| `ultima_emissao_nfse` | `ultima_emissao_nfse` | — |
| *(sem equivalente)* | — | `url`, `autenticacao`, `cancelamento` (texto), `formato`, `endpoint_tipo`, `requer_token_portal`, `im_zeros_esquerda`, `serie_rps_so_numeros`, `instrucoes_configuracao`, `requer_liberacao_rps`, `requer_aidf`, `requer_cadastro_tomador`, etc. |

---

## Arquivos a criar

### `src/lib/clients/focus-municipios.ts`

Cliente isolado (separado de `focus-nfe.ts` que trata emissão) com uma única responsabilidade: paginar e retornar todos os municípios da Focus.

```ts
// Tipagem espelhando o response da Focus
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

// fetchAllMunicipiosFocus(): FocusMunicipio[]
// — Loop offset=0,100,200... lendo X-Total-Count do primeiro response
// — Autenticação: FOCUS_NFE_TOKEN (Basic auth, senha vazia)
// — Sempre usa api.focusnfe.com.br (catálogo é o mesmo em prod/hom)
```

### `src/app/api/cron/sync-municipios/route.ts`

Route handler GET protegido por Bearer token.

```
Fluxo:
  1. Valida Authorization: Bearer ${CRON_SECRET} → 401 se inválido/ausente
  2. Busca todos os municípios via fetchAllMunicipiosFocus()
  3. Cria cliente Supabase com service_role (escrita sem RLS)
  4. Upsert em chunks de 500 ON CONFLICT (codigo_ibge) DO UPDATE
     — todos os campos + updated_at = now() + focus_synced_at = now()
  5. Retorna JSON: { ok: true, total, upserted, duration_ms }
     — em caso de erro parcial: { ok: false, error, partial: { upserted, failed } }
```

Segurança: sem `CRON_SECRET` configurado → rota retorna 500 (falha fechada, não aberta).

---

## Arquivos a modificar

### `src/types/database.ts`

Reescreve o bloco `municipios_nfse` para espelhar o novo schema.  
Remove campos Bubble; adiciona `nfse_habilitada`, `status_nfse`, `possui_cancelamento_nfse`, `ultima_emissao_nfse`, `focus_synced_at`.

### `src/lib/fiscal/municipio-nfse.server.ts`

**Tipo `MunicipioNfse`** — remove campos Bubble, adiciona novos:
```ts
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
  possui_cancelamento_nfse: boolean | null;   // era cancelamento_so_portal
};
```

**`resolveMunicipioNfse()`** — dois ajustes:
- `.eq('estado', uf)` → `.eq('uf', uf)`
- match por `normalizeNome(m.nome_municipio)` (era `m.municipio`)
- `select()` lista as novas colunas

### `src/lib/fiscal/saude-empresa.ts`

**`SaudeState.municipioInfo`** — substitui shape inline:
```ts
// antes
municipioInfo: {
  producao_disponivel: string | null;
  homologacao_disponivel: string | null;
  provedor: string | null;
} | null;

// depois — usa diretamente MunicipioNfse (import do server.ts não vai aqui — mantém shape inline)
municipioInfo: {
  nfse_habilitada: boolean;
  status_nfse: string | null;
  provedor_nfse: string | null;
  possui_ambiente_homologacao_nfse: boolean | null;
} | null;
```

**`cidadeNfseCheck()`** — remove `isSim()` e substitui lógica:
- `prodOk`: `municipioInfo.nfse_habilitada && municipioInfo.status_nfse === 'ativo'`
- `homOk`: `municipioInfo.possui_ambiente_homologacao_nfse === true`
- `provedor`: `municipioInfo.provedor_nfse`

### `src/app/(auth)/configuracoes/page.tsx`

Linhas 120-122: monta `municipioInfo` com novos campos em vez dos campos Bubble via cast.

### `src/app/(auth)/configuracoes/NfseForm.tsx`

- Prop `municipio` atualiza tipo: remove `cancelamento` (texto), `provedor` → `provedor_nfse`, `cancelamento_so_portal` → `possui_cancelamento_nfse`
- Linha 108: `municipio.provedor` → `municipio.provedor_nfse`
- Linha 110: remove exibição de `cancelamento` (texto, sem fonte). Mantém flag `possui_cancelamento_nfse`

### `src/app/(auth)/notas_fiscais/[id]/page.tsx`

- `muni?.cancelamento_so_portal` → `muni?.possui_cancelamento_nfse`

### `src/app/(auth)/notas_fiscais/actions.ts`

- `muni?.cancelamento_so_portal` → `muni?.possui_cancelamento_nfse`

---

## `vercel.json`

Adiciona entrada no array `crons` (cria o arquivo se não existir):

```json
{
  "crons": [
    {
      "path": "/api/cron/sync-municipios",
      "schedule": "0 0 * * *"
    }
  ]
}
```

Dia 1 de cada mês, 05:00 UTC — antes do cron de apuração (06:00 UTC, quando vier).

---

## Env vars necessárias

| Variável | Uso |
|---|---|
| `FOCUS_NFE_TOKEN` | já existe — autenticação Basic na Focus |
| `CRON_SECRET` | novo — proteção Bearer da rota cron |

`CRON_SECRET` deve ser adicionado ao `.env.local` (dev) e às variáveis de ambiente da Vercel.  
A Vercel injeta automaticamente `CRON_SECRET` em rotas configuradas via `vercel.json` quando o projeto está deployado — em dev o header deve ser enviado manualmente para testar.

---

## Testes

### Unitários (Vitest)
- `focus-municipios.test.ts` — mock fetch, verifica paginação (2 páginas), verifica tratamento de erro HTTP

### E2E / smoke (Playwright ou script manual)
- `GET /api/cron/sync-municipios` sem header → 401
- `GET /api/cron/sync-municipios` com Bearer errado → 401
- `GET /api/cron/sync-municipios` com Bearer correto → 200, `{ ok: true, total: N, upserted: N }`
- Query Supabase após sync: `municipios_nfse` tem registros com `codigo_ibge`, `nfse_habilitada`, `focus_synced_at` preenchidos

---

## DoD (Definition of Done)

- [ ] Migration `0015` criada e documentada
- [ ] `focus-municipios.ts` com paginação + tipagem
- [ ] Route `sync-municipios` protegida, retorna log estruturado
- [ ] `vercel.json` com cron configurado
- [ ] `database.ts` atualizado
- [ ] `municipio-nfse.server.ts` com novo tipo e query
- [ ] `saude-empresa.ts` com nova lógica (sem `isSim()`)
- [ ] `configuracoes/page.tsx` monta `municipioInfo` com novos campos
- [ ] `NfseForm.tsx` usa `provedor_nfse` e `possui_cancelamento_nfse`
- [ ] `notas_fiscais/[id]/page.tsx` e `actions.ts` usam `possui_cancelamento_nfse`
- [ ] `tsc --noEmit` verde
- [ ] Vitest verde
