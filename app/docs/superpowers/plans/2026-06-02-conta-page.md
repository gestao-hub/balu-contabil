# Página /conta — Perfil, Segurança e Exclusão

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar a página `/conta` com abas Perfil (nome, email, role) e Segurança (alterar senha, deletar conta), acessível por todos os roles no menu lateral.

**Architecture:** Server Component `conta/page.tsx` carrega `user` + `roleRow` e renderiza tabs via `?tab=`. Três Client Components isolados (`PerfilForm`, `AlterarSenhaForm`, `DangerZone`) consomem server actions de `conta/actions.ts`. Delete usa `createAdminClient()` com service_role para `auth.admin.deleteUser`.

**Tech Stack:** Next.js 15 App Router, Supabase SSR (`@supabase/ssr`), Supabase Admin (`@supabase/supabase-js`), Tailwind, `useToast`, `PopupConfirm`.

---

## Mapa de arquivos

| Arquivo | Ação |
|---|---|
| `src/lib/supabase/admin.ts` | CRIAR — `createAdminClient()` com service_role |
| `src/app/(auth)/conta/actions.ts` | CRIAR — 4 server actions |
| `src/app/(auth)/conta/PerfilForm.tsx` | CRIAR — nome + email inline + role |
| `src/app/(auth)/conta/AlterarSenhaForm.tsx` | CRIAR — nova senha + confirmar |
| `src/app/(auth)/conta/DangerZone.tsx` | CRIAR — delete com PopupConfirm |
| `src/app/(auth)/conta/page.tsx` | CRIAR — Server Component com tabs |
| `src/components/MenuLateral.tsx` | MODIFICAR — adicionar item Conta + UserCircle |
| `src/app/(auth)/layout.tsx` | MODIFICAR — `userName` prefere `full_name` |

---

## Task 1: `createAdminClient`

**Files:**
- Create: `src/lib/supabase/admin.ts`

- [ ] **Step 1: Criar o cliente admin**

```ts
// src/lib/supabase/admin.ts
import 'server-only';
import { createClient } from '@supabase/supabase-js';

/** Cliente Supabase com service_role — bypassa RLS.
 *  Usar APENAS em server actions / route handlers para operações privilegiadas. */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /home/allan/Projetos/claude/balu/balu-next && npm run typecheck 2>&1 | tail -5
```

Esperado: `Found 0 errors`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/supabase/admin.ts
git commit -m "feat(supabase): createAdminClient com service_role para operações privilegiadas"
```

---

## Task 2: Server actions (`conta/actions.ts`)

**Files:**
- Create: `src/app/(auth)/conta/actions.ts`

- [ ] **Step 1: Criar o arquivo com as 4 actions**

```ts
// src/app/(auth)/conta/actions.ts
'use server';
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export type ContaActionResult = { ok: true; message?: string } | { ok: false; error: string };

