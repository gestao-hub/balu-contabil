// Bloco 4A — rotina diaria de billing.
//
// NADA AQUI E REQUISITO DE CORRECAO: o status efetivo e derivado na leitura
// (lib/billing/status.ts), entao o trial vence sozinho e o gate decide certo
// mesmo que este cron nunca rode. Isto e conveniencia e rede de seguranca —
// fecha em ate 24h a janela de um webhook perdido.
//
// MORA EM lib/ E NAO NA ROUTE de proposito: um `route.ts` do App Router so
// pode exportar os handlers HTTP (GET/POST/...). Exportar `rodarBilling` de
// la quebra o `next build` com "Property 'rodarBilling' is incompatible with
// index signature" — e `tsc --noEmit` NAO pega, porque a validacao vive nos
// tipos gerados em .next/types. Mesma licao que o Bloco 3 registrou para
// arquivos 'use server'.
//
// Estar aqui tambem deixa a rotina chamavel de dentro de
// /api/cron/obrigacoes, caso o projeto esteja no plano Hobby da Vercel
// (limite de 2 crons, e o vercel.json ja tem 2).
import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { asaas } from '@/lib/clients';
import { planoPorQtdClientes, type PlanoFaixa } from '@/lib/billing/faixa';
import { sincronizarCobrancas, type CobrancaRemota } from '@/lib/billing/cobranca';
import { ymdBrt } from '@/lib/fiscal/tempo-brt';

export type ResumoBilling = {
  reconciliadas: number;
  faixasAtualizadas: number;
  avisos: number;
  erros: number;
  hoje: string;
};

/** Dono a notificar: o titular da empresa, ou o membro mais antigo do
 *  escritorio. Sem dono nao ha a quem avisar — o chamador pula. */
async function donoDaAssinatura(
  sb: ReturnType<typeof createAdminClient>,
  a: { company_id: string | null; contabilidade_id: string | null },
): Promise<string | null> {
  if (a.company_id) {
    const { data } = await sb.from('companies').select('user_id').eq('id', a.company_id).maybeSingle();
    return (data?.user_id as string | null) ?? null;
  }
  if (a.contabilidade_id) {
    const { data } = await sb.from('contabilidade_membros')
      .select('user_id').eq('contabilidade_id', a.contabilidade_id)
      .order('created_at').limit(1).maybeSingle();
    return (data?.user_id as string | null) ?? null;
  }
  return null;
}

