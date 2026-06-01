// src/app/(onboarding)/onboarding/abertura/page.tsx
import { redirect } from 'next/navigation';
import AberturaWizard from '@/components/abertura/AberturaWizard';
import { submitAberturaAction, solicitarAlteracaoAction, loadAberturaAtual } from './actions';

export default async function AberturaPage({ searchParams }: { searchParams: Promise<{ modo?: string }> }) {
  const { modo } = await searchParams;
  if (modo === 'alteracao') {
    const atual = await loadAberturaAtual();
    if (!atual) redirect('/configuracoes');
    return <AberturaWizard mode="alterar" initial={atual.data} existingDocs={atual.docs} action={solicitarAlteracaoAction} />;
  }
  return <AberturaWizard mode="criar" action={submitAberturaAction} />;
}
