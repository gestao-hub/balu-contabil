// @custom — implementado pela skill bubble-behavior
'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  requestResetAction,
  updatePasswordAction,
  type ResetState,
} from './actions';

const initialState: ResetState = undefined;

export default function ResetPwPage() {
  return (
    <Suspense fallback={<main className="w-full max-w-sm px-6" />}>
      <ResetPwInner />
    </Suspense>
  );
}

function ResetPwInner() {
  const params = useSearchParams();
  // O /auth/callback redireciona para cá com `step=update` após estabelecer a
  // sessão de recuperação; ou com `error=…` se o link falhou.
  const showUpdate = params.get('step') === 'update';
  const errorParam = params.get('error');

  return (
    <main className="w-full max-w-sm px-6">
      <div className="bg-surface rounded-2xl shadow-sm border border-border p-8">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-primary">Balu</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {showUpdate ? 'Defina uma nova senha' : 'Recuperar acesso'}
          </p>
        </div>

        {errorParam && (
          <p className="mb-4 text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">
            {errorParam}
          </p>
        )}

        {showUpdate ? <UpdatePasswordForm /> : <RequestResetForm />}

        <div className="mt-6 text-center text-sm">
          <Link href="/login" className="text-primary hover:underline">
            Voltar ao login
          </Link>
        </div>
      </div>
    </main>
  );
}

function RequestResetForm() {
  const [state, formAction] = useActionState(requestResetAction, initialState);

  return (
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
          className="w-full rounded-lg border border-border bg-surface-2 text-foreground px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      <Feedback state={state} />

      <SubmitButton labelIdle="Enviar link" labelPending="Enviando…" />
    </form>
  );
}

function UpdatePasswordForm() {
  const [state, formAction] = useActionState(updatePasswordAction, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label htmlFor="password" className="block text-sm font-medium text-muted-foreground-2 mb-1">
          Nova senha
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

      <Feedback state={state} />

      <SubmitButton labelIdle="Atualizar senha" labelPending="Atualizando…" />
    </form>
  );
}

function Feedback({ state }: { state: ResetState }) {
  if (!state) return null;
  if (state.error) {
    return (
      <p className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">
        {state.error}
      </p>
    );
  }
  if (state.success) {
    return (
      <p className="text-sm text-success bg-success/10 border border-success/30 rounded-md px-3 py-2">
        {state.success}
      </p>
    );
  }
  return null;
}

function SubmitButton({ labelIdle, labelPending }: { labelIdle: string; labelPending: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full bg-primary text-white rounded-lg py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-60 transition"
    >
      {pending ? labelPending : labelIdle}
    </button>
  );
}
