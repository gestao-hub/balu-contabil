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
    const passwordConfirm = String(fd.get('password_confirm') ?? '');
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
    if (password !== passwordConfirm) {
      e.preventDefault();
      setClientError('As senhas não conferem.');
      return;
    }
    setClientError(null);
  }

  const errorMsg = clientError ?? state?.error;

  return (
    <main className="w-full max-w-sm px-6">
      <div className="bg-surface rounded-2xl shadow-sm border border-border p-8">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-primary">Balu</h1>
          <p className="text-sm text-muted-foreground mt-1">Crie sua conta</p>
        </div>

        <form action={formAction} onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="full_name" className="block text-sm font-medium text-muted-foreground-2 mb-1">
              Nome completo
            </label>
            <input
              id="full_name"
              name="full_name"
              type="text"
              required
              autoComplete="name"
              className="w-full rounded-lg border border-border bg-surface-2 text-foreground px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div>
            <label htmlFor="role_type" className="block text-sm font-medium text-muted-foreground-2 mb-1">
              Tipo de conta
            </label>
            <select
              id="role_type"
              name="role_type"
              defaultValue=""
              className="w-full rounded-lg border border-border bg-surface-2 text-foreground px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value=""></option>
              <option value="Empresa">Empresa</option>
              <option value="Contador">Contador</option>
            </select>
          </div>

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
              className="w-full rounded-lg border border-border bg-surface-2 text-foreground px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
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
              minLength={6}
              autoComplete="new-password"
              className="w-full rounded-lg border border-border bg-surface-2 text-foreground px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <p className="text-xs text-muted-foreground mt-1">Mínimo 6 caracteres.</p>
          </div>

          <div>
            <label htmlFor="password_confirm" className="block text-sm font-medium text-muted-foreground-2 mb-1">
              Confirmar senha
            </label>
            <input
              id="password_confirm"
              name="password_confirm"
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              className="w-full rounded-lg border border-border bg-surface-2 text-foreground px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {errorMsg && (
            <p className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">
              {errorMsg}
            </p>
          )}

          <SubmitButton />
        </form>

        <div className="mt-6 text-center text-sm">
          <span className="text-muted-foreground">Já tem conta? </span>
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
