import { requireAdminBaluPage } from '@/lib/admin/guard';
import { createAdminClient } from '@/lib/supabase/admin';
import PlanosAdmin from './PlanosAdmin';
import type { PlanoInput } from './actions';

// O reajuste de plano propaga o preco para cada assinatura viva no Asaas, uma
// chamada por assinante. Sem este teto de tempo a Server Action morre no meio
// do laco -- ver o comentario do TETO em `actions.ts`.
export const maxDuration = 60;

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
        {/* A frase antiga dizia que "assinaturas já ativas seguem no valor
            contratado até o próximo ciclo". Isso era verdade enquanto o preço
            NÃO propagava — e virou mentira em 02/09/2026, quando passou a
            propagar. Copy que descreve o comportamento antigo é pior que copy
            nenhuma: ela dá ao admin confiança para fazer justamente o que ele
            não quer. (Achado do /code-review.) */}
        Preços, faixas e período de teste. <strong>Mudar o preço reajusta na hora, no Asaas,
        todas as assinaturas ativas do plano</strong> — inclusive as já contratadas.
      </p>
      <PlanosAdmin planos={(planos ?? []) as PlanoInput[]} usoPorPlano={usoPorPlano} />
    </div>
  );
}
