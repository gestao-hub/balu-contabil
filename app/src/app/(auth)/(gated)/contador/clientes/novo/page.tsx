// src/app/(auth)/contador/clientes/novo/page.tsx
// Cadastro de cliente pelo escritório: mesma guarda de acesso do painel (/contador).
import { redirect } from 'next/navigation';
import { getContabilidadeCtx } from '@/lib/contador/guards';
import { assertAssinaturaEscritorio } from '@/lib/billing/gate';
import BloqueioAssinatura from '../../../_components/BloqueioAssinatura';
import NovoClienteFlow from './NovoClienteFlow';

export default async function NovoClientePage() {
  const ctx = await getContabilidadeCtx();
  if ('error' in ctx) redirect('/login');
  if (!ctx.contabilidade) redirect('/contador/cadastro');
  if (ctx.contabilidade.status === 'pendente') redirect('/contador/aguardando');
  if (ctx.contabilidade.status === 'suspensa') redirect('/contador/aguardando');

  // Diz o bloqueio ANTES do formulário. A action continua checando — esta
  // camada é conveniência, não a defesa.
  const gate = await assertAssinaturaEscritorio(ctx.contabilidade.id);
  if (!gate.ok) {
    return (
      <BloqueioAssinatura
        titulo="Cadastrar cliente"
        href="/contador/assinatura"
        voltarHref="/contador"
        voltarRotulo="Voltar ao painel"
      />
    );
  }

  return <NovoClienteFlow />;
}
