import { describe, it, expect } from 'vitest';
import { competenciasEsperadasDoAno, derivarObrigacoes, ordenarFila } from './obrigacoes';

describe('competenciasEsperadasDoAno', () => {
  it('de janeiro até o último mês FECHADO (mês corrente - 1)', () => {
    const hoje = new Date('2026-06-08T12:00:00-03:00');
    expect(competenciasEsperadasDoAno(hoje)).toEqual([
      '202601', '202602', '202603', '202604', '202605',
    ]);
  });
  it('em janeiro não há mês fechado no ano → vazio', () => {
    const hoje = new Date('2026-01-10T12:00:00-03:00');
    expect(competenciasEsperadasDoAno(hoje)).toEqual([]);
  });
});

const HOJE = new Date('2026-06-08T12:00:00-03:00');
const ESPERADAS = ['202601', '202602', '202603', '202604', '202605'];

function rodar(over: {
  declaracoes?: Parameters<typeof derivarObrigacoes>[0]['declaracoes'];
  guias?: Parameters<typeof derivarObrigacoes>[0]['guias'];
  apuracoes?: Parameters<typeof derivarObrigacoes>[0]['apuracoes'];
} = {}) {
  return derivarObrigacoes({
    hoje: HOJE,
    competenciasEsperadas: ESPERADAS,
    declaracoes: over.declaracoes ?? [],
    guias: over.guias ?? [],
    apuracoes: over.apuracoes ?? [],
  });
}

function estadoDe(comp: string, lista: ReturnType<typeof derivarObrigacoes>) {
  return lista.find((o) => o.competencia === comp)?.estado;
}

describe('derivarObrigacoes — regra de estado', () => {
  it('esperada sem declaração → a_declarar (faz "maio" aparecer)', () => {
    const r = rodar();
    expect(estadoDe('202605', r)).toBe('a_declarar');
    expect(r).toHaveLength(5);
  });

  it('guia paga (status) → paga', () => {
    const r = rodar({
      declaracoes: [{ competencia: '202601', numeroDeclaracao: 'D1', dataTransmissao: '2026-02-23T00:00:00Z' }],
      guias: [{ competencia: '202601', numeroDas: 'X', valor: 100, vencimento: '2026-02-20', pagamento: null, status: 'paga', pdfUrl: null }],
    });
    expect(estadoDe('202601', r)).toBe('paga');
  });

  it('guia com data_pagamento (sem status paga) → paga', () => {
    const r = rodar({
      declaracoes: [{ competencia: '202602', numeroDeclaracao: 'D2', dataTransmissao: null }],
      guias: [{ competencia: '202602', numeroDas: 'X', valor: 100, vencimento: '2026-03-20', pagamento: '2026-03-20', status: 'gerada', pdfUrl: null }],
    });
    expect(estadoDe('202602', r)).toBe('paga');
  });

  it('declarada, não paga, vencimento < hoje → vencida', () => {
    const r = rodar({
      declaracoes: [{ competencia: '202604', numeroDeclaracao: 'D4', dataTransmissao: null }],
      guias: [{ competencia: '202604', numeroDas: 'X', valor: 100, vencimento: '2026-05-20', pagamento: null, status: 'gerada', pdfUrl: null }],
    });
    expect(estadoDe('202604', r)).toBe('vencida');
  });

  it('declarada, não paga, vencimento >= hoje → a_pagar', () => {
    const r = rodar({
      declaracoes: [{ competencia: '202605', numeroDeclaracao: 'D5', dataTransmissao: null }],
      guias: [{ competencia: '202605', numeroDas: 'X', valor: 100, vencimento: '2026-06-20', pagamento: null, status: 'gerada', pdfUrl: null }],
    });
    expect(estadoDe('202605', r)).toBe('a_pagar');
  });

  it('declarada, não paga, sem DAS materializado (sem vencimento) → a_pagar', () => {
    const r = rodar({
      declaracoes: [{ competencia: '202605', numeroDeclaracao: 'D5', dataTransmissao: null }],
    });
    expect(estadoDe('202605', r)).toBe('a_pagar');
  });

  it('estimativaLocal vem da apuração comitada', () => {
    const r = rodar({ apuracoes: [{ competencia: '202605', estimativa: 1910.5 }] });
    expect(r.find((o) => o.competencia === '202605')?.estimativaLocal).toBe(1910.5);
  });
});

describe('ordenarFila', () => {
  it('vencida → a_pagar → a_declarar; dentro do grupo por competência asc', () => {
    const r = rodar({
      declaracoes: [
        { competencia: '202604', numeroDeclaracao: 'D4', dataTransmissao: null },
        { competencia: '202603', numeroDeclaracao: 'D3', dataTransmissao: null },
      ],
      guias: [
        { competencia: '202604', numeroDas: 'X', valor: 1, vencimento: '2026-05-20', pagamento: null, status: 'gerada', pdfUrl: null },
        { competencia: '202603', numeroDas: 'Y', valor: 1, vencimento: '2026-06-20', pagamento: null, status: 'gerada', pdfUrl: null },
      ],
    });
    const fila = ordenarFila(r.filter((o) => o.estado !== 'paga'));
    expect(fila.map((o) => `${o.competencia}:${o.estado}`)).toEqual([
      '202604:vencida',
      '202603:a_pagar',
      '202601:a_declarar',
      '202602:a_declarar',
      '202605:a_declarar',
    ]);
  });
});
