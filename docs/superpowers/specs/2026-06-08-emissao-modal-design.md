# Spec — Emissão de NF via modal (popup)

> **Data:** 2026-06-08
> **Antecede:** sucede o lançamento manual (`2026-06-08-nota-manual-design.md`), que entrou antes.
> **Origem:** brainstorm aprovou a **abordagem A** na sessão anterior; este spec a formaliza.
> **Contexto:** hoje a emissão é um fluxo de 4 páginas (uma tela de escolha de tipo + 3 forms,
> um por rota). O pedido é fazer a emissão **via popup/modal**, sem sair da lista de notas.

## Problema / objetivo

A emissão atual navega por rotas: `/notas_fiscais/emissao` (escolhe o tipo) →
`/notas_fiscais/emissao/{nfse,nfe,nfce}` (cada uma faz guard server-side + carrega dados +
renderiza seu form). Queremos que toda a emissão aconteça num **modal multi-step** disparado do
dropdown "Nova nota", sem troca de página: escolher tipo → preencher → emitir → fechar e ver a
nota na lista.

## Decisões (fechadas)

- **Modal-only.** As rotas `/notas_fiscais/emissao` e `/emissao/{nfse,nfe,nfce}` são **removidas**.
  Os guards server-side de cada página migram para uma action `prepararEmissaoAction(tipo)`.
- **Cobre os 3 tipos** (NFS-e / NF-e / NFC-e), reusando os forms atuais dentro do modal.
- **Pós-emissão = fechar + refresh.** No sucesso o modal fecha e a lista recarrega
  (`router.refresh()`) — o usuário fica na lista com a nota nova visível. Para isso o form de NFS-e
  deixa o padrão `<form action>`/redirect e passa a chamar `emitirNotaAction` direto (igual NF-e/NFC-e
  já fazem). Comportamento uniforme nos 3 tipos.
- **Padrão de modal:** `<dialog>` nativo (`showModal()`/`.close()`), header com X, body scrollável,
  footer/ações — espelhando `src/components/ClienteFormDialog.tsx`.

## Arquitetura

### Pasta privada `_emissao/`

Os componentes de emissão saem de `emissao/` (que é rota e será deletada) para
`notas_fiscais/_emissao/` — pasta com prefixo `_`, que o App Router **não** trata como rota.

Movidos (conteúdo inalterado, salvo as mudanças de form descritas abaixo):
- `emissao/EmissaoForm.tsx` → `_emissao/EmissaoForm.tsx`
- `emissao/ClienteCombobox.tsx` → `_emissao/ClienteCombobox.tsx`
- `emissao/nfe/NfeForm.tsx` → `_emissao/NfeForm.tsx`
- `emissao/nfce/NfceForm.tsx` → `_emissao/NfceForm.tsx`
- `emissao/_components/ItensField.tsx` → `_emissao/ItensField.tsx`

Novo:
- `_emissao/EmitirNotaDialog.tsx` (client) — o modal multi-step.

### `EmitirNotaDialog` (multi-step)

Client component controlado por `open`/`onClose` (igual `ClienteFormDialog`). Estado interno:

```ts
type Step = 'tipo' | 'form';
type Tipo = 'nfse' | 'nfe' | 'nfce';
// step: Step; tipo: Tipo | null; tipos: TiposHabilitados | null;
// preparo: PreparoOk | null; bloqueio: Bloqueio | null; carregando: boolean
```

Fluxo:

1. **Ao abrir** (`open` vira true): `step='tipo'`; chama `listarTiposEmissaoAction()` →
   `{ nfse, nfe, nfce }`. Renderiza os **3 cards** (NFS-e/Serviço, NF-e/Produto, NFC-e/Consumidor),
   desabilitando os não habilitados (mesma UX de `emissao/page.tsx`: opacidade + "não habilitado").
   Se **exatamente 1** tipo habilitado, pula direto pro passo `form` desse tipo (sem mostrar o chooser).
2. **Escolher tipo:** `carregando=true`; chama `prepararEmissaoAction(tipo)`.
   - Resultado `{ ok:false, bloqueio }` → renderiza painel de bloqueio (título + mensagem + link
     opcional "labelLink → href") com botão "Voltar" pro chooser.
   - Resultado `{ ok:true, dados }` → `step='form'`, renderiza o form do tipo com `dados`.
3. **Submeter o form:** o form chama sua action async; no `ok` dispara `onSuccess()`.
4. **`onSuccess`** (no dialog) → `onClose()` + `router.refresh()`.

Cabeçalho do dialog muda por passo: "Emitir nota fiscal" (chooser) / "Emitir NFS-e|NF-e|NFC-e" (form).
No passo `form` há um "Voltar" que volta ao chooser (reseta `tipo`/`preparo`/`bloqueio`).
Fechar (X / Esc / Cancelar) chama `onClose` quando não está enviando.

### Server actions (em `notas_fiscais/actions.ts`)

