// Bloco 7, Task 12 — conciliação de pagamentos: sugestões e (legado) consentimento.
//
// ═══ CORRIGIDO EM 19/08/2026 — a tela prometia o que foi CANCELADO ═══
//
// Ela dizia "Estamos finalizando a integração com o Open Finance. Assim que
// estiver disponível...". Não está sendo finalizada: o Open Finance foi
// DESCARTADO na sessão 25 — o provedor de mercado custa a partir de
// R$ 2.500/mês e o item nunca veio do cliente (entrou por decisão de escopo
// interna). A Frente 3 substituiu a leitura de extrato por SERPRO + Asaas.
//
// O texto era pior que um bug de layout: todo empresário tem "Conciliação" no
// menu, abria e via uma promessa de entrega que ninguém pretende cumprir — e,
// pior, não ficava sabendo que o pagamento do DAS JÁ é reconhecido sozinho por
// outro caminho, todo dia, pelo cron.
//
// As sugestões NÃO são persistidas: a página recalcula com `casar()`, a mesma
// função pura que o cron usa. Uma tabela de sugestões seria estado derivado
// para manter em dia — e um cache que envelhece mal, porque a guia pode ter
// sido paga por outro caminho entre o cron e a visita à tela.
import { redirect } from 'next/navigation';
import { Landmark } from 'lucide-react';
import { createServerClient } from '@/lib/supabase/server';
import { casar, type GuiaCandidata, type TransacaoCandidata } from '@/lib/conciliacao/matcher';
import { conciliacaoDisponivel } from '@/lib/conciliacao/provedor';
import { formatBRL } from '@/lib/format/dinheiro';
import ConciliacaoClient, { type SugestaoVM } from './ConciliacaoClient';

export default async function ConciliacaoPage() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles').select('current_company').eq('user_id', user.id).single();
  const companyId = (profile?.current_company ?? null) as string | null;

  if (!companyId) {
    return (
      <main className="p-6 max-w-3xl">
        <h1 className="mb-2 text-2xl font-semibold text-foreground">Conciliação bancária</h1>
        <p className="text-sm text-muted-foreground">Selecione uma empresa para configurar a conciliação.</p>
      </main>
    );
  }

  // Sem provedor de Open Finance de verdade, a tela NÃO oferece conexão: o
  // botão prometeria leitura do extrato bancário, e o que existe é um mock que
  // lê uma tabela nossa. Quem já estiver conectado continua vendo as sugestões
  // (o cron segue rodando) — o que se fecha é a porta de entrada.
  const disponivel = conciliacaoDisponivel();

  const { data: conexao } = await supabase
    .from('conciliacao_conexoes')
    .select('id,status,consentida_em')
    .eq('company_id', companyId)
    .in('status', ['pendente', 'ativa'])
    .maybeSingle();

  const conectada = !!conexao;
  let sugestoes: SugestaoVM[] = [];
  let totalConciliadas = 0;

  if (conectada) {
    const [{ data: txs }, { data: guias }, { count }] = await Promise.all([
      supabase
        .from('conciliacao_transacoes')
        .select('id,valor_centavos,data,tipo,descricao')
        .eq('company_id', companyId)
        .is('guia_id', null)
        .eq('tipo', 'credito')
        .order('data', { ascending: false })
        .limit(200),
      supabase
        .from('guias_fiscais')
        .select('id,valor_total,data_vencimento,competencia_referencia')
        .eq('company_id', companyId)
        .is('data_pagamento', null)
        .is('deleted_at', null),
      supabase
        .from('conciliacao_transacoes')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .not('guia_id', 'is', null),
    ]);

    totalConciliadas = count ?? 0;

    const transacoes: TransacaoCandidata[] = (txs ?? []).map((t) => ({
      id: t.id as string,
      valorCentavos: Number(t.valor_centavos),
      data: t.data as string,
      tipo: t.tipo as 'credito' | 'debito',
    }));
    const candidatas: GuiaCandidata[] = (guias ?? []).map((g) => ({
      id: g.id as string,
      valorTotal: g.valor_total as number | string | null,
      dataVencimento: g.data_vencimento as string | null,
    }));

    const porTx = new Map((txs ?? []).map((t) => [t.id as string, t]));
    const porGuia = new Map((guias ?? []).map((g) => [g.id as string, g]));

    sugestoes = casar(transacoes, candidatas)
      .filter((c) => c.decisao === 'sugestao')
      .map((c) => {
        const t = porTx.get(c.transacaoId);
        const g = porGuia.get(c.guiaId);
        return {
          transacaoId: c.transacaoId,
          guiaId: c.guiaId,
          motivo: c.motivo,
          transacao: {
            data: (t?.data as string) ?? '',
            valor: formatBRL(Number(t?.valor_centavos ?? 0)),
            descricao: (t?.descricao as string | null) ?? null,
          },
          guia: {
            competencia: (g?.competencia_referencia as string | null) ?? '—',
            vencimento: (g?.data_vencimento as string | null) ?? null,
            // `valor_total` é numeric em REAIS; formatBRL espera centavos.
            valor: formatBRL(Math.round(Number(g?.valor_total ?? 0) * 100)),
          },
        };
      });
  }

  return (
    <main className="p-6 max-w-3xl">
      <header className="mb-6">
        <div className="mb-1 flex items-center gap-2">
          <Landmark className="size-5 text-primary" />
          <h1 className="text-2xl font-semibold text-foreground">Conciliação de pagamentos</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Como o pagamento das suas guias e cobranças é reconhecido.
        </p>
      </header>

      {!disponivel && !conectada ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-surface p-5">
            <h2 className="mb-3 text-sm font-semibold text-foreground">O que já é automático</h2>
            <ul className="space-y-3 text-sm text-muted-foreground">
              <li>
                <strong className="text-foreground">DAS pago em qualquer banco.</strong>{' '}
                Todo dia consultamos os pagamentos na Receita Federal e damos baixa na guia
                sozinhos, sem você marcar nada. Para isso funcionar, a empresa precisa ter o
                certificado digital A1 enviado e a procuração eletrônica ativa.
              </li>
              <li>
                <strong className="text-foreground">Cobranças emitidas pela plataforma.</strong>{' '}
                Honorários e mensalidades cobrados por aqui são baixados assim que o provedor
                de pagamento confirma.
              </li>
            </ul>
          </div>

          <div className="rounded-xl border border-border bg-surface p-5">
            <h2 className="mb-3 text-sm font-semibold text-foreground">O que continua manual</h2>
            <p className="text-sm text-muted-foreground">
              Pagamentos que não passam por nenhum desses dois caminhos você marca em{' '}
              <strong>Impostos</strong>, na guia correspondente. A leitura direta do extrato
              bancário (Open Finance) <strong>não faz parte do produto</strong> — o
              reconhecimento vem da Receita e do provedor de pagamento, que são as fontes que
              confirmam a quitação de verdade.
            </p>
          </div>
        </div>
      ) : (
      <ConciliacaoClient
        conectada={conectada}
        consentidaEm={(conexao?.consentida_em as string | null) ?? null}
        sugestoes={sugestoes}
        totalConciliadas={totalConciliadas}
      />
      )}
    </main>
  );
}
