'use client';

// Toggle claro/escuro na sidebar. useTheme do next-themes; a guarda `mounted`
// evita hydration mismatch (o tema resolvido só existe no cliente).
import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Sun, Moon } from 'lucide-react';

export default function ThemeToggle({ open }: { open: boolean }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === 'dark';
  const label = isDark ? 'Modo claro' : 'Modo escuro';

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm text-muted-foreground-2 hover:bg-surface-2 hover:text-foreground"
    >
      {/* Antes de montar, renderiza um ícone neutro p/ não piscar/mismatch */}
      {!mounted ? (
        <Sun className="size-4 shrink-0 opacity-0" />
      ) : isDark ? (
        <Sun className="size-4 shrink-0" />
      ) : (
        <Moon className="size-4 shrink-0" />
      )}
      {open && <span>{mounted ? label : ''}</span>}
    </button>
  );
}
