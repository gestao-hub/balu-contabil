import { describe, it, expect } from 'vitest';
import {
  aplicarEventoNaCobranca, statusDoAsaas, cobrancaViva, STATUS_VIVOS, STATUS_MORTOS,
} from './cobranca-escritorio';

describe('statusDoAsaas', () => {
  it.each([
    ['PENDING', 'pendente'], ['RECEIVED', 'paga'], ['CONFIRMED', 'paga'],
    ['OVERDUE', 'vencida'], ['REFUNDED', 'estornada'],
  ])('%s vira %s', (asaas, esperado) => {
    expect(statusDoAsaas(asaas)).toBe(esperado);
  });

  it('status desconhecido nao inventa: fica pendente', () => {
    expect(statusDoAsaas('COISA_NOVA')).toBe('pendente');
  });

  // Os quatro valores que saem daqui sao exatamente os do CHECK
  // `cobrancas_escritorio_status_check` da 0053: um quinto valor viraria erro
  // de Postgres no webhook, longe de quem poderia entender.
  it('so emite os quatro status que o banco aceita', () => {
    const emitidos = new Set(
      ['PENDING', 'AWAITING_RISK_ANALYSIS', 'RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH',
        'OVERDUE', 'REFUNDED', 'REFUND_REQUESTED', 'CHARGEBACK_REQUESTED', 'QUALQUER_COISA']
        .map(statusDoAsaas),
    );
    expect([...emitidos].sort()).toEqual(['estornada', 'paga', 'pendente', 'vencida']);
  });
});

describe('aplicarEventoNaCobranca', () => {
  const paga = { status: 'paga', pago_em: '2026-07-20' };

  // A mesma regra de nao-regressao do 4A: o Asaas REENTREGA eventos, e um
  // 'vencida' que chega depois do 'paga' nao pode desfazer o pagamento.
  it('evento fora de ordem nao desfaz um pagamento', () => {
    expect(aplicarEventoNaCobranca(paga, { status: 'vencida', pagoEm: null })).toBeNull();
  });

  it('pendente reentregue depois do pagamento tambem nao desfaz', () => {
    expect(aplicarEventoNaCobranca(paga, { status: 'pendente', pagoEm: null })).toBeNull();
  });

  it('pagamento sobrescreve pendente', () => {
    const r = aplicarEventoNaCobranca({ status: 'pendente', pago_em: null }, { status: 'paga', pagoEm: '2026-07-20' });
    expect(r).toEqual({ status: 'paga', pago_em: '2026-07-20' });
  });

  it('pagamento sobrescreve vencida — quem venceu e pagou depois esta pago', () => {
    const r = aplicarEventoNaCobranca({ status: 'vencida', pago_em: null }, { status: 'paga', pagoEm: '2026-07-25' });
    expect(r).toEqual({ status: 'paga', pago_em: '2026-07-25' });
  });

  it('estorno DESFAZ o pagamento — e o unico que pode', () => {
    const r = aplicarEventoNaCobranca(paga, { status: 'estornada', pagoEm: null });
    expect(r).toEqual({ status: 'estornada', pago_em: null });
  });

  it('reentrega do mesmo evento nao gera atualizacao', () => {
    expect(aplicarEventoNaCobranca(paga, { status: 'paga', pagoEm: '2026-07-20' })).toBeNull();
  });

  // `pago_em` so existe quando ha pagamento. Um evento nao-pago que chegasse
  // com data deixaria a linha dizendo "vencida, paga em 20/07".
  it('status nao-pago nunca carrega pago_em, mesmo se o evento trouxer data', () => {
    const r = aplicarEventoNaCobranca({ status: 'pendente', pago_em: null }, { status: 'vencida', pagoEm: '2026-07-20' });
    expect(r).toEqual({ status: 'vencida', pago_em: null });
  });

  // Fixar o comportamento, que nao e obvio: uma cobranca JA PAGA e imutavel
  // para tudo que nao seja estorno — inclusive para uma segunda confirmacao com
  // outra data. Quando o Asaas reentrega RECEIVED e depois CONFIRMED, as datas
  // costumam diferir, e ficar reescrevendo `pago_em` so gera escrita e
  // revalidacao a toa sobre um fato que ja esta decidido.
  it('segunda confirmacao com data diferente NAO reescreve o pagamento', () => {
    expect(aplicarEventoNaCobranca(paga, { status: 'paga', pagoEm: '2026-07-21' })).toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // A DIRECAO QUE FALTAVA: estornada → X.
  //
  // Os testes acima cobriam so paga → X. O buraco simetrico era real: com a
  // cobranca estornada, o `PAYMENT_RECEIVED` reentregue (o evento que o Asaas
  // mais reentrega) caia direto no `return` final e a linha voltava a "paga" —
  // o painel afirmando que entrou dinheiro que ja tinha sido devolvido.
  // ─────────────────────────────────────────────────────────────────────────
  const estornada = { status: 'estornada', pago_em: null };

  it('PAYMENT_RECEIVED reentregue NAO ressuscita uma cobranca estornada', () => {
    expect(aplicarEventoNaCobranca(estornada, { status: 'paga', pagoEm: '2026-07-26' })).toBeNull();
  });

  it.each([
    ['pendente', null],
    ['vencida', null],
    ['paga', '2026-07-26'],
  ] as const)('evento %s reentregue nao reabre uma cobranca estornada', (status, pagoEm) => {
    expect(aplicarEventoNaCobranca(estornada, { status, pagoEm })).toBeNull();
  });

  // O caso perverso: o estorno chegou ANTES do pagamento que ele estorna (o
  // Asaas nao garante ordem). Mesmo assim o dinheiro voltou — o estorno e o
  // fato mais recente que se conhece, e o RECEIVED atrasado nao o desfaz.
  it('estorno que chegou antes do pagamento continua valendo', () => {
    expect(
      aplicarEventoNaCobranca({ status: 'estornada', pago_em: '2026-07-20' }, { status: 'paga', pagoEm: '2026-07-20' }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// VIVA x MORTA — a particao que a guarda de recobranca e o banco compartilham
// ---------------------------------------------------------------------------
describe('cobrancaViva', () => {
  it('pendente, paga e vencida ainda pesam', () => {
    for (const s of STATUS_VIVOS) expect(cobrancaViva(s)).toBe(true);
  });

  it('estornada nao pesa — e o que libera o honorario para nova cobranca', () => {
    for (const s of STATUS_MORTOS) expect(cobrancaViva(s)).toBe(false);
  });

  // Sem esta prova, um status novo no CHECK da 0053 ficaria fora das duas
  // listas e ninguem notaria: a guarda passaria a decidir por acidente.
  it('as duas listas cobrem, sem sobra, os quatro status do CHECK da 0053', () => {
    const todos = [...STATUS_VIVOS, ...STATUS_MORTOS].sort();
    expect(todos).toEqual(['estornada', 'paga', 'pendente', 'vencida']);
    expect(new Set(todos).size).toBe(todos.length);
  });

  // Escrito como "nao esta entre os mortos" de proposito: recusar uma emissao
  // a mais custa um clique; emitir um segundo boleto real custa a relacao do
  // escritorio com o cliente dele.
  it('status inesperado conta como VIVO — o lado seguro do erro', () => {
    expect(cobrancaViva('coisa_nova')).toBe(true);
  });
});
