import { describe, it, expect } from 'vitest';
import { classificarPergunta } from './classificar';

describe('classificarPergunta — dúvida geral (a base jurídica responde)', () => {
  it.each([
    'como funciona o DAS?',
    'o que é IOF',
    'o que significa IPI?',
    'para que serve o CNAE',
    'qual a diferença entre MEI e Simples Nacional?',
    'quem precisa declarar o DASN?',
    'quando vence o DAS todo mês?',
    'é obrigatório emitir nota fiscal?',
    'o que acontece se atrasar o imposto',
    'me explica o fator R',
  ])('%s → geral', (p) => {
    expect(classificarPergunta(p)).toBe('geral');
  });

  it('termo fiscal solto também é geral — é assim que se pergunta no WhatsApp', () => {
    expect(classificarPergunta('IPI')).toBe('geral');
    expect(classificarPergunta('limite do MEI?')).toBe('geral');
  });
});

describe('classificarPergunta — sobre a empresa (precisa dos dados)', () => {
  it.each([
    'quanto é o meu DAS?',
    'minha guia já venceu?',
    'meu CNPJ está regular',
    'quanto eu pago de imposto',
    'estou devendo alguma coisa?',
    'preciso do das da minha empresa',
    'me manda o meu boleto',
  ])('%s → especifica', (p) => {
    expect(classificarPergunta(p)).toBe('especifica');
  });

  it('possessivo vence a forma conceitual', () => {
    // "como funciona" está lá, mas a resposta útil depende do dado dele.
    expect(classificarPergunta('como funciona o meu DAS?')).toBe('especifica');
  });
});

describe('classificarPergunta — o lado seguro', () => {
  it('frase vazia ou sem pista vira especifica', () => {
    // Errar para "geral" faria o assistente responder sobre a empresa de
    // alguém com informação genérica. Errar para "especifica" só gera um
    // encaminhamento a mais.
    expect(classificarPergunta('')).toBe('especifica');
    expect(classificarPergunta('bom dia, tudo bem?')).toBe('especifica');
    expect(classificarPergunta('preciso de ajuda com uma coisa complicada aqui do escritório'))
      .toBe('especifica');
  });
});
