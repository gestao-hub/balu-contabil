// @custom — Tela mostrada após signup com "Confirm email" ON: pede pro user
// abrir o link do email. Server component que extrai `email` da query e
// renderiza o client island com botão de reenvio.
import Link from 'next/link';
import { Mail } from 'lucide-react';
import ResendButton from './ResendButton';

type SP = Promise<{ email?: string }>;

export default async function ConfirmeEmailPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const email = (sp.email ?? '').trim();

  return (
    <main className="w-full max-w-sm px-6">
      <div className="bg-white rounded-2xl shadow-sm border border-zinc-200 p-8">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center size-14 rounded-full bg-primary/10 mb-3">
            <Mail className="size-7 text-primary" />
          </div>
          <h1 className="text-xl font-semibold text-brand-navy">Verifique seu e-mail</h1>
          <p className="text-sm text-zinc-500 mt-2">
            Enviamos um link de confirmação{email ? <> para <strong className="text-zinc-700">{email}</strong></> : ''}.
            Clique no link para ativar sua conta.
          </p>
        </div>

        <div className="rounded-lg bg-zinc-50 border border-zinc-200 px-4 py-3 text-xs text-zinc-600 space-y-1">
          <p>• O link expira em 1 hora.</p>
          <p>• Confira a pasta de spam se não encontrar.</p>
          <p>• Você só precisa fazer isso uma vez.</p>
        </div>

        {email && (
          <div className="mt-6">
            <ResendButton email={email} />
          </div>
        )}

        <div className="mt-6 text-center text-sm">
          <Link href="/login" className="text-primary hover:underline">
            Voltar para o login
          </Link>
        </div>
      </div>
    </main>
  );
}
