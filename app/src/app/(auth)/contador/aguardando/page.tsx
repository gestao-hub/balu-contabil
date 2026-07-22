// src/app/(auth)/contador/aguardando/page.tsx
import { redirect } from 'next/navigation';
import { getContabilidadeCtx } from '@/lib/contador/guards';

export default async function ContadorAguardandoPage() {
  const ctx = await getContabilidadeCtx();
  if ('error' in ctx) redirect('/login');
  if (!ctx.contabilidade) redirect('/contador/cadastro');
  if (ctx.contabilidade.status === 'aprovada') redirect('/contador');

  return (
    <main className="p-6">
      <div className="mx-auto max-w-lg rounded-lg border border-border bg-card p-6 text-center">
        <h1 className="text-2xl font-head font-semibold text-foreground">Cadastro em análise</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Validamos o registro CRC de cada escritório antes de liberar o acesso — é uma
          exigência da profissão contábil (DL 9.295/46). Você recebe um e-mail assim que
          aprovarmos.
        </p>
      </div>
    </main>
  );
}
