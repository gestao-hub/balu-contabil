# Spec — Criação de NF via modal (emissão real + nota manual)

> **Data:** 2026-06-08
> **Sucede:** o lançamento manual (`2026-06-08-nota-manual-design.md`), que entrou como página.
> **Origem:** brainstorm aprovou a **abordagem A** (emissão real em modal); na revisão o usuário
> pediu **simetria** — a nota manual também vira modal.
> **Contexto:** hoje a criação de nota usa rotas: emissão é 4 páginas (escolhe tipo + 3 forms) e a
> nota manual é 1 página (`/notas_fiscais/manual`). Queremos **toda criação de nota num popup**,
> sem sair da lista.

## Problema / objetivo

O dropdown "Nova nota" tem dois caminhos, ambos navegando pra outra rota:
- **Emitir NF** → `/notas_fiscais/emissao` (escolhe tipo) → `/emissao/{nfse,nfe,nfce}` (guard
  server-side + carga + form).
- **Nota manual** → `/notas_fiscais/manual` (carga de clientes + form).

Queremos que os **dois** aconteçam em **modais** disparados do dropdown: escolher/preencher →
salvar → fechar e ver a nota na lista. Sem troca de página.

## Decisões (fechadas)

- **Modal-only nos dois fluxos.** Removidas as rotas `/notas_fiscais/emissao`,
  `/emissao/{nfse,nfe,nfce}` e `/notas_fiscais/manual`. Os guards/cargas server-side viram actions.
- **Emissão cobre os 3 tipos** (NFS-e / NF-e / NFC-e), reusando os forms atuais dentro do modal.
- **Pós-sucesso = fechar + refresh** nos dois modais: fecha o popup e `router.refresh()` — o usuário
  fica na lista com a nota nova visível. Para a emissão NFS-e, o form deixa o padrão
  `<form action>`/redirect e passa a chamar `emitirNotaAction` direto (igual NF-e/NFC-e). A nota
  manual deixa o `router.push('/notas_fiscais')` e passa a `onSuccess()`.
- **Padrão de modal:** `<dialog>` nativo (`showModal()`/`.close()`), header com X, body scrollável —
  espelhando `src/components/ClienteFormDialog.tsx`.
- **Pasta privada única `_nova-nota/`** para toda a UI de criação (dois dialogs + forms + combobox).
  Prefixo `_` → o App Router não trata como rota.

## Arquitetura

### Pasta privada `_nova-nota/`

Tudo que era rota de criação migra pra cá. Movidos (conteúdo inalterado salvo as mudanças de form
abaixo):

| De | Para |
|---|---|
| `emissao/EmissaoForm.tsx` | `_nova-nota/EmissaoForm.tsx` |
| `emissao/ClienteCombobox.tsx` | `_nova-nota/ClienteCombobox.tsx` |
| `emissao/nfe/NfeForm.tsx` | `_nova-nota/NfeForm.tsx` |
| `emissao/nfce/NfceForm.tsx` | `_nova-nota/NfceForm.tsx` |
| `emissao/_components/ItensField.tsx` | `_nova-nota/ItensField.tsx` |
| `manual/NotaManualForm.tsx` | `_nova-nota/NotaManualForm.tsx` |

Novos:
- `_nova-nota/EmitirNotaDialog.tsx` (client) — modal multi-step da **emissão real**.
- `_nova-nota/NotaManualDialog.tsx` (client) — modal da **nota manual**.

### `EmitirNotaDialog` (emissão real, multi-step)

Client controlado por `open`/`onClose` (igual `ClienteFormDialog`). Estado interno:

```ts
type Step = 'tipo' | 'form';
type Tipo = 'nfse' | 'nfe' | 'nfce';
// step; tipo: Tipo | null; tipos: TiposHabilitados | null;
// preparo: PreparoOk | null; bloqueio: Bloqueio | null; carregando: boolean
```

Fluxo:

1. **Ao abrir:** `step='tipo'`; chama `listarTiposEmissaoAction()` → `{ nfse, nfe, nfce }`. Renderiza
   os **3 cards** (NFS-e/Serviço, NF-e/Produto, NFC-e/Consumidor), desabilitando os não habilitados
   (mesma UX de `emissao/page.tsx`: opacidade + "não habilitado"). Se **exatamente 1** habilitado,
   pula direto pro `form` desse tipo.
2. **Escolher tipo:** `carregando=true`; chama `prepararEmissaoAction(tipo)`.
   - `{ ok:false, bloqueio }` → painel de bloqueio (título + mensagem + link opcional
     "labelLink → href") com "Voltar" pro chooser.
   - `{ ok:true, dados }` → `step='form'`, renderiza o form do tipo com `dados`.
