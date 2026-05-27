# Máscaras de CNPJ/CEP + ViaCEP na edição (design)

**Data:** 2026-05-27
**Status:** aprovado (brainstorming) — pronto para writing-plans
**Branch:** `feat/mascaras-cnpj-cep`
**Fontes:** `CreateCompanyDialog.tsx` (cadastro), `DadosEmpresaForm.tsx` (edição), `onboarding/actions.ts` (`lookupCepAction`), `src/types/zod.ts` (`CompanyCreateSchema`/`CompanySchema`).

## Contexto

Os inputs de CNPJ e CEP no cadastro e na edição de empresa hoje exibem o valor cru (sem máscara). O cadastro tem ViaCEP funcionando (botão "Buscar" → `lookupCepAction`); a edição não tem. O usuário pediu:
1. Máscara visual de CNPJ e CEP — aplicada nos **dois** forms (cadastro e edição), por consistência.
2. ViaCEP (botão "Buscar") também no form de **edição**.

### Constraints já verificadas
- `CompanyCreateSchema.cnpj` e `CompanySchema.cnpj` exigem **exatamente 14 dígitos** (`z.string().length(14)`) — a máscara é só visual; o valor persistido é só dígitos.
- `lookupCepAction(cep)` normaliza o CEP internamente (`normCep` → 8 dígitos) — aceita CEP com ou sem máscara.
- O cadastro já normaliza o CNPJ no submit (`.replace(/\D+/g,'').padStart(14,'0').slice(-14)`).
- `companies.cep` está vazio na empresa de teste; não há formato legado a preservar — gravamos **só dígitos**.
- Não existe helper de máscara hoje (o `ClienteFormDialog` só remove não-dígitos via `replace(/\D/g,'')`, sem formatação visual).

## Decisões aprovadas

1. **Formatadores puros, sem biblioteca.** Criar `formatCnpj`/`formatCep` (funções puras). Rejeitada uma lib de máscara (react-imask/cleave): overkill para 2 campos e adiciona dependência. Formatação progressiva conforme digita; caret no fim (digitação esquerda→direita) — aceitável para v1.
2. **Máscara nos dois forms** (cadastro + edição). Na edição o CNPJ é read-only e aparece formatado; o CEP editável também mascarado.
3. **ViaCEP na edição** — botão "Buscar" espelhando o do cadastro.
4. **Persistência só dígitos.** CEP passa a ser gravado só com dígitos (normalizado no submit dos dois forms); CNPJ continua 14 dígitos. Display sempre formatado.

## Arquitetura

### 1. `src/lib/format/masks.ts` (novo) — formatadores puros

```ts
export function formatCnpj(value: string): string  // "11222333000181" → "11.222.333/0001-81"
export function formatCep(value: string): string    // "80010000" → "80010-000"
```

Regras:
- `formatCnpj`: `digits = value.replace(/\D/g, '').slice(0, 14)`; aplica o template `00.000.000/0000-00` progressivamente (formata só o que já foi digitado — ex.: `112` → `11.2`).
- `formatCep`: `digits = value.replace(/\D/g, '').slice(0, 8)`; insere `-` após o 5º dígito (ex.: `8001` → `8001`; `80010` → `80010`; `800100` → `80010-0`).
- Ambas idempotentes (formatar um valor já formatado devolve o mesmo) e tolerantes a entrada já mascarada ou parcial.

Sem dependências, sem `server-only` (uso client). Testável em vitest.

### 2. `src/lib/format/masks.test.ts` (novo)

Casos: CNPJ completo formata certo; CNPJ parcial formata progressivo; >14 dígitos truncado; entrada com símbolos é limpa; idempotência. Idem para CEP (parcial, completo, truncado, idempotência).

### 3. `CreateCompanyDialog.tsx` (cadastro) — modificar

