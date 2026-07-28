'use server';
// Bloco 4B — emitir a cobranca de um HONORARIO pela subconta do escritorio.
//
// POR QUE ESTE CAMINHO EXISTE: o plano promete "Gerar cobranca no honorario" na
// tabela de arquivos, e o webhook e a reconciliacao ja leem
// `cobrancas_escritorio.honorario_id` — mas nenhum INSERT do plano preenchia
// essa coluna. Sem este arquivo, o unico jeito de cobrar seria o servico avulso,
// e ficaria de fora a MENSALIDADE: o principal que um escritorio cobra, todo
// mes, de todo cliente.
//
// EMISSAO POR CLIQUE, NUNCA POR CRON — decisao explicita do usuario. Um laco que
// emitisse a mensalidade de toda a carteira sozinho transformaria qualquer bug
// em dezenas de boletos reais na mao de clientes reais.
//
// ┌─ A LIGACAO CANONICA HONORARIO ↔ COBRANCA ──────────────────────────────┐
// │ Existem TRES colunas capazes de ligar os dois, e usar mais de uma como  │
// │ verdade e como ficar com tres relogios marcando horas diferentes:       │
// │                                                                         │
// │ 1. `cobrancas_escritorio.honorario_id`  ← CANONICA. E a direcao em que  │
// │    a resposta do dinheiro chega: webhook e cron so tem o `chargeId`,    │
// │    acham a cobranca por ele e PRECISAM descobrir dali qual honorario    │
// │    marcar. Mora na mesma linha que `asaas_charge_id UNIQUE` (0053), o   │
// │    que a impede de divergir da cobranca que ela descreve.               │
// │                                                                         │
// │ 2. `honorarios.cobranca_escritorio_id` ← DERIVADA. Escrita so aqui,     │
// │    logo apos o INSERT, e lida so para responder "este honorario ja tem  │
// │    cobranca?" (a trava de duplo clique abaixo e o botao da tela).       │
// │    NENHUMA decisao sobre pagamento passa por ela.                       │
// │                                                                         │
// │ 3. `honorarios.asaas_charge_id` / `asaas_customer_id` (0032, marcadas   │
// │    "-- gancho Bloco B") ← MORTAS, e ficam mortas. Elas supoem que o     │
// │    honorario carrega a cobranca; no 4B quem carrega e                   │
// │    `cobrancas_escritorio`, que tambem guarda valor, vencimento, status, │
// │    link e estorno. Preenche-las seria a terceira ligacao meio            │
// │    preenchida. Ficam para um DROP COLUMN na proxima migration do bloco. │
// └─────────────────────────────────────────────────────────────────────────┘
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireEscritorioAprovado } from '@/lib/contador/guards';
import { registrarAuditoria } from '@/lib/security/audit';
import { emitirCobrancaEscritorio, clienteDaCarteira } from '@/lib/billing/emitir-cobranca';
import { valorToCentavos } from '@/lib/format/dinheiro';
import { ymdBrt } from '@/lib/fiscal/tempo-brt';
import { CobrarHonorarioSchema } from '@/types/zod';

export type CobrarHonorarioResult =
  | { ok: true; linkFatura: string | null; aviso?: string }
  | { ok: false; error: string };

/**
 * Competência como MM/YYYY, a partir do que o banco devolver.
 *
 * `honorarios.mes_referencia` nasceu `char(6)` na 0001 e virou `date` no
 * caminho (o v2 grava `YYYY-MM-01`). As duas formas ainda podem estar na
 * tabela, e uma descrição de cobrança errada é o que o cliente lê no boleto.
 */
function competencia(mesReferencia: string | null): string {
  const s = String(mesReferencia ?? '');
  if (/^\d{4}-\d{2}/.test(s)) return `${s.slice(5, 7)}/${s.slice(0, 4)}`;
  if (/^\d{6}$/.test(s)) return `${s.slice(4, 6)}/${s.slice(0, 4)}`;
  return '';
}

