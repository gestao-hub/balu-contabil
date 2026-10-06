'use server';
// "Pagar" um honorário, do lado da EMPRESA (06/10/2026).
//
// O honorário lançado pelo escritório só virava algo pagável quando o
// escritório clicava em "Gerar cobrança". O cliente via "Aberto" e não tinha
// como pagar. Agora o próprio cliente abre a fatura: se a cobrança já existe,
// recebe o link dela; se não, ela é emitida AGORA, pela subconta do escritório
// (`cobrarHonorario`, o mesmo miolo do botão do escritório), com o valor que o
// escritório lançou — o cliente não escolhe valor nem descrição.
//
// Vencimento já passado vira HOJE (o Asaas não aceita data passada, e quem
// clicou em "Pagar" quer pagar agora).
//
// ANTI-IDOR: o honorário tem de ser da empresa ATUAL do usuário, e a empresa
// tem de ser lida pela SESSÃO (RLS) — o id que vem do navegador é só o do
// honorário.
import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getContabilidadeCtx } from '@/lib/contador/guards';
import { cobrarHonorario } from '@/lib/billing/cobrar-honorario';

export type PagarHonorarioResult =
  | { ok: true; linkFatura: string }
  | { ok: false; error: string };

const INDISPONIVEL =
  'O pagamento online deste honorário ainda não está disponível. Fale com o seu escritório de contabilidade.';

export async function pagarHonorarioAction(honorarioId: string): Promise<PagarHonorarioResult> {
  if (!honorarioId) return { ok: false, error: 'Honorário não informado.' };

  const g = await getContabilidadeCtx();
  if ('error' in g) return { ok: false, error: 'Entre na sua conta para pagar.' };

  const supabase = await createServerClient();
  const { data: profile } = await supabase
    .from('profiles').select('current_company').eq('user_id', g.userId).maybeSingle();
  const companyId = (profile?.current_company as string | null) ?? null;
  if (!companyId) return { ok: false, error: 'Selecione a sua empresa antes de pagar.' };

  // Pela SESSÃO: a RLS de `honorarios` (honorarios_select_empresario) só deixa
  // ver os honorários das empresas do próprio usuário.
  const { data: hon } = await supabase
    .from('honorarios')
    .select('id, contabilidade_id, data_pagamento')
    .eq('id', honorarioId).eq('empresa_cliente_id', companyId)
    .maybeSingle();
  if (!hon?.contabilidade_id) return { ok: false, error: 'Honorário não encontrado.' };
  if (hon.data_pagamento) return { ok: false, error: 'Este honorário já está pago.' };

  const r = await cobrarHonorario(createAdminClient(), {
    contabilidadeId: hon.contabilidade_id as string,
    userId: g.userId,
    honorarioId: hon.id as string,
    vencimento: null,
    vencidoVira: 'hoje',
  });

  if (!r.ok) {
    // Cobrança que já existe: para o cliente, isso é a fatura a abrir.
    if (r.motivo === 'viva') {
      if (r.status === 'paga') return { ok: false, error: 'Este honorário já foi pago.' };
      if (r.linkFatura) return { ok: true, linkFatura: r.linkFatura };
    }
    // As recusas do motor falam com o ESCRITÓRIO ("estorne", "corrija o
    // cadastro", "conta de recebimento não aprovada"). Para o cliente, a
    // mensagem útil é uma só.
    console.error('[honorarios] pagamento pelo cliente indisponivel:', r.error);
    return { ok: false, error: INDISPONIVEL };
  }
  if (!r.linkFatura) return { ok: false, error: INDISPONIVEL };

  revalidatePath('/honorarios');
  return { ok: true, linkFatura: r.linkFatura };
}
