// @custom — implementado pela skill bubble-behavior
'use client';

import Link from 'next/link';
import { Suspense, useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useSearchParams } from 'next/navigation';
import { loginAction, type AuthState } from './actions';
import Logo from '@/components/Logo';

const initialState: AuthState = undefined;

export default function LoginPage() {
  const [state, formAction] = useActionState(loginAction, initialState);

  return (
    <main className="w-full max-w-sm px-6">
      <div className="bg-surface rounded-2xl shadow-lg shadow-black/40 border border-border p-8">
        <div className="flex flex-col items-center mb-8">
          <Logo size={44} className="mb-3" />
          <p className="text-sm text-muted-foreground mt-1">Gestão fiscal simplificada</p>
        </div>

        <form action={formAction} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-muted-foreground-2 mb-1">
              E-mail
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="w-full rounded-lg border border-border bg-surface-2 text-foreground placeholder:text-muted-foreground px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-muted-foreground-2 mb-1">
              Senha
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="w-full rounded-lg border border-border bg-surface-2 text-foreground placeholder:text-muted-foreground px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <Suspense fallback={null}>
            <NextField />
            <ErrorBanner stateError={state?.error} />
          </Suspense>

          <SubmitButton />
        </form>

        <div className="mt-6 flex items-center justify-between text-sm">
          <Link href="/reset_pw" className="text-primary hover:underline">
            Esqueci a senha
          </Link>
          <Link href="/cadastro" className="text-primary hover:underline">
            Criar conta
          </Link>
        </div>
      </div>
    </main>
  );
}

// Passthrough mínimo pro fluxo de convite: `/login?next=/convite/<token>` — o
// action lê este campo oculto e redireciona pra lá após autenticar (em vez de
// sempre mandar pra `/`). Vai como hidden input (não searchParam direto na
// action) porque server actions não recebem a URL da página que as invocou.
function NextField() {
  const sp = useSearchParams();
  const next = sp.get('next');
  if (!next) return null;
  return <input type="hidden" name="next" value={next} />;
}

// useSearchParams precisa de Suspense boundary no Next 15. Isolei o consumer
// num componente filho pra não obrigar a página inteira a virar dinâmica.
function ErrorBanner({ stateError }: { stateError?: string }) {
  const sp = useSearchParams();
  const queryError = sp.get('error');
  const msg = stateError ?? queryError;
  if (!msg) return null;
  return (
    <p className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">
      {msg}
    </p>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full bg-primary text-white rounded-lg py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-60 transition"
    >
      {pending ? 'Entrando…' : 'Entrar'}
    </button>
  );
}