3. **Submeter o form:** o form chama sua action async; no `ok` dispara `onSuccess()`.
4. **`onSuccess`** (no dialog) → `onClose()` + `router.refresh()`.

Cabeçalho por passo: "Emitir nota fiscal" (chooser) / "Emitir NFS-e|NF-e|NFC-e" (form). No `form`
há um "Voltar" que volta ao chooser (reseta `tipo`/`preparo`/`bloqueio`). Fechar (X / Esc / Cancelar)
chama `onClose` quando não está enviando.

### `NotaManualDialog` (nota manual)

Client controlado por `open`/`onClose`. Sem multi-step (tipo é um campo do form, não um passo).

1. **Ao abrir:** `carregando=true`; chama `prepararNotaManualAction()` → `{ clientes }`.
2. Renderiza `NotaManualForm` com `clientes` + `onSuccess`.
3. **`onSuccess`** → `onClose()` + `router.refresh()`.

Header "Lançar nota manual"; subtítulo "Registre uma NF já emitida fora da plataforma. Não emite na
Receita." (o mesmo da página atual). Fechar quando não está enviando.

### Server actions (em `notas_fiscais/actions.ts`)

**Helper interno (não-action)** para DRY entre os fluxos:

```ts
// resolve clientes ativos da empresa (≤500), no shape ClienteOption
async function lerClientesAtivos(supabase, companyId: string): Promise<ClienteOption[]>
```

**`listarTiposEmissaoAction(): Promise<TiposHabilitados>`** — espelha as flags de `emissao/page.tsx`:

```ts
export type TiposHabilitados = { nfse: boolean; nfe: boolean; nfce: boolean };
```

- Resolve `user` + `companyId`. Sem empresa → tudo `false`.
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
  - sem `companyId` → "Nenhuma empresa selecionada".
  - sem `empresas_fiscais` → "Cadastro fiscal incompleto" (`/configuracoes?tab=regime`,
    "Ir para Regime tributário").
  - sem `company.codigo_municipio` → "Município sem código IBGE" (`/configuracoes?tab=dados`,
    "Ir para Dados da empresa").
  - `municipios_nfse.status_nfse !== 'ativo'` → "NFS-e indisponível para este município" com a
    mensagem do mapa `statusLabel` (fora_do_ar/pausado/em_implementacao/em_reimplementacao/inativo/
    nao_implementado).
  - ok → `dados`: `razaoSocial` (company.razao_social), `clientes` (`lerClientesAtivos`),
    `previewImposto` (`obterPreviewImposto`), `cnaes` (`listarCnaesEmpresaAction`).
- **nfe** (de `emissao/nfe/page.tsx`):
  - `empresa_fiscal_ativada !== true` → "Ative a empresa fiscal antes de emitir."
    (`/configuracoes?tab=fiscal`).
  - `focus_habilita_nfe !== true` → "Esta empresa não está habilitada para emitir NF-e."
  - ok → `dados`: `clientes` (`lerClientesAtivos`), `produtos` (`listarProdutosAction`).
- **nfce** (de `emissao/nfce/page.tsx`):
  - `empresa_fiscal_ativada !== true` → "Ative a empresa fiscal antes de emitir."
    (`/configuracoes?tab=fiscal`).
  - `focus_habilita_nfce !== true` → "Esta empresa não está habilitada para emitir NFC-e."
  - ok → `dados`: `produtos`.

**`prepararNotaManualAction(): Promise<{ clientes: ClienteOption[] }>`**

- Resolve `user` + `companyId` (sem empresa → `{ clientes: [] }`, como a página faz hoje).
- `clientes = lerClientesAtivos(...)`. Sem bloqueio (a nota manual funciona sem setup fiscal/Focus).

> A validação **forte** continua nas actions de gravação (`emitirNotaAction` revalida
> empresa/município/cliente; `lancarNotaManualAction` valida tipo/itens/data). As actions `preparar*`
> são guard de UX (bloquear ou liberar o form com os dados), não a fonte de verdade.

### Mudanças nos forms (callback de sucesso)

Todos ganham `onSuccess: () => void` e, no sucesso, chamam `onSuccess()` em vez de navegar.

