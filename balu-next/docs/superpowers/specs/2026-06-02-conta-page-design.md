# Design: Página /conta — Perfil, Segurança e Exclusão

**Data:** 2026-06-02  
**Branch:** main (criar `feat/conta-page` na implementação)

---

## Contexto

Página dedicada às configurações pessoais do usuário — separada de `/configuracoes` que é empresa-específica. Atende roles `empresa` e `contador`. Fundação para o SaaS: abas adicionais de Plano e Notificações serão encaixadas aqui futuramente sem refatoração.

---

## Rota e arquivos

```
src/app/(auth)/conta/
├── page.tsx              — Server Component: carrega user + roleRow, renderiza tabs
├── actions.ts            — updateNomeAction, updateEmailAction, updateSenhaAction, deleteAccountAction
├── PerfilForm.tsx        — Client: nome (editar) + email (read-only + fluxo alterar) + role (read-only)
├── AlterarSenhaForm.tsx  — Client: nova senha + confirmar
└── DangerZone.tsx        — Client: botão deletar + PopupConfirm com digitação de email

src/lib/supabase/admin.ts — createAdminClient() com service_role (para deleteUser)
```

---

## Menu

`MenuLateral.tsx` — adicionar ao array `NAV`, visível para todos os roles:

```ts
{ href: '/conta', label: 'Conta', Icon: UserCircle }
```

Importar `UserCircle` de `lucide-react`.

---

## Tabs

`?tab=perfil` (default) e `?tab=seguranca` — mesmo padrão de `/configuracoes` (`TABS` array + `?tab=` na URL).

---

## Aba Perfil

### Dados carregados no Server Component

```ts
const { data: { user } } = await supabase.auth.getUser();
const { data: roleRow } = await supabase
  .from('role_types').select('type').eq('user_id', user.id).maybeSingle();
const nome = (user.user_metadata?.full_name as string | null) ?? '';
const role = (roleRow?.type as string | null) ?? 'Empresa';
```

### `PerfilForm.tsx` — campos

| Campo | Valor | Editável |
|---|---|---|
| Nome de exibição | `user_metadata.full_name` | ✅ modo leitura/edição |
| Email | `user.email` | ❌ read-only — botão "Alterar email" abre sub-form inline |
| Tipo de conta | `role_types.type` (Empresa / Contador) | ❌ read-only |

**Alterar nome:** `updateNomeAction(nome)` → `supabase.auth.updateUser({ data: { full_name: nome } })`.  
Após salvar, o `MenuLateral` exibe `user_metadata.full_name ?? user.email` — ajustar o layout para ler `full_name`.

**Alterar email:** botão "Alterar email" expande sub-form inline (não modal):
- Campo "Novo email" + botão "Enviar confirmação"
- `updateEmailAction(newEmail)` → `supabase.auth.updateUser({ email: newEmail })`
- Supabase envia link de confirmação para o **novo** endereço; o email só muda após o clique
- Mensagem de retorno: *"Link enviado para [newEmail]. O email atual permanece ativo até a confirmação."*
- Nenhum redirect necessário — o usuário permanece logado

---

## Aba Segurança

### `AlterarSenhaForm.tsx`

Formulário client simples (modo sempre editável — não faz sentido "ler" senha):

```
Nova senha          [________________]
Confirmar senha     [________________]
                                [Salvar]
```

**`updateSenhaAction(senha)`:**
- Valida: `senha.length >= 6`, senhas idênticas
- `supabase.auth.updateUser({ password: senha })`
- Toast de sucesso; limpa os campos

Não exige senha atual — usuário está autenticado. Implementada em `conta/actions.ts` (não reaproveita a de `/reset_pw` para evitar acoplamento entre rotas públicas e privadas).

---

### `DangerZone.tsx` — Zona de risco

Seção visual separada por borda `destructive` no rodapé da aba Segurança.

**UI:**
```
┌─ Zona de risco ─────────────────────────────────────────┐
│  Excluir conta                                           │
│  Esta ação é irreversível. Empresas, notas fiscais,      │
│  clientes e todos os dados vinculados serão excluídos    │
│  permanentemente.                                        │
│                                                          │
│                       [Excluir minha conta]  (vermelho)  │
└──────────────────────────────────────────────────────────┘
```

**Fluxo ao clicar:**

1. Abre `<PopupConfirm variant="destructive">` com campo de texto
2. Usuário digita o **próprio email** para confirmar (prevenção de clique acidental)
3. Ao confirmar → chama `deleteAccountAction()`

**`deleteAccountAction()`:**
1. `createServerClient()` → verifica sessão atual (`user.id`)
2. `createAdminClient()` → `supabase.auth.admin.deleteUser(user.id)`
3. Cascade do banco apaga: `profiles`, `companies` (→ toda a cadeia), `clientes`, `abertura_empresas`, `role_types`
4. `supabase.auth.signOut()` no cliente (feito pelo caller após retorno `ok: true`)
5. `redirect('/login')`

---

## `src/lib/supabase/admin.ts`

```ts
import 'server-only';
import { createClient } from '@supabase/supabase-js';

export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
```

Usado exclusivamente em server actions e route handlers — nunca exposto ao cliente.

---

## Ajuste no MenuLateral

`userName` passa a preferir `full_name`:

```ts
// layout.tsx — já passa user.email; ajustar para:
userName={
  (user.user_metadata?.full_name as string | null)?.trim() || user.email || 'Usuário'
}
```

---

## Testes

- `tsc --noEmit` verde
- Smoke manual:
  - Alterar nome → MenuLateral reflete imediatamente após router.refresh()
  - Alterar email → toast de confirmação, email não muda até link clicado
  - Alterar senha → login com nova senha funciona
  - Deletar conta → sem o email correto no popup, botão permanece desabilitado; com email correto, redireciona para /login e sessão não existe mais

---

## Roadmap SaaS (fora do escopo v1)

| Aba futura | Conteúdo |
|---|---|
| Notificações | Alertas por email: DAS vencendo, notas pendentes, etc. |
| Plano | Tier atual, uso (empresas, notas/mês), upgrade, faturas |
| Segurança (expansão) | Sessões ativas, 2FA |

---

## DoD

- [ ] `src/lib/supabase/admin.ts` criado
- [ ] `conta/actions.ts` com 4 actions (nome, email, senha, delete)
- [ ] `PerfilForm.tsx` com sub-form inline de email
- [ ] `AlterarSenhaForm.tsx`
- [ ] `DangerZone.tsx` com PopupConfirm + validação de email
- [ ] `conta/page.tsx` com tabs perfil/segurança
- [ ] MenuLateral: item Conta + full_name no userName
- [ ] `tsc --noEmit` verde
