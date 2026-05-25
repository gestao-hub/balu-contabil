// @custom — implementado pela skill bubble-behavior
'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { loginAction, type AuthState } from './actions';

const initialState: AuthState = undefined;

export default function LoginPage() {
  const [state, formAction] = useActionState(loginAction, initialState);

  return (
    <main className="w-full max-w-sm px-6">
      <div className="bg-white rounded-2xl shadow-sm border border-zinc-200 p-8">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-primary">Balu</h1>
          <p className="text-sm text-zinc-500 mt-1">Gestão fiscal simplificada</p>
        </div>

        <form action={formAction} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-zinc-700 mb-1">
              E-mail
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-zinc-700 mb-1">
              Senha
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {state?.error && (
            <p className="text-sm text-destructive bg-red-50 border border-red-100 rounded-md px-3 py-2">
              {state.error}
            </p>
          )}

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
