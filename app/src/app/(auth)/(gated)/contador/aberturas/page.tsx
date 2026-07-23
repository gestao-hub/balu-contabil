// @custom — Fila de aberturas de empresa da carteira do escritório (operador).
// Reads via admin client escopado por contabilidade_id (padrão do painel_contador);
// não depende da RLS de leitura. Guard igual às demais telas do contador.
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Building2 } from 'lucide-react';
import { createAdminClient } from '@/lib/supabase/admin';
import { getContabilidadeCtx } from '@/lib/contador/guards';
import { etapaLabel } from '@/lib/abertura/etapas';
import AbrirEmpresaButton from './AbrirEmpresaButton';

export const dynamic = 'force-dynamic';

function fmtData(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('pt-BR') : '—';
}

type AberturaRow = {
  id: string; company_id: string | null;
  titular_nome_completo: string | null; empresa_razao_social_1: string | null;
  empresa_nome_fantasia: string | null; empresa_tipo: string | null;
  processo_etapa: string | null; criado_em: string | null;
};

export default async function ContadorAberturasPage() {
  const g = await getContabilidadeCtx();
  if ('error' in g) redirect('/login');
  if (!g.contabilidade) redirect('/contador/cadastro');
  if (g.contabilidade.status !== 'aprovada') redirect('/contador/aguardando');

  const admin = createAdminClient();
  const { data: comps } = await admin.from('companies').select('id').eq('contabilidade_id', g.contabilidade.id);
  const ids = (comps ?? []).map((c) => (c as { id: string }).id);

  const aberturas: AberturaRow[] = ids.length
    ? (((await admin.from('abertura_empresas')
        .select('id, company_id, titular_nome_completo, empresa_razao_social_1, empresa_nome_fantasia, empresa_tipo, processo_etapa, criado_em')
        .in('company_id', ids)
        .order('criado_em', { ascending: false })).data) ?? []) as AberturaRow[]
    : [];

  const abIds = aberturas.map((a) => a.id);
  const { data: pend } = abIds.length
    ? await admin.from('abertura_alteracoes').select('abertura_id').eq('status', 'pendente').in('abertura_id', abIds)
    : { data: [] as { abertura_id: string }[] };
  const pendentesPorAbertura = new Map<string, number>();
  for (const p of (pend ?? []) as { abertura_id: string }[]) {
    pendentesPorAbertura.set(p.abertura_id, (pendentesPorAbertura.get(p.abertura_id) ?? 0) + 1);
  }

  return (
    <main className="p-6">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-head font-semibold text-foreground">Aberturas de empresa</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Solicitações da sua carteira ({aberturas.length}). O app coleta os dados; sua equipe conduz a abertura nos órgãos e atualiza o status aqui.
          </p>
        </div>
        <AbrirEmpresaButton />
      </header>

      {/* Card com as solicitações de abertura. */}
      <section className="overflow-hidden rounded-xl border border-border bg-surface">
        {aberturas.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 px-6 py-20 text-center">
            <Building2 className="size-24 text-muted-foreground/25" strokeWidth={1} aria-hidden />
            <p className="text-sm text-muted-foreground">Ainda não há solicitações de abertura</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Empresa pretendida</th>
                <th className="px-3 py-2 font-medium">Titular</th>
                <th className="px-3 py-2 font-medium">Tipo</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Solicitada</th>
                <th className="px-3 py-2 font-medium">Alterações</th>
              </tr>
            </thead>
            <tbody>
              {aberturas.map((a) => {
                const pendentes = pendentesPorAbertura.get(a.id) ?? 0;
                return (
                  <tr key={a.id} className="border-b border-border last:border-0 hover:bg-surface-2">
                    <td className="px-3 py-2">
                      <Link href={`/contador/aberturas/${a.id}`} className="font-medium text-primary hover:underline">
                        {a.empresa_nome_fantasia || a.empresa_razao_social_1 || '—'}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground-2">{a.titular_nome_completo ?? '—'}</td>
                    <td className="px-3 py-2 text-muted-foreground-2">{a.empresa_tipo ?? '—'}</td>
                    <td className="px-3 py-2">
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">{etapaLabel(a.processo_etapa)}</span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground-2">{fmtData(a.criado_em)}</td>
                    <td className="px-3 py-2">
                      {pendentes > 0
                        ? <span className="rounded-full bg-warning/10 px-2 py-0.5 text-xs text-warning">{pendentes} pendente(s)</span>
                        : <span className="text-xs text-muted-foreground">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </section>
    </main>
  );
}
