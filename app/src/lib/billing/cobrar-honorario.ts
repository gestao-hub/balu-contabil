// Emitir a cobrança de UM honorário pela subconta do escritório — o miolo que
// o escritório ("Gerar cobrança" em /contador/honorarios) e o CLIENTE ("Pagar"
// em /honorarios, 06/10/2026) compartilham.
//
// Saiu de `contador/honorarios/cobrar-actions.ts` para que as duas portas não
// tenham duas cópias da trava de cobrança viva, do back-pointer com
// compare-and-swap e das auditorias. O cabeçalho daquele arquivo continua sendo
// a explicação da LIGAÇÃO CANÔNICA e do ESTORNO; aqui mora só a mecânica.
//
// Quem chama já provou QUEM está pedindo e o recorte: o escritório pelo
// `contabilidade_id` do contexto, o cliente pela empresa dele. Este módulo
// confere de novo que o honorário é desse escritório (admin client ignora RLS).
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { registrarAuditoria } from '@/lib/security/audit';
import { emitirCobrancaEscritorio, clienteDaCarteira } from '@/lib/billing/emitir-cobranca';
import { cobrancaViva } from '@/lib/billing/cobranca-escritorio';
import { valorToCentavos } from '@/lib/format/dinheiro';
import { ymdBrt } from '@/lib/fiscal/tempo-brt';

export type ResultadoCobrarHonorario =
  | { ok: true; linkFatura: string | null; clienteId: string; aviso?: string }
  /** Já existe cobrança VIVA: o escritório recebe isto como recusa; o cliente,
   *  como "abra a fatura que já existe". */
  | { ok: false; motivo: 'viva'; status: string; linkFatura: string | null; error: string }
  | { ok: false; motivo?: undefined; error: string; linkFatura?: string | null };

/** Competência como MM/YYYY — `mes_referencia` existe em `char(6)` e em `date`. */
function competencia(mesReferencia: string | null): string {
  const s = String(mesReferencia ?? '');
  if (/^\d{4}-\d{2}/.test(s)) return `${s.slice(5, 7)}/${s.slice(0, 4)}`;
  if (/^\d{6}$/.test(s)) return `${s.slice(4, 6)}/${s.slice(0, 4)}`;
  return '';
}