**`listarTiposEmissaoAction(): Promise<TiposHabilitados>`**

Espelha a lógica de flags de `emissao/page.tsx`:

```ts
export type TiposHabilitados = { nfse: boolean; nfe: boolean; nfce: boolean };
```

- Resolve `user` + `companyId` (profile.current_company). Sem empresa → tudo `false`.
- Lê `empresas_fiscais` (`focus_habilita_nfse, focus_habilita_nfsen_homologacao, focus_habilita_nfe,
  focus_habilita_nfce, empresa_fiscal_ativada`, `deleted_at is null`).
- `ativa = empresa_fiscal_ativada === true`.
  - `nfse = ativa && (focus_habilita_nfse === true || focus_habilita_nfsen_homologacao === true)`
  - `nfe  = ativa && focus_habilita_nfe === true`
  - `nfce = ativa && focus_habilita_nfce === true`

**`prepararEmissaoAction(tipo): Promise<PreparoEmissao>`**

```ts
export type Bloqueio = { titulo: string; mensagem: string; href?: string; labelLink?: string };
export type PreparoEmissao =
  | { ok: true; tipo: 'nfse'; dados: DadosNfse }
  | { ok: true; tipo: 'nfe';  dados: DadosNfe }
  | { ok: true; tipo: 'nfce'; dados: DadosNfce }
  | { ok: false; bloqueio: Bloqueio };

type DadosNfse = { razaoSocial: string; clientes: ClienteOption[]; previewImposto: PreviewImposto; cnaes: CnaeOption[] };
type DadosNfe  = { clientes: ClienteOption[]; produtos: ProdutoOption[] };
type DadosNfce = { produtos: ProdutoOption[] };
```

Faz os mesmos guards/cargas das páginas atuais, devolvendo `bloqueio` em vez de renderizar:

- **nfse** (de `emissao/nfse/page.tsx`):
  - sem `companyId` → bloqueio "Nenhuma empresa selecionada".
  - sem `empresas_fiscais` → "Cadastro fiscal incompleto" (`href:/configuracoes?tab=regime`,
    `labelLink:'Ir para Regime tributário'`).
  - sem `company.codigo_municipio` → "Município sem código IBGE"
    (`href:/configuracoes?tab=dados`, `labelLink:'Ir para Dados da empresa'`).
  - `municipios_nfse.status_nfse !== 'ativo'` → "NFS-e indisponível para este município" com a
    mensagem do mapa `statusLabel` (fora_do_ar/pausado/em_implementacao/em_reimplementacao/inativo/
    nao_implementado).
  - ok → `dados`: `razaoSocial` (company.razao_social), `clientes` (ativos, ≤500), `previewImposto`
    (`obterPreviewImposto`), `cnaes` (`listarCnaesEmpresaAction`).
- **nfe** (de `emissao/nfe/page.tsx`):
  - `empresa_fiscal_ativada !== true` → "Ative a empresa fiscal antes de emitir."
    (`href:/configuracoes?tab=fiscal`).
  - `focus_habilita_nfe !== true` → "Esta empresa não está habilitada para emitir NF-e."
  - ok → `dados`: `clientes`, `produtos` (`listarProdutosAction`).
- **nfce** (de `emissao/nfce/page.tsx`):
  - `empresa_fiscal_ativada !== true` → "Ative a empresa fiscal antes de emitir."
    (`href:/configuracoes?tab=fiscal`).
  - `focus_habilita_nfce !== true` → "Esta empresa não está habilitada para emitir NFC-e."
  - ok → `dados`: `produtos`.

> A validação **forte** continua na própria action de emissão (`emitirNotaAction` revalida
> empresa/município/cliente etc.). `prepararEmissaoAction` é o guard de UX (decide bloquear o form
> ou liberar com os dados), não a fonte de verdade.

### Mudanças nos forms (callback de sucesso)

Todos os forms ganham uma prop `onSuccess: () => void` e, no sucesso da emissão, chamam
`onSuccess()` em vez de navegar.

- **`EmissaoForm` (NFS-e)** — hoje usa `<form action={emitirNotaFormAction}>` + `useFormStatus`.
  Passa a:
  - `props`: `{ clientes, previewImposto, cnaes, onSuccess }`.
  - submit via `onSubmit` (sem `action=`): faz a validação Zod que já existe, monta o
    `EmitirNotaInput` (clienteId, codigoTributacao, descricao, valorReais, aliquotaIssPercentual, cnae)
    e chama `emitirNotaAction(input)` direto.
  - estado local `enviando` (substitui `useFormStatus`); botão desabilita e mostra "Emitindo…".
  - `ok` → `onSuccess()`. Erro → seta `clientErr` (inline, como já faz).
- **`NfeForm`** — já chama `emitirNfeAction` async. Troca `router.push('/notas_fiscais')` por
  `onSuccess()`. Recebe `onSuccess` por prop (mantém `clientes`/`produtos`).