export async function rodarBilling(): Promise<ResumoBilling> {
  const sb = createAdminClient();
  const hoje = ymdBrt();
  const resumo: ResumoBilling = {
    reconciliadas: 0, faixasAtualizadas: 0, avisos: 0, erros: 0, hoje,
  };

  // ─────────────────────────────────────────────── 1. reconciliacao
  //
  // Reconcilia pelas COBRANCAS, nao pelo status da assinatura. O status de
  // subscription do Asaas continua ACTIVE enquanto uma cobranca esta
  // vencida — sao coisas diferentes. Uma versao anterior promovia
  // `remota.status === 'ACTIVE'` para 'ativa', o que desfazia todo
  // PAYMENT_OVERDUE na madrugada seguinte e tornava o gate inoperante.
  //
  // `cancelada` fica INTEIRAMENTE de fora: e democao deliberada do titular,
  // e nenhuma cobranca atrasada do passado pode ressuscitar a conta.
  const { data: comAsaas } = await sb
    .from('assinaturas').select('id, status, asaas_subscription_id')
    .not('asaas_subscription_id', 'is', null)
    .in('status', ['trial', 'ativa', 'inadimplente']);

  for (const a of comAsaas ?? []) {
    try {
      const { data: pagamentos } = await asaas.listarCobrancas(a.asaas_subscription_id as string);
      if (!pagamentos?.length) continue;

      // Rede de seguranca do webhook perdido: as cobrancas ja estao em mao,
      // gravar aqui nao custa uma chamada a mais. Sem isto, uma entrega
      // falha do Asaas deixava o titular sem link de fatura para sempre.
      await sincronizarCobrancas(sb, a.id as string, pagamentos as CobrancaRemota[]);

      // A cobranca mais recente por vencimento manda: e ela que diz se o
      // titular esta em dia hoje.
      const recente = [...pagamentos].sort((x, y) => (x.dueDate < y.dueDate ? 1 : -1))[0];
      const pago = recente.status === 'RECEIVED' || recente.status === 'CONFIRMED';
      const vencido = recente.status === 'OVERDUE';

      const alvo = pago ? 'ativa' : vencido ? 'inadimplente' : null;
      if (alvo && alvo !== a.status) {
        await sb.from('assinaturas')
          .update({ status: alvo, updated_at: new Date().toISOString() }).eq('id', a.id);
        resumo.reconciliadas++;
      }
    } catch (err) {
      resumo.erros++;
      console.error('[cron billing] reconciliacao falhou', a.id, err);
    }
  }

  // ──────────────────────────────────────── 2. faixa do escritorio
  const { data: planosEsc } = await sb
    .from('planos').select('id, clientes_min, clientes_max, ativo')
    .eq('publico', 'escritorio');

  const { data: assEsc } = await sb
    .from('assinaturas').select('id, contabilidade_id, plano_id')
    .not('contabilidade_id', 'is', null).in('status', ['trial', 'ativa', 'inadimplente']);

  /** Piso da faixa de um plano — serve para comparar "quem cobre mais". */
  const pisoDe = (id: string | null) =>
    (planosEsc ?? []).find((p) => p.id === id)?.clientes_min ?? null;

  for (const a of assEsc ?? []) {
    const { count } = await sb
      .from('companies').select('id', { count: 'exact', head: true })
      .eq('contabilidade_id', a.contabilidade_id as string).is('deleted_at', null);

    const r = planoPorQtdClientes(count ?? 0, (planosEsc ?? []) as PlanoFaixa[]);
    if (!r.ok) {
      // Buraco entre faixas criado pelo admin. NAO adivinhar um plano:
      // registrar e seguir, para alguem consertar em /admin/assinaturas.
      console.warn('[cron billing] sem faixa para', a.contabilidade_id, count, r.motivo);
      resumo.erros++;
      continue;
    }

    // SO CORRIGE PARA CIMA. O escritorio escolhe o plano nos cards da tela,
    // e sobrescrever a escolha dele todo mes seria mudar o preco sem pedir:
    // quem assinou o plano maior de proposito acordaria no menor. Mas quem
    // esta ABAIXO da faixa da carteira e corrigido, senao bastaria assinar
    // o plano de 50 clientes e crescer a vontade.
    const pisoAtual = pisoDe(a.plano_id as string | null);
    const pisoDaFaixa = pisoDe(r.planoId);
    const precisaSubir =
      a.plano_id === null ||
      pisoAtual === null ||
      (pisoDaFaixa !== null && pisoAtual < pisoDaFaixa);

    if (precisaSubir && r.planoId !== a.plano_id) {
      await sb.from('assinaturas')
        .update({ plano_id: r.planoId, updated_at: new Date().toISOString() }).eq('id', a.id);
      resumo.faixasAtualizadas++;
    }
  }

  // ───────────────────────────────────────────────────── 3. avisos
  // Trial terminando em ate 2 dias. A chave de idempotencia inclui a
  // data-alvo, entao rodar 2x no mesmo dia nao duplica (casa com o indice
  // notifications_owner_chave_uidx do Bloco 1).
  const limite = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const { data: trials } = await sb
    .from('assinaturas').select('id, company_id, contabilidade_id, trial_termina_em')
    .eq('status', 'trial')
    .not('trial_termina_em', 'is', null)
    .lte('trial_termina_em', limite);

  for (const t of trials ?? []) {
    const ownerId = await donoDaAssinatura(sb, t);
    if (!ownerId) continue;
    const venc = t.trial_termina_em as string;
    const { error } = await sb.from('notifications').upsert({
      owner_user_id: ownerId,
      company_id: t.company_id,
      tipo: 'assinatura_trial_acabando',
      severidade: 'warning',
      titulo: 'Seu período de teste está acabando',
      corpo: `O teste termina em ${venc.split('-').reverse().join('/')}. Assine para continuar usando.`,
      action_href: t.contabilidade_id ? '/contador/assinatura' : '/conta/assinatura',
      chave: `trial_acabando:${t.id}:${venc}`,
    }, { onConflict: 'owner_user_id,chave', ignoreDuplicates: true });
    if (error) {
      resumo.erros++;
      console.error('[cron billing] aviso de trial falhou', t.id, error.message);
    } else {
      resumo.avisos++;
    }
  }

  return resumo;
}
