import { describe, it, expect } from 'vitest';
import { classificarPergunta, pareceUmaPergunta, temMarcaPessoal, TERMO_FISCAL } from './classificar';

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

describe('vocabulario fiscal — termos soltos que o WhatsApp recebe', () => {
  // 19/08/2026: "regime tributário" caía em `especifica` e o número não
  // cadastrado recebia "não conseguimos identificar sua conta" no lugar da
  // resposta. `\btributo\b` não casa com "tributário" — a lista é que estava
  // curta, não a régua errada.
  it.each([
    'regime tributário',
    'IPI',
    'o que é IPI?',
    'simples nacional',
    'como funciona o Simples Nacional',
    'ICMS',
    'faturamento',
    'microempreendedor',
  ])('%j é dúvida geral', (texto) => {
    expect(classificarPergunta(texto)).toBe('geral');
  });

  it('sigla curta nao casa dentro de palavra comum', () => {
    // Sem `\b`, "iss" casaria em "isso" e "compromisso", e conversa fiada
    // viraria dúvida fiscal — o assistente voltaria a falar com quem não
    // perguntou nada (o incidente de 12/08/2026).
    expect(TERMO_FISCAL.test('isso mesmo, combinado')).toBe(false);
    expect(TERMO_FISCAL.test('temos um compromisso amanhã')).toBe(false);
    expect(TERMO_FISCAL.test('paguei o ISS ontem')).toBe(true);
  });
});

describe('pareceUmaPergunta — a regua do ramo sem cadastro', () => {
  it('a mensagem REAL que ficou sem resposta em 19/08/2026', () => {
    // Vocabulario tinha `imposto` no singular e o reconhecimento de termo
    // solto para em 40 caracteres: a pergunta caiu no silencio.
    const real = 'quais os impostos que o governo cobra quando abro uma empresa?';
    expect(pareceUmaPergunta(real)).toBe(true);
    expect(temMarcaPessoal(real)).toBe(false);
    expect(TERMO_FISCAL.test(real)).toBe(true);   // plural agora casa
  });

  it.each([
    'o que é MEI?',
    'quais os impostos que o governo cobra',
    'quanto custa abrir uma empresa',
    'como funciona o icms',
    'porque preciso emitir nota',
  ])('%j é pergunta', (t) => expect(pareceUmaPergunta(t)).toBe(true));

  it.each([
    'Ta bom entao 👍',
    'pode ficar so escurtando',
    'entra aqui pf https://meet.google.com/mym-she',
    'to no ponto',
  ])('%j NAO é pergunta', (t) => expect(pareceUmaPergunta(t)).toBe(false));

  it('verbo no inicio nao vira pergunta', () => {
    // "pode ficar so escurtando" é conversa entre duas pessoas. Aceitar verbo
    // no inicio traria de volta o incidente de 12/08/2026, em que o assistente
    // respondeu a quem nunca perguntou nada.
    expect(pareceUmaPergunta('pode ficar so escurtando')).toBe(false);
    expect(pareceUmaPergunta('pode me explicar o que é MEI?')).toBe(true);  // com "?" vale
  });
});

describe('temMarcaPessoal — quem merece "nao identificamos sua conta"', () => {
  it.each(['quanto é o meu DAS?', 'minha empresa está regular?', 'quanto eu pago de imposto?'])(
    '%j fala da empresa de quem escreve', (t) => expect(temMarcaPessoal(t)).toBe(true));

  it.each(['o que é MEI?', 'como funciona o ICMS', 'quais os impostos que o governo cobra'])(
    '%j é conhecimento geral', (t) => expect(temMarcaPessoal(t)).toBe(false));
});
