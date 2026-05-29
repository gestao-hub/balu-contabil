'use client';

// Origem: reusable Bubble nomeado `Menu(i)` (FloatingGroup, 16 workflows).
// Workflows: navegação por ChangePage + carregar dados do usuário/empresa
// (DisplayGroupData) + Change Company (PATCH /profiles → MakeChangeCurrentUser → RefreshPage).
// States Bubble: `open_` (bool), `selecionado_` (text) — substituídos por
// usePathname() para o item ativo e useState para o toggle aberto/fechado.

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Home, Users, FileText, Calculator, Settings, Building2,
  ChevronDown, Menu as MenuIcon, X, LogOut, Plus,
} from 'lucide-react';
import { createBrowserClient } from '@/lib/supabase/browser';
import { useToast } from '@/components/Toaster';
import CreateCompanyDialog from '@/components/CreateCompanyDialog';
import Logo from '@/components/Logo';
import ThemeToggle from '@/components/ThemeToggle';

// Os values batem com o option set Bubble (lowercase). Para exibição, label é capitalizada.
type Role = 'empresa' | 'contador';
const ROLE_LABEL: Record<Role, string> = { empresa: 'Empresa', contador: 'Contador' };

export type MenuLateralProps = {
  userName: string;
  userRole: Role;
  companies: { id: string; nome: string }[];
  currentCompanyId: string | null;
};

type NavItem = { href: string; label: string; Icon: React.ComponentType<{ className?: string }>; roles?: Role[] };

const NAV: NavItem[] = [
  { href: '/',                      label: 'Início',         Icon: Home },
  { href: '/clientes',              label: 'Clientes',       Icon: Users },
  { href: '/notas_fiscais',         label: 'Notas fiscais',  Icon: FileText },
  { href: '/impostos',              label: 'Impostos',       Icon: Calculator },
  { href: '/configuracoes',         label: 'Configurações',  Icon: Settings },
  // TODO(honorarios): rota /honorarios ainda não gerada — adicionar a NAV quando criada
];

export default function MenuLateral({
  userName, userRole, companies, currentCompanyId,
}: MenuLateralProps) {
  const pathname = usePathname();
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [companyMenuOpen, setCompanyMenuOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const isDev = process.env.NODE_ENV !== 'production';

  const currentCompany = companies.find((c) => c.id === currentCompanyId);
  const items = NAV.filter((i) => !i.roles || i.roles.includes(userRole));

  async function changeCompany(companyId: string) {
    if (companyId === currentCompanyId) return;
    setSwitching(true);
    try {
      const supabase = createBrowserClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace('/login'); return; }
      const { error } = await supabase
        .from('profiles')
        .update({ current_company: companyId })
        .eq('user_id', user.id);
      if (error) {
        toast('error', `Não foi possível trocar de empresa: ${error.message}`);
        return;
      }
      toast('success', 'Empresa alterada');
      setCompanyMenuOpen(false);
      router.refresh();
    } finally {
      // Reabilita o seletor em TODOS os caminhos. Antes, o caminho de sucesso não
      // resetava `switching` — e como o MenuLateral vive no layout persistente (auth),
      // o router.refresh() preserva o estado client, deixando o botão `disabled` após
      // a 1ª troca (impedindo selecionar outra empresa até um reload completo).
      setSwitching(false);
    }
  }

  async function signOut() {
    const supabase = createBrowserClient();
    await supabase.auth.signOut();
    router.replace('/login');
  }

  return (
    <aside
      className={`relative flex flex-col border-r border-border bg-surface transition-[width] duration-200 ${
        open ? 'w-60' : 'w-16'
      }`}
    >
      <button
        type="button"
        aria-label={open ? 'Recolher menu' : 'Expandir menu'}
        onClick={() => setOpen((v) => !v)}
        className="absolute -right-3 top-4 grid size-6 place-items-center rounded-full border border-border bg-surface-2 text-muted-foreground shadow-sm hover:text-primary"
      >
        {open ? <X className="size-3" /> : <MenuIcon className="size-3" />}
      </button>

      {/* Marca */}
      <div className="flex items-center border-b border-border px-3 py-4">
        {open ? <Logo size={26} /> : <Logo variant="symbol" size={24} />}
      </div>

      {/* Cabeçalho com usuário + empresa — só quando expandido.
          Recolhido: omitido (sem ícone centralizado); trocar empresa = abrir o menu. */}
      {open && (
        <div className="border-b border-border p-3">
          <>
            <p className="truncate text-sm font-semibold text-foreground">{userName}</p>
            <p className="text-xs text-muted-foreground">{ROLE_LABEL[userRole] ?? userRole}</p>
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setCompanyMenuOpen((v) => !v)}
                disabled={switching}
                className="flex w-full items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5 text-left text-xs text-foreground hover:border-primary disabled:opacity-50"
              >
                <span className="flex items-center gap-1.5 truncate">
                  <Building2 className="size-3.5 shrink-0 text-primary" />
                  <span className="truncate">{currentCompany?.nome ?? 'Selecionar empresa'}</span>
                </span>
                <ChevronDown className={`size-3.5 transition-transform ${companyMenuOpen ? 'rotate-180' : ''}`} />
              </button>
              {companyMenuOpen && (
                <ul className="mt-1 max-h-60 overflow-auto rounded-md border border-border bg-surface-2 shadow-sm">
                  {companies.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => changeCompany(c.id)}
                        className={`w-full truncate px-2 py-1.5 text-left text-xs hover:bg-surface-3 ${
                          c.id === currentCompanyId ? 'font-semibold text-primary' : 'text-muted-foreground-2'
                        }`}
                      >
                        {c.nome}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {isDev && (
              <button
                type="button"
                onClick={() => { setCompanyMenuOpen(false); setAddOpen(true); }}
                className="mt-2 flex w-full items-center gap-1.5 rounded-md border border-dashed border-border px-2 py-1.5 text-xs text-muted-foreground hover:border-primary hover:text-primary"
              >
                <Plus className="size-3.5 shrink-0" />
                Nova empresa
              </button>
            )}
          </>
        </div>
      )}

      {/* Navegação */}
      <nav className="flex-1 overflow-y-auto p-2">
        <ul className="flex flex-col gap-1">
          {items.map(({ href, label, Icon }) => {
            const active = pathname === href || (href !== '/' && pathname.startsWith(href));
            return (
              <li key={href}>
                <Link
                  href={href}
                  className={`flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors ${
                    active
                      ? 'bg-primary/15 text-primary font-semibold'
                      : 'text-muted-foreground-2 hover:bg-surface-2 hover:text-foreground'
                  }`}
                >
                  <Icon className="size-4 shrink-0" />
                  {open && <span className="truncate">{label}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Sair */}
      <div className="border-t border-border p-2">
        <ThemeToggle open={open} />
        <button
          type="button"
          onClick={signOut}
          className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm text-muted-foreground-2 hover:bg-surface-2 hover:text-foreground"
        >
          <LogOut className="size-4 shrink-0" />
          {open && <span>Sair</span>}
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
  );
}
