// src/app/(auth)/contador/clientes/novo/page.tsx
// Cadastro de cliente pelo escritório: mesma guarda de acesso do painel (/contador).
import { redirect } from 'next/navigation';
import { getContabilidadeCtx } from '@/lib/contador/guards';
import NovoClienteFlow from './NovoClienteFlow';

export default async function NovoClientePage() {
  const ctx = await getContabilidadeCtx();
  if ('error' in ctx) redirect('/login');
  if (!ctx.contabilidade) redirect('/contador/cadastro');
  if (ctx.contabilidade.status === 'pendente') redirect('/contador/aguardando');
  if (ctx.contabilidade.status === 'suspensa') redirect('/contador/aguardando');

  return <NovoClienteFlow />;
}
