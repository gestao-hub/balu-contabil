# Criação de NF via modal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mover a criação de NF (emissão real dos 3 tipos + nota manual) de rotas dedicadas para dois modais disparados do dropdown "Nova nota", sem trocar de página.

**Architecture:** Strangler em 6 tarefas que mantêm `tsc` verde a cada commit. Primeiro adicionamos as server actions de preparo (aditivo); depois movemos os componentes pra pasta privada `_nova-nota/` e apagamos as rotas; convertemos os forms pra callback `onSuccess`; criamos os dois dialogs (`EmitirNotaDialog` multi-step + `NotaManualDialog`); e por fim ligamos o `NovaNotaDropdown` nos dois modais.

**Tech Stack:** Next.js App Router (Server Components + Server Actions), React client components, Supabase, `<dialog>` nativo (padrão de `src/components/ClienteFormDialog.tsx`), TypeScript, Vitest.

**Convenções de verificação:**
- Typecheck: `npm run typecheck` (de dentro de `app/`). Esperado: sem erros.
- Testes: `npm test -- --run` (Vitest one-shot). Esperado: tudo verde.
- Todos os caminhos abaixo são relativos a `app/` salvo indicação contrária.

---

### Task 1: Server actions de preparo (aditivo)

Adiciona o helper interno `lerClientesAtivos` e três actions (`listarTiposEmissaoAction`, `prepararEmissaoAction`, `prepararNotaManualAction`) ao fim de `actions.ts`. Puramente aditivo — nada passa a depender disso ainda, então `tsc` segue verde.

**Files:**
- Modify: `src/app/(auth)/notas_fiscais/actions.ts`

- [ ] **Step 1: Adicionar imports no topo de `actions.ts`**

Logo após a linha `import type { RegimeCode } from '@/lib/fiscal/regime';` (atualmente linha 19), inserir:

```ts
import { obterPreviewImposto } from '@/lib/fiscal/preview-imposto';
import type { PreviewImposto } from '@/lib/fiscal/apuracao-types';
import type { ClienteOption } from './emissao/ClienteCombobox';
```

> O import de `ClienteOption` aponta pro caminho atual (`./emissao/ClienteCombobox`); a Task 2 atualiza pra `./_nova-nota/ClienteCombobox` quando o arquivo for movido.

- [ ] **Step 2: Adicionar o bloco de actions ao FINAL de `actions.ts`**

