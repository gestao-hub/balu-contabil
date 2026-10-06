import { describe, it, expect } from 'vitest';
import {
  pedeAtendimentoHumano, escolherEscritorio, textoEscolhaEscritorio, textoEncaminhado,
} from './encaminhar';

describe('pedeAtendimentoHumano', () => {
  // As mensagens REAIS do teste de 06/10/2026, que ficaram sem encaminhamento.
  it.each([
    'Quero falar com atendente',
    'Falar com o contador',
    'Direcione para atendimento humano',
    'Passe para o escritório demo',
    'Quero falar com escrito passe para eles',
    'me passa pra contabilidade',
    'preciso falar com alguém do escritório',
    'quero falar com uma pessoa',
  ])('pedido: %s', (t) => expect(pedeAtendimentoHumano(t)).toBe(true));

  it.each([
    'o contador falou que o DAS vence dia 20',
    'o que o contador faz?',
    'quanto é o DAS do MEI',
    'quero abrir um MEI',
    'Ok',
    '',
  ])('não é pedido: %s', (t) => expect(pedeAtendimentoHumano(t)).toBe(false));
});

describe('escolherEscritorio', () => {
  const opcoes = [
    { id: 'a', nome: 'Escritório Demo — Apresentação' },
    { id: 'b', nome: 'Escritório Teste Balu' },
    { id: 'c', nome: 'Silva Contabilidade' },
  ];

  it('pelo número da lista', () => {
    expect(escolherEscritorio('2', opcoes)).toBe('b');
    expect(escolherEscritorio('opção 3', opcoes)).toBe('c');
    expect(escolherEscritorio('9', opcoes)).toBeNull();
  });

  it('pelo nome, inteiro ou parte', () => {
    expect(escolherEscritorio('demo', opcoes)).toBe('a');
    expect(escolherEscritorio('Escritório Teste', opcoes)).toBe('b');
    expect(escolherEscritorio('silva', opcoes)).toBe('c');
  });

  it('ambíguo ou sem relação devolve null', () => {
    expect(escolherEscritorio('escritório', opcoes)).toBeNull();
    expect(escolherEscritorio('qualquer um', opcoes)).toBeNull();
    expect(escolherEscritorio('', opcoes)).toBeNull();
  });
});

describe('textos', () => {
  it('lista numerada', () => {
    const t = textoEscolhaEscritorio([{ id: 'a', nome: 'X' }, { id: 'b', nome: 'Y' }]);
    expect(t).toContain('1. X');
    expect(t).toContain('2. Y');
  });
  it('confirmação com prazo', () => {
    expect(textoEncaminhado('X', 4)).toContain('em até 4 horas');
    expect(textoEncaminhado('X', null)).toContain('assim que possível');
  });
});
