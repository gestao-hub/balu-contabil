// Bloco 4A — rotina diaria de billing.
//
// NADA AQUI E REQUISITO DE CORRECAO: o status efetivo e derivado na leitura
// (lib/billing/status.ts), entao o trial vence sozinho e o gate decide certo
// mesmo que este cron nunca rode. Isto e conveniencia e rede de seguranca —
// fecha em ate 24h a janela de um webhook perdido.
//
// `rodarBilling` e exportada de proposito: se o projeto na Vercel estiver no
// plano Hobby (limite de 2 crons, e o vercel.json ja tem 2), esta funcao e
// chamada de dentro de /api/cron/obrigacoes em vez de virar cron proprio.
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { asaas } from '@/lib/clients';
import { planoPorQtdClientes, type PlanoFaixa } from '@/lib/billing/faixa';
import { ymdBrt } from '@/lib/fiscal/tempo-brt';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  const { data: comAsaas } = await sb
    .from('assinaturas').select('id, status, asaas_subscription_id')
    .not('asaas_subscription_id', 'is', null)
    .neq('status', 'cortesia');   // cortesia nao tem cobranca a reconciliar

  for (const a of comAsaas ?? []) {
    try {
      const remota = await asaas.consultarAssinatura(a.asaas_subscription_id as string);
      // ACTIVE no Asaas e a UNICA situacao que garante 'ativa' aqui.
      // Qualquer outra coisa NAO vira inadimplente automaticamente: quem
      // declara inadimplencia e o evento PAYMENT_OVERDUE. Ausencia de
      // ACTIVE pode ser mil coisas, e rebaixar por ela bloquearia cliente
      // adimplente.
      if (remota.status === 'ACTIVE' && a.status !== 'ativa') {
        await sb.from('assinaturas')
          .update({ status: 'ativa', updated_at: new Date().toISOString() }).eq('id', a.id);
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
    if (r.planoId !== a.plano_id) {
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

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET não configurado' }, { status: 500 });
  if ((req.headers.get('authorization') ?? '') !== `Bearer ${secret}`)
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  try {
    return NextResponse.json({ ok: true, ...(await rodarBilling()) });
  } catch (err) {
    console.error('[cron billing] falhou', err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