```ts
// ───────────────────────────────────────────────────────────────────────────
// Criação de nota via modal: tipos habilitados + preparo (guards de UX).
// As actions de gravação (emitirNotaAction etc.) seguem sendo a fonte de
// verdade; estas só decidem bloquear o form ou liberá-lo com os dados.
// ───────────────────────────────────────────────────────────────────────────

async function lerClientesAtivos(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  companyId: string,
): Promise<ClienteOption[]> {
  const { data } = await supabase
    .from('clientes')
    .select('id, razao_social, document, person_type')
    .eq('company_id', companyId).eq('status', 'active').is('deleted_at', null)
    .order('razao_social', { ascending: true }).limit(500);
  return (data ?? []).map((c) => ({
    id: c.id as string,
    razao_social: (c.razao_social as string | null) ?? '—',
    document: (c.document as string | null) ?? '',
    person_type: (c.person_type as string | null) ?? 'PJ',
  }));
}

export type TiposHabilitados = { nfse: boolean; nfe: boolean; nfce: boolean };

export async function listarTiposEmissaoAction(): Promise<TiposHabilitados> {
  const off = { nfse: false, nfe: false, nfce: false };
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return off;
  const { data: profile } = await supabase
    .from('profiles').select('current_company').eq('user_id', user.id).single();
  const companyId = (profile?.current_company ?? null) as string | null;
  if (!companyId) return off;
  const { data: fiscal } = await supabase
    .from('empresas_fiscais')
    .select('focus_habilita_nfse, focus_habilita_nfsen_homologacao, focus_habilita_nfe, focus_habilita_nfce, empresa_fiscal_ativada')
    .eq('empresa_id', companyId).is('deleted_at', null).maybeSingle();
  const ativa = fiscal?.empresa_fiscal_ativada === true;
  return {
    nfse: ativa && (fiscal?.focus_habilita_nfse === true || fiscal?.focus_habilita_nfsen_homologacao === true),
    nfe: ativa && fiscal?.focus_habilita_nfe === true,
    nfce: ativa && fiscal?.focus_habilita_nfce === true,
  };
}

export type Bloqueio = { titulo: string; mensagem: string; href?: string; labelLink?: string };
export type DadosNfse = { razaoSocial: string; clientes: ClienteOption[]; previewImposto: PreviewImposto; cnaes: CnaeOption[] };
export type DadosNfe = { clientes: ClienteOption[]; produtos: ProdutoOption[] };
export type DadosNfce = { produtos: ProdutoOption[] };
export type PreparoEmissao =
  | { ok: true; tipo: 'nfse'; dados: DadosNfse }
  | { ok: true; tipo: 'nfe'; dados: DadosNfe }
  | { ok: true; tipo: 'nfce'; dados: DadosNfce }
  | { ok: false; bloqueio: Bloqueio };

export async function prepararEmissaoAction(tipo: 'nfse' | 'nfe' | 'nfce'): Promise<PreparoEmissao> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, bloqueio: { titulo: 'Sessão expirada', mensagem: 'Entre novamente para emitir.' } };
  const { data: profile } = await supabase
    .from('profiles').select('current_company').eq('user_id', user.id).single();
  const companyId = (profile?.current_company ?? null) as string | null;
  if (!companyId) return { ok: false, bloqueio: { titulo: 'Nenhuma empresa selecionada', mensagem: 'Cadastre ou escolha uma empresa antes de emitir notas.' } };

  if (tipo === 'nfse') {
    const [{ data: company }, { data: fiscal }] = await Promise.all([
      supabase.from('companies').select('razao_social, codigo_municipio').eq('id', companyId).single(),
      supabase.from('empresas_fiscais').select('Code_regime_tributario').eq('empresa_id', companyId).is('deleted_at', null).maybeSingle(),
    ]);
    if (!company) return { ok: false, bloqueio: { titulo: 'Empresa não encontrada', mensagem: 'A empresa selecionada não existe.' } };
    if (!fiscal) return { ok: false, bloqueio: { titulo: 'Cadastro fiscal incompleto', mensagem: 'Configure o regime tributário e ative a empresa fiscal antes de emitir.', href: '/configuracoes?tab=regime', labelLink: 'Ir para Regime tributário' } };
    const codigoMunicipio = (company.codigo_municipio as string | null) ?? null;
    if (!codigoMunicipio) return { ok: false, bloqueio: { titulo: 'Município sem código IBGE', mensagem: 'A NFS-e Nacional exige o código IBGE do município do prestador. Edite os dados da empresa.', href: '/configuracoes?tab=dados', labelLink: 'Ir para Dados da empresa' } };
    const { data: muni } = await supabase.from('municipios_nfse').select('status_nfse').eq('codigo_ibge', codigoMunicipio).maybeSingle();
    if (muni && muni.status_nfse !== 'ativo') {
      const statusLabel: Record<string, string> = {
        fora_do_ar: 'O servidor da Focus para este município está temporariamente fora do ar.',
        pausado: 'A emissão NFS-e para este município está pausada na Focus.',
        em_implementacao: 'Este município está sendo implementado na Focus. Aguarde.',
        em_reimplementacao: 'Este município está em reimplementação na Focus. Aguarde.',
        inativo: 'A NFS-e para este município foi desativada na Focus.',
        nao_implementado: 'Este município não é suportado pela Focus para NFS-e.',
      };
      return { ok: false, bloqueio: { titulo: 'NFS-e indisponível para este município', mensagem: statusLabel[muni.status_nfse ?? ''] ?? `Status Focus: ${muni.status_nfse}` } };
    }
    const [clientes, previewImposto, cnaes] = await Promise.all([
      lerClientesAtivos(supabase, companyId),
      obterPreviewImposto(supabase, companyId),
      listarCnaesEmpresaAction(),
    ]);
    return { ok: true, tipo: 'nfse', dados: { razaoSocial: (company.razao_social as string | null) ?? '—', clientes, previewImposto, cnaes } };
  }

  // nfe / nfce — guards de ativação + habilitação
  const { data: fiscal } = await supabase
    .from('empresas_fiscais')
    .select('empresa_fiscal_ativada, focus_habilita_nfe, focus_habilita_nfce')
    .eq('empresa_id', companyId).is('deleted_at', null).maybeSingle();
  if (!fiscal || fiscal.empresa_fiscal_ativada !== true) {
    return { ok: false, bloqueio: { titulo: 'Empresa fiscal não ativada', mensagem: 'Ative a empresa fiscal antes de emitir.', href: '/configuracoes?tab=fiscal', labelLink: 'Ir para Fiscal' } };
  }
  if (tipo === 'nfe') {
    if (fiscal.focus_habilita_nfe !== true) return { ok: false, bloqueio: { titulo: 'NF-e não habilitada', mensagem: 'Esta empresa não está habilitada para emitir NF-e.' } };
    const [clientes, produtos] = await Promise.all([lerClientesAtivos(supabase, companyId), listarProdutosAction()]);
    return { ok: true, tipo: 'nfe', dados: { clientes, produtos } };
  }
  // nfce
  if (fiscal.focus_habilita_nfce !== true) return { ok: false, bloqueio: { titulo: 'NFC-e não habilitada', mensagem: 'Esta empresa não está habilitada para emitir NFC-e.' } };
  const produtos = await listarProdutosAction();
  return { ok: true, tipo: 'nfce', dados: { produtos } };
}

export async function prepararNotaManualAction(): Promise<{ clientes: ClienteOption[] }> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { clientes: [] };
  const { data: profile } = await supabase
    .from('profiles').select('current_company').eq('user_id', user.id).single();
  const companyId = (profile?.current_company ?? null) as string | null;
  if (!companyId) return { clientes: [] };
  return { clientes: await lerClientesAtivos(supabase, companyId) };
}
```

