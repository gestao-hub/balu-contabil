import { describe, it, expect } from 'vitest';
import {
  resumoPlataforma, usoPorEscritorio,
  type CobrancaPlataforma, type AssinaturaLinha, type PlanoLinha,
} from './metricas';

const HOJE = '2026-08-12';
const planos: PlanoLinha[] = [
  { id: 'starter', valor_centavos: 9900, ciclo: 'MONTHLY' },
  { id: 'pro', valor_centavos: 29900, ciclo: 'MONTHLY' },
];

describe('resumoPlataforma — receita', () => {
  it('MRR conta só assinatura ativa; trial e cancelada ficam de fora', () => {
    // Trial é promessa, não receita. Somar trial no MRR é a maneira mais comum
    // de um painel de SaaS mentir para o dono.
    const assinaturas: AssinaturaLinha[] = [
      { contabilidade_id: 'c1', company_id: null, plano_id: 'pro', status: 'ativa' },
      { contabilidade_id: 'c2', company_id: null, plano_id: 'pro', status: 'trial' },
      { contabilidade_id: 'c3', company_id: null, plano_id: 'starter', status: 'cancelada' },
      { contabilidade_id: 'c4', company_id: null, plano_id: 'starter', status: 'ativa' },
    ];
    const r = resumoPlataforma([], assinaturas, planos, HOJE);
    expect(r.mrrCentavos).toBe(29900 + 9900);
    expect(r.assinaturasPorStatus).toEqual({ ativa: 2, trial: 1, cancelada: 1 });
  });

  it('recebido no mês soma só o que foi pago DENTRO do mês corrente', () => {
    const cobrancas: CobrancaPlataforma[] = [
      { valor_centavos: 10000, status: 'paga', vencimento: '2026-08-05', pago_em: '2026-08-05' },
      { valor_centavos: 20000, status: 'paga', vencimento: '2026-07-05', pago_em: '2026-07-06' },
    ];
    expect(resumoPlataforma(cobrancas, [], planos, HOJE).recebidoNoMesCentavos).toBe(10000);
  });

  it('cobrança "confirmada" não conta como recebida', () => {
    // No Asaas, CONFIRMED é "confirmada, ainda não liquidada" — não é dinheiro
    // na conta.
    const cobrancas: CobrancaPlataforma[] = [
      { valor_centavos: 50000, status: 'confirmada', vencimento: '2026-08-01', pago_em: null },
    ];
    const r = resumoPlataforma(cobrancas, [], planos, HOJE);
    expect(r.recebidoNoMesCentavos).toBe(0);
    // e, por já ter vencido sem pagamento, entra como inadimplente
    expect(r.inadimplenteCentavos).toBe(50000);
  });
});

describe('resumoPlataforma — inadimplência', () => {
  it('inadimplente é o que venceu e não foi pago, não o que está "pendente"', () => {
    const cobrancas: CobrancaPlataforma[] = [
      { valor_centavos: 10000, status: 'pendente', vencimento: '2026-08-01', pago_em: null }, // venceu
      { valor_centavos: 30000, status: 'pendente', vencimento: '2026-08-25', pago_em: null }, // a vencer
      { valor_centavos: 20000, status: 'paga', vencimento: '2026-08-02', pago_em: '2026-08-03' },
    ];
    const r = resumoPlataforma(cobrancas, [], planos, HOJE);
    expect(r.inadimplenteCentavos).toBe(10000);
    expect(r.inadimplenteQtd).toBe(1);
    expect(r.aVencerNoMesCentavos).toBe(30000);
  });

  it('taxa é sobre o que já venceu, não sobre o faturamento total', () => {
    // Dividir pelo total faria a taxa despencar só porque há muita cobrança
    // futura em aberto — e o painel diria "1% de inadimplência" com metade do
    // vencido sem pagar.
    const cobrancas: CobrancaPlataforma[] = [
      { valor_centavos: 10000, status: 'pendente', vencimento: '2026-08-01', pago_em: null },
      { valor_centavos: 10000, status: 'paga', vencimento: '2026-08-01', pago_em: '2026-08-01' },
      { valor_centavos: 900000, status: 'pendente', vencimento: '2026-12-01', pago_em: null },
    ];
    expect(resumoPlataforma(cobrancas, [], planos, HOJE).taxaInadimplencia).toBeCloseTo(0.5, 5);
  });

  it('sem nada vencido, a taxa é 0 e não NaN', () => {
    const r = resumoPlataforma([], [], planos, HOJE);
    expect(r.taxaInadimplencia).toBe(0);
  });

  it('cobrança vencida hoje ainda não é inadimplente', () => {
    const cobrancas: CobrancaPlataforma[] = [
      { valor_centavos: 10000, status: 'pendente', vencimento: HOJE, pago_em: null },
    ];
    expect(resumoPlataforma(cobrancas, [], planos, HOJE).inadimplenteCentavos).toBe(0);
  });

  it('valor vindo como string (numeric do Postgres) é somado, não concatenado', () => {
    const cobrancas: CobrancaPlataforma[] = [
      { valor_centavos: '10000', status: 'pendente', vencimento: '2026-08-01', pago_em: null },
      { valor_centavos: '5000', status: 'pendente', vencimento: '2026-08-01', pago_em: null },
    ];
    expect(resumoPlataforma(cobrancas, [], planos, HOJE).inadimplenteCentavos).toBe(15000);
  });
});

