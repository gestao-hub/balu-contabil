// @custom — implementado pela skill bubble-behavior
'use client';

import Link from 'next/link';
import { Suspense, useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { useSearchParams } from 'next/navigation';
import { signupAction, type SignupState } from './actions';
import Logo from '@/components/Logo';

const initialState: SignupState = undefined;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function CadastroPage() {
  const [state, formAction] = useActionState(signupAction, initialState);
  const [clientError, setClientError] = useState<string | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);

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
    if (!termsAccepted) {
      e.preventDefault();
      setClientError('Você precisa aceitar os termos de uso.');
      return;
    }
    setClientError(null);
  }

  const errorMsg = clientError ?? state?.error;

  return (
    <main className="w-full max-w-sm px-6">
      <div className="bg-surface rounded-2xl shadow-sm border border-border p-8">
        <div className="flex flex-col items-center mb-8">
          <Logo size={44} className="mb-3" />
          <p className="text-sm text-muted-foreground mt-1">Crie sua conta</p>
        </div>

        <Suspense fallback={null}>
          <RefEscritorioBanner />
        </Suspense>

        <form action={formAction} onSubmit={handleSubmit} className="space-y-4">
          <Suspense fallback={null}>
            <NextField />
          </Suspense>

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

          <div className="flex items-start gap-2">
            <input
              id="terms"
              name="terms"
              type="checkbox"
              checked={termsAccepted}
              onChange={(e) => setTermsAccepted(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-2 focus:ring-primary"
            />
            <label htmlFor="terms" className="text-sm text-muted-foreground">
              Li e concordo com os{' '}
              <a
                href="/termos"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                termos de uso
              </a>
            </label>
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

// Passthrough mínimo pro fluxo de convite deslogado: `/cadastro?next=/convite/<token>`
// (link "Criar conta" da página de convite) — o action lê este campo oculto e, no
// caminho de auto-confirm (Confirm email OFF), redireciona pra lá em vez de `/`.
// No caminho de confirmação por e-mail o `next` não é usado (ver comentário em
// `signupAction`) — o input só fica sem efeito nesse caso, não quebra o fluxo.
function NextField() {
  const sp = useSearchParams();
  const next = sp.get('next');
  if (!next) return null;
  return <input type="hidden" name="next" value={next} />;
}

// Vem de `/r/[token]` (link reutilizável do escritório) ou de um convite dirigido
// clicado deslogado. `escritorio` = nome pra exibir; `ref_invalido` = token
// inválido/expirado/revogado — o cadastro segue normalmente, só sem o vínculo.
// useSearchParams precisa de Suspense boundary no Next 15.
function RefEscritorioBanner() {
  const sp = useSearchParams();
  const escritorio = sp.get('escritorio');
  const refInvalido = sp.get('ref_invalido') === '1';

  if (escritorio) {
    return (
      <p className="mb-4 text-sm text-muted-foreground bg-surface-2 border border-border rounded-md px-3 py-2">
        Você está entrando pelo escritório <b className="text-foreground">{escritorio}</b>. Depois de criar sua
        empresa, o escritório poderá <b>visualizar</b> suas notas, impostos e guias — ele não pode emitir nem
        alterar nada. Você pode desvincular quando quiser em Configurações.
      </p>
    );
  }
  if (refInvalido) {
    return (
      <p className="mb-4 text-xs text-muted-foreground bg-surface-2 border border-border rounded-md px-3 py-2">
        O link do escritório usado para chegar aqui não é mais válido, mas você pode continuar seu cadastro
        normalmente.
      </p>
    );
  }
  return null;
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