> `listarProdutosAction`, `listarCnaesEmpresaAction`, `ProdutoOption`, `CnaeOption` já existem em `actions.ts` (declarações de função hoisteiam, então a ordem no arquivo não importa).

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(auth\)/notas_fiscais/actions.ts
git commit -m "feat(notas): actions de preparo p/ criação de nota em modal"
```

---

### Task 2: Mover componentes pra `_nova-nota/` e apagar as rotas

Move os 6 componentes pra `notas_fiscais/_nova-nota/` (pasta privada, fora do roteamento), corrige imports, apaga as 5 páginas de rota e ajusta a home. Os forms mantêm o comportamento atual (conversão pra `onSuccess` é a Task 3); como nada os renderiza ainda (dialogs são Task 4/5), `tsc` segue verde.

**Files:**
- Move: `src/app/(auth)/notas_fiscais/emissao/EmissaoForm.tsx` → `src/app/(auth)/notas_fiscais/_nova-nota/EmissaoForm.tsx`
- Move: `src/app/(auth)/notas_fiscais/emissao/ClienteCombobox.tsx` → `src/app/(auth)/notas_fiscais/_nova-nota/ClienteCombobox.tsx`
- Move: `src/app/(auth)/notas_fiscais/emissao/nfe/NfeForm.tsx` → `src/app/(auth)/notas_fiscais/_nova-nota/NfeForm.tsx`
- Move: `src/app/(auth)/notas_fiscais/emissao/nfce/NfceForm.tsx` → `src/app/(auth)/notas_fiscais/_nova-nota/NfceForm.tsx`
- Move: `src/app/(auth)/notas_fiscais/emissao/_components/ItensField.tsx` → `src/app/(auth)/notas_fiscais/_nova-nota/ItensField.tsx`
- Move: `src/app/(auth)/notas_fiscais/manual/NotaManualForm.tsx` → `src/app/(auth)/notas_fiscais/_nova-nota/NotaManualForm.tsx`
- Delete: `src/app/(auth)/notas_fiscais/emissao/page.tsx`, `emissao/nfse/page.tsx`, `emissao/nfe/page.tsx`, `emissao/nfce/page.tsx`, `manual/page.tsx`
- Modify: `src/app/(auth)/notas_fiscais/actions.ts` (import de `ClienteOption`)
- Modify: `src/app/(auth)/page.tsx` (href do DashboardCard)

- [ ] **Step 1: Criar a pasta e mover os arquivos com `git mv`**

```bash
cd src/app/\(auth\)/notas_fiscais
mkdir -p _nova-nota
git mv emissao/EmissaoForm.tsx       _nova-nota/EmissaoForm.tsx
git mv emissao/ClienteCombobox.tsx   _nova-nota/ClienteCombobox.tsx
git mv emissao/nfe/NfeForm.tsx       _nova-nota/NfeForm.tsx
git mv emissao/nfce/NfceForm.tsx     _nova-nota/NfceForm.tsx
git mv emissao/_components/ItensField.tsx _nova-nota/ItensField.tsx
git mv manual/NotaManualForm.tsx     _nova-nota/NotaManualForm.tsx
cd -
```

- [ ] **Step 2: Apagar as páginas de rota e as pastas vazias**

```bash
cd src/app/\(auth\)/notas_fiscais
git rm emissao/page.tsx emissao/nfse/page.tsx emissao/nfe/page.tsx emissao/nfce/page.tsx manual/page.tsx
# remover diretórios que ficaram vazios (ignora erro se já sumiram)
rmdir emissao/nfse emissao/nfe emissao/_components emissao manual 2>/dev/null || true
cd -
```

- [ ] **Step 3: Corrigir imports relativos nos arquivos movidos**

Em `_nova-nota/NfeForm.tsx` — trocar as três linhas de import (eram `../ClienteCombobox`, `../_components/ItensField`, `../../actions`):

```ts
import ClienteCombobox, { type ClienteOption } from './ClienteCombobox';
import ItensField, { type LinhaItem } from './ItensField';
import { emitirNfeAction, type ProdutoOption } from '../actions';
```

Em `_nova-nota/NfceForm.tsx` — trocar (eram `../_components/ItensField`, `../../actions`):

```ts
import ItensField, { type LinhaItem } from './ItensField';
import { emitirNfceAction, type ProdutoOption } from '../actions';
```

Em `_nova-nota/ItensField.tsx` — trocar (era `../../actions`):

```ts
import { criarProdutoAction, type ProdutoOption } from '../actions';
```

Em `_nova-nota/NotaManualForm.tsx` — trocar (era `../emissao/ClienteCombobox`):

```ts
import ClienteCombobox, { type ClienteOption } from './ClienteCombobox';
```

> `EmissaoForm.tsx` e `ClienteCombobox.tsx` não precisam de mudança de import: `EmissaoForm` já usava `./ClienteCombobox` (sibling, ainda válido) e `../actions` (continua um nível acima); `ItensField` mantém `@/lib/fiscal/nfe-payload` (absoluto).

- [ ] **Step 4: Atualizar o import de `ClienteOption` em `actions.ts`**

Trocar a linha adicionada na Task 1:

```ts
import type { ClienteOption } from './_nova-nota/ClienteCombobox';
```

- [ ] **Step 5: Atualizar o href do DashboardCard na home**

Em `src/app/(auth)/page.tsx`, no card "Última nota emitida", trocar:

```ts
          action={{ label: 'Emitir nova', href: '/notas_fiscais' }}
