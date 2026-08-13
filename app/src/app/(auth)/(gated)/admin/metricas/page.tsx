// Métricas de operação da plataforma (AdminBalu).
//
// Responde as quatro perguntas que o dono da plataforma faz: quanto entra,
// quanto está sem pagar, quem está usando e quantos clientes cada escritório
// tem. Os números saem de `lib/admin/metricas.ts` (funções puras, testadas) —
// aqui só há leitura e apresentação.
import Link from 'next/link';
import { TrendingUp, AlertTriangle, Wallet, Building2 } from 'lucide-react';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdminBaluPage } from '@/lib/admin/guard';
import { ymdBrt } from '@/lib/fiscal/tempo-brt';
import { formatBRL } from '@/lib/format/dinheiro';
import { resumoPlataforma, usoPorEscritorio } from '@/lib/admin/metricas';

export const dynamic = 'force-dynamic';

export default async function AdminMetricasPage() {
  await requireAdminBaluPage();
  const admin = createAdminClient();
  const hoje = ymdBrt();

  // ⚠️ Toda leitura aqui é uma listagem crua, e o PostgREST corta em
  // `db-max-rows` (1000 por padrão) sem avisar — passado esse ponto os números
  // param de crescer e o painel mente para baixo, calado. Enquanto o volume
  // couber, tudo bem; quando não couber, isto vira agregação em SQL, não um
  // `.limit()` maior. Por isso o erro de cada consulta é logado: uma tabela
  // que falhe por permissão renderizaria zero como se fosse a verdade.
  const [
    { data: cobrancas, error: eCobr }, { data: assinaturas, error: eAssin }, { data: planos, error: ePlanos },
    { data: contabs, error: eContabs }, { data: empresas, error: eEmp },
    { data: membros, error: eMembros }, { data: cobrEscritorio, error: eCobrEsc },
  ] = await Promise.all([
    admin.from('cobrancas').select('valor_centavos,status,vencimento,pago_em'),
    admin.from('assinaturas').select('contabilidade_id,company_id,plano_id,status'),
    admin.from('planos').select('id,valor_centavos,ciclo'),
    admin.from('contabilidades').select('id,nome,status'),
    admin.from('companies').select('id,contabilidade_id,deleted_at'),
    admin.from('contabilidade_membros').select('contabilidade_id'),
    admin.from('cobrancas_escritorio').select('contabilidade_id,valor_centavos,status,pago_em'),
  ]);

  for (const [rotulo, erro] of [
    ['cobrancas', eCobr], ['assinaturas', eAssin], ['planos', ePlanos],
    ['contabilidades', eContabs], ['companies', eEmp],
    ['contabilidade_membros', eMembros], ['cobrancas_escritorio', eCobrEsc],
  ] as const) {
    if (erro) console.error(`[admin/metricas] leitura de ${rotulo} falhou:`, erro.message);
  }

  const resumo = resumoPlataforma(cobrancas ?? [], assinaturas ?? [], planos ?? [], hoje);
  const uso = usoPorEscritorio(
    contabs ?? [], empresas ?? [], membros ?? [], cobrEscritorio ?? [], assinaturas ?? [],
  );

  const totalClientes = uso.reduce((s, e) => s + e.clientes, 0);
  const semCliente = uso.filter((e) => e.clientes === 0).length;
  const gmvRecebido = uso.reduce((s, e) => s + e.recebidoCentavos, 0);
  const nadaCobrado = (cobrancas ?? []).length === 0;

  const cards = [
    {
      Icon: TrendingUp, label: 'Receita recorrente (MRR)',
      valor: formatBRL(resumo.mrrCentavos),
      sub: 'Soma dos planos das assinaturas ativas — trial não entra',
    },
    {
      Icon: Wallet, label: 'Recebido neste mês',
      valor: formatBRL(resumo.recebidoNoMesCentavos),
      sub: `${formatBRL(resumo.aVencerNoMesCentavos)} ainda a vencer no mês`,
    },
    {
      Icon: AlertTriangle, label: 'Inadimplência',
      valor: formatBRL(resumo.inadimplenteCentavos),
      sub: resumo.inadimplenteQtd > 0
        ? `${resumo.inadimplenteQtd} cobrança(s) vencida(s) · ${(resumo.taxaInadimplencia * 100).toFixed(1)}% do que venceu`
        : 'Nenhuma cobrança vencida sem pagamento',
      alerta: resumo.inadimplenteCentavos > 0,
    },
    {
      Icon: Building2, label: 'Volume dos escritórios',
      valor: formatBRL(gmvRecebido),
      sub: 'Já recebido pelos escritórios via subconta (não é receita da Balu)',
    },
  ];

  return (
    <main className="p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-head font-semibold text-foreground">Métricas de operação</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Receita da plataforma, inadimplência e uso por escritório. Valores em tempo real,
          nada em cache.
        </p>
      </header>

      {nadaCobrado && (
        <div className="mb-6 rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted-foreground">
          Nenhuma cobrança de assinatura foi emitida ainda — os números de receita e
          inadimplência abaixo são <strong className="text-foreground">zero de verdade</strong>,
          não falta de dado. O billing está em sandbox até as credenciais de produção do Asaas
          entrarem.
        </div>
      )}

      <section className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(({ Icon, label, valor, sub, alerta }) => (
          <div
            key={label}
            className={`rounded-lg border bg-surface p-4 ${alerta ? 'border-destructive/50' : 'border-border'}`}
          >
            <div className="flex items-center gap-2 text-muted-foreground">
              <Icon className={`size-4 ${alerta ? 'text-destructive' : 'text-primary'}`} />
              <span className="text-sm">{label}</span>
            </div>
            <p className="mt-2 text-2xl font-semibold text-foreground">{valor}</p>
            <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
          </div>
        ))}
      </section>

      <section className="mb-8">
        <h2 className="mb-1 text-lg font-semibold text-foreground">Assinaturas</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          {Object.keys(resumo.assinaturasPorStatus).length === 0
            ? 'Nenhuma assinatura criada ainda.'
            : Object.entries(resumo.assinaturasPorStatus)
                .map(([s, n]) => `${n} ${s}`)
                .join(' · ')}
        </p>
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-foreground">Uso por escritório</h2>
          <p className="text-sm text-muted-foreground">
            {uso.length} escritório(s) · {totalClientes} cliente(s) no total
            {semCliente > 0 && ` · ${semCliente} sem nenhum cliente`}
          </p>
        </div>

        {uso.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Nenhum escritório cadastrado.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Escritório</th>
                  <th className="px-4 py-3">Situação</th>
                  <th className="px-4 py-3 text-right">Clientes</th>
                  <th className="px-4 py-3 text-right">Equipe</th>
                  <th className="px-4 py-3">Assinatura</th>
                  <th className="px-4 py-3 text-right">Recebido</th>
                  <th className="px-4 py-3 text-right">Em aberto</th>
                </tr>
              </thead>
              <tbody>
                {uso.map((e) => (
                  <tr key={e.id} className="border-t border-border bg-surface">
                    <td className="px-4 py-3 font-medium text-foreground">{e.nome}</td>
                    <td className="px-4 py-3 text-muted-foreground">{e.status}</td>
                    <td className={`px-4 py-3 text-right ${e.clientes === 0 ? 'text-muted-foreground' : 'text-foreground'}`}>
                      {e.clientes}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground">{e.membros}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {e.assinaturaStatus ? `${e.plano ?? '—'} · ${e.assinaturaStatus}` : 'sem assinatura'}
                    </td>
                    <td className="px-4 py-3 text-right text-foreground">{formatBRL(e.recebidoCentavos)}</td>
                    <td className={`px-4 py-3 text-right ${e.emAbertoCentavos > 0 ? 'text-alert' : 'text-muted-foreground'}`}>
                      {formatBRL(e.emAbertoCentavos)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-3 text-xs text-muted-foreground">
          &quot;Recebido&quot; e &quot;Em aberto&quot; são cobranças que o escritório emitiu para os
          clientes dele pela subconta (Bloco 4B) — dinheiro dele, não da Balu.{' '}
          <Link href="/admin/contabilidades" className="inline-flex min-h-6 items-center text-primary hover:underline">
            Ver escritórios
          </Link>
        </p>
      </section>
    </main>
  );
}
