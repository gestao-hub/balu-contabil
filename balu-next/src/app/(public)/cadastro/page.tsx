// @custom — implementado pela skill bubble-behavior
'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useState } from 'react';
import { signupAction, type SignupState } from './actions';

const initialState: SignupState = undefined;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function CadastroPage() {
  const [state, formAction] = useActionState(signupAction, initialState);
  const [clientError, setClientError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get('email') ?? '');
    const password = String(fd.get('password') ?? '');
    if (!EMAIL_RE.test(email)) {
      e.preventDefault();
      setClientError('Informe um e-mail válido.');
      return;
    }
    if (password.length < 6) {
      e.preventDefault();
      setClientError('A senha deve ter pelo menos 6 caracteres.');
      return;
    }
    setClientError(null);
  }

  const errorMsg = clientError ?? state?.error;

  return (
    <main className="w-full max-w-sm px-6">
      <div className="bg-white rounded-2xl shadow-sm border border-zinc-200 p-8">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-primary">Balu</h1>
          <p className="text-sm text-zinc-500 mt-1">Crie sua conta</p>
        </div>

        <form action={formAction} onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="full_name" className="block text-sm font-medium text-zinc-700 mb-1">
              Nome completo
            </label>
            <input
              id="full_name"
              name="full_name"
              type="text"
              required
              autoComplete="name"
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

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
              minLength={6}
              autoComplete="new-password"
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <p className="text-xs text-zinc-500 mt-1">Mínimo 6 caracteres.</p>
          </div>

          {errorMsg && (
            <p className="text-sm text-destructive bg-red-50 border border-red-100 rounded-md px-3 py-2">
              {errorMsg}
            </p>
          )}

          <SubmitButton />
        </form>

        <div className="mt-6 text-center text-sm">
          <span className="text-zinc-500">Já tem conta? </span>
          <Link href="/login" className="text-primary hover:underline">
            Entrar
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
      {pending ? 'Criando…' : 'Criar conta'}
    </button>
  );
}