- Import `formatCnpj`, `formatCep` de `@/lib/format/masks`.
- CNPJ input (linha ~146): `onChange={(e) => set('cnpj', formatCnpj(e.target.value))}`, adicionar `maxLength={18}`. O submit já normaliza o CNPJ — sem mudança lá.
- CEP input (linha ~161): `onChange={(e) => set('cep', formatCep(e.target.value))}`, adicionar `maxLength={9}`.
- Submit (`handleSubmit`): no objeto passado ao `CompanyCreateSchema.safeParse`, acrescentar `cep: form.cep ? form.cep.replace(/\D+/g, '') : undefined` (grava CEP só dígitos). CNPJ permanece como está.
- ViaCEP (`handleLookupCep`): sem mudança (já normaliza via `lookupCepAction`).

### 4. `DadosEmpresaForm.tsx` (edição) — modificar

- Import `formatCnpj`, `formatCep` de `@/lib/format/masks`; importar `lookupCepAction` de `@/app/(auth)/onboarding/actions`.
- Novo state `const [busyCep, setBusyCep] = useState(false)`.
- Nova função `handleLookupCep` (espelha o cadastro): valida 8 dígitos em `form.cep`, chama `lookupCepAction`, preenche `logradouro`/`bairro`/`municipio`/`uf`, toasts.
- CNPJ (read-only, linha 61): trocar para `value={formatCnpj(form.cnpj ?? '')}` — exibe formatado. Como o input é `disabled`, o `onChange` não dispara e `form.cnpj` segue com os dígitos de `initial`; o submit continua mandando 14 dígitos.
- CEP (linha 65): substituir o `<Field>` por um grupo input + botão "Buscar" (mesmo padrão do cadastro), com `value={formatCep(form.cep ?? '')}`, `onChange={(v) => set('cep', formatCep(v))}`, `disabled={locked}`, `maxLength={9}`. Botão "Buscar" chama `handleLookupCep`, `disabled={locked || busyCep}`.
- Submit (`handleSubmit`): acrescentar `cep: form.cep ? form.cep.replace(/\D+/g, '') : undefined` ao objeto do `CompanySchema.safeParse` (grava CEP só dígitos). CNPJ não precisa normalizar (já é dígitos, read-only).

## Fluxo de dados

Digitação → `formatCnpj`/`formatCep` formata o valor exibido (estado guarda a string mascarada nos campos editáveis; no CNPJ read-only o estado segue dígitos e só o display é formatado) → no submit, CNPJ e CEP são reduzidos a dígitos antes do `safeParse` → action grava dígitos em `companies`. No load (edição), os dígitos do banco são formatados para exibição.

ViaCEP (edição): `form.cep` (mascarado) → `lookupCepAction` (normaliza) → preenche endereço.

## Tratamento de erro

- CNPJ inválido / com menos de 14 dígitos: o `safeParse` (cadastro usa `CompanyCreateSchema` com `isValidCnpj`) rejeita e mostra a mensagem — comportamento atual mantido.
- CEP fora de 8 dígitos no "Buscar": toast "Informe um CEP com 8 dígitos." (igual ao cadastro).
- ViaCEP indisponível / CEP não encontrado: toast de erro vindo de `lookupCepAction`.

## Verificação

- `vitest run`: novos testes de `masks.test.ts` passam; suíte total segue verde.
- `tsc --noEmit`: zero erros.
- UI/manual:
  - **Cadastro**: digitar CNPJ mostra `00.000.000/0000-00` progressivo; digitar CEP mostra `00000-000`; "Buscar" preenche endereço; criar empresa grava CNPJ e CEP só com dígitos.
  - **Edição**: CNPJ aparece formatado (read-only); CEP editável mascarado; novo "Buscar" preenche endereço; salvar grava CEP só dígitos (confirmar via query que `companies.cep` ficou com 8 dígitos, sem símbolos).

## Premissas / fora de escopo

- Caret no meio da string pode "pular" para o fim ao editar (limitação conhecida de máscara sem lib) — aceitável para v1; digitação normal (esquerda→direita) não é afetada.
- Não se aplica máscara a telefone, inscrições ou outros campos — fora do pedido (YAGNI).
- `ClienteFormDialog` (cadastro de cliente) não entra neste escopo — só os dois forms de empresa.
- Sem migration: `companies.cep`/`cnpj` são colunas de texto; só muda o que o app grava (dígitos).
