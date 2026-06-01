# Busca de CNPJ na Focus — empresa + melhorias no cliente · design

**Data:** 2026-05-31
**Status:** aprovado (brainstorming) — pronto para writing-plans
**Fontes:** `CreateCompanyDialog.tsx` (cadastro empresa), `ClienteFormDialog.tsx` (cadastro cliente), `clientes/actions.ts` (`lookupCnpjAction`/`CnpjLookup`), `lib/clients/focus-nfe.ts` (`consultarCnpj`), `lib/format/masks.ts` (`formatCnpj`/`formatCep`). Ver também [[balu-focus-cert-registration-gap]] e spec `2026-05-28-focus-integracao-cadastro-design.md`.

## Contexto

A busca de CNPJ na Focus (`GET /v2/cnpjs/:cnpj`, read-only da Receita, só em produção) **já existe e funciona no cadastro de CLIENTE** (botão "Buscar" para PJ em `ClienteFormDialog.tsx:182-193` → `handleLookupCnpj` → `lookupCnpjAction`). Autopreenche razão social, endereço, telefone e e-mail.

No cadastro de **EMPRESA** a busca **não existe** — foi deliberadamente deixada só no cliente (comentário em `CreateCompanyDialog.tsx:153`). O CNPJ é digitado manualmente; o único autofill é por CEP (ViaCEP).

O usuário pediu para **adicionar a busca na empresa** e **melhorar a do cliente**. Toda a infra (`focus.consultarCnpj`, `lookupCnpjAction`) já existe e será reaproveitada.

## Decisões aprovadas

1. **Camada compartilhada.** Extrair `lookupCnpjAction` + tipo `CnpjLookup` + helpers (`normCnpj`, `stringOrUndef`, `onlyDigits`) de `clientes/actions.ts` para um módulo server-only `src/lib/fiscal/cnpj-lookup.ts`. Empresa e cliente consomem a **mesma** consulta — sem duplicação.
2. **IE/IM no `CnpjLookup`.** Adicionar `inscricao_estadual` e `inscricao_municipal` ao tipo e ao mapeamento (best-effort: a Focus nem sempre devolve esses campos).
3. **Erros amigáveis na action.** `lookupCnpjAction` passa a devolver `error` já tratado: 404/não encontrado → "CNPJ não encontrado na Receita."; indisponível/timeout/5xx → "Serviço de consulta indisponível. Tente novamente."; CNPJ inválido → "CNPJ inválido." Beneficia empresa e cliente.
4. **Autofill sobrescreve.** Ao buscar, campos retornados pela Focus substituem o valor atual; campos não retornados ficam intactos (comportamento atual do cliente). Decisão do usuário.
5. **Empresa: nova busca de CNPJ** no `CreateCompanyDialog`, espelhando o botão de CEP.
6. **Cliente: máscara de CNPJ** (PJ) + IE/IM no autofill + erros melhores. Nome fantasia **fora** (cliente não tem o campo).
7. **`/v2/cnpjs` em produção** — já tratado (`'prod'` forçado em `consultarCnpj`/`lookupCnpjAction`). Mantido.

## Arquitetura

### 1. `src/lib/fiscal/cnpj-lookup.ts` (novo) — consulta compartilhada

Server-only (`import 'server-only'`), **sem** `'use server'` (é um módulo de lib, não um arquivo de actions). Move de `clientes/actions.ts`.

**Tipo de retorno autocontido.** Os dois arquivos de actions definem `ActionResult` com shapes **diferentes** (`onboarding/actions.ts:23` = `({ ok: true } & T) | { ok: false; error }`; `clientes/actions.ts:11` = `{ ok: true; data?: T } | { ok: false; error }`). Para não acoplar a nenhum dos dois, o módulo define o seu próprio:

```ts
export type CnpjLookupResult =
  | { ok: true; data: CnpjLookup }
  | { ok: false; error: string };
```

O consumidor atual (cliente) usa `if (!r.ok) ... const d = r.data ?? {}` — compatível (`data` sempre presente no sucesso).

```ts
export type CnpjLookup = {
  razao_social?: string;
  nome_fantasia?: string;
  inscricao_estadual?: string;   // NOVO
  inscricao_municipal?: string;  // NOVO
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
  cep?: string;
  telefone?: string;
  email?: string;
};

export async function lookupCnpj(cnpj: string): Promise<CnpjLookupResult>
```

- Helpers `onlyDigits`/`normCnpj`/`stringOrUndef` movem junto.
- Mapeamento ganha:
  - `inscricao_estadual: stringOrUndef(raw['inscricao_estadual'] ?? raw['inscricao_estadual_numero'])`
  - `inscricao_municipal: stringOrUndef(raw['inscricao_municipal'])`
  - (mantém os apelidos já existentes: `razao_social ?? nome`, `nome_fantasia ?? fantasia`)
- **Erros amigáveis**: o `catch` (e a checagem pós-`consultarCnpj`) classifica a falha. Como `focus-nfe.ts::call` lança `Error` com mensagem/length variável, a classificação é por heurística no texto do erro (404/`nao_encontrado` → não encontrado; timeout/502/503/504/`fetch` → indisponível; demais → genérica "Falha ao consultar CNPJ."). CNPJ inválido (≠14 díg. ou tudo zero) já retorna "CNPJ inválido." antes da chamada.

### 2. `src/app/(auth)/clientes/actions.ts` — reexporta a action

Remove a implementação local; passa a reexportar como server action:

```ts
'use server';
import { lookupCnpj, type CnpjLookup } from '@/lib/fiscal/cnpj-lookup';
export type { CnpjLookup };
export async function lookupCnpjAction(cnpj: string) { return lookupCnpj(cnpj); }
```

