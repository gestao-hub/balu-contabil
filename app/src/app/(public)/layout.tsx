import Link from 'next/link';

// O card de login continua centralizado na tela — é o `flex-1 grid
// place-items-center` do meio. O que mudou é a coluna em volta: sem ela, um
// rodapé dentro do `place-items-center` original seria centralizado junto com o
// card, e um documento longo (as políticas) ficaria espremido no meio.
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="grid flex-1 place-items-center">{children}</div>

      {/* LGPD: a política de privacidade precisa ser alcançável por quem AINDA
          NÃO é cliente — é justamente quem tem de lê-la antes de decidir. Até
          20/08/2026 ela só existia dentro de `/aceite` e do cadastro, ou seja,
          atrás do login.

          `min-h-6` (24px) nos dois links: são alvos de NAVEGAÇÃO num <nav>, não
          links dentro de uma frase, então a exceção inline da WCAG 2.5.8 não os
          alcança — a 16px de altura eles reprovavam no critério de alvo de
          toque em 390px. O texto continua `text-xs`; o que cresce é a área
          clicável. Achado pela varredura de `responsivo.spec.ts` em 01/09/2026,
          na primeira vez que ela rodou depois de 14/08. */}
      <footer className="border-t border-border px-4 py-4">
        <nav className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>Balu Contábil</span>
          <span aria-hidden="true">·</span>
          <Link
            href="/documentos/privacidade"
            className="inline-flex min-h-6 items-center transition-colors hover:text-primary hover:underline"
          >
            Política de Privacidade
          </Link>
          <span aria-hidden="true">·</span>
          <Link
            href="/documentos/termos"
            className="inline-flex min-h-6 items-center transition-colors hover:text-primary hover:underline"
          >
            Termos de Uso
          </Link>
        </nav>
      </footer>
    </div>
  );
}
