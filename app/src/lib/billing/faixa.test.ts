import { describe, it, expect } from 'vitest';
import { planoPorQtdClientes, type PlanoFaixa } from './faixa';

const PLANOS: PlanoFaixa[] = [
  { id: 'ate_50',   clientes_min: 0,   clientes_max: 50,   ativo: true },
  { id: 'f51_200',  clientes_min: 51,  clientes_max: 200,  ativo: true },
  { id: 'f201_up',  clientes_min: 201, clientes_max: null, ativo: true },
];

describe('planoPorQtdClientes', () => {
  it('zero cliente cai na primeira faixa', () => {
    expect(planoPorQtdClientes(0, PLANOS)).toEqual({ ok: true, planoId: 'ate_50' });
  });

  it('borda inferior da faixa', () => {
    expect(planoPorQtdClientes(51, PLANOS)).toEqual({ ok: true, planoId: 'f51_200' });
  });

  it('borda superior da faixa', () => {
    expect(planoPorQtdClientes(50, PLANOS)).toEqual({ ok: true, planoId: 'ate_50' });
  });

  it('faixa aberta no topo aceita qualquer quantidade', () => {
    expect(planoPorQtdClientes(99999, PLANOS)).toEqual({ ok: true, planoId: 'f201_up' });
  });

  it('ignora plano inativo e cai na faixa seguinte que sirva', () => {
    const comInativo: PlanoFaixa[] = [
      { id: 'ate_50', clientes_min: 0, clientes_max: 50, ativo: false },
      { id: 'tudo',   clientes_min: 0, clientes_max: null, ativo: true },
    ];
    expect(planoPorQtdClientes(10, comInativo)).toEqual({ ok: true, planoId: 'tudo' });
  });

  // O admin edita faixas em runtime (/admin/assinaturas), entao o buraco
  // passou a ser possivel. Sem este caso a funcao devolveria undefined
  // silencioso e o cron gravaria plano_id null sem ninguem perceber.
  it('buraco entre faixas devolve erro nomeado, nao undefined', () => {
    const comBuraco: PlanoFaixa[] = [
      { id: 'a', clientes_min: 0,   clientes_max: 10,   ativo: true },
      { id: 'b', clientes_min: 100, clientes_max: null, ativo: true },
    ];
    expect(planoPorQtdClientes(50, comBuraco)).toEqual({ ok: false, motivo: 'sem_faixa' });
  });

  it('lista vazia devolve erro nomeado', () => {
    expect(planoPorQtdClientes(10, [])).toEqual({ ok: false, motivo: 'sem_faixa' });
  });

  it('quantidade negativa e entrada invalida', () => {
    expect(planoPorQtdClientes(-1, PLANOS)).toEqual({ ok: false, motivo: 'qtd_invalida' });
  });

  it('quantidade nao inteira e entrada invalida', () => {
    expect(planoPorQtdClientes(1.5, PLANOS)).toEqual({ ok: false, motivo: 'qtd_invalida' });
  });
});