- **`EmissaoForm` (NFS-e)** — hoje `<form action={emitirNotaFormAction}>` + `useFormStatus`. Passa a:
  - props `{ clientes, previewImposto, cnaes, onSuccess }`.
  - submit via `onSubmit` (sem `action=`): mantém a validação Zod existente, monta `EmitirNotaInput`
    (clienteId, codigoTributacao, descricao, valorReais, aliquotaIssPercentual, cnae) e chama
    `emitirNotaAction(input)` direto.
  - estado local `enviando` (substitui `useFormStatus`); botão "Emitindo…".
  - `ok` → `onSuccess()`. Erro → `clientErr` inline (como já faz).
- **`NfeForm`** — já chama `emitirNfeAction`. Troca `router.push('/notas_fiscais')` por `onSuccess()`.
  Recebe `onSuccess` por prop (mantém `clientes`/`produtos`).
- **`NfceForm`** — idem: troca `router.push` por `onSuccess()`. Recebe `onSuccess` (mantém `produtos`).
- **`NotaManualForm`** — hoje, no sucesso: `toast(...)` + `router.push('/notas_fiscais')` +
  `router.refresh()`. Passa a: `toast(...)` + `onSuccess()` (o dialog cuida do refresh). Recebe
  `onSuccess` por prop (mantém `clientes`). Import de `ClienteCombobox` vira sibling `./ClienteCombobox`.

### Entrada: `NovaNotaDropdown`

Passa a controlar o estado dos **dois** modais:

- Item **"Emitir NF"**: `<button>` → `setEmitirOpen(true)` (era `<Link href=/emissao>`).
- Item **"Nota manual"**: `<button>` → `setManualOpen(true)` (era `<Link href=/manual>`).
- Renderiza `<EmitirNotaDialog open={emitirOpen} onClose={() => setEmitirOpen(false)} />` e
  `<NotaManualDialog open={manualOpen} onClose={() => setManualOpen(false)} />`.

### Remoções

- Deleta as rotas: `emissao/page.tsx`, `emissao/{nfse,nfe,nfce}/page.tsx`, `manual/page.tsx`, e as
  pastas que ficarem vazias (`emissao/` e subpastas, `_components/`, `manual/`).
- Remove `emitirNotaFormAction` de `actions.ts` (morto após a conversão do `EmissaoForm`). Se o
  import `redirect` do `next/navigation` ficar sem uso em `actions.ts`, remover também.

### Ajustes de link

- Home (`(auth)/page.tsx`): `DashboardCard` "Última nota emitida" → `action.href` de
  `'/notas_fiscais/emissao'` para `'/notas_fiscais'` (a entrada canônica de criação é o dropdown).

## Arquitetura — arquivos

| Arquivo | Ação |
|---|---|
| `notas_fiscais/_nova-nota/EmitirNotaDialog.tsx` | **novo** — modal multi-step da emissão |
| `notas_fiscais/_nova-nota/NotaManualDialog.tsx` | **novo** — modal da nota manual |
| `notas_fiscais/_nova-nota/EmissaoForm.tsx` | mover; converter p/ `onSuccess` + `emitirNotaAction` |
| `notas_fiscais/_nova-nota/NfeForm.tsx` | mover; `onSuccess` no lugar de `router.push` |
| `notas_fiscais/_nova-nota/NfceForm.tsx` | mover; `onSuccess` no lugar de `router.push` |
| `notas_fiscais/_nova-nota/NotaManualForm.tsx` | mover; `onSuccess` no lugar de `router.push`/`refresh` |
| `notas_fiscais/_nova-nota/ClienteCombobox.tsx` | mover (compartilhado pelos forms) |
| `notas_fiscais/_nova-nota/ItensField.tsx` | mover (NfeForm/NfceForm) |
| `notas_fiscais/actions.ts` | `+ lerClientesAtivos` (helper), `+ listarTiposEmissaoAction`, `+ prepararEmissaoAction`, `+ prepararNotaManualAction`; `- emitirNotaFormAction` |
| `notas_fiscais/NovaNotaDropdown.tsx` | dois itens abrem dialogs; renderiza os dois modais |
| `app/(auth)/page.tsx` | `DashboardCard` href → `/notas_fiscais` |
| `emissao/` (page + nfse/nfe/nfce + _components), `manual/page.tsx` | **deletar** |

## Testes

- **`notas-filtros.test.ts`** (existente): segue verde (sem mudança).
- **Actions `preparar*`/`listarTiposEmissaoAction`**: dependem de Supabase/Focus; sem harness de
  action no projeto → cobertura por **smoke manual** (abaixo), não unitário (YAGNI).
