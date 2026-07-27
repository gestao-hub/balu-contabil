// Bloco 4A — Configurações do sistema (AdminBalu).
//
// Hoje tem um assunto só: liberar acesso de quem pagou por boleto e mandou o
// comprovante antes da compensação. É a página onde os próximos ajustes de
// plataforma vão morar.
import Link from 'next/link';
import { CreditCard } from 'lucide-react';
import { requireAdminBaluPage } from '@/lib/admin/guard';
import { createAdminClient } from '@/lib/supabase/admin';
import { statusEfetivo, type StatusAssinatura } from '@/lib/billing/status';
import { ymdBrt } from '@/lib/fiscal/tempo-brt';
import LiberacoesAdmin, { type TitularVm } from './LiberacoesAdmin';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requireAdminBaluPage();
  const sb = createAdminClient();
  const hoje = ymdBrt();

  const { data: assinaturas } = await sb
    .from('assinaturas')
    .select(`
      id, status, trial_termina_em, proxima_cobranca_em, liberado_ate,
      liberacao_motivo, liberacao_em, asaas_subscription_id,
      company_id, contabilidade_id
    `)
    .order('created_at');

  // Nomes em lote: uma consulta por tabela, não uma por linha. Com a
  // plataforma crescendo, N+1 aqui viraria a tela mais lenta do admin.
  const idsEmpresa = (assinaturas ?? []).map((a) => a.company_id).filter(Boolean) as string[];
  const idsEscritorio = (assinaturas ?? []).map((a) => a.contabilidade_id).filter(Boolean) as string[];

  const [{ data: empresas }, { data: escritorios }] = await Promise.all([
    idsEmpresa.length
      ? sb.from('companies').select('id, nome, cnpj').in('id', idsEmpresa)
      : Promise.resolve({ data: [] as { id: string; nome: string; cnpj: string | null }[] }),
    idsEscritorio.length
      ? sb.from('contabilidades').select('id, nome, cnpj').in('id', idsEscritorio)
      : Promise.resolve({ data: [] as { id: string; nome: string; cnpj: string | null }[] }),
  ]);

  const nomeEmpresa = new Map((empresas ?? []).map((e) => [e.id, e]));
  const nomeEscritorio = new Map((escritorios ?? []).map((e) => [e.id, e]));

  const titulares: TitularVm[] = (assinaturas ?? []).map((a) => {
    const dono = a.contabilidade_id
      ? nomeEscritorio.get(a.contabilidade_id)
      : a.company_id ? nomeEmpresa.get(a.company_id) : undefined;

    // O MESMO `statusEfetivo` do gate. Se a tela do admin calculasse por
    // conta própria, ela mostraria "bloqueado" para quem o app libera (ou o
    // contrário) — e o admin liberaria quem não precisa.
    const efetivo = statusEfetivo(
      {
        status: a.status as StatusAssinatura,
        trial_termina_em: a.trial_termina_em,
        liberado_ate: a.liberado_ate,
      },
      hoje,
    );

    return {
      id: a.id,
      nome: dono?.nome ?? '(sem nome)',
      cnpj: dono?.cnpj ?? null,
      tipo: a.contabilidade_id ? 'escritorio' : 'empresa',
      status: a.status,
      bloqueado: efetivo === 'bloqueado',
      contratada: Boolean(a.asaas_subscription_id),
      proximaCobrancaEm: a.proxima_cobranca_em,
      liberadoAte: a.liberado_ate,
      liberacaoMotivo: a.liberacao_motivo,
      liberacaoVigente: Boolean(a.liberado_ate && hoje <= a.liberado_ate),
    };
  });

  return (
    <div className="p-6 space-y-8">
      <div>
        <h1 className="text-xl font-semibold mb-1">Configurações do sistema</h1>
        <p className="text-sm text-muted-foreground">
          Ajustes da plataforma. Toda ação aqui vai para o registro de auditoria.
        </p>
      </div>

      <section className="rounded-md border border-border bg-surface p-4">
        <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
          <CreditCard className="size-4 shrink-0 text-primary" />
          Planos e preços
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Valores, faixas por número de clientes e duração do período de teste.
        </p>
        <Link
          href="/admin/assinaturas"
          className="mt-3 inline-block rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground-2 transition-colors hover:border-primary hover:bg-primary/10 hover:text-primary"
        >
          Abrir assinaturas
        </Link>
      </section>

      <LiberacoesAdmin titulares={titulares} />
    </div>
  );
}
