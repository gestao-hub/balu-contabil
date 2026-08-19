import { describe, it, expect } from 'vitest';
import { lerRespostaAtendimento } from './resposta';

describe('lerRespostaAtendimento — o caso que aconteceu de verdade', () => {
  it('aceita a chave com erro de digitação do modelo ("resovido")', () => {
    // 12/08/2026, modelo gratuito: resposta perfeita, chave sem o "l". A
    // validação estrita jogou fora e o cliente recebeu "não consegui
    // responder agora".
    const bruto = '{"resposta":"O seu DAS de agosto é R$ 76,90 e vence em 20/08.","resovido":true}';
    expect(lerRespostaAtendimento(bruto)).toEqual({
      resposta: 'O seu DAS de agosto é R$ 76,90 e vence em 20/08.',
      resolvido: true,
    });
  });

  it('aceita cerca markdown em volta do JSON', () => {
    const bruto = '```json\n{"resposta":"Tudo certo por aqui.","resolvido":true}\n```';
    expect(lerRespostaAtendimento(bruto)?.resolvido).toBe(true);
  });

  it('aceita sinônimos em inglês', () => {
    expect(lerRespostaAtendimento('{"answer":"ok assim","resolved":true}'))
      .toEqual({ resposta: 'ok assim', resolvido: true });
  });

  it('booleano em texto conta como booleano', () => {
    expect(lerRespostaAtendimento('{"resposta":"pronto","resolvido":"true"}')?.resolvido).toBe(true);
  });
});

describe('lerRespostaAtendimento — o que NÃO se adivinha', () => {
  it('sem texto de resposta, devolve null', () => {
    // O conteúdo é obrigatório: mandar uma bolha vazia ao cliente é pior que
    // mandar o texto de fallback.
    expect(lerRespostaAtendimento('{"resolvido":true}')).toBeNull();
    expect(lerRespostaAtendimento('{"resposta":"   ","resolvido":true}')).toBeNull();
  });

  it('faltando o sinal, resolve para FALSE — o lado seguro', () => {
    // O cliente recebe a resposta E o contador é acionado. Assumir `true`
    // fecharia um atendimento que ninguém garantiu.
    expect(lerRespostaAtendimento('{"resposta":"Acho que é isso."}'))
      .toEqual({ resposta: 'Acho que é isso.', resolvido: false });
  });

  it('valor estranho no sinal também cai no lado seguro', () => {
    expect(lerRespostaAtendimento('{"resposta":"x","resolvido":"talvez"}')?.resolvido).toBe(false);
    expect(lerRespostaAtendimento('{"resposta":"x","resolvido":1}')?.resolvido).toBe(false);
  });

  it('prosa em vez de JSON É ENTREGUE ao cliente (mudou em 19/08/2026)', () => {
    // Antes devolvia null, e o cliente recebia "não consegui responder agora"
    // com a explicação CERTA no lixo — só porque o modelo esqueceu as chaves.
    // O que não se adivinha é o CONTEÚDO; a embalagem, sim.
    const r = lerRespostaAtendimento('Claro! Seu DAS vence dia 20.');
    expect(r?.resposta).toBe('Claro! Seu DAS vence dia 20.');
    // `resolvido:false` de propósito: sem o sinal explícito do modelo, o
    // atendimento continua acionando o contador quando existe um.
    expect(r?.resolvido).toBe(false);
  });

  it('string JSON pura tambem e entregue', () => {
    expect(lerRespostaAtendimento('"O ICMS é um imposto estadual."')?.resposta)
      .toBe('O ICMS é um imposto estadual.');
  });

  it('JSON truncado ainda entrega a resposta que der para resgatar', () => {
    // Resposta cortada no meio (teto de tokens) não pode virar silêncio.
    const r = lerRespostaAtendimento('{"resposta":"O MEI paga o DAS todo mês","reso');
    expect(r?.resposta).toBe('O MEI paga o DAS todo mês');
  });

  it('array ou nulo devolve null', () => {
    expect(lerRespostaAtendimento('[]')).toBeNull();
    expect(lerRespostaAtendimento('null')).toBeNull();
  });

  it('não confunde chave distante com "resolvido"', () => {
    // "resolucao" não é erro de digitação de "resolvido" — se fosse aceito,
    // qualquer campo parecido viraria decisão de fechar atendimento.
    const r = lerRespostaAtendimento('{"resposta":"x","resolucao":true}');
    expect(r?.resolvido).toBe(false);
  });
});