```

(era `href: '/notas_fiscais/emissao'`.)

- [ ] **Step 6: Confirmar que ninguém mais importa os caminhos antigos**

Run: `cd app && grep -rn "emissao/EmissaoForm\|emissao/ClienteCombobox\|emissao/nfe/NfeForm\|emissao/nfce/NfceForm\|emissao/_components\|manual/NotaManualForm\|/notas_fiscais/emissao/nfse\|/notas_fiscais/emissao/nfe\|/notas_fiscais/emissao/nfce" src`
Expected: apenas ocorrências dentro de `actions.ts` referentes ao `redirect(...)` em `emitirNotaFormAction` (string, removida na Task 3) e o link `/notas_fiscais/emissao` no `NovaNotaDropdown` (tratado na Task 6). Nenhum import quebrado de componente.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: sem erros. (Os forms ainda usam `router.push`/`emitirNotaFormAction`; nada os renderiza, mas eles compilam.)

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(notas): mover forms p/ _nova-nota e remover rotas /emissao e /manual"
```

---

### Task 3: Converter os forms para callback `onSuccess`

Cada form passa a receber `onSuccess: () => void` e, no sucesso, chamá-lo em vez de navegar. O `EmissaoForm` (NFS-e) sai do padrão `<form action>`/`useFormStatus` e chama `emitirNotaAction` direto. Remove `emitirNotaFormAction` e o import `redirect` (agora órfãos). Ainda sem caller — `tsc` verde.

**Files:**
- Modify: `src/app/(auth)/notas_fiscais/_nova-nota/EmissaoForm.tsx`
- Modify: `src/app/(auth)/notas_fiscais/_nova-nota/NfeForm.tsx`
- Modify: `src/app/(auth)/notas_fiscais/_nova-nota/NfceForm.tsx`
- Modify: `src/app/(auth)/notas_fiscais/_nova-nota/NotaManualForm.tsx`
- Modify: `src/app/(auth)/notas_fiscais/actions.ts`

- [ ] **Step 1: `EmissaoForm.tsx` — imports**

Trocar o bloco de imports do topo (remover `useFormStatus`/`react-dom`, trocar a action):

```ts
'use client';
// @custom — Form de emissão de NFS-e (dentro do modal). Chama emitirNotaAction direto.
import { useState } from 'react';
import { z } from 'zod';
import { Loader2 } from 'lucide-react';
import ClienteCombobox, { type ClienteOption } from './ClienteCombobox';
import {
  CODIGOS_TRIBUTACAO_FREQUENTES,
  CODIGO_OUTRO_SENTINEL,
  isCodigoTributacaoValido,
} from '@/lib/fiscal/codigos-tributacao';
import { emitirNotaAction, type CnaeOption } from '../actions';
import type { PreviewImposto } from '@/lib/fiscal/apuracao-types';
```