Mantém a assinatura `lookupCnpjAction(cnpj)` que o `ClienteFormDialog` já importa — zero mudança no import do cliente.

### 3. `src/app/(auth)/onboarding/actions.ts` — expõe a action para a empresa

Adiciona, no arquivo de actions do onboarding (de onde o `CreateCompanyDialog` já importa `lookupCepAction`/`createCompanyAction`):

```ts
import { lookupCnpj } from '@/lib/fiscal/cnpj-lookup';
export async function lookupCnpjAction(cnpj: string) { return lookupCnpj(cnpj); }
```

Atualizar o comentário de cabeçalho do arquivo (linhas 5-6), que hoje diz *"A consulta de CNPJ na Focus saiu daqui: agora só o cadastro de CLIENTE a usa"* — passa a refletir que a empresa voltou a usá-la via lib compartilhada.

### 4. `CreateCompanyDialog.tsx` (empresa) — modificar

- State novo `const [busyCnpj, setBusyCnpj] = useState(false)`.
- Import `lookupCnpjAction` de `@/app/(auth)/onboarding/actions`; import `Search` de lucide.
- Etapa 1 (CNPJ): input vira um grupo `flex gap-2` com botão "Buscar" (ícone `Search`/`Loader2`, `disabled={busyCnpj}`), mesmo padrão visual do botão CEP.
- Handler `handleLookupCnpj`: valida 14 dígitos de `form.cnpj`; chama `lookupCnpjAction`; em sucesso, `setForm` sobrescrevendo: `razao_social`, `nome` (← `d.nome_fantasia`), `inscricao_estadual`, `inscricao_municipal`, `logradouro`, `numero`, `bairro`, `municipio`, `uf`, `cep` (via `formatCep`), `telefone`, `email`. Toasts de sucesso/erro.
- `complemento` **ignorado** (não há campo de complemento no form de empresa). `codigo_municipio` não vem da Focus.
- Remover comentário da linha 153 ("a busca na Focus fica só no cadastro de cliente").

### 5. `ClienteFormDialog.tsx` (cliente) — modificar

- **Máscara CNPJ**: input `document` (linha ~176) — quando `person_type === 'PJ'`, `value={formatCnpj(form.document)}`, `onChange={(e)=>update('document', e.target.value.replace(/\D/g,''))}` (estado segue dígitos; display formatado via `formatCnpj` no `value`), `maxLength={18}`. Para PF: mantém cru, `maxLength={11}`. Import `formatCnpj` de `@/lib/format/masks`.
  - Nota: como o estado guarda dígitos e o `value` é `formatCnpj(dígitos)`, é a mesma estratégia do CNPJ read-only da empresa (display formatado sobre estado em dígitos). Submit e lookup já normalizam.
- **IE/IM no autofill**: em `handleLookupCnpj`, acrescentar ao `setForm`: `inscricao_estadual: d.inscricao_estadual ?? prev.inscricao_estadual`, `inscricao_municipal: d.inscricao_municipal ?? prev.inscricao_municipal`.
- **Erros**: nenhuma mudança no componente além de exibir `r.error` (que agora vem amigável da action).
- Nome fantasia: **fora de escopo** (sem campo/coluna no cliente).

## Fluxo de dados

```
[input CNPJ] --dígitos--> handleLookupCnpj --> lookupCnpjAction(cnpj)
   --> lib/fiscal/cnpj-lookup.lookupCnpj --> focus.consultarCnpj(d,'prod')
   --> CnpjLookup (normalizado, erros amigáveis)
   --> setForm (sobrescreve campos retornados; CEP via formatCep)
```

Persistência inalterada: empresa grava CNPJ 14 díg. em `companies` (submit já normaliza); cliente grava `document` 14 díg. em `clientes`. Nenhuma migration (nome fantasia ficou fora).

## Tratamento de erro

| Situação | Mensagem |
|---|---|
| input < 14 dígitos (client) | toast warning "Informe um CNPJ com 14 dígitos." (atual) |
| CNPJ inválido (action) | "CNPJ inválido." |
| 404 / não encontrado | "CNPJ não encontrado na Receita." |
| Focus indisponível / timeout / 5xx | "Serviço de consulta indisponível. Tente novamente." |
| outro | "Falha ao consultar CNPJ." |

## Testing

- **Vitest**: teste unitário de `lib/fiscal/cnpj-lookup.ts` com `focus.consultarCnpj` mockado — mapeamento (incl. IE/IM e apelidos), CNPJ inválido, classificação de erro (404 → não encontrado; 503/timeout → indisponível). Segue o padrão de `focus-nfe.test.ts`.
- **tsc --noEmit**: verde.
- **Smoke manual (browser, app em :3000)**: empresa e cliente — buscar um CNPJ PJ real (autofill + máscara), buscar um CNPJ inexistente (mensagem amigável). PF no cliente continua cru.
- **Não rodar `next build`** com `next dev` ativo (ver [[balu-build-corrompe-dev-next]]).

## Premissas / fora de escopo

- `/v2/cnpjs` da Focus só responde em produção; consulta read-only. Sem mudança nesse comportamento.
- IE/IM são best-effort: se a Focus não devolver, ficam em branco (sem erro).
- Sem `formatCpf` (PF segue cru) — fora do pedido (YAGNI).
- Sem campo/coluna de nome fantasia no cliente — decisão do usuário.
- Sem campo de complemento no form de empresa — não adicionar; `complemento` da Focus é ignorado na empresa.
- Sem migration.
