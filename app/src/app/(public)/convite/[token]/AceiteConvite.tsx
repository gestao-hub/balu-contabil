// src/app/(public)/convite/[token]/AceiteConvite.tsx
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Logo from '@/components/Logo';
import { aceitarConviteAction } from '@/app/(auth)/contador/convites-actions';

type Props = {
  token: string;
  tipo: 'cliente' | 'membro';
  escritorioNome: string;
  empresaNome: string | null;
};

export default function AceiteConvite({ token, tipo, escritorioNome, empresaNome }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function aceitar() {
    setError(null);
    startTransition(async () => {
      const res = await aceitarConviteAction(token);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push(tipo === 'membro' ? '/contador' : '/');
    });
  }

  return (
    <div className="bg-surface rounded-2xl shadow-sm border border-border p-8">
      <div className="flex flex-col items-center mb-6">
        <Logo size={44} className="mb-3" />
      </div>

      <p className="text-sm text-foreground mb-4">
        <b>{escritorioNome}</b> convidou você para{' '}
        {tipo === 'membro' ? (
          'entrar na equipe'
        ) : (
          <>
            assumir {empresaNome ? (
              <>
                a empresa <b>{empresaNome}</b>
              </>
            ) : (
              'sua empresa'
            )}
          </>
        )}{' '}
        no Balu.
      </p>

      {tipo === 'cliente' && (
        <div className="mb-4 rounded-lg border border-border bg-surface-2 px-4 py-3">
          <p className="text-xs font-medium text-muted-foreground-2 mb-2">
            Ao aceitar, você consente que o escritório <b>{escritorioNome}</b> tenha acesso, para fins de prestação
            de serviços contábeis (LGPD art. 7º, V e art. 9º), a:
          </p>
          <ul className="list-disc list-inside text-xs text-muted-foreground space-y-1 mb-2">
            <li>Notas fiscais emitidas</li>
            <li>Impostos apurados</li>
            <li>Guias e comprovantes de pagamento</li>
            <li>Dados cadastrais da empresa</li>
          </ul>
          <p className="text-xs text-muted-foreground">
            O acesso do escritório é <b>somente visualização</b> — ele não pode emitir nem alterar nada. Você pode
            desvincular quando quiser em Configurações.
          </p>
        </div>
      )}

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2 mb-4">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={aceitar}
        disabled={pending}
        className="w-full bg-primary text-white rounded-lg py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-60 transition"
      >
        {pending ? 'Vinculando…' : 'Aceitar e vincular'}
      </button>
    </div>
  );
}
