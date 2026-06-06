import { describe, it, expect } from 'vitest';
import { parseDasnSimei } from './serpro-dasn-simei-parse';

// FIXTURE MODELADA PELA DOC (DASN-SIMEI não está no Trial — 101507; ver investigação).
// Confirmar nomes de campos contra envelope REAL no 1º e-CNPJ MEI.
const envelope = (decl: Record<string, unknown>, mensagens = [{ codigo: '[Sucesso-DASNSIMEI]', texto: 'ok' }]) => ({
  status: '200',
  mensagens,
  dados: JSON.stringify([decl]),
});

const base = {
  cnpjCompleto: '00000000000100',
  anoCalendario: '2021',
  nomeEmpresarial: 'EXEMPLO MEI',
  ocupacaoProfissional: 'Cabeleireiro(a)',
  idDeclaracao: '00000000202100001',
  dataTransmissao: '20220215103000',
  codigoTipoDeclaracao: 1,
};

describe('parseDasnSimei', () => {
  it('extrai número, data (ISO), tipo, nome; sem excesso/MAED → flags false', () => {
    const r = parseDasnSimei(envelope(base));
    expect(r.numeroDeclaracao).toBe('00000000202100001');
    expect(r.dataTransmissao).toBe('2022-02-15T10:30:00');
    expect(r.tipoDeclaracao).toBe(1);
    expect(r.nomeEmpresarial).toBe('EXEMPLO MEI');
    expect(r.temExcesso).toBe(false);
    expect(r.temMaed).toBe(false);
    expect(r.desenquadramento).toBe(false);
  });

  it('retificadora → tipoDeclaracao 2', () => {
    expect(parseDasnSimei(envelope({ ...base, codigoTipoDeclaracao: 2 })).tipoDeclaracao).toBe(2);
  });

  it('multaAtrasoEntrega presente → temMaed true', () => {
    expect(parseDasnSimei(envelope({ ...base, multaAtrasoEntrega: { algumPdf: 'x' } })).temMaed).toBe(true);
  });

  it('excessoReceitaBruta presente → temExcesso true', () => {
    expect(parseDasnSimei(envelope({ ...base, excessoReceitaBruta: { valor: 1000 } })).temExcesso).toBe(true);
  });

  it('aviso 10008 nas mensagens → desenquadramento true', () => {
    const env = envelope(base, [{ codigo: 'Aviso-DASNSIMEI-10008', texto: 'receita acima do limite' }]);
    const r = parseDasnSimei(env);
    expect(r.desenquadramento).toBe(true);
    expect(r.mensagens).toContain('Aviso-DASNSIMEI-10008: receita acima do limite');
  });

  it('aceita `dados` já como objeto (não-string)', () => {
    const env = { status: '200', mensagens: [], dados: [base] };
    expect(parseDasnSimei(env).numeroDeclaracao).toBe('00000000202100001');
  });

  it('lança quando `dados` é string inválida', () => {
    expect(() => parseDasnSimei({ dados: '{nao-json' })).toThrow(/formato inválido/);
  });
});
