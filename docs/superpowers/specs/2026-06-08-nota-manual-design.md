# Spec — Lançamento manual de NF ("Nova nota": manual × emissão)

> **Data:** 2026-06-08
> **Antecede:** a refatoração da emissão para popup/modal (passo seguinte; este vem antes)
> **Contexto:** clientes que entram na plataforma já têm NFs emitidas fora. Precisam **registrar
> manualmente** (sem chamar a Focus) além de **emitir** de verdade.

## Problema / objetivo

Hoje só existe **emissão real** (chama a Focus). Faltam: (1) **lançar manualmente** uma NF já
emitida fora — para histórico e base de imposto; (2) **distinguir** na listagem o que é lançamento
manual vs emissão real (coluna + filtro); (3) o ponto de entrada "Nova nota" oferecendo as duas opções.

## Decisões (do brainstorming)

- **Coluna `origem`** em `notas_fiscais` (`'emissao'`/`'manual'`) — separa a **origem** (não muda) do
  **status** (ciclo de vida). Não usar só o status, senão cancelar uma manual apaga o rastro de origem.
- **Status próprio `'lancada'`** para a nota manual (nasce válida, sem ciclo Focus; se cancelada vira
  `'cancelada'` mantendo `origem='manual'`).
- **Form manual completo (com itens)**, unificado (tipo é um campo), reusando `ClienteCombobox` + `ItensField`.
- Sem preview de imposto, sem gates de município/Focus, sem upload de PDF/XML (YAGNI).

## 1. Banco — coluna `origem`

Migration aditiva em `notas_fiscais`:

```sql
ALTER TABLE public.notas_fiscais
  ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'emissao';
-- garante valores válidos (idempotente; remove e recria o check se já existir)
ALTER TABLE public.notas_fiscais DROP CONSTRAINT IF EXISTS notas_fiscais_origem_check;
ALTER TABLE public.notas_fiscais
  ADD CONSTRAINT notas_fiscais_origem_check CHECK (origem IN ('emissao','manual'));
```

Notas existentes ficam `'emissao'` (default). **Status `'lancada'`:** se houver `CHECK` em `status`,
estendê-lo para incluir `'lancada'` (o implementador confirma contra o banco real — `db_atual.sql`
não mostra check de status; pode não existir). Os statuses reais usados: `pendente`, `processando`,
`autorizada`, `erro`, `cancelada` → adicionar `lancada`.

## 2. Botão "Nova nota" (dropdown)

Na **lista** (`NotasFiscaisList.tsx`), o botão "Emitir nova" vira **"Nova nota"**, um dropdown
(client) com dois itens:

| Item | Ação |
|---|---|
| **Emitir NF** | `/notas_fiscais/emissao` (fluxo atual — vira modal no passo seguinte) |
| **Nota manual** | `/notas_fiscais/manual` (novo) |

Componente novo `NovaNotaDropdown.tsx` (client). **Home (`(auth)/page.tsx`): fora deste escopo** —
o card de ação ali usa um `StatCard` com `{label, href}` (link simples, não comporta dropdown);
fica como está ("Emitir nova" → `/notas_fiscais/emissao`). O dropdown é a entrada canônica na
página de notas.

## 3. Form "Nota manual" — `/notas_fiscais/manual`

Página (server carrega clientes da empresa; modaliza junto no passo seguinte). Renderiza um
**form unificado** `NotaManualForm.tsx` (client):

Campos:
- **Tipo** — NFS-e / NF-e / NFC-e (mapeia p/ `tipo_documento` `'NFSe'|'NFe'|'NFCe'`)
- **Cliente** — `ClienteCombobox` (reuso)
- **Número** — número/identificador da nota já emitida fora
- **Data de emissão** — data real da nota
- **Itens** — `ItensField` (reuso): descrição + valor por item
- **Valor total** — calculado (somatório dos itens), exibido read-only

Submit → server action `lancarNotaManualAction(input)`:
1. auth + `companyId` (profile.current_company)
2. valida tipo/cliente/valor/data/itens
3. `insert` em `notas_fiscais`:
   - `company_id`, `cliente_id`
   - `tipo_documento` (do tipo)
   - `referencia` — gerada interna única (ex.: `man_<uuid>`; o número externo do usuário vai no payload)
   - `data_emissao`, `valor_total`
   - `status = 'lancada'`, `origem = 'manual'`
   - `payload_focusnfe` — JSON com `{ numero, itens, manual: true }` (a tabela é mínima; itens/número ficam no jsonb, como o payload da Focus nas emitidas)
4. `revalidatePath('/notas_fiscais')` + redireciona pra lista (ou pro detalhe)

**Sem Focus.** A nota manual **conta pra base de imposto** igual às emitidas (entra no
`valor_total`/competência por `data_emissao`) — confirmar que a fonte de receita da apuração
(`lerReceitasParaApuracao`/`receitas-source`) lê de `notas_fiscais` por valor/competência e **não
exclui** por status/origem (se excluir 'lancada', ajustar para incluí-la).

## 4. Filtro de origem + tag na lista

- **`notas-filtros.ts`**: novo campo `origem: string` (default `'todos'`) no tipo `Filtros` +
  parse de `sp.get('origem')` em `parseFiltrosFromParams`.
- **Query da lista** (`page.tsx` da listagem): quando `origem !== 'todos'`, `.eq('origem', origem)`.
- **UI de filtros** (na seção de filtros da lista): seletor **Origem** — `Todas` / `Emitidas` / `Manuais`.
- **Lista** (`NotasFiscaisList.tsx`): tag discreta **"Manual"** na linha quando `origem === 'manual'`
  (o status segue mostrando `lancada`/`cancelada`/etc. com seu badge).

## Arquitetura — arquivos

| Arquivo | Ação |
|---|---|
| `supabase/migrations/NNNN_notas_fiscais_origem.sql` | migration: coluna `origem` + check; status `lancada` |
| `app/(auth)/notas_fiscais/NovaNotaDropdown.tsx` | novo (client) — dropdown "Nova nota" |
| `app/(auth)/notas_fiscais/manual/page.tsx` | novo (server) — carrega clientes, renderiza o form |
| `app/(auth)/notas_fiscais/manual/NotaManualForm.tsx` | novo (client) — form unificado (reusa ClienteCombobox + ItensField) |
| `app/(auth)/notas_fiscais/actions.ts` | `lancarNotaManualAction` (+ a query da lista ganha filtro `origem`) |
| `app/(auth)/notas_fiscais/notas-filtros.ts` | campo `origem` no tipo + parse |
| `app/(auth)/notas_fiscais/NotasFiscaisList.tsx` | troca botão por `NovaNotaDropdown`; filtro Origem; tag "Manual" |
| `app/(auth)/notas_fiscais/page.tsx` | aplica filtro `origem` na query |

## Testes

- `notas-filtros.test.ts` (já existe): cobrir o parse do `origem` (default `'todos'`, valores `emitidas`/`manuais`).
- `lancarNotaManualAction`: teste de validação (campos obrigatórios) se houver harness de action; senão smoke manual.
- Smoke manual: "Nova nota" → "Nota manual" → preenche tipo/cliente/itens → salva → aparece na lista
  com tag "Manual" e status `lancada`; filtro Origem=Manuais isola; a nota entra na base de imposto da competência.

## Fora de escopo (YAGNI)

- Promover manual → emissão real.
- Upload de PDF/XML da nota manual.
- Modalizar (vem no passo seguinte, junto com a emissão real).
- Edição de nota manual (v1: lançar; editar depois se necessário).
