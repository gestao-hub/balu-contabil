import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { getContabilidadeCtx } from '@/lib/contador/guards';
import { createAdminClient } from '@/lib/supabase/admin';
import { planoPorQtdClientes, type PlanoFaixa } from '@/lib/billing/faixa';
import AssinaturaView, { type AssinaturaVm, type CobrancaVm }
  from '../../conta/assinatura/AssinaturaView';
import PlanosCards, { type PlanoCard } from './PlanosCards';

export const dynamic = 'force-dynamic';

type PlanoJoin = { nome: string; valor_centavos: number } | null;

export default async function Page() {
  const ctx = await getContabilidadeCtx();
  if ('error' in ctx) redirect('/login');
  if (!ctx.contabilidade) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold mb-2">Assinatura do escritório</h1>
        <p className="text-sm text-muted-foreground-2">Você não faz parte de um escritório.</p>
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
        <p className="text-sm text-muted-foreground-2">
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

  // A contagem usa o client admin: a RLS de `companies` para o contador é
  // por carteira, mas `count` sob RLS varia com a policy e aqui precisamos
  // do número exato que o cron vai usar para a faixa.
  const admin = createAdminClient();
  const { count } = await admin
    .from('companies').select('id', { count: 'exact', head: true })
    .eq('contabilidade_id', ctx.contabilidade.id).is('deleted_at', null);
  const clientes = count ?? 0;

  const { data: planosEsc } = await supabase
    .from('planos').select('id, nome, valor_centavos, clientes_min, clientes_max, ativo')
    .eq('publico', 'escritorio').eq('ativo', true).order('valor_centavos');

  // A faixa da carteira vira RECOMENDAÇÃO, não imposição: o escritório
  // escolhe nos cards. O cron nunca o rebaixa abaixo desta faixa — só
  // corrige para cima se a carteira crescer (ver lib/billing/cron.ts).
  const escolha = planoPorQtdClientes(clientes, (planosEsc ?? []) as PlanoFaixa[]);
  const recomendado = escolha.ok ? escolha.planoId : null;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold mb-1">Assinatura do escritório</h1>
        <p className="text-sm text-muted-foreground">
          Sua carteira tem <strong>{clientes}</strong> cliente{clientes === 1 ? '' : 's'} hoje.
        </p>
      </div>

      <AssinaturaView
        assinatura={assinatura}
        cobrancas={(cobrancas ?? []) as CobrancaVm[]}
        semAcoes
      />

      <div>
        <h2 className="font-medium mb-3">Planos</h2>
        <PlanosCards
          assinaturaId={assinatura.id}
          planos={(planosEsc ?? []) as PlanoCard[]}
          planoAtivo={a.plano_id as string | null}
          planoRecomendado={recomendado}
          contratada={assinatura.contratada}
          clientes={clientes}
          status={assinatura.status}
        />
      </div>

      {!escolha.ok && (
        <p className="rounded-md border border-alert/40 bg-alert/10 px-3 py-2 text-sm text-alert">
          Não há plano configurado para a sua quantidade de clientes — nenhum aparece como
          recomendado. Fale com o suporte.
        </p>
      )}
    </div>
  );
}
