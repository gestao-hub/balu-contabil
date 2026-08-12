// Saldo e saque da subconta Asaas do escritório.
//
// ⚠️ AQUI SAI DINHEIRO. As três regras que governam este arquivo:
//   1. Só o dono da subconta (quem a criou) pode cadastrar destino e sacar.
//      O modelo atual é "1 escritório = N usuários iguais", sem papéis
//      internos — sem essa restrição, qualquer pessoa da equipe esvaziaria a
//      conta do escritório.
//   2. Nada de retry automático em transferência (ver `transferir` no cliente).
//   3. Toda tentativa vira linha em `saques_escritorio` e em `audit_log`,
//      inclusive as que falharam — "não apareceu no histórico" não pode ser
//      resposta para "cadê meu dinheiro".
'use server';
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { getContabilidadeCtx } from '@/lib/contador/guards';
import { registrarAuditoria } from '@/lib/security/audit';
import { lerCredencial } from '@/lib/billing/credencial-subconta';
import { asaasSub } from '@/lib/clients/asaas';
import {
  validarContaDestino, resumoDaConta, guardarContaDestino, lerContaDestino,
  type ContaDestino,
} from '@/lib/billing/conta-destino';

export type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

/**
 * Contexto de quem pode mexer em dinheiro: membro do escritório **e** dono da
 * subconta. Devolve também a chave decifrada, porque todo caminho daqui
 * precisa dela.
 */
async function requireDonoDaSubconta(): Promise<
  | { ok: true; contabilidadeId: string; userId: string; chave: string; conta: ContaDestino | null; resumo: string | null }
  | { ok: false; error: string }
> {
  const g = await getContabilidadeCtx();
  if ('error' in g) return { ok: false, error: g.error };
  if (!g.contabilidade) return { ok: false, error: 'Você não faz parte de um escritório.' };

  const sb = createAdminClient();
  const { data: cont } = await sb
    .from('contabilidades')
    .select('id, asaas_subconta_id, asaas_api_key_cifrada, asaas_subconta_status, asaas_subconta_criada_por, conta_destino_cifrada, conta_destino_resumo')
    .eq('id', g.contabilidade.id)
    .maybeSingle();

  if (!cont?.asaas_subconta_id) return { ok: false, error: 'Este escritório ainda não tem conta de recebimento.' };
  if (cont.asaas_subconta_status !== 'aprovada') {
    return { ok: false, error: 'A conta de recebimento ainda não foi aprovada pelo Asaas.' };
  }

  // `criada_por` NULO NÃO É PASSE LIVRE. A 0073 fez backfill apontando o
  // membro mais antigo, então nulo aqui significa "sem dono identificável" —
  // e é exatamente assim que a tela decide (`ehDono` exige o valor presente).
  // Aceitar nulo aqui deixaria qualquer pessoa do escritório esvaziar a conta
  // por chamada direta da action, com a caixa escondida na tela dando a falsa
  // impressão de que a regra existe.
  const dono = cont.asaas_subconta_criada_por as string | null;
  if (!dono) {
    return { ok: false, error: 'Não sabemos quem abriu esta conta de recebimento. Fale com o suporte da Balu antes de sacar.' };
  }
  if (dono !== g.userId) {
    return { ok: false, error: 'Apenas quem abriu a conta de recebimento pode movimentar o saldo.' };
  }

  let chave: string | null;
  try {
    chave = lerCredencial(cont.asaas_api_key_cifrada);
  } catch {
    console.error('[saque] credencial da subconta ilegível', cont.asaas_subconta_id);
    return { ok: false, error: 'A credencial da conta está ilegível. Fale com o suporte da Balu.' };
  }
  if (!chave) return { ok: false, error: 'A credencial da conta não está guardada. Fale com o suporte da Balu.' };

  return {
    ok: true,
    contabilidadeId: cont.id as string,
    userId: g.userId,
    chave,
    conta: lerContaDestino(cont.conta_destino_cifrada as string | null),
    resumo: (cont.conta_destino_resumo as string | null) ?? null,
  };
}

/** Saldo disponível, direto do Asaas — nunca calculado por nós. */
export async function consultarSaldoAction(): Promise<ActionResult<{ centavos: number }>> {
  const ctx = await requireDonoDaSubconta();
  if (!ctx.ok) return ctx;

  try {
    const r = await asaasSub(ctx.chave).consultarSaldo();
    // O Asaas responde em reais com decimais; o app inteiro fala centavos.
    return { ok: true, data: { centavos: Math.round(Number(r.balance ?? 0) * 100) } };
  } catch (e) {
    console.error('[saque] consultar saldo:', e);
    return { ok: false, error: 'Não conseguimos consultar o saldo agora. Tente de novo em instantes.' };
  }
}