- [ ] **Step 2: `EmissaoForm.tsx` — assinatura, estado e submit**

Trocar a assinatura da função pra receber `onSuccess` e adicionar o estado `enviando`:

```ts
export default function EmissaoForm({
  clientes,
  previewImposto,
  cnaes,
  onSuccess,
}: {
  clientes: ClienteOption[];
  previewImposto: PreviewImposto;
  cnaes: CnaeOption[];
  onSuccess: () => void;
}) {
  const [clienteId, setClienteId] = useState<string>('');
  const [cnae, setCnae] = useState<string>(cnaes.length === 1 ? cnaes[0]!.codigo : '');
  const [codigoBase, setCodigoBase] = useState<string>(CODIGOS_TRIBUTACAO_FREQUENTES[0]!.codigo);
  const [codigoOutro, setCodigoOutro] = useState<string>('');
  const [descricao, setDescricao] = useState<string>('');
  const [valorTexto, setValorTexto] = useState<string>('');
  const [aliquotaTexto, setAliquotaTexto] = useState<string>('5');
  const [clientErr, setClientErr] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
```

Substituir a função `handleSubmit` inteira por:

```ts
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (cnaes.length > 1 && !cnae) {
      setClientErr('Selecione a atividade (CNAE) da nota.');
      return;
    }
    const codigoFinal = codigoBase === CODIGO_OUTRO_SENTINEL ? codigoOutro.trim() : codigoBase;
    const valor = parseDecimal(valorTexto);
    const aliquota = parseDecimal(aliquotaTexto);
    const parsed = Schema.safeParse({
      clienteId,
      codigoTributacao: codigoFinal,
      descricao,
      valorReais: valor,
      aliquotaIssPercentual: aliquota,
    });
    if (!parsed.success) {
      setClientErr(parsed.error.issues[0]?.message ?? 'Dados inválidos.');
      return;
    }
    if (codigoBase === CODIGO_OUTRO_SENTINEL && !isCodigoTributacaoValido(codigoOutro)) {
      setClientErr('Código personalizado deve ter 6 dígitos numéricos.');
      return;
    }
    setClientErr(null);
    setEnviando(true);
    try {
      const r = await emitirNotaAction({
        clienteId,
        codigoTributacao: codigoFinal,
        descricao,
        valorReais: valor,
        aliquotaIssPercentual: aliquota,
        cnae: cnae || null,
      });
      if (!r.ok) {
        setClientErr(r.error);
        return;
      }
      onSuccess();
    } finally {
      setEnviando(false);
    }
  }
```

- [ ] **Step 3: `EmissaoForm.tsx` — `<form>` e `SubmitButton`**

Trocar a abertura do form (remover `action={emitirNotaFormAction}`):

```tsx
    <form onSubmit={handleSubmit} className="space-y-5">
```

Trocar a chamada do botão (final do form):

```tsx
      <SubmitButton disabled={!clienteId} enviando={enviando} />
```

Substituir a função `SubmitButton` por (sem `useFormStatus`):

```tsx
function SubmitButton({ disabled, enviando }: { disabled: boolean; enviando: boolean }) {
  return (
    <button
      type="submit"
      disabled={enviando || disabled}
      className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition"
    >
      {enviando && <Loader2 className="size-4 animate-spin" />}
      {enviando ? 'Emitindo…' : 'Emitir nota'}
    </button>
  );
}
```

> Os `<input type="hidden" ...>` do form ficam inertes (não há mais `action`/FormData) mas são inofensivos; mantê-los reduz o diff. O `maskMoney`/`parseDecimal` no rodapé do arquivo não mudam.

- [ ] **Step 4: `NfeForm.tsx` — `onSuccess`**

Remover `useRouter`: apagar `import { useRouter } from 'next/navigation';` e a linha `const router = useRouter();`. Trocar a assinatura e a navegação:

```ts
export default function NfeForm({ clientes, produtos, onSuccess }: { clientes: ClienteOption[]; produtos: ProdutoOption[]; onSuccess: () => void }) {
```

Dentro de `emitir()`, trocar `router.push('/notas_fiscais');` por:

```ts
      onSuccess();
```

- [ ] **Step 5: `NfceForm.tsx` — `onSuccess`**

