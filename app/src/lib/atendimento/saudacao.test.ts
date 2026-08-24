// `ehSoCumprimento` decide quem recebe a apresentação em vez de silêncio.
//
// Os dois lados custam caro e por isso os dois estão presos aqui:
//   - falso NEGATIVO: número de empresa que recebe "olá" e fica mudo parece
//     número errado — foi o que o usuário viu em 24/08;
//   - falso POSITIVO: tratar "olá, preciso abrir um MEI" como cumprimento faz
//     o assistente cumprimentar e IGNORAR a pergunta.
import { describe, it, expect } from 'vitest';
import { ehSoCumprimento } from './saudacao';

describe('ehSoCumprimento — é só cumprimento', () => {
  for (const t of [
    'Olá', 'ola', 'OI', 'oi!', 'Opa', 'e aí', 'Salve',
    'Bom dia', 'boa tarde!', 'Boa noite', 'bom dia!!',
    'Oi, tudo bem?', 'olá, tudo bem', 'Oi, bom dia', 'ola tudo bom?',
    'Oi, como você está?', 'olá, como vai?', 'oi por favor',
  ]) {
    it(`aceita ${JSON.stringify(t)}`, () => expect(ehSoCumprimento(t)).toBe(true));
  }
});

describe('ehSoCumprimento — NÃO é só cumprimento', () => {
  for (const t of [
    // O caso que o usuário deu: cumprimento + pergunta continua sendo pergunta.
    'olá, como você está? preciso de uma ajuda com abertura de mei',
    'Oi, quero abrir um MEI',
    'bom dia, qual o valor do DAS?',
    'preciso de ajuda',
    'obrigado pela ajuda de ontem, deu tudo certo com a nota',
    '', '   ',
  ]) {
    it(`recusa ${JSON.stringify(t)}`, () => expect(ehSoCumprimento(t)).toBe(false));
  }
});