- **`NfceForm`** — idem: troca `router.push` por `onSuccess()`. Recebe `onSuccess` (mantém `produtos`).

### Entrada: `NovaNotaDropdown`

Passa a controlar o estado do modal (client já é):

- Item **"Emitir NF"**: vira `<button>` que faz `setEmitirOpen(true)` (em vez de `<Link href=/emissao>`).
- Item **"Nota manual"**: continua `<Link href="/notas_fiscais/manual">`.
- Renderiza `<EmitirNotaDialog open={emitirOpen} onClose={() => setEmitirOpen(false)} />`.

### Remoções

- Deleta: `emissao/page.tsx`, `emissao/nfse/page.tsx`, `emissao/nfe/page.tsx`,
  `emissao/nfce/page.tsx` e as pastas que ficarem vazias (`emissao/`, `nfse/`, `nfe/`, `nfce/`,
  `_components/`).
- Remove `emitirNotaFormAction` de `actions.ts` (fica morto após a conversão do `EmissaoForm`).
  Se o import `redirect` do `next/navigation` ficar sem uso em `actions.ts`, remover também.

### Ajustes de import / links

- `manual/page.tsx` e `manual/NotaManualForm.tsx`: `../emissao/ClienteCombobox` →
  `../_emissao/ClienteCombobox`.
- Forms movidos: ajustar imports relativos para os irmãos em `_emissao/`
  (`./ClienteCombobox`, `./ItensField`).
- Home (`(auth)/page.tsx`): `DashboardCard` "Última nota emitida" → `action.href` de
  `'/notas_fiscais/emissao'` para `'/notas_fiscais'`.

## Arquitetura — arquivos

| Arquivo | Ação |
|---|---|
| `notas_fiscais/_emissao/EmitirNotaDialog.tsx` | **novo** — modal multi-step (chooser + form) |
| `notas_fiscais/_emissao/EmissaoForm.tsx` | mover de `emissao/`; converter p/ `onSuccess` + `emitirNotaAction` |
| `notas_fiscais/_emissao/NfeForm.tsx` | mover de `emissao/nfe/`; `onSuccess` no lugar de `router.push` |
| `notas_fiscais/_emissao/NfceForm.tsx` | mover de `emissao/nfce/`; `onSuccess` no lugar de `router.push` |
| `notas_fiscais/_emissao/ClienteCombobox.tsx` | mover de `emissao/` |
| `notas_fiscais/_emissao/ItensField.tsx` | mover de `emissao/_components/` |
| `notas_fiscais/actions.ts` | `+ listarTiposEmissaoAction`, `+ prepararEmissaoAction`; `- emitirNotaFormAction` |
| `notas_fiscais/NovaNotaDropdown.tsx` | "Emitir NF" abre o dialog; renderiza `EmitirNotaDialog` |
| `notas_fiscais/manual/page.tsx` | import de `ClienteCombobox` → `../_emissao` |
| `notas_fiscais/manual/NotaManualForm.tsx` | import de `ClienteCombobox` → `../_emissao` |
| `app/(auth)/page.tsx` | `DashboardCard` href → `/notas_fiscais` |
| `emissao/page.tsx`, `emissao/{nfse,nfe,nfce}/page.tsx`, `emissao/_components/` | **deletar** |

## Testes

- **`notas-filtros.test.ts`** (existente): deve seguir verde (sem mudança).
- **`prepararEmissaoAction` / `listarTiposEmissaoAction`**: dependem de Supabase/Focus; sem harness
  de action no projeto → cobertura por **smoke manual** (abaixo), não por teste unitário (YAGNI —
  não vale extrair toda a query pra um helper puro só pra testar guard).
- **`tsc`** limpo (sem erros de tipo após mover arquivos e trocar assinaturas).
- **Smoke manual** (empresa AL Piscinas, hom):
  1. Lista de notas → "Nova nota" → "Emitir NF" → abre o modal no chooser com os tipos habilitados.
  2. Escolhe NFS-e → form carrega clientes/preview/CNAE → preenche → "Emitir nota".
  3. Sucesso → modal fecha, lista recarrega, a nota nova aparece (status `pendente`).
  4. Tipo bloqueado (ex.: município indisponível) → painel de bloqueio com link, "Voltar" volta ao chooser.
  5. "Nota manual" continua indo pra `/notas_fiscais/manual`.

## Fora de escopo (YAGNI)

- Mudar o que `emitirNotaAction`/`emitirNfeAction`/`emitirNfceAction` fazem por dentro (Focus,
  inserts, status) — só trocamos quem as chama e o pós-sucesso.
- Suporte a produção (continua homologação, como hoje).
- Deep-link para abrir o modal já num tipo (ex.: `?emitir=nfse`) — pode vir depois.
- Multi-step adicional (revisão/confirmação antes de emitir) — o form único por tipo basta.