Remover `useRouter` (import + `const router = useRouter();`). Trocar a assinatura e a navegação:

```ts
export default function NfceForm({ produtos, onSuccess }: { produtos: ProdutoOption[]; onSuccess: () => void }) {
```

Dentro de `emitir()`, trocar `router.push('/notas_fiscais');` por:

```ts
      onSuccess();
```

- [ ] **Step 6: `NotaManualForm.tsx` — `onSuccess`**

Remover `useRouter` (import + `const router = useRouter();`). Trocar a assinatura:

```ts
export default function NotaManualForm({ clientes, onSuccess }: { clientes: ClienteOption[]; onSuccess: () => void }) {
```

No `submit()`, trocar o ramo de sucesso (eram `router.push('/notas_fiscais'); router.refresh();`) por:

```ts
      if (r.ok) {
        toast('success', 'Nota lançada.');
        onSuccess();
      } else {
        toast('error', r.error);
      }
```

- [ ] **Step 7: Remover `emitirNotaFormAction` e o import `redirect` de `actions.ts`**

Apagar a função `emitirNotaFormAction` inteira (o bloco `export async function emitirNotaFormAction(formData: FormData): Promise<void> { ... }`, incluindo o comentário JSDoc logo acima). Apagar a linha `import { redirect } from 'next/navigation';` (linha 8) — `redirect` só era usado por ela.

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: sem erros. (Os forms agora exigem `onSuccess`, mas nada os renderiza ainda.)

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor(notas): forms chamam onSuccess; NFS-e via emitirNotaAction; remove form action"
```

---

### Task 4: `EmitirNotaDialog` (modal multi-step da emissão)

Cria o modal de emissão real: passo "tipo" (3 cards com flags) → passo "form". Usa `<dialog>` nativo no padrão `ClienteFormDialog`. Ainda não é renderizado por ninguém (Task 6 liga no dropdown) — `tsc` verde.

**Files:**
- Create: `src/app/(auth)/notas_fiscais/_nova-nota/EmitirNotaDialog.tsx`

- [ ] **Step 1: Criar `EmitirNotaDialog.tsx`**

```tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X, ArrowLeft, FileText, Package, ShoppingCart, Loader2 } from 'lucide-react';
import {
  listarTiposEmissaoAction,
  prepararEmissaoAction,
  type TiposHabilitados,
  type PreparoEmissao,
  type Bloqueio,
} from '../actions';
import EmissaoForm from './EmissaoForm';
import NfeForm from './NfeForm';
import NfceForm from './NfceForm';

type Tipo = 'nfse' | 'nfe' | 'nfce';
type PreparoOk = Extract<PreparoEmissao, { ok: true }>;

const CARDS: { key: Tipo; titulo: string; sub: string; Icon: typeof FileText }[] = [
  { key: 'nfse', titulo: 'NFS-e', sub: 'Serviço', Icon: FileText },
  { key: 'nfe', titulo: 'NF-e', sub: 'Produto (modelo 55)', Icon: Package },
  { key: 'nfce', titulo: 'NFC-e', sub: 'Consumidor (modelo 65)', Icon: ShoppingCart },
];

