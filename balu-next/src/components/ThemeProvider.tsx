'use client';

// Wrapper sobre next-themes. Aplica a classe no <html> (.light / dark),
// default escuro (padrão da marca), sem opção "sistema" (v1).
import { ThemeProvider as NextThemesProvider } from 'next-themes';

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
