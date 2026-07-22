// src/app/(auth)/contador/cadastro/page.tsx
import { redirect } from 'next/navigation';
import { getContabilidadeCtx } from '@/lib/contador/guards';
import ContabilidadeForm from './ContabilidadeForm';

export default async function ContadorCadastroPage() {
  const ctx = await getContabilidadeCtx();
  if ('error' in ctx) redirect('/login');
  if (ctx.contabilidade) {
    redirect(ctx.contabilidade.status === 'aprovada' ? '/contador' : '/contador/aguardando');
  }

  return (
    <main className="p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-head font-semibold text-foreground">Cadastro do escritório</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Informe os dados da contabilidade para solicitar acesso ao painel do contador.
        </p>
      </header>

      <div className="max-w-lg">
        <ContabilidadeForm />
      </div>
    </main>
  );
}