export default function EmitirNotaDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [tipos, setTipos] = useState<TiposHabilitados | null>(null);
  const [tipo, setTipo] = useState<Tipo | null>(null);
  const [preparo, setPreparo] = useState<PreparoOk | null>(null);
  const [bloqueio, setBloqueio] = useState<Bloqueio | null>(null);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  // Ao abrir: reseta e carrega os tipos habilitados; se só 1, pula pro form.
  useEffect(() => {
    if (!open) return;
    setTipo(null); setPreparo(null); setBloqueio(null); setTipos(null);
    setCarregando(true);
    listarTiposEmissaoAction().then((t) => {
      setTipos(t);
      const habilitados = (['nfse', 'nfe', 'nfce'] as Tipo[]).filter((k) => t[k]);
      if (habilitados.length === 1) {
        void escolher(habilitados[0]!);
      } else {
        setCarregando(false);
      }
    });
    // escolher não muda entre renders; só depende de `open`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function escolher(t: Tipo) {
    setTipo(t); setBloqueio(null); setPreparo(null); setCarregando(true);
    const r = await prepararEmissaoAction(t);
    if (r.ok) setPreparo(r);
    else setBloqueio(r.bloqueio);
    setCarregando(false);
  }

  function voltar() { setTipo(null); setPreparo(null); setBloqueio(null); }
  function sucesso() { onClose(); router.refresh(); }

  if (!open) return null;

  const titulo = !tipo ? 'Emitir nota fiscal'
    : tipo === 'nfse' ? 'Emitir NFS-e'
    : tipo === 'nfe' ? 'Emitir NF-e'
    : 'Emitir NFC-e';

  return (
    <dialog
      ref={dialogRef}
      onCancel={(e) => { e.preventDefault(); if (!carregando) onClose(); }}
      className="rounded-xl border border-border bg-surface text-foreground p-0 shadow-xl backdrop:bg-black/40 backdrop:backdrop-blur-sm"
    >
      <div className="w-[min(720px,95vw)] max-h-[90vh] overflow-y-auto">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface px-6 py-4">
          <div className="flex items-center gap-2">
            {tipo && !carregando && (
              <button type="button" onClick={voltar} aria-label="Voltar" className="text-muted-foreground hover:text-foreground">
                <ArrowLeft className="size-4" />
              </button>
            )}
            <h2 className="text-base font-semibold text-foreground">{titulo}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar">
            <X className="size-5 text-muted-foreground hover:text-muted-foreground-2" />
          </button>
        </header>

        <div className="px-6 py-5">
          {carregando && (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          )}

          {!carregando && !tipo && tipos && (
            <>
              <p className="text-sm text-muted-foreground mb-4">Escolha o tipo de documento.</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {CARDS.map(({ key, titulo: t, sub, Icon }) => tipos[key] ? (
                  <button key={key} type="button" onClick={() => escolher(key)}
                    className="rounded-xl border border-border bg-surface-2 p-5 hover:border-primary hover:shadow-sm transition flex flex-col gap-2 text-left">
                    <span className="text-primary"><Icon className="size-6" /></span>
                    <span className="font-medium text-foreground">{t}</span>
                    <span className="text-xs text-muted-foreground">{sub}</span>
                  </button>
                ) : (
                  <div key={key} aria-disabled
                    className="rounded-xl border border-border bg-surface p-5 opacity-50 cursor-not-allowed flex flex-col gap-2"
                    title="Empresa não habilitada para este tipo">
                    <span className="text-muted-foreground"><Icon className="size-6" /></span>
                    <span className="font-medium text-muted-foreground">{t}</span>
                    <span className="text-xs text-muted-foreground">{sub} · não habilitado</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {!carregando && bloqueio && (
            <div className="rounded-lg border border-alert/30 bg-alert/5 p-5">
              <h3 className="text-base font-semibold text-alert">{bloqueio.titulo}</h3>
              <p className="text-sm text-muted-foreground-2 mt-2">{bloqueio.mensagem}</p>
              {bloqueio.href && bloqueio.labelLink && (
                <a href={bloqueio.href} className="inline-block mt-4 text-sm font-medium text-primary hover:underline">{bloqueio.labelLink} →</a>
              )}
              <button type="button" onClick={voltar} className="mt-3 ml-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
                <ArrowLeft className="size-4" /> Voltar
              </button>
            </div>
          )}

          {!carregando && preparo?.tipo === 'nfse' && (
            <EmissaoForm clientes={preparo.dados.clientes} previewImposto={preparo.dados.previewImposto} cnaes={preparo.dados.cnaes} onSuccess={sucesso} />
          )}
          {!carregando && preparo?.tipo === 'nfe' && (
            <NfeForm clientes={preparo.dados.clientes} produtos={preparo.dados.produtos} onSuccess={sucesso} />
          )}
          {!carregando && preparo?.tipo === 'nfce' && (
            <NfceForm produtos={preparo.dados.produtos} onSuccess={sucesso} />
          )}
        </div>
      </div>
    </dialog>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: sem erros. (`preparo?.tipo === 'nfse'` estreita `preparo.dados` para `DadosNfse` etc. pela união discriminada.)

- [ ] **Step 3: Commit**

```bash
git add src/app/\(auth\)/notas_fiscais/_nova-nota/EmitirNotaDialog.tsx
git commit -m "feat(notas): EmitirNotaDialog (modal multi-step da emissão)"
```

---

### Task 5: `NotaManualDialog` (modal da nota manual)

Modal simples: ao abrir carrega clientes via `prepararNotaManualAction`, renderiza `NotaManualForm`. Sem caller ainda — `tsc` verde.

**Files:**
- Create: `src/app/(auth)/notas_fiscais/_nova-nota/NotaManualDialog.tsx`

- [ ] **Step 1: Criar `NotaManualDialog.tsx`**

```tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X, Loader2 } from 'lucide-react';
import { prepararNotaManualAction } from '../actions';
import type { ClienteOption } from './ClienteCombobox';
import NotaManualForm from './NotaManualForm';

export default function NotaManualDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [clientes, setClientes] = useState<ClienteOption[] | null>(null);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setClientes(null);
    prepararNotaManualAction().then((r) => setClientes(r.clientes));
  }, [open]);

  function sucesso() { onClose(); router.refresh(); }

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      className="rounded-xl border border-border bg-surface text-foreground p-0 shadow-xl backdrop:bg-black/40 backdrop:backdrop-blur-sm"
    >
      <div className="w-[min(720px,95vw)] max-h-[90vh] overflow-y-auto">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Lançar nota manual</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Registre uma NF já emitida fora da plataforma. Não emite na Receita.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar">
            <X className="size-5 text-muted-foreground hover:text-muted-foreground-2" />
          </button>
        </header>
        <div className="px-6 py-5">
          {clientes === null
            ? <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>
            : <NotaManualForm clientes={clientes} onSuccess={sucesso} />}
        </div>
      </div>
    </dialog>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(auth\)/notas_fiscais/_nova-nota/NotaManualDialog.tsx
git commit -m "feat(notas): NotaManualDialog (modal da nota manual)"
```

---

### Task 6: Ligar o `NovaNotaDropdown` nos dois modais

Troca os dois `<Link>` do dropdown por `<button>` que abrem os respectivos dialogs e renderiza ambos. A partir daqui o fluxo fica funcional.

**Files:**
- Modify: `src/app/(auth)/notas_fiscais/NovaNotaDropdown.tsx`

- [ ] **Step 1: Reescrever `NovaNotaDropdown.tsx`**

```tsx
'use client';
import { useState, useRef, useEffect } from 'react';
import { ChevronDown, FilePlus, FileText } from 'lucide-react';
import EmitirNotaDialog from './_nova-nota/EmitirNotaDialog';
import NotaManualDialog from './_nova-nota/NotaManualDialog';

export default function NovaNotaDropdown() {
  const [open, setOpen] = useState(false);
  const [emitirOpen, setEmitirOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  return (
    <>
      <div ref={ref} className="relative">
        <button type="button" onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
          Nova nota <ChevronDown className="size-4" />
        </button>
        {open && (
          <div className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
            <button type="button" onClick={() => { setOpen(false); setEmitirOpen(true); }}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-foreground hover:bg-surface-2">
              <FileText className="size-4 text-primary" /> Emitir NF
            </button>
            <button type="button" onClick={() => { setOpen(false); setManualOpen(true); }}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-foreground hover:bg-surface-2 border-t border-border">
              <FilePlus className="size-4 text-muted-foreground" /> Nota manual
            </button>
          </div>
        )}
      </div>
      <EmitirNotaDialog open={emitirOpen} onClose={() => setEmitirOpen(false)} />
      <NotaManualDialog open={manualOpen} onClose={() => setManualOpen(false)} />
    </>
  );
}
```

- [ ] **Step 2: Typecheck + testes**

Run: `npm run typecheck`
Expected: sem erros.

Run: `npm test -- --run`
Expected: tudo verde (incl. `notas-filtros.test.ts`).

- [ ] **Step 3: Smoke manual no browser** (empresa AL Piscinas, homologação)

1. Lista de notas → "Nova nota" → "Emitir NF" → o modal abre no chooser com os tipos habilitados (desabilitados aparecem em cinza "não habilitado").
2. Escolher NFS-e → form carrega clientes/preview/CNAE → preencher cliente/descrição/valor → "Emitir nota" → modal fecha, lista recarrega, nota nova `pendente` aparece.
3. Forçar um bloqueio (ex.: empresa sem código de município, ou tipo não habilitado) → painel de bloqueio com mensagem (+ link, quando houver) e "Voltar" volta ao chooser.
4. "Nova nota" → "Nota manual" → modal abre com clientes → escolher tipo, número, itens → "Lançar nota" → modal fecha, lista recarrega, nota `lancada` com tag "Manual".
5. Filtro Origem=Manuais isola a nota lançada; Origem=Emitidas isola a emitida.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(auth\)/notas_fiscais/NovaNotaDropdown.tsx
git commit -m "feat(notas): dropdown abre emissão e nota manual em modal"
```

---

## Notas finais

- **Sem migrations.** Nenhuma mudança de schema; o `origem`/`lancada` da feature anterior já cobre a nota manual.
- **Ambiente.** A emissão segue só em homologação (igual hoje); nada muda nas actions de gravação.
- **`@custom`.** Manter os comentários `// @custom` no topo dos arquivos movidos/criados, seguindo a convenção do projeto.