describe('usoPorEscritorio', () => {
  const escritorios = [
    { id: 'e1', nome: 'Alfa', status: 'aprovada' },
    { id: 'e2', nome: 'Beta', status: 'aprovada' },
    { id: 'e3', nome: 'Gama', status: 'pendente' },
  ];

  it('conta clientes ativos por escritório e ignora empresa arquivada', () => {
    const empresas = [
      { id: 'a', contabilidade_id: 'e1', deleted_at: null },
      { id: 'b', contabilidade_id: 'e1', deleted_at: null },
      { id: 'c', contabilidade_id: 'e1', deleted_at: '2026-01-01' },
      { id: 'd', contabilidade_id: 'e2', deleted_at: null },
      { id: 'e', contabilidade_id: null, deleted_at: null },   // self-service
    ];
    const r = usoPorEscritorio(escritorios, empresas, [], [], [], [], HOJE);
    expect(r.map((x) => [x.nome, x.clientes])).toEqual([['Alfa', 2], ['Beta', 1], ['Gama', 0]]);
  });

  it('escritório sem cliente nenhum APARECE na lista', () => {
    // É justamente o caso que interessa ao dono da plataforma: cadastrou e não
    // usou. Filtrar por clientes > 0 esconderia isso.
    const r = usoPorEscritorio(escritorios, [], [], [], [], [], HOJE);
    expect(r).toHaveLength(3);
    expect(r.every((x) => x.clientes === 0)).toBe(true);
  });

  it('separa o que o escritório recebeu do que está em aberto', () => {
    const cobrancas = [
      { contabilidade_id: 'e1', valor_centavos: 50000, status: 'paga', pago_em: '2026-08-01' },
      { contabilidade_id: 'e1', valor_centavos: 30000, status: 'pendente', pago_em: null },
      { contabilidade_id: 'e2', valor_centavos: 10000, status: 'vencida', pago_em: null },
    ];
    const r = usoPorEscritorio(escritorios, [], [], cobrancas, [], [], HOJE);
    const alfa = r.find((x) => x.nome === 'Alfa');
    expect(alfa).toMatchObject({ recebidoCentavos: 50000, emAbertoCentavos: 30000 });
    expect(r.find((x) => x.nome === 'Beta')).toMatchObject({ recebidoCentavos: 0, emAbertoCentavos: 10000 });
  });

  it('traz plano e status da assinatura do escritório', () => {
    const assinaturas: AssinaturaLinha[] = [
      { contabilidade_id: 'e2', company_id: null, plano_id: 'pro', status: 'ativa' },
    ];
    const r = usoPorEscritorio(escritorios, [], [], [], assinaturas, planos, HOJE);
    expect(r.find((x) => x.nome === 'Beta')).toMatchObject({ plano: 'pro', assinaturaStatus: 'ativa' });
    expect(r.find((x) => x.nome === 'Alfa')).toMatchObject({ plano: null, assinaturaStatus: null });
  });

  it('ordena por carteira e desempata por nome', () => {
    const empresas = [
      { id: 'a', contabilidade_id: 'e2', deleted_at: null },
      { id: 'b', contabilidade_id: 'e2', deleted_at: null },
    ];
    const r = usoPorEscritorio(escritorios, empresas, [], [], [], [], HOJE);
    expect(r.map((x) => x.nome)).toEqual(['Beta', 'Alfa', 'Gama']);
  });
});
