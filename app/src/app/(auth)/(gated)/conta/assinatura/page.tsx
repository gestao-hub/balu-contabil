import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import AssinaturaView, { type AssinaturaVm, type CobrancaVm } from './AssinaturaView';

export const dynamic = 'force-dynamic';

type PlanoJoin = { nome: string; valor_centavos: number } | null;

export default async function Page() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles').select('current_company').eq('user_id', user.id).maybeSingle();
  const companyId = (profile?.current_company ?? null) as string | null;
  if (!companyId) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold mb-2">Assinatura</h1>
        <p className="text-sm text-neutral-600">Nenhuma empresa selecionada.</p>
      </div>
    );
  }

  const { data: company } = await supabase
    .from('companies').select('contabilidade_id').eq('id', companyId).maybeSingle();

  // Empresa de carteira NAO paga — quem paga e o escritorio (decisao 3.2).
  // Mostrar cobranca a quem nao deve nada e bug de produto.
  if (company?.contabilidade_id) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold mb-2">Assinatura</h1>
        <p className="text-sm text-neutral-600 max-w-prose">
          Sua empresa é atendida por um escritório de contabilidade, e o acesso à Balu está
          incluído no serviço dele. Não há cobrança para você aqui.
        </p>
      </div>
    );
  }

  const { data: a } = await supabase
    .from('assinaturas')
    .select('id, status, trial_termina_em, proxima_cobranca_em, plano_id, planos ( nome, valor_centavos )')
    .eq('company_id', companyId).maybeSingle();

  if (!a) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold mb-2">Assinatura</h1>
        <p className="text-sm text-neutral-600">
          Assinatura não encontrada para esta empresa. Fale com o suporte.
        </p>
      </div>
    );
  }

  // O supabase-js tipa a relacao embutida como ARRAY mesmo quando ela e
  // to-one (FK simples), e em runtime devolve objeto. Normalizar as duas
  // formas evita depender de qual das duas aparece.
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
      <h1 className="text-xl font-semibold mb-6">Assinatura</h1>
      <AssinaturaView assinatura={assinatura} cobrancas={(cobrancas ?? []) as CobrancaVm[]} />
    </div>
  );
}
