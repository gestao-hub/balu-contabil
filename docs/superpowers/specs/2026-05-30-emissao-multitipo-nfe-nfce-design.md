# Emissão multi-tipo de NF (NFS-e / NF-e / NFC-e) — Design

> **Status:** desenho aprovado (2026-05-30).
> **Escopo:** habilitar emissão de **NF-e (modelo 55)** e **NFC-e (modelo 65)** no painel, ao lado
> da NFS-e já existente. Meta desta entrega = **wiring até a resposta da Focus** (em homologação):
> tela de escolha de tipo + formulário por tipo + envio real à Focus. Receber a resposta da Focus —
> **inclusive o erro de atividade/CNAE** — já "destrava" os 2 braços ainda não testados.

---

## 1. Contexto (o que já existe — verificado)

- **Cliente Focus** (`src/lib/clients/focus-nfe.ts`): **já tem** `emitirNfe`, `emitirNfce`,
  `consultarStatusNfe/Nfce`, `baixarDanfe(Nfce)`, `cancelarNfe/Nfce` (todos `FocusEnv='hom'|'prod'`,
  default `hom`; emissão usa token da empresa em `companies.focus_token`). Esta entrega **não mexe no
  cliente HTTP**.
- **`notas_fiscais.tipo_documento`** já existe e aceita `'NFe'|'NFCe'|'NFSe'`; hoje a action grava
  hardcoded `'NFSe'` (`actions.ts:229`). `src/lib/fiscal/notas-tipo.ts` já define `TipoDoc` e
  `assertTipoDoc`.
- **Fluxo NFS-e** (referência a espelhar): `emissao/page.tsx` (guards) → `EmissaoForm.tsx` (zod) →
  `emitirNotaAction` (`actions.ts:147`) → `buildNfsePayload` (`lib/fiscal/nfse-payload.ts`) → grava
  nota `pendente` → `focus.emitirNfse(ref, payload, focus_token, 'hom')` → erro traduzido por
  `lib/fiscal/focus-erro.ts`, status `'erro'` + `payload_focusnfe.error`.
- **`aux_produtos`**: tabela **existe no banco** (colunas: `id, company_id, codigo, descricao, ncm,
  cfop, tipo_nf, unidade_comercial, quantidade_comercial, valor_unitario_comercial, finalizado,
  created_at, updated_at`), mas **NÃO tem UI, não é usada em emissão, e NÃO está em
  `src/types/database.ts`** (types desatualizado). Origem Bubble legada.
- **`empresas_fiscais`**: tem flags de habilitação só para NFS-e (`focus_habilita_nfse`,
  `focus_habilita_nfsen_producao`, `focus_habilita_nfsen_homologacao`). **Não há** flag p/ NF-e/NFC-e.

---

## 2. Fluxo

```
/notas_fiscais/emissao  →  TELA DE ESCOLHA (3 cards: NFS-e · NF-e · NFC-e)
                           • os 3 cards SEMPRE visíveis
                           • card DESABILITADO (cinza, não clicável) se a empresa
                             não tiver a flag focus_habilita_<tipo>
        │
        ├─ NFS-e → EmissaoForm atual (intocado)         → emitirNotaAction (já existe)
        ├─ NF-e  → /notas_fiscais/emissao/nfe  (novo)    → emitirNfeAction   (novo)
        └─ NFC-e → /notas_fiscais/emissao/nfce (novo)    → emitirNfceAction  (novo)
                          │
              builder puro (por tipo) monta JSON Focus
              → INSERT notas_fiscais (status 'pendente', tipo_documento 'NFe'|'NFCe')
              → focus.emitirNfe/Nfce(ref, payload, focus_token, 'hom')
              → rejeição (422 / erro CNAE) → status 'erro' + payload_focusnfe.error
                (mesmo padrão NFS-e; erro legível na listagem/detalhe)
```

---

## 3. Formulários

### 3.1 NF-e (modelo 55) — `emissao/nfe`
| Bloco | Campos |
|---|---|
| Operação | `natureza_operacao` (texto, ex. "Venda de mercadoria"), `finalidade` (default `1`=normal) |
| Destinatário | combobox de `clientes` (reusa o de NFS-e) → CNPJ/CPF, nome, endereço, indicador IE |
| **Itens** | `ItensField` (≥1 item) — ver §4 |
| Totais | calculado dos itens (read-only) |