export async function salvarContaDestinoAction(bruto: unknown): Promise<ActionResult> {
  const ctx = await requireDonoDaSubconta();
  if (!ctx.ok) return ctx;

  const v = validarContaDestino((bruto ?? {}) as Partial<ContaDestino>);
  if (!v.ok) return { ok: false, error: v.erro };

  const sb = createAdminClient();
  const { error } = await sb
    .from('contabilidades')
    .update({
      conta_destino_cifrada: guardarContaDestino(v.conta),
      conta_destino_resumo: resumoDaConta(v.conta),
      conta_destino_em: new Date().toISOString(),
    })
    .eq('id', ctx.contabilidadeId);
  if (error) return { ok: false, error: error.message };

  await registrarAuditoria({
    actorUserId: ctx.userId, acao: 'subconta.conta_destino_salva',
    contabilidadeId: ctx.contabilidadeId,
  });

  revalidatePath('/contador/configuracoes/subconta');
  return { ok: true };
}

/**
 * Saque. O valor vem em centavos da tela; o Asaas fala reais.
 *
 * Confere o saldo ANTES de pedir a transferência — não por confiar no número
 * (o Asaas decide de verdade), mas para o erro comum ("pedi mais do que
 * tenho") virar uma frase clara em vez de uma falha de API.
 */
export async function sacarAction(valorCentavos: number): Promise<ActionResult<{ transferId: string }>> {
  const ctx = await requireDonoDaSubconta();
  if (!ctx.ok) return ctx;

  if (!Number.isInteger(valorCentavos) || valorCentavos <= 0) {
    return { ok: false, error: 'Informe um valor válido para saque.' };
  }
  if (!ctx.conta) {
    return { ok: false, error: 'Cadastre a conta bancária de destino antes de sacar.' };
  }

  const cliente = asaasSub(ctx.chave);
  const sb = createAdminClient();

  let saldoCentavos: number;
  try {
    const s = await cliente.consultarSaldo();
    saldoCentavos = Math.round(Number(s.balance ?? 0) * 100);
  } catch (e) {
    console.error('[saque] saldo antes do saque:', e);
    return { ok: false, error: 'Não conseguimos confirmar o saldo agora. Tente de novo em instantes.' };
  }

  if (valorCentavos > saldoCentavos) {
    return { ok: false, error: 'Valor maior que o saldo disponível. Lembre que valores recebidos têm prazo de liberação.' };
  }

  // A linha nasce ANTES da chamada. Se a resposta do Asaas se perder (timeout,
  // queda), fica o registro de que a tentativa existiu — sem isso, um saque
  // que saiu mas não respondeu não teria rastro nenhum do nosso lado.
  const { data: saque, error: eIns } = await sb
    .from('saques_escritorio')
    .insert({
      contabilidade_id: ctx.contabilidadeId,
      valor_centavos: valorCentavos,
      status: 'solicitado',
      destino_resumo: ctx.resumo,
      solicitado_por: ctx.userId,
    })
    .select('id')
    .single();
  if (eIns) return { ok: false, error: eIns.message };

  try {
    const r = await cliente.transferir({
      value: valorCentavos / 100,
      bankAccount: {
        bank: { code: ctx.conta.bancoCodigo },
        ownerName: ctx.conta.titular,
        cpfCnpj: ctx.conta.cpfCnpj,
        agency: ctx.conta.agencia,
        account: ctx.conta.conta,
        accountDigit: ctx.conta.contaDigito,
        bankAccountType: ctx.conta.tipo,
      },
      description: 'Saque solicitado pelo painel Balu',
    });

    await sb.from('saques_escritorio')
      .update({ status: 'confirmado', asaas_transfer_id: r.id, updated_at: new Date().toISOString() })
      .eq('id', saque.id);

    await registrarAuditoria({
      actorUserId: ctx.userId, acao: 'subconta.saque',
      contabilidadeId: ctx.contabilidadeId, alvoTipo: 'saque', alvoId: saque.id as string,
    });

    revalidatePath('/contador/configuracoes/subconta');
    return { ok: true, data: { transferId: r.id } };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'falha desconhecida';
    await sb.from('saques_escritorio')
      .update({ status: 'falhou', erro: msg.slice(0, 300), updated_at: new Date().toISOString() })
      .eq('id', saque.id);

    console.error('[saque] transferência recusada:', msg);
    revalidatePath('/contador/configuracoes/subconta');
    // Sem retry, e a mensagem diz para conferir antes de repetir: o Asaas não
    // expõe chave de idempotência nesta rota, então repetir sozinho pode
    // transferir duas vezes.
    return { ok: false, error: 'O Asaas recusou a transferência. Confira o extrato antes de tentar de novo — o registro ficou salvo no histórico.' };
  }
}
