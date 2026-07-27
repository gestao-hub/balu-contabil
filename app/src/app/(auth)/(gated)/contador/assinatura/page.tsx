import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { getContabilidadeCtx } from '@/lib/contador/guards';
import AssinaturaView, { type AssinaturaVm, type CobrancaVm }
  from '../../conta/assinatura/AssinaturaView';

export const dynamic = 'force-dynamic';

type PlanoJoin = { nome: string; valor_centavos: number } | null;

export default async function Page() {
  const ctx = await getContabilidadeCtx();
  if ('error' in ctx) redirect('/login');
  if (!ctx.contabilidade) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold mb-2">Assinatura do escritório</h1>
        <p className="text-sm text-neutral-600">Você não faz parte de um escritório.</p>
      </div>
    );
  }

  const supabase = await createServerClient();
  const { data: a } = await supabase
    .from('assinaturas')
    .select('id, status, trial_termina_em, proxima_cobranca_em, plano_id, planos ( nome, valor_centavos )')
    .eq('contabilidade_id', ctx.contabilidade.id).maybeSingle();

  if (!a) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold mb-2">Assinatura do escritório</h1>
        <p className="text-sm text-neutral-600">
          Assinatura não encontrada para este escritório. Fale com o suporte.
        </p>
      </div>
    );
  }

  // Ver nota em conta/assinatura/page.tsx: o supabase-js tipa a relacao
  // embutida como array mesmo sendo to-one.
  const planoRaw = a.planos as unknown;
  const plano = (Array.isArray(planoRaw) ? planoRaw[0] ?? null : planoRaw ?? null) as PlanoJoin;
  const assinatura: AssinaturaVm = {
    id: a.id, status: a.status,
    trial_termina_em: a.trial_termina_em, proxima_cobranca_em: a.proxima_cobranca_em,
    planoNome: plano?.nome ?? null, valor_centavos: plano?.valor_centavos ?? null,
  };

  const { data: cobrancas } = await supabase
    .from('cobrancas')
    .select('id, status, valor_centavos, vencimento, link_fatura, pix_copia_cola')
    .eq('assinatura_id', a.id).order('vencimento', { ascending: false }).limit(24);

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-1">Assinatura do escritório</h1>
      <p className="text-sm text-neutral-500 mb-6">
        O plano é definido pela quantidade de clientes na sua carteira e recalculado a cada mês.
      </p>
      <AssinaturaView assinatura={assinatura} cobrancas={(cobrancas ?? []) as CobrancaVm[]} />
    </div>
  );
}