### 3.2 NFC-e (modelo 65) — `emissao/nfce`
| Bloco | Campos |
|---|---|
| Operação | `presenca_comprador` (default `1`), `modalidade_frete` (default `9`=sem frete), `local_destino` (default `1`) |
| Destinatário | **opcional** (consumidor final): CPF opcional + nome opcional |
| **Itens** | `ItensField` (≥1 item) — ver §4 |
| **Pagamento** | `formas_pagamento[]` **obrigatório** (ex. forma `01`=dinheiro + valor) — bloco que NF-e não tem |

Validação client-side com **zod**, no padrão do `EmissaoForm` atual. Cada form submete via server
action dedicada (`emitirNfeAction` / `emitirNfceAction`).

---

## 4. Modelo de itens / produtos (`ItensField`, compartilhado NF-e + NFC-e)

```
┌─ Itens da nota ──────────────────────────────────┐
│  [ Buscar produto… ▼]   ← dropdown de aux_produtos  │
│   selecionar → preenche linha (ncm/cfop/unid/valor)  │
│  ┌─ linha ──────────────────────────────────────┐  │
│  │ desc | NCM | CFOP | un | qtd | vlr unit | [×]  │  │  [×] = remove DA NOTA
│  └────────────────────────────────────────────────┘  │
│  [ + Adicionar produto novo (inline) ]               │
└────────────────────────────────────────────────────┘
```

**Comportamento (decisões do usuário):**
1. **Dropdown** lista produtos de `aux_produtos` da empresa, filtrados por `tipo_nf IN ('nfe','nfce')`
   — **produtos de NF-e e NFC-e são compartilhados** (mesmo universo de NCM, intercambiáveis).
   Serviços de NFS-e (sem NCM) ficam de fora. Selecionar → preenche a linha com
   `descricao/ncm/cfop/unidade_comercial/valor_unitario_comercial`.
2. **Criação inline**: "Adicionar produto novo" abre campos (descrição, NCM, CFOP, unidade, qtd,
   valor) → ao confirmar, **grava em `aux_produtos`** (`criarProdutoAction`) → a linha entra na nota
   **e** o produto passa a aparecer no dropdown nas próximas emissões.
3. **Botão [×]** remove o item **da nota** — **não** apaga o produto de `aux_produtos`.
4. **Sem exclusão de produto** nesta entrega → "sujeira sistêmica" **aceita conscientemente**;
   será resolvida depois com o CRUD de produtos.

**Persistência dos itens na nota:** os itens vão dentro de `payload_focusnfe.request` (JSON, já
existe). **Não** se cria tabela de itens nem FK `notas_fiscais → aux_produtos`. `aux_produtos` é o
**catálogo/fonte** dos itens, não o vínculo da nota.

**Impostos por item:** **defaults fixos sensatos**, sem expor no form (ICMS `origem=0`=nacional;
CST/CSOSN conforme regime da empresa). Suficiente para a Focus processar e retornar o erro de CNAE.
Refinamento fiscal completo fica para depois (fora de escopo, §7).

---

## 5. Habilitação e guards

**Migration aditiva** (`empresas_fiscais`):
- `focus_habilita_nfe boolean DEFAULT false`
- `focus_habilita_nfce boolean DEFAULT false`
- **UPDATE** marcando `true` nas 3 flags (nfse/nfe/nfce) para o CNPJ da **AL Piscinas**, para teste
  imediato. (Confirmar o CNPJ/empresa_id alvo na escrita do plano.)

**Guard em 2 camadas:**
- **UI**: os 3 cards sempre **visíveis**; card desabilitado quando a flag for false (não ocultar).
- **Server**: `emitirNfeAction`/`emitirNfceAction` verificam a flag no início e recusam com erro
  claro se não habilitada (defesa real — não confia só na UI). Mesmos guards já existentes de
  NFS-e seguem valendo (empresa ativada, `focus_token` presente, regime configurado).

---

## 6. Componentes — arquivos

**Novos:**
- `src/app/(auth)/notas_fiscais/emissao/page.tsx` — vira **tela de escolha** (3 cards c/ guard por flag).
- `src/app/(auth)/notas_fiscais/emissao/nfe/page.tsx` + `NfeForm.tsx`
- `src/app/(auth)/notas_fiscais/emissao/nfce/page.tsx` + `NfceForm.tsx`
- `src/app/(auth)/notas_fiscais/emissao/_components/ItensField.tsx` (compartilhado)
- `src/lib/fiscal/nfe-payload.ts` + `nfe-payload.test.ts` — `buildNfePayload(...)` puro (modelo 55).
- `src/lib/fiscal/nfce-payload.ts` + `nfce-payload.test.ts` — `buildNfcePayload(...)` puro (modelo 65).

