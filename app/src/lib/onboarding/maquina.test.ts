import { describe, it, expect } from 'vitest';
import { proximoPasso, acumular, pediuRecomecar, type EstadoOnboarding } from './maquina';

const vazio: EstadoOnboarding = { intencao: 'indefinido', campos: {} };

describe('proximoPasso', () => {
  it('sem intenção, pergunta quem é a pessoa', () => {
    expect(proximoPasso(vazio)).toMatchObject({ tipo: 'perguntar', campo: 'intencao' });
  });

  it('empresa existente sem CNPJ pede o CNPJ', () => {
    expect(proximoPasso({ intencao: 'empresa_existente', campos: {} }))
      .toMatchObject({ tipo: 'perguntar', campo: 'cnpj' });
  });

  it('empresa existente com CNPJ conclui para o painel da empresa', () => {
    expect(proximoPasso({ intencao: 'empresa_existente', campos: { cnpj: '11222333000181' } }))
      .toEqual({ tipo: 'concluir', destino: 'empresa' });
  });

  it('contador pede CRC antes do CNPJ', () => {
    // O CRC é o que o admin usa para aprovar o escritório (DL 9.295/46); pedir
    // primeiro evita o cadastro chegar pela metade na fila de aprovação.
    expect(proximoPasso({ intencao: 'contador', campos: { cnpj: '11222333000181' } }))
      .toMatchObject({ tipo: 'perguntar', campo: 'crc' });
  });

  it('contador completo conclui para o escritório', () => {
    expect(proximoPasso({ intencao: 'contador', campos: { crc: '123456', crcUf: 'SP', cnpj: '11222333000181' } }))
      .toEqual({ tipo: 'concluir', destino: 'escritorio' });
  });

  it('abertura conclui na hora, entregando ao wizard', () => {
    // Abertura são ~49 campos e 8 documentos: isso é wizard, não chat. O
    // assistente identifica e encaminha — que é o que o cliente pediu.
    expect(proximoPasso({ intencao: 'abertura', campos: {} }))
      .toEqual({ tipo: 'concluir', destino: 'abertura' });
  });

  it('uma pergunta por vez, mesmo faltando dois campos', () => {
    const p = proximoPasso({ intencao: 'contador', campos: {} });
    expect(p).toMatchObject({ tipo: 'perguntar', campo: 'crc' });
  });
});

describe('acumular', () => {
  it('guarda o que veio e fixa a intenção', () => {
    const e = acumular(vazio, { cnpj: '11222333000181' }, 'empresa_existente');
    expect(e).toEqual({ intencao: 'empresa_existente', campos: { cnpj: '11222333000181', email: undefined, telefone: undefined, crc: undefined, crcUf: undefined } });
  });

  it('NÃO sobrescreve campo já preenchido', () => {
    // "o CNPJ do meu contador é ..." não pode trocar o CNPJ da empresa que já
    // foi informado antes.
    const antes: EstadoOnboarding = { intencao: 'empresa_existente', campos: { cnpj: '11222333000181' } };
    const depois = acumular(antes, { cnpj: '11444777000161' }, 'empresa_existente');
    expect(depois.campos.cnpj).toBe('11222333000181');
  });

  it('não deixa a intenção mudar depois de definida', () => {
    const antes: EstadoOnboarding = { intencao: 'contador', campos: {} };
    expect(acumular(antes, {}, 'empresa_existente').intencao).toBe('contador');
  });
});

describe('pediuRecomecar', () => {
  it('reconhece pedidos de correção', () => {
    expect(pediuRecomecar('errei o cnpj')).toBe(true);
    expect(pediuRecomecar('não é isso')).toBe(true);
    expect(pediuRecomecar('quero recomeçar')).toBe(true);
  });

  it('não confunde conversa normal', () => {
    expect(pediuRecomecar('meu cnpj é 11.222.333/0001-81')).toBe(false);
  });
});