export async function cobrarHonorario(
  sb: SupabaseClient,
  p: {
    contabilidadeId: string;
    /** Quem pediu — vai para as auditorias. */
    userId: string;
    honorarioId: string;
    /** YYYY-MM-DD informado; `null` = o vencimento do próprio honorário. */
    vencimento: string | null;
    /** O que fazer quando o vencimento já passou. O escritório escolhe nova
     *  data na tela ('recusar'); o cliente que quer pagar hoje recebe a
     *  cobrança com vencimento HOJE ('hoje') — o Asaas não aceita data passada. */
    vencidoVira: 'recusar' | 'hoje';
  },
): Promise<ResultadoCobrarHonorario> {
  // ANTI-IDOR: o honorário tem de ser DESTE escritório.
  const { data: hon } = await sb.from('honorarios')
    .select('id, empresa_cliente_id, mes_referencia, valor, data_vencimento, status, cobranca_escritorio_id')
    .eq('id', p.honorarioId).eq('contabilidade_id', p.contabilidadeId).maybeSingle();
  if (!hon) return { ok: false, error: 'Honorário não encontrado neste escritório.' };

  // TRAVA DE DUPLO CLIQUE sequencial, pela tabela CANÔNICA (que sabe o status).
  // O clique simultâneo é arbitrado pela reserva dentro de
  // `emitirCobrancaEscritorio` e pelo índice único parcial da 0055.
  const { data: cobrancas, error: erroCobrancas } = await sb.from('cobrancas_escritorio')
    .select('id, status, link_fatura, created_at')
    .eq('honorario_id', hon.id).eq('contabilidade_id', p.contabilidadeId)
    .order('created_at', { ascending: false });
  if (erroCobrancas) {
    console.error('[4b] leitura das cobrancas do honorario falhou', hon.id, erroCobrancas.message);
    return { ok: false, error: 'Não foi possível conferir se este honorário já tem cobrança. Tente de novo.' };
  }
  const viva = (cobrancas ?? []).find((c) => cobrancaViva(String(c.status)));
  if (viva) {
    return {
      ok: false, motivo: 'viva', status: String(viva.status),
      linkFatura: (viva.link_fatura as string | null) ?? null,
      error: viva.status === 'paga'
        ? 'Este honorário já tem uma cobrança PAGA. Estorne-a antes de emitir outra.'
        : 'Este honorário já tem uma cobrança em aberto. Estorne-a antes de emitir outra.',
    };
  }
  if (hon.status === 'pago') return { ok: false, error: 'Este honorário já está marcado como pago.' };
  if (!hon.empresa_cliente_id) {
    return { ok: false, error: 'Este honorário não está vinculado a um cliente da carteira.' };
  }

  const cliente = await clienteDaCarteira(sb, p.contabilidadeId, hon.empresa_cliente_id as string);
  if (!cliente) return { ok: false, error: 'Cliente não encontrado na carteira do escritório.' };

  // `valorToCentavos`, nunca float: `valor` é numeric e chega como string.
  const valorCentavos = valorToCentavos(String(hon.valor ?? '0'));
  if (!(valorCentavos > 0)) return { ok: false, error: 'Este honorário está sem valor — corrija antes de cobrar.' };

  const hoje = ymdBrt();
  let vencimento = p.vencimento ?? (hon.data_vencimento as string | null);
  if (!vencimento) {
    if (p.vencidoVira === 'hoje') vencimento = hoje;
    else return { ok: false, error: 'Informe o vencimento da cobrança.' };
  }
  if (vencimento < hoje) {
    if (p.vencidoVira === 'hoje') vencimento = hoje;
    else return { ok: false, error: 'O vencimento deste honorário já passou — informe uma nova data para a cobrança.' };
  }

  const mes = competencia(hon.mes_referencia as string | null);
  const descricao = mes ? `Honorários contábeis — ${mes}` : 'Honorários contábeis';

  const r = await emitirCobrancaEscritorio(sb, {
    contabilidadeId: p.contabilidadeId,
    userId: p.userId,
    cliente,
    descricao,
    valorCentavos,
    vencimento,
    servicoAvulsoId: null,
    // A LIGAÇÃO CANÔNICA — é dela que webhook e reconciliação tiram qual
    // honorário marcar como pago.
    honorarioId: hon.id as string,
    // O honorário tem chave natural (`hon:<id>`); chave de submissão faria a
    // mesma dívida ter dois nomes.
    idempotencyKey: null,
  });
  if (!r.ok) return { ok: false, error: r.error, ...(r.linkFatura !== undefined ? { linkFatura: r.linkFatura } : {}) };

  // BACK-POINTER com compare-and-swap do valor LIDO nesta requisição: de dois
  // pedidos simultâneos, só um troca o ponteiro. Ver o cabeçalho de
  // `contador/honorarios/cobrar-actions.ts`.
  const ponteiroAntes = (hon.cobranca_escritorio_id as string | null) ?? null;
  const alvo = sb.from('honorarios')
    .update({ cobranca_escritorio_id: r.cobrancaId, updated_at: new Date().toISOString() })
    .eq('id', hon.id).eq('contabilidade_id', p.contabilidadeId);
  const { data: ligadas, error: erroLigacao } = await (
    ponteiroAntes
      ? alvo.eq('cobranca_escritorio_id', ponteiroAntes)
      : alvo.is('cobranca_escritorio_id', null)
  ).select('id');

  let aviso: string | undefined;
  if (erroLigacao) {
    console.error('[4b] back-pointer do honorario nao gravado', hon.id, r.cobrancaId, erroLigacao.message);
    await registrarAuditoria({
      actorUserId: p.userId, acao: 'cobranca_escritorio.honorario_sem_vinculo',
      alvoTipo: 'honorario', alvoId: hon.id as string, contabilidadeId: p.contabilidadeId,
      meta: { cobranca_id: r.cobrancaId, charge_id: r.chargeId, erro: erroLigacao.message },
    });
    aviso = 'A cobrança foi emitida, mas o honorário não ficou marcado como cobrado — não clique de novo, e avise o suporte da Balu.';
  } else if ((ligadas?.length ?? 0) !== 1) {
    console.error('[4b] honorario com segunda cobranca emitida', hon.id, r.cobrancaId);
    await registrarAuditoria({
      actorUserId: p.userId, acao: 'cobranca_escritorio.honorario_duplicado',
      alvoTipo: 'honorario', alvoId: hon.id as string, contabilidadeId: p.contabilidadeId,
      meta: { cobranca_id: r.cobrancaId, charge_id: r.chargeId, valor_centavos: valorCentavos },
    });
    aviso = 'Atenção: parece que este honorário já tinha uma cobrança emitida. Confira no Asaas antes de enviar ao cliente.';
  } else if (ponteiroAntes) {
    await registrarAuditoria({
      actorUserId: p.userId, acao: 'cobranca_escritorio.honorario_recobrado',
      alvoTipo: 'honorario', alvoId: hon.id as string, contabilidadeId: p.contabilidadeId,
      meta: {
        cobranca_anterior_id: ponteiroAntes, cobranca_id: r.cobrancaId,
        charge_id: r.chargeId, valor_centavos: valorCentavos,
      },
    });
  }

  return { ok: true, linkFatura: r.linkFatura, clienteId: cliente.id, ...(aviso ? { aviso } : {}) };
}