**Modificados:**
- `src/app/(auth)/notas_fiscais/actions.ts` — `+emitirNfeAction`, `+emitirNfceAction`,
  `+criarProdutoAction`, `+listarProdutosAction`. Reusa `generateRef`, `focus-erro`, padrão de
  insert/`payload_focusnfe`/status de `emitirNotaAction`.
- `src/types/database.ts` — **adicionar `aux_produtos`** (regenerar do banco OU adicionar à mão) +
  as 2 flags novas em `empresas_fiscais`.
- migration nova em `supabase/migrations/` (flags + UPDATE AL Piscinas).

**Reaproveitado sem alteração:** `focus-nfe.ts` (emitir/status/cancelar/download NF-e/NFC-e),
`notas-tipo.ts` (`TipoDoc`/dispatch), webhook `api/webhooks/focus` (campos genéricos),
`atualizarStatusNotaAction`/`cancelarNotaAction` (já fazem dispatch por tipo).

---

## 7. Builders puros (espelham `nfse-payload.ts`)

- `buildNfePayload(empresa, destinatario, itens)` → JSON modelo 55. Obrigatórios Focus:
  `natureza_operacao`, `data_emissao`, `tipo_documento`, `finalidade`, emitente (CNPJ),
  destinatário (CNPJ/CPF + nome), `items[]` (cada: `numero_item`, `codigo_produto`, `descricao`,
  `ncm`, `cfop`, `unidade_comercial`, `quantidade_comercial`, `valor_unitario_comercial`,
  `valor_bruto`, + ICMS default). Defaults: `finalidade=1`, ICMS `origem=0`, CST por regime.
- `buildNfcePayload(empresa, itens, formasPagamento, consumidor?)` → JSON modelo 65. Obrigatórios
  Focus: `cnpj_emitente`, `data_emissao`, `modalidade_frete`, `local_destino`,
  `presenca_comprador`, `items[]`, `formas_pagamento[]`. Destinatário opcional.
- Ambos com **teste unitário sem rede** (como `nfse-payload.test.ts`).

---

## 8. Tratamento de resposta / erro (mesmo padrão NFS-e)

Grava nota `pendente` → `focus.emitirNfe/Nfce(ref, payload, focus_token, 'hom')` → sucesso (202)
mantém `pendente` (webhook completa); rejeição síncrona (**422** / erro de CNAE) → `focus-erro.ts`
traduz → `status='erro'` + `payload_focusnfe.error`, exibido na listagem/detalhe. **O erro de
atividade/CNAE esperado cai exatamente aqui, legível** — é o sinal de "destravado".

---

## 9. Fora de escopo (explícito)

- CRUD completo e **exclusão** de `aux_produtos` (sujeira sistêmica aceita; resolver depois).
- Campos fiscais avançados por item (ICMS/IPI/PIS/COFINS detalhados, CST manual).
- Emissão em **produção** (fica travado em `hom`).
- Flags de habilitação populadas de forma automática/sincronizada com a Focus (por ora, manual via
  migration p/ AL Piscinas).
- Polling/webhook de NF-e/NFC-e — **reaproveita** o existente, sem retrabalho nesta entrega.

---

## 10. Testes / verificação

- Unit: `nfe-payload.test.ts`, `nfce-payload.test.ts` (montagem do JSON, defaults, itens, totais).
- Manual (homologação, AL Piscinas): escolher NF-e → adicionar produto inline → emitir → **observar
  a resposta da Focus** (sucesso OU erro de CNAE legível). Idem NFC-e. Confirmar que a nota aparece
  na listagem com o status correto e o erro guardado em `payload_focusnfe.error`.
- Guard: empresa sem a flag → card desabilitado na UI **e** action recusa no servidor.

---

## Changelog
- **2026-05-30** — Criação. Escopo: wiring NF-e/NFC-e até a resposta da Focus (hom). Decisões:
  tela de escolha primeiro; produtos via `aux_produtos` com **criação inline** (sem exclusão agora);
  dropdown compartilha produtos nfe+nfce; flags novas + AL Piscinas habilitada p/ teste; impostos com
  defaults fixos; resposta/erro no padrão NFS-e.
