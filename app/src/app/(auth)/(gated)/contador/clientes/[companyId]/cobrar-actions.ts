'use server';
// Bloco 4B — emitir cobranca do cliente PELA SUBCONTA do escritorio, a partir
// do catalogo de servicos avulsos (ou de uma descricao livre).
//
// POR CLIQUE DO CONTADOR, NUNCA POR CRON. Decisao explicita do usuario: dinheiro
// emitido sem humano no laco e outro perfil de risco — um bug de laco vira
// dezenas de boletos reais na mao de clientes reais, e desfazer cobranca ja
// enviada custa a relacao do escritorio com o cliente dele. O caminho automatico
// deste bloco e so o de LER de volta (webhook e reconciliacao).
//
// Toda a mecanica de emissao (gate, KYC da subconta, credencial, Asaas,
// persistencia, auditoria) mora em `@/lib/billing/emitir-cobranca` — porta unica,
// para que nenhum caminho novo possa esquecer o gate ou trocar `asaasSub` por
// `asaas`. O que e desta tela mora aqui: resolver O QUE cobrar e por quanto.
//
// Nada de puro neste arquivo: 'use server' so pode exportar funcao async, e
// tipo/constante/funcao pura exportada daqui quebra no `next build` sem o
// `tsc --noEmit` reclamar.
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireEscritorioAprovado } from '@/lib/contador/guards';
import { valorFinalCentavos } from '@/lib/billing/avulso';
import { emitirCobrancaEscritorio, clienteDaCarteira } from '@/lib/billing/emitir-cobranca';
import { ymdBrt } from '@/lib/fiscal/tempo-brt';
import { CobrarClienteSchema } from '@/types/zod';

export type CobrarResult =
  | { ok: true; linkFatura: string | null }
  // `linkFatura` na recusa: quando o motivo e "esta cobranca ja foi emitida"
  // (chave de idempotencia repetida), o contador precisa CHEGAR na fatura que
  // bloqueou para conferir antes de tentar de novo. Mesma forma de
  // `CobrarHonorarioResult`.
  | { ok: false; error: string; linkFatura?: string | null };

export async function cobrarClienteAction(entrada: unknown): Promise<CobrarResult> {
  const ctx = await requireEscritorioAprovado();
  if (!ctx.ok) return { ok: false, error: ctx.error };

  const parsed = CobrarClienteSchema.safeParse(entrada);
  if (!parsed.success) return { ok: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos.' };
  const dados = parsed.data;

  // Vencimento no passado: o Asaas recusa com erro em ingles. Barrar aqui, em
  // BRT, e o que evita recusar o proprio dia corrente depois das 21h (a Vercel
  // roda em UTC).
  if (dados.vencimento < ymdBrt()) {
    return { ok: false, error: 'O vencimento não pode ser anterior a hoje.' };
  }

  const sb = createAdminClient();

  // ANTI-IDOR: o cliente precisa estar na carteira DESTE escritorio. O admin
  // client ignora RLS — sem esta checagem, um companyId qualquer emitiria
  // cobranca contra uma empresa de outro escritorio.
  const cliente = await clienteDaCarteira(sb, ctx.id, dados.companyId);
  if (!cliente) return { ok: false, error: 'Cliente não encontrado na sua carteira.' };

  let descricao = dados.descricaoLivre ?? '';
  let valor: number | null = dados.baseCentavos;
  let servicoId: string | null = null;

  if (dados.servicoAvulsoId) {
    // `.eq('contabilidade_id', ...)` alem do `.eq('id', ...)`: sem ele, o id de
    // um servico de outro escritorio (que vaza de historico, print ou palpite)
    // definiria o preco desta cobranca.
    const { data: srv } = await sb.from('servicos_avulsos')
      .select('id, nome, tipo_valor, valor_centavos, percentual, ativo')
      .eq('id', dados.servicoAvulsoId).eq('contabilidade_id', ctx.id).maybeSingle();
    if (!srv) return { ok: false, error: 'Serviço não encontrado no catálogo.' };
    // Servico desativado saiu da lista de emissao de proposito (ver
    // `definirAtivoServicoAction`): a tela nao o oferece, e a action tambem nao.
    if (!srv.ativo) return { ok: false, error: 'Este serviço está desativado — reative-o para poder cobrar.' };

    servicoId = srv.id;
    descricao = descricao || srv.nome;
    // `valorFinalCentavos` devolve `null` para zero e negativo DE PROPOSITO —
    // emitir por zero e pior que recusar, porque sai de graca sem ninguem
    // notar. Nao ha numero forcado aqui.
    valor = valorFinalCentavos(
      { tipoValor: srv.tipo_valor, valorCentavos: srv.valor_centavos, percentual: srv.percentual },
      dados.baseCentavos,
    );
    if (valor == null) {
      return srv.tipo_valor === 'percentual'
        ? { ok: false, error: 'Este serviço é percentual — informe o valor-base da cobrança.' }
        : { ok: false, error: 'Este serviço está sem valor no catálogo — corrija-o antes de cobrar.' };
    }
  }

  if (!valor || valor <= 0) return { ok: false, error: 'Informe o valor da cobrança.' };
  if (!descricao.trim()) return { ok: false, error: 'Descreva o que está sendo cobrado.' };

  const r = await emitirCobrancaEscritorio(sb, {
    contabilidadeId: ctx.id,
    userId: ctx.userId,
    cliente,
    descricao,
    valorCentavos: valor,
    vencimento: dados.vencimento,
    servicoAvulsoId: servicoId,
    honorarioId: null,
    // ┌─ QUEM MANDA ISTO E A TELA (`CobrarDialog.tsx`, Task 10) ──────────┐
    // │ O avulso NAO TEM chave natural: cobrar duas vezes o mesmo servico │
    // │ do mesmo cliente e legitimo. Quem separa "duplo clique" de        │
    // │ "cobrar de novo" e um UUID gerado no navegador                    │
    // │ (`novaChaveEmissao`, em lib/billing/chave-emissao) UMA VEZ POR    │
    // │ ABERTURA DO FORMULARIO, mantido em estado e RENOVADO SO APOS UMA  │
    // │ EMISSAO BEM-SUCEDIDA.                                             │
    // │                                                                   │
    // │ A chave segue OPCIONAL no schema: chamador que nao a mande        │
    // │ (script, teste, uma tela nova que esqueca) ainda emite, e ai      │
    // │ segue SEM TRAVA contra duplo clique simultaneo — sem chave nao ha │
    // │ reserva a tomar antes do Asaas nem indice unico a violar depois.  │
    // │ O caminho do honorario nao depende disto: ele tem chave natural   │
    // │ (`honorarioId`).                                                  │
    // └───────────────────────────────────────────────────────────────────┘
    idempotencyKey: dados.idempotencyKey,
  });
  if (!r.ok) return r;

  revalidatePath(`/contador/clientes/${cliente.id}`);
  return { ok: true, linkFatura: r.linkFatura };
}
