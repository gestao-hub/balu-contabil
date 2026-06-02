# Botão "Nova empresa" no menu (dev-only) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar um botão "+ Nova empresa" no `MenuLateral` (visível só em desenvolvimento) que abre o `CreateCompanyDialog` sob demanda, sem precisar apagar empresas.

**Architecture:** Mudança só em `MenuLateral.tsx` (client). Ele passa a renderizar a própria instância do `CreateCompanyDialog` (modo normal, com fechar) controlada por `useState`, e um botão gated por `process.env.NODE_ENV !== 'production'`. Ao criar, `router.refresh()` recarrega o layout (a nova empresa já vira a atual via `createCompanyAction`). Sem mudança em `layout.tsx`, `CreateCompanyDialog`, actions ou schema.

**Tech Stack:** Next.js 15 (client component), React, lucide-react. Sem teste novo (componente sem suíte; verificação por `tsc` + round-trip ao vivo).

**Spec:** `docs/superpowers/specs/2026-05-27-menu-nova-empresa-dev-design.md`

---

### Task 1: Botão "Nova empresa" + dialog no `MenuLateral` (dev-only)

**Files:**
- Modify: `app/src/components/MenuLateral.tsx`

Quatro edições no mesmo arquivo.

- [ ] **Step 1: Importar `Plus` e o `CreateCompanyDialog`**

Trocar:
```tsx
import {
  Home, Users, FileText, Calculator, Settings, Building2,
  ChevronDown, Menu as MenuIcon, X, LogOut,
} from 'lucide-react';
import { createBrowserClient } from '@/lib/supabase/browser';
import { useToast } from '@/components/Toaster';
```
por:
```tsx
import {
  Home, Users, FileText, Calculator, Settings, Building2,
  ChevronDown, Menu as MenuIcon, X, LogOut, Plus,
} from 'lucide-react';
import { createBrowserClient } from '@/lib/supabase/browser';
import { useToast } from '@/components/Toaster';
import CreateCompanyDialog from '@/components/CreateCompanyDialog';
```

- [ ] **Step 2: Adicionar state `addOpen` e a const `isDev`**

Trocar:
```tsx
  const [open, setOpen] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [companyMenuOpen, setCompanyMenuOpen] = useState(false);
```
por:
```tsx
  const [open, setOpen] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [companyMenuOpen, setCompanyMenuOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const isDev = process.env.NODE_ENV !== 'production';
```

- [ ] **Step 3: Adicionar o botão "+ Nova empresa" logo abaixo do seletor de empresa**

Trocar (final do bloco do dropdown de empresas, dentro do branch `open ? (...)`):
```tsx
                </ul>
              )}
            </div>
          </>
```
por:
```tsx
                </ul>
              )}
            </div>
            {isDev && (
              <button
                type="button"
                onClick={() => setAddOpen(true)}
                className="mt-2 flex w-full items-center gap-1.5 rounded-md border border-dashed border-zinc-300 px-2 py-1.5 text-xs text-zinc-600 hover:border-primary hover:text-primary"
              >
                <Plus className="size-3.5 shrink-0" />
                Nova empresa
              </button>
            )}
          </>
```

- [ ] **Step 4: Renderizar a instância do `CreateCompanyDialog` antes de fechar o `<aside>`**

Trocar (fim do bloco "Sair"):
```tsx
        </button>
      </div>
    </aside>
```
por:
```tsx
        </button>
      </div>

      {isDev && (
        <CreateCompanyDialog
          open={addOpen}
          onClose={() => setAddOpen(false)}
          onCreated={() => { setAddOpen(false); router.refresh(); }}
        />
      )}
    </aside>
```

- [ ] **Step 5: `tsc` + `vitest`**

Run: `cd app && npx tsc --noEmit && npx vitest run`
Expected: tsc zero erros; vitest verde (nenhuma suíte cobre `MenuLateral`; nada de helper mudou — total 50 testes).

- [ ] **Step 6: Commit**

```bash
git add app/src/components/MenuLateral.tsx
git commit -m "feat(menu): botão Nova empresa (dev-only) abre CreateCompanyDialog sob demanda

Gated por process.env.NODE_ENV !== 'production'; ao criar, router.refresh()
atualiza o seletor (a nova vira a empresa atual via createCompanyAction).
Sem mudança em layout/CreateCompanyDialog/actions."
```

---

## Verificação final (controlador, ao vivo)

Dev server em `:3000` (`NODE_ENV` de dev), usuário de teste logado.

1. `/` (ou qualquer rota autenticada): com o menu expandido, o botão **"+ Nova empresa"** aparece abaixo do seletor de empresa.
2. Clicar → abre o `CreateCompanyDialog` em modo normal (com X e "Cancelar", diferente do onboarding forçado).
3. Preencher CNPJ/CEP/endereço (a máscara e o ViaCEP já funcionam) e "Criar empresa" → toast de sucesso, popup fecha.
4. O seletor de empresa do menu passa a mostrar a empresa recém-criada como atual, e ela aparece na lista do dropdown.
5. Cancelar/fechar (X) também funciona sem criar nada.

> O gate de produção (`isDev`) não é testável no `npm run dev` (sempre dev); é garantido estaticamente — `process.env.NODE_ENV` é inlinado pelo Next e o bloco é eliminado no build de produção.