- **`tsc`** limpo após mover arquivos e trocar assinaturas.
- **Smoke manual** (empresa AL Piscinas, hom):
  1. Lista → "Nova nota" → "Emitir NF" → modal abre no chooser com os tipos habilitados.
  2. NFS-e → form carrega clientes/preview/CNAE → preenche → "Emitir nota" → modal fecha, lista
     recarrega, nota nova (`pendente`) aparece.
  3. Tipo bloqueado (ex.: município indisponível) → painel de bloqueio com link; "Voltar" volta ao
     chooser.
  4. "Nova nota" → "Nota manual" → modal abre com clientes → preenche tipo/itens → "Lançar nota" →
     modal fecha, lista recarrega, nota `lancada` com tag "Manual".

## Fora de escopo (YAGNI)

- Mudar o que as actions de gravação (`emitirNotaAction`/`emitirNfeAction`/`emitirNfceAction`/
  `lancarNotaManualAction`) fazem por dentro — só trocamos quem as chama e o pós-sucesso.
- Suporte a produção (continua homologação).
- Deep-link pra abrir um modal já num tipo (ex.: `?emitir=nfse`).
- Multi-step extra (revisão/confirmação antes de emitir) — form único por tipo basta.

---

## Atualizações pós-merge (as-built — 2026-06-08)

Durante/depois da implementação alguns pontos do design acima evoluíram (pedidos do usuário na
mesma sessão). Estado final na `main`:

1. **Nota manual também virou multi-step.** Não é mais form único com campo "Tipo": tem o mesmo
   chooser de 3 cards → form, igual à emissão (simetria).
2. **Manual reusa os MESMOS forms da emissão** via prop `modo: 'emissao' | 'manual'` —
   `EmissaoForm`/`NfeForm`/`NfceForm` servem os dois fluxos. Em manual adicionam **Número** +
   **Data de emissão**, escondem a prévia de imposto e gravam via `lancarNotaManualAction`. O
   `NotaManualForm.tsx` foi **removido**. Assim o form manual é idêntico ao da emissão por tipo.
3. **`lancarNotaManualAction`** virou união discriminada por tipo (NFSe: cliente/cnae/codigoTributacao/
   descricao/valor/aliquota; NFe: cliente/natureza/itens; NFCe: itens/pagamentos/cpf) — calcula
   `valor_total`, grava `cnae` (NFS-e) e `numero_nf`, valida ownership do cliente.
   **`prepararNotaManualAction(tipo)`** carrega dados por tipo (clientes/cnaes/produtos) **sem** os
   guards de emissão (município etc. não importam num registro manual).
4. **Chooser sempre mostra os 3 cards** (removido o auto-pular quando só 1 habilitado): os não
   habilitados ficam desativados. Vale p/ emissão **e** manual (manual usa a mesma trava
   `listarTiposEmissaoAction`). Ver memória `balu-emissao-sempre-3-tipos`.
5. **Dropdown "Nova nota" foi pro header** da página de notas (saiu da fileira de filtros, que
   quebrava a linha).
6. **Botão de submit alinhado à direita** (`flex justify-end`) nos 3 forms.
7. **Data de emissão em `dd-mm-aaaa`** no modo manual via componente `DataEmissaoBR` (exibe BR,
   mantém ISO `YYYY-MM-DD` internamente p/ a action).
8. **`ClienteCombobox`**: dropdown passou a flutuar (`absolute top-full z-30`) + fecha ao clicar
   fora (era inline, empurrava o layout).
9. Fora do escopo do modal, no mesmo passe: botões `bg-primary` trocaram `text-primary-foreground`
   (token inexistente → texto ilegível no light) por `text-white`; o seletor de empresa na sidebar
   (`MenuLateral`) também passou a flutuar.

## Adendo as-built (2026-06-09)

Ao testar emissão na AL PISCINAS o chooser travava todos os 3 tipos. Causa: o gate
`empresa_fiscal_ativada === true` em `listarTiposEmissaoAction` (e nos validadores NF-e/NFC-e e no
`prepararEmissaoAction`) era **órfão** — nenhum código no app setava a coluna `true`, então toda
empresa nascia bloqueada mesmo com a Focus habilitando. Removido o gate; habilitação passou a ser
só `focus_habilita_*`. A coluna não foi dropada (ainda é kill-switch no payload da Focus,
`!== false`). Em paralelo: `focus_habilita_nfe/nfce` passaram a ser populados pelo
`snapshotFocusEmpresa`, e a NFS-e ganhou resolução de `codigo_municipio` (IBGE) via CEP. Ver
memórias `balu-emissao-habilitacao-gating` e `balu-codigo-municipio-via-cep`.
