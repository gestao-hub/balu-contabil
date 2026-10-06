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
// │    logo apos o INSERT. Aponta para a cobranca MAIS RECENTE, e serve ao  │
// │    compare-and-swap que arbitra dois cliques simultaneos — NAO mais     │
// │    para responder "este honorario ja tem cobranca?" (ver a nota do      │
// │    ESTORNO abaixo). NENHUMA decisao sobre pagamento passa por ela.      │
// │                                                                         │
// │ 3. `honorarios.asaas_charge_id` / `asaas_customer_id` (0032, marcadas   │
// │    "-- gancho Bloco B") ← MORTAS, e ficam mortas. Elas supoem que o     │
// │    honorario carrega a cobranca; no 4B quem carrega e                   │
// │    `cobrancas_escritorio`, que tambem guarda valor, vencimento, status, │
// │    link e estorno. Preenche-las seria a terceira ligacao meio            │
// │    preenchida. Ficam para um DROP COLUMN na proxima migration do bloco. │
// └─────────────────────────────────────────────────────────────────────────┘
//
// ┌─ ESTORNO LIBERA O HONORARIO (decisao do usuario, 28/07) ────────────────┐
// │ Ate aqui, quem bloqueava nova emissao era `cobranca_escritorio_id`      │
// │ preenchido — "ja existiu alguma cobranca". Isso deixava o honorario     │
// │ cuja cobranca foi ESTORNADA impossivel de recobrar pela tela, para      │
// │ sempre. Mas estorno acontece por valor errado, dados errados ou acordo, │
// │ e A DIVIDA CONTINUA EXISTINDO: o escritorio precisa poder emitir a      │
// │ cobranca certa.                                                         │
// │                                                                         │
// │ Agora quem bloqueia e existir cobranca VIVA (`cobrancaViva`, em         │
// │ lib/billing/cobranca-escritorio) na tabela canonica. O rastro do que    │
// │ foi estornado NAO some: a linha estornada fica em `cobrancas_escritorio`│
// │ com o mesmo `honorario_id`, e a recobranca vira auditoria propria.      │
// │ O que muda de dono e so o back-pointer, que passa a apontar para a      │
// │ cobranca mais recente.                                                  │
// └─────────────────────────────────────────────────────────────────────────┘
//
// A MECÂNICA mora em `@/lib/billing/cobrar-honorario` desde 06/10/2026: o
// cliente também passou a poder pagar o honorário (botão "Pagar" em
// /honorarios), e as duas portas não podem ter cópias divergentes da trava de
// cobrança viva, do back-pointer e das auditorias.
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireEscritorioAprovado } from '@/lib/contador/guards';
import { cobrarHonorario } from '@/lib/billing/cobrar-honorario';
import { CobrarHonorarioSchema } from '@/types/zod';

export type CobrarHonorarioResult =
  | { ok: true; linkFatura: string | null; aviso?: string }
  // `linkFatura` na recusa NAO e enfeite: quando a recusa e "ja existe cobranca
  // viva", o contador precisa CHEGAR nela — para conferir o valor, reenviar ao
  // cliente ou estorna-la. Sem o link, a unica saida e cacar no Asaas.
  | { ok: false; error: string; linkFatura?: string | null };

export async function cobrarHonorarioAction(entrada: unknown): Promise<CobrarHonorarioResult> {
  const ctx = await requireEscritorioAprovado();
  if (!ctx.ok) return { ok: false, error: ctx.error };

  const parsed = CobrarHonorarioSchema.safeParse(entrada);
  if (!parsed.success) return { ok: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos.' };

  const r = await cobrarHonorario(createAdminClient(), {
    contabilidadeId: ctx.id,
    userId: ctx.userId,
    honorarioId: parsed.data.honorarioId,
    vencimento: parsed.data.vencimento ?? null,
    // O escritório escolhe nova data na tela quando o vencimento já passou.
    vencidoVira: 'recusar',
  });
  if (!r.ok) {
    // Mesma forma de antes da extração: `linkFatura` só vem quando há fatura.
    return r.linkFatura !== undefined ? { ok: false, error: r.error, linkFatura: r.linkFatura } : { ok: false, error: r.error };
  }

  revalidatePath('/contador/honorarios');
  revalidatePath(`/contador/clientes/${r.clienteId}`);
  return { ok: true, linkFatura: r.linkFatura, ...(r.aviso ? { aviso: r.aviso } : {}) };
}