/** Atualiza o nome de exibição em user_metadata.full_name. */
export async function updateNomeAction(nome: string): Promise<ContaActionResult> {
  const trimmed = nome.trim();
  if (!trimmed) return { ok: false, error: 'Informe um nome.' };

  const supabase = await createServerClient();
  const { error } = await supabase.auth.updateUser({ data: { full_name: trimmed } });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Envia link de confirmação para o novo email.
 *  O email só muda após o usuário clicar no link recebido. */
export async function updateEmailAction(newEmail: string): Promise<ContaActionResult> {
  const trimmed = newEmail.trim().toLowerCase();
  if (!trimmed || !trimmed.includes('@')) return { ok: false, error: 'Informe um email válido.' };

  const supabase = await createServerClient();
  const { error } = await supabase.auth.updateUser({ email: trimmed });
  if (error) return { ok: false, error: error.message };
  return { ok: true, message: `Link enviado para ${trimmed}. O email atual permanece ativo até a confirmação.` };
}

/** Atualiza a senha do usuário autenticado. */
export async function updateSenhaAction(senha: string, confirmar: string): Promise<ContaActionResult> {
  if (senha.length < 6) return { ok: false, error: 'A senha deve ter pelo menos 6 caracteres.' };
  if (senha !== confirmar) return { ok: false, error: 'As senhas não coincidem.' };

  const supabase = await createServerClient();
  const { error } = await supabase.auth.updateUser({ password: senha });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Exclui permanentemente a conta e todos os dados vinculados (cascade no banco).
 *  Após a exclusão, invalida a sessão e redireciona para /login. */
export async function deleteAccountAction(): Promise<ContaActionResult> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) return { ok: false, error: error.message };

  // Invalida os cookies de sessão antes do redirect.
  await supabase.auth.signOut();
  redirect('/login');
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck 2>&1 | tail -5
```

Esperado: `Found 0 errors`.

- [ ] **Step 3: Commit**

```bash
git add 'src/app/(auth)/conta/actions.ts'
git commit -m "feat(conta): 4 server actions — nome, email, senha, delete"
```

---

## Task 3: `PerfilForm.tsx`

**Files:**
- Create: `src/app/(auth)/conta/PerfilForm.tsx`

- [ ] **Step 1: Criar o componente**

```tsx
// src/app/(auth)/conta/PerfilForm.tsx
'use client';
import { useState, useTransition } from 'react';
import { Pencil, Save, X, Mail } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { updateNomeAction, updateEmailAction } from './actions';

type Props = {
  initialNome: string;
  email: string;
  role: string;
};

export default function PerfilForm({ initialNome, email, role }: Props) {
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  // — Nome
  const [editingNome, setEditingNome] = useState(false);
  const [nome, setNome] = useState(initialNome);
  const [nomeTemp, setNomeTemp] = useState(initialNome);

  // — Email inline form
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [newEmail, setNewEmail] = useState('');

  function handleNomeSave() {
    startTransition(async () => {
      const r = await updateNomeAction(nomeTemp);
      if (!r.ok) { toast('error', r.error); return; }
      setNome(nomeTemp);
      setEditingNome(false);
      toast('success', 'Nome atualizado.');
    });
  }

  function handleNomeCancel() {
    setNomeTemp(nome);
    setEditingNome(false);
  }

  function handleEmailSend() {
    startTransition(async () => {
      const r = await updateEmailAction(newEmail);
      if (!r.ok) { toast('error', r.error); return; }
      toast('info', r.message ?? 'Link enviado.');
      setShowEmailForm(false);
      setNewEmail('');
    });
  }

  return (
    <div className="max-w-lg space-y-6">

      {/* Nome */}
      <div className="rounded-lg border border-border bg-surface p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Nome de exibição</p>
        {editingNome ? (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={nomeTemp}
              onChange={(e) => setNomeTemp(e.target.value)}
              autoFocus
              className="flex-1 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground"
            />
            <button
              type="button"
              onClick={handleNomeSave}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              <Save className="size-3.5" />
              Salvar
            </button>
            <button
              type="button"
              onClick={handleNomeCancel}
              disabled={isPending}
              className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground-2 hover:bg-surface-2 disabled:opacity-50"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <p className="text-sm text-foreground">{nome || <span className="text-muted-foreground italic">Não definido</span>}</p>
            <button
              type="button"
              onClick={() => { setNomeTemp(nome); setEditingNome(true); }}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground-2 hover:bg-surface-2"
            >
              <Pencil className="size-3" />
              Editar
            </button>
          </div>
        )}
      </div>

      {/* Email */}
      <div className="rounded-lg border border-border bg-surface p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Email</p>
        <div className="flex items-center justify-between">
          <p className="text-sm text-foreground">{email}</p>
          {!showEmailForm && (
            <button
              type="button"
              onClick={() => setShowEmailForm(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground-2 hover:bg-surface-2"
            >
              <Mail className="size-3" />
              Alterar email
            </button>
          )}
        </div>
        {showEmailForm && (
          <div className="mt-3 flex items-center gap-2">
            <input
              type="email"
              placeholder="Novo email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              autoFocus
              className="flex-1 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground"
            />
            <button
              type="button"
              onClick={handleEmailSend}
              disabled={isPending || !newEmail.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              Enviar confirmação
            </button>
            <button
              type="button"
              onClick={() => { setShowEmailForm(false); setNewEmail(''); }}
              disabled={isPending}
              className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground-2 hover:bg-surface-2"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Tipo de conta — read-only */}
      <div className="rounded-lg border border-border bg-surface p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Tipo de conta</p>
        <p className="text-sm text-foreground capitalize">{role}</p>
      </div>

    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck 2>&1 | tail -5
```

Esperado: `Found 0 errors`.

- [ ] **Step 3: Commit**

```bash
git add 'src/app/(auth)/conta/PerfilForm.tsx'
git commit -m "feat(conta): PerfilForm — nome editável, alterar email inline, role read-only"
```

---

## Task 4: `AlterarSenhaForm.tsx`

**Files:**
- Create: `src/app/(auth)/conta/AlterarSenhaForm.tsx`

- [ ] **Step 1: Criar o componente**

```tsx
// src/app/(auth)/conta/AlterarSenhaForm.tsx
'use client';
import { useState, useTransition } from 'react';
import { Loader2, Save } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { updateSenhaAction } from './actions';

export default function AlterarSenhaForm() {
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [senha, setSenha] = useState('');
  const [confirmar, setConfirmar] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const r = await updateSenhaAction(senha, confirmar);
      if (!r.ok) { toast('error', r.error); return; }
      toast('success', 'Senha atualizada com sucesso.');
      setSenha('');
      setConfirmar('');
    });
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-lg space-y-4">
      <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Alterar senha</p>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs font-medium text-muted-foreground-2">Nova senha</span>
          <input
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            minLength={6}
            required
            autoComplete="new-password"
            className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs font-medium text-muted-foreground-2">Confirmar senha</span>
          <input
            type="password"
            value={confirmar}
            onChange={(e) => setConfirmar(e.target.value)}
            minLength={6}
            required
            autoComplete="new-password"
            className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground"
          />
        </label>
      </div>
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Salvar senha
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck 2>&1 | tail -5
```

Esperado: `Found 0 errors`.

- [ ] **Step 3: Commit**

```bash
git add 'src/app/(auth)/conta/AlterarSenhaForm.tsx'
git commit -m "feat(conta): AlterarSenhaForm — nova senha + confirmar"
```

---

## Task 5: `DangerZone.tsx`

**Files:**
- Create: `src/app/(auth)/conta/DangerZone.tsx`

- [ ] **Step 1: Criar o componente**

```tsx
// src/app/(auth)/conta/DangerZone.tsx
'use client';
import { useState, useTransition } from 'react';
import { Trash2 } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import PopupConfirm from '@/components/PopupConfirm';
import { deleteAccountAction } from './actions';

type Props = { email: string };

export default function DangerZone({ email }: Props) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [isPending, startTransition] = useTransition();

  const confirmed = typed.trim().toLowerCase() === email.toLowerCase();

  function handleConfirm() {
    if (!confirmed) return;
    startTransition(async () => {
      const r = await deleteAccountAction();
      // Se chegou aqui sem redirect, é erro
      if (!r.ok) {
        toast('error', r.error);
        setOpen(false);
        setTyped('');
      }
    });
  }

  function handleCancel() {
    setOpen(false);
    setTyped('');
  }

  return (
    <>
      <div className="max-w-lg rounded-lg border border-destructive/40 bg-destructive/5 p-4">
        <p className="text-sm font-semibold text-destructive mb-1">Zona de risco</p>
        <p className="text-xs text-muted-foreground-2 mb-4">
          Excluir conta é irreversível. Empresas, notas fiscais, clientes e todos os dados
          vinculados serão permanentemente excluídos.
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 rounded-md bg-destructive px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          <Trash2 className="size-4" />
          Excluir minha conta
        </button>
      </div>

      <PopupConfirm
        open={open}
        variant="destructive"
        title="Excluir conta permanentemente"
        description="Esta ação não pode ser desfeita. Digite seu email para confirmar."
        confirmLabel="Excluir conta"
        onConfirm={handleConfirm}
        onCancel={handleCancel}
        busy={!confirmed || isPending}
      >
        <input
          type="email"
          placeholder={email}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoFocus
          className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground"
        />
        {typed && !confirmed && (
          <p className="mt-1 text-xs text-destructive">Email incorreto.</p>
        )}
      </PopupConfirm>
    </>
  );
}

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck 2>&1 | tail -5
```

Esperado: `Found 0 errors`.

- [ ] **Step 3: Commit**

```bash
git add 'src/app/(auth)/conta/DangerZone.tsx'
git commit -m "feat(conta): DangerZone — delete com PopupConfirm e confirmação por email"
```

---

## Task 6: `conta/page.tsx`

**Files:**
- Create: `src/app/(auth)/conta/page.tsx`

- [ ] **Step 1: Criar a page**

```tsx
// src/app/(auth)/conta/page.tsx
import Link from 'next/link';
import { createServerClient } from '@/lib/supabase/server';
import PerfilForm from './PerfilForm';
import AlterarSenhaForm from './AlterarSenhaForm';
import DangerZone from './DangerZone';

const TABS = [
  { key: 'perfil',    label: 'Perfil' },
  { key: 'seguranca', label: 'Segurança' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

type SP = Promise<{ tab?: string }>;

export default async function ContaPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const active: TabKey =
    (TABS.find((t) => t.key === sp.tab)?.key ?? 'perfil') as TabKey;

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: roleRow } = await supabase
    .from('role_types')
    .select('type')
    .eq('user_id', user.id)
    .maybeSingle();

  const nome = (user.user_metadata?.full_name as string | null) ?? '';
  const email = user.email ?? '';
  const role = (roleRow?.type as string | null) ?? 'Empresa';

  return (
    <main className="p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground">Minha conta</h1>
        <p className="text-sm text-muted-foreground mt-1">{email}</p>
      </header>

      <nav className="border-b border-border mb-6">
        <ul className="flex gap-1">
          {TABS.map((t) => {
            const is = t.key === active;
            return (
              <li key={t.key}>
                <Link
                  href={`/conta?tab=${t.key}`}
                  className={`inline-block px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                    is
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted-foreground-2 hover:text-foreground'
                  }`}
                >
                  {t.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {active === 'perfil' && (
        <PerfilForm initialNome={nome} email={email} role={role} />
      )}

      {active === 'seguranca' && (
        <div className="space-y-8">
          <AlterarSenhaForm />
          <DangerZone email={email} />
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck 2>&1 | tail -5
```

Esperado: `Found 0 errors`.

- [ ] **Step 3: Verificar no browser que a rota existe**

Acesse `http://localhost:3002/conta` — deve renderizar a aba Perfil. Acesse `http://localhost:3002/conta?tab=seguranca` — deve renderizar AlterarSenhaForm + DangerZone.

- [ ] **Step 4: Commit**

```bash
git add 'src/app/(auth)/conta/page.tsx'
git commit -m "feat(conta): page.tsx com tabs Perfil e Segurança"
```

---

## Task 7: MenuLateral + layout

**Files:**
- Modify: `src/components/MenuLateral.tsx`
- Modify: `src/app/(auth)/layout.tsx`

- [ ] **Step 1: Adicionar item Conta ao MenuLateral**

Em `src/components/MenuLateral.tsx`:

1. Adicione `UserCircle` ao import do lucide-react (linha ~13):

```ts
import {
  Home, Users, FileText, Calculator, HandCoins, Settings, Building2,
  ChevronDown, Menu as MenuIcon, X, LogOut, Plus, UserCircle,
} from 'lucide-react';
```

2. Adicione o item ao array `NAV` após `Configurações` (linha ~41):

```ts
const NAV: NavItem[] = [
  { href: '/',                      label: 'Início',         Icon: Home },
  { href: '/clientes',              label: 'Clientes',       Icon: Users },
  { href: '/notas_fiscais',         label: 'Notas fiscais',  Icon: FileText },
  { href: '/impostos',              label: 'Impostos',       Icon: Calculator },
  { href: '/honorarios',            label: 'Honorários',     Icon: HandCoins, roles: ['contador'] },
  { href: '/configuracoes',         label: 'Configurações',  Icon: Settings },
  { href: '/conta',                 label: 'Conta',          Icon: UserCircle },
];
```

- [ ] **Step 2: Atualizar `layout.tsx` para preferir `full_name`**

Em `src/app/(auth)/layout.tsx`, localize a linha que passa `userName`:

```tsx
userName={user.email ?? 'Usuário'}
```

Substitua por:

```tsx
userName={
  ((user.user_metadata?.full_name as string | null)?.trim()) ||
  user.email ||
  'Usuário'
}
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck 2>&1 | tail -5
```

Esperado: `Found 0 errors`.

- [ ] **Step 4: Verificar no browser**

- Menu lateral deve exibir o item "Conta" com ícone de usuário.
- Ao clicar, navega para `/conta`.
- Se o usuário tiver `full_name` preenchido, o topo do menu mostra o nome em vez do email.

- [ ] **Step 5: Commit**

```bash
git add src/components/MenuLateral.tsx 'src/app/(auth)/layout.tsx'
git commit -m "feat(menu): item Conta no menu + userName prefere full_name"
```

---

## Task 8: Verificação final

**Files:** nenhum novo.

- [ ] **Step 1: Typecheck limpo**

```bash
npm run typecheck 2>&1
```

Esperado: `Found 0 errors`.

- [ ] **Step 2: Testes unitários**

```bash
npm test 2>&1 | tail -10
```

Esperado: todos passando.

- [ ] **Step 3: Smoke manual — Perfil**

Acesse `http://localhost:3002/conta`:
- Nome não definido → exibe "Não definido" em itálico.
- Clicar "Editar" → input aparece com nome atual.
- Salvar nome → campo volta para leitura com novo valor; `router.refresh()` reflete no menu.
- "Alterar email" → sub-form inline aparece; preencher email válido → botão "Enviar confirmação" ativo; clicar → toast com mensagem de link enviado, sub-form fecha.

- [ ] **Step 4: Smoke manual — Segurança**

Acesse `http://localhost:3002/conta?tab=seguranca`:
- Formulário de senha visível.
- Senhas diferentes → toast de erro "As senhas não coincidem."
- Senha < 6 chars → toast de erro.
- Senha válida → toast de sucesso, campos limpos.
- Botão "Excluir minha conta" → abre popup; email incorreto → botão "Excluir conta" desabilitado (`busy`); email correto → botão habilita; confirmar → redireciona para `/login`.

- [ ] **Step 5: Criar branch e PR**

```bash
# Se ainda não estiver em branch:
git checkout -b feat/conta-page
# (Todos os commits desta feature foram feitos direto em main?
#  Se sim, criar branch a partir do commit anterior ao Task 1 e cherry-pick os commits)

# Alternativa: apenas confirmar que main está limpo e funcional
git status
git log --oneline -8
```

- [ ] **Step 6: Criar card no kanban e marcar como Done**

Usar o skill `local-kanban-sync` ou adicionar manualmente no board.json:
- Title: `Conta: Perfil, Segurança e Exclusão`
- Status: `done`
- Labels: `[conta, auth, perfil, seguranca]`
- Checklist: todos os itens do DoD marcados
