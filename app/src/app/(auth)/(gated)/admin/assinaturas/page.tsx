import { requireAdminBaluPage } from '@/lib/admin/guard';
import { createAdminClient } from '@/lib/supabase/admin';
import PlanosAdmin from './PlanosAdmin';
import type { PlanoInput } from './actions';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requireAdminBaluPage();
  const admin = createAdminClient();

  const { data: planos } = await admin
    .from('planos').select('*').order('publico').order('valor_centavos');

  const { data: assinaturas } = await admin
    .from('assinaturas').select('plano_id, status');

  // "Em uso" conta so assinatura viva — cancelada e cortesia nao impedem
  // desativar o plano, e mostrar o total confundiria a leitura.
  const usoPorPlano: Record<string, number> = {};
  for (const a of assinaturas ?? []) {
    if (a.plano_id && ['trial', 'ativa', 'inadimplente'].includes(a.status)) {
      usoPorPlano[a.plano_id] = (usoPorPlano[a.plano_id] ?? 0) + 1;
    }
  }

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-1">Assinaturas</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Preços, faixas e período de teste. As alterações valem para as próximas cobranças —
        assinaturas já ativas seguem no valor contratado até o próximo ciclo.
      </p>
      <PlanosAdmin planos={(planos ?? []) as PlanoInput[]} usoPorPlano={usoPorPlano} />
    </div>
  );
}
