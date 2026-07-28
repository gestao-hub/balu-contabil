// Bloco 4B — persistencia das cobrancas do escritorio.
//
// Espelha lib/billing/cobranca.ts do 4A, mas em tabela separada: aquilo e
// dinheiro da Balu, isto e dinheiro do escritorio, e a separacao vale no banco.
//
// PURO DE PROPOSITO — zero import, zero I/O, zero `server-only`. Tres lugares
// diferentes decidem o mesmo estado a partir do mesmo evento: o webhook
// (api/webhooks/asaas/route.ts), a reconciliacao diaria (lib/billing/cron.ts) e
// a tela. Se a regra "evento fora de ordem nao desfaz pagamento" morasse em
// qualquer um deles, os outros dois teriam a sua propria versao dela — e o
// Asaas REENTREGA e REORDENA eventos. Isso ja mordeu este projeto no 4A.

export type StatusCobranca = 'pendente' | 'paga' | 'vencida' | 'estornada';

// ┌─ VIVA x MORTA — a particao dos quatro status ──────────────────────────────┐
// │ "Este honorario ja tem cobranca?" NAO e a mesma pergunta que "ja existiu   │
// │ alguma cobranca deste honorario?". Estorno acontece por valor errado,      │
// │ dados errados ou acordo — e a divida continua existindo. Se qualquer       │
// │ cobranca passada bloqueasse, o honorario estornado ficaria impossivel de   │
// │ recobrar pela tela, para sempre (decisao do usuario, 28/07).               │
// │                                                                            │
// │ As duas listas moram AQUI, no modulo puro, porque duas coisas distantes    │
// │ precisam concordar sobre elas: a guarda de `cobrarHonorarioAction` e o     │
// │ indice unico parcial do banco. Divergirem significa a tela deixar passar   │
// │ o que o banco recusa — erro de Postgres na cara do contador.               │
// │                                                                            │
// │ Status novo no CHECK da tabela entra em UMA das duas listas (o teste de    │
// │ exaustividade morde quem esquecer). Se um dia existir 'cancelada', ela e   │
// │ MORTA: cobranca cancelada nao esta na mao de ninguem.                      │
// └────────────────────────────────────────────────────────────────────────────┘

/** Ainda pesa: ha boleto na mao do cliente, ou dinheiro que entrou por ele.
 *  `vencida` e VIVA de proposito — no Asaas o boleto vencido continua pagavel,
 *  entao emitir outra e mandar um segundo boleto da mesma divida. */
export const STATUS_VIVOS = ['pendente', 'paga', 'vencida'] as const satisfies readonly StatusCobranca[];

/** Nao pesa mais: o dinheiro voltou. Nao impede uma cobranca nova. */
export const STATUS_MORTOS = ['estornada'] as const satisfies readonly StatusCobranca[];

/**
 * A cobrança ainda pesa?
 *
 * Escrito como "não está entre os mortos", e não "está entre os vivos", para
 * que um status inesperado (linha antiga, CHECK afrouxado, escrita fora do app)
 * conte como VIVO: recusar uma emissão a mais é reparável com um clique;
 * emitir um segundo boleto real, não.
 */
export function cobrancaViva(status: string): boolean {
  return !(STATUS_MORTOS as readonly string[]).includes(status);
}

/** Os quatro valores acima sao exatamente o CHECK
 *  `cobrancas_escritorio_status_check` da migration 0053. */
const MAPA: Record<string, StatusCobranca> = {
  PENDING: 'pendente', AWAITING_RISK_ANALYSIS: 'pendente',
  RECEIVED: 'paga', CONFIRMED: 'paga', RECEIVED_IN_CASH: 'paga',
  OVERDUE: 'vencida',
  REFUNDED: 'estornada', REFUND_REQUESTED: 'estornada', CHARGEBACK_REQUESTED: 'estornada',
};

/** Status desconhecido vira `pendente` de propósito: inventar um estado a
 *  partir de string nova do Asaas seria pior que ficar no mais conservador —
 *  e `pendente` é o único dos quatro que não afirma nada sobre o dinheiro. */
export function statusDoAsaas(s: string): StatusCobranca {
  return MAPA[s] ?? 'pendente';
}

/**
 * O que gravar, ou `null` quando não há nada a mudar.
 *
 * O Asaas **reentrega** eventos e não garante ordem. Sem esta função, um
 * `OVERDUE` atrasado chegando depois do `RECEIVED` marcaria como vencida uma
 * cobrança já paga — e o cliente seria cobrado de novo por algo que pagou.
 */
export function aplicarEventoNaCobranca(
  atual: { status: string; pago_em: string | null },
  evento: { status: StatusCobranca; pagoEm: string | null },
): { status: StatusCobranca; pago_em: string | null } | null {
  // Reentrega exata do mesmo evento: nada a escrever, e nada a revalidar.
  if (atual.status === evento.status && (atual.pago_em ?? null) === (evento.pagoEm ?? null)) return null;

  // ESTORNO É TERMINAL. Esta linha é a simétrica da de baixo, e faltava.
  //
  // O evento que o Asaas mais reentrega é justamente `PAYMENT_RECEIVED`. Com a
  // cobrança já `estornada`, a reentrega dele encontrava só a guarda de baixo
  // (`atual.status === 'paga'`), não se aplicava, e a linha VOLTAVA A "paga":
  // o painel do escritório passava a afirmar que entrou dinheiro que já tinha
  // sido devolvido, e o honorário voltava a parecer quitado. É a mesma classe
  // de bug que esta função existe para impedir — só que no sentido inverso, e
  // por isso escapou: os testes cobriam apenas a direção paga → X.
  //
  // Nada sai de `estornada` por evento. Se um estorno for revertido de verdade
  // (chargeback ganho, por exemplo), o Asaas emite uma cobrança NOVA, com outro
  // `asaas_charge_id` — que vira outra linha. Ressuscitar esta seria inventar
  // um fato sobre o dinheiro a partir de um evento que só sabemos ter chegado
  // fora de ordem.
  if (atual.status === 'estornada') return null;

  // Estorno é o ÚNICO evento que pode desfazer um pagamento: é o próprio
  // Asaas dizendo que o dinheiro voltou.
  if (atual.status === 'paga' && evento.status !== 'estornada') return null;

  return { status: evento.status, pago_em: evento.status === 'paga' ? evento.pagoEm : null };
}
