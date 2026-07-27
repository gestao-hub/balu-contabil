import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { getContabilidadeCtx } from '@/lib/contador/guards';
import { createAdminClient } from '@/lib/supabase/admin';
import { planoPorQtdClientes, type PlanoFaixa } from '@/lib/billing/faixa';
import AssinaturaView, { type AssinaturaVm, type CobrancaVm, type PlanoVm }
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
    .select('id, status, trial_termina_em, proxima_cobranca_em, plano_id, asaas_subscription_id, planos ( nome, valor_centavos )')
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
    contratada: Boolean(a.asaas_subscription_id),
  };

  const { data: cobrancas } = await supabase
    .from('cobrancas')
    .select('id, status, valor_centavos, vencimento, link_fatura, pix_copia_cola')
    .eq('assinatura_id', a.id).order('vencimento', { ascending: false }).limit(24);

  // O plano do escritório NÃO é escolha: sai da faixa pela quantidade de
  // clientes da carteira. Oferecer um select deixaria ele contratar a faixa
  // errada, e o cron de recálculo corrigiria depois — cobrando diferente do
  // que ele viu na tela.
  //
  // A contagem usa o client admin: a RLS de `companies` para o contador é
  // por carteira, mas `count` sob RLS varia com a policy e aqui precisamos
  // do número exato que o cron vai usar.
  const admin = createAdminClient();
  const { count } = await admin
    .from('companies').select('id', { count: 'exact', head: true })
    .eq('contabilidade_id', ctx.contabilidade.id).is('deleted_at', null);

  const { data: planosEsc } = await supabase
    .from('planos').select('id, nome, valor_centavos, clientes_min, clientes_max, ativo')
    .eq('publico', 'escritorio');

  const escolha = planoPorQtdClientes(count ?? 0, (planosEsc ?? []) as PlanoFaixa[]);
  const planoDaFaixa = escolha.ok
    ? (planosEsc ?? []).find((p) => p.id === escolha.planoId)
    : null;
  const planos: PlanoVm[] = planoDaFaixa
    ? [{ id: planoDaFaixa.id, nome: planoDaFaixa.nome, valor_centavos: planoDaFaixa.valor_centavos }]
    : [];

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-1">Assinatura do escritório</h1>
      <p className="text-sm text-neutral-500 mb-6">
        O plano é definido pela quantidade de clientes na sua carteira
        {typeof count === 'number' ? ` (hoje: ${count})` : ''} e recalculado a cada mês.
      </p>
      <AssinaturaView
        assinatura={assinatura}
        cobrancas={(cobrancas ?? []) as CobrancaVm[]}
        planos={planos}
      />
      {!escolha.ok && (
        <p className="mt-4 text-sm rounded border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
          Não há plano configurado para a sua quantidade de clientes. Fale com o suporte.
        </p>
      )}
    </div>
  );
}