export async function cobrarHonorarioAction(entrada: unknown): Promise<CobrarHonorarioResult> {
  const ctx = await requireEscritorioAprovado();
  if (!ctx.ok) return { ok: false, error: ctx.error };

  const parsed = CobrarHonorarioSchema.safeParse(entrada);
  if (!parsed.success) return { ok: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos.' };
  const { honorarioId, vencimento: vencimentoInformado } = parsed.data;

  const sb = createAdminClient();

  // ANTI-IDOR: `.eq('contabilidade_id', ...)` alem do `.eq('id', ...)`. O admin
  // client ignora RLS, e sem este filtro um id de honorario de outro escritorio
  // emitiria cobranca — pela subconta errada, contra o cliente errado.
  const { data: hon } = await sb.from('honorarios')
    .select('id, empresa_cliente_id, mes_referencia, valor, data_vencimento, status, cobranca_escritorio_id')
    .eq('id', honorarioId).eq('contabilidade_id', ctx.id).maybeSingle();
  if (!hon) return { ok: false, error: 'Honorário não encontrado neste escritório.' };

  // TRAVA DE DUPLO CLIQUE (sequencial). O clique SIMULTANEO ainda passa — ver o
  // compare-and-swap la embaixo e a nota no relatorio da task.
  if (hon.cobranca_escritorio_id) {
    return { ok: false, error: 'Este honorário já tem uma cobrança emitida.' };
  }
  if (hon.status === 'pago') {
    return { ok: false, error: 'Este honorário já está marcado como pago.' };
  }
  // Linha legada da 0001 (sem `empresa_cliente_id`): a UI v2 ja as esconde, e
  // sem empresa nao ha quem cobrar.
  if (!hon.empresa_cliente_id) {
    return { ok: false, error: 'Este honorário não está vinculado a um cliente da carteira.' };
  }

  const cliente = await clienteDaCarteira(sb, ctx.id, hon.empresa_cliente_id as string);
  if (!cliente) return { ok: false, error: 'Cliente não encontrado na sua carteira.' };

  // `valorToCentavos` e nao `Math.round(Number(v) * 100)`: `valor` e
  // `numeric(14,2)` e chega como STRING; o caminho por float ja errou centavo
  // neste repo (199.9 * 100 = 19989.999...).
  const valorCentavos = valorToCentavos(String(hon.valor ?? '0'));
  if (!(valorCentavos > 0)) return { ok: false, error: 'Este honorário está sem valor — corrija antes de cobrar.' };

  // O vencimento do honorario e o default. Quando ele ja passou, o Asaas recusa
  // a data e o contador precisa informar uma nova — em vez de ver
  // "invalid_dueDate" em ingles no meio da tela.
  const hoje = ymdBrt();
  const vencimento = vencimentoInformado ?? (hon.data_vencimento as string | null);
  if (!vencimento) return { ok: false, error: 'Informe o vencimento da cobrança.' };
  if (vencimento < hoje) {
    return { ok: false, error: 'O vencimento deste honorário já passou — informe uma nova data para a cobrança.' };
  }

  const mes = competencia(hon.mes_referencia as string | null);
  const descricao = mes ? `Honorários contábeis — ${mes}` : 'Honorários contábeis';

  const r = await emitirCobrancaEscritorio(sb, {
    contabilidadeId: ctx.id,
    userId: ctx.userId,
    cliente,
    descricao,
    valorCentavos,
    vencimento,
    servicoAvulsoId: null,
    // A LIGACAO CANONICA. E dela que o webhook e a reconciliacao tiram qual
    // honorario marcar como pago (decisao 7.4: semaforo automatico onde houver
    // cobranca pela subconta, manual onde nao houver).
    honorarioId: hon.id as string,
  });
  if (!r.ok) return r;

  // BACK-POINTER, com compare-and-swap. `.is('cobranca_escritorio_id', null)`
  // faz do banco o juiz de dois cliques simultaneos: so um encontra a coluna
  // nula. O `.select('id')` nao e enfeite — sem ele o supabase-js devolve
  // `data: null` e o perdedor da corrida fica indistinguivel do vencedor.
  //
  // Nao mexe em `pagamento_origem`: ele descreve a ORIGEM DO PAGAMENTO, e aqui
  // ainda nao houve pagamento nenhum. Quem o preenche com 'asaas' e o webhook,
  // quando o dinheiro entra.
  const { data: ligadas, error: erroLigacao } = await sb.from('honorarios')
    .update({ cobranca_escritorio_id: r.cobrancaId, updated_at: new Date().toISOString() })
    .eq('id', hon.id).eq('contabilidade_id', ctx.id)
    .is('cobranca_escritorio_id', null)
    .select('id');

  // EM QUALQUER DOS DOIS CASOS ABAIXO A COBRANCA VALE: ela existe no Asaas e ja
  // esta gravada com `honorario_id`, que e a ligacao CANONICA — o semaforo do
  // painel vai fechar sozinho quando o dinheiro entrar. O que falta e o
  // back-pointer, e por isso o aviso vai para o contador em vez de virar erro.
  // Os dois casos sao registrados com acoes DIFERENTES de proposito: "ja havia
  // outra cobranca" e "nao consegui gravar" pedem investigacoes opostas.
  let aviso: string | undefined;
  if (erroLigacao) {
    console.error('[4b] back-pointer do honorario nao gravado', hon.id, r.cobrancaId, erroLigacao.message);
    await registrarAuditoria({
      actorUserId: ctx.userId, acao: 'cobranca_escritorio.honorario_sem_vinculo',
      alvoTipo: 'honorario', alvoId: hon.id as string, contabilidadeId: ctx.id,
      meta: { cobranca_id: r.cobrancaId, charge_id: r.chargeId, erro: erroLigacao.message },
    });
    // Sem o back-pointer, a trava de duplo clique nao ve nada: o proximo clique
    // emitiria uma SEGUNDA cobranca real. Dizer isso e o que evita o segundo
    // boleto.
    aviso = 'A cobrança foi emitida, mas o honorário não ficou marcado como cobrado — não clique de novo, e avise o suporte da Balu.';
  } else if ((ligadas?.length ?? 0) !== 1) {
    // Corrida perdida: outro pedido simultaneo ja tinha ligado uma cobranca a
    // este honorario. Existem DUAS cobrancas reais para a mesma mensalidade, e
    // quem precisa saber disso e o contador, antes de mandar dois boletos.
    console.error('[4b] honorario com segunda cobranca emitida', hon.id, r.cobrancaId);
    await registrarAuditoria({
      actorUserId: ctx.userId, acao: 'cobranca_escritorio.honorario_duplicado',
      alvoTipo: 'honorario', alvoId: hon.id as string, contabilidadeId: ctx.id,
      meta: { cobranca_id: r.cobrancaId, charge_id: r.chargeId, valor_centavos: valorCentavos },
    });
    aviso = 'Atenção: parece que este honorário já tinha uma cobrança emitida. Confira no Asaas antes de enviar ao cliente.';
  }

  revalidatePath('/contador/honorarios');
  revalidatePath(`/contador/clientes/${cliente.id}`);
  return { ok: true, linkFatura: r.linkFatura, ...(aviso ? { aviso } : {}) };
}
