import { describe, it, expect } from 'vitest';
import { montarPromptAtendimento, comSaudacao, SAUDACAO_INICIAL } from './prompt';

describe('prompt de atendimento', () => {
  it('inclui a pergunta do cliente e a situacao fiscal, pede resposta estruturada', () => {
    const p = montarPromptAtendimento({
      pergunta: 'quanto eu pago esse mes?',
      situacaoFiscalTexto: 'Você paga R$ 75,90 de INSS e R$ 5,00 de ISS.',
    });
    expect(p).toContain('quanto eu pago esse mes?');
    expect(p).toContain('R$ 75,90');
    expect(p).toMatch(/resolvido/i);
  });

  // A GARANTIA DO 6A DE NOVO: o prompt so recebe o TEXTO ja calculado, nunca
  // um numero cru que a IA teria que decidir sozinha.
  it('sem situacao fiscal, instrui a nao inventar', () => {
    const p = montarPromptAtendimento({ pergunta: 'quanto eu pago?', situacaoFiscalTexto: null });
    expect(p).not.toContain('null');
    expect(p.toLowerCase()).toMatch(/não (sabe|tem informação|encontr)/);
  });

  it('sem primeiraInteracao, nao inclui saudacao', () => {
    const p = montarPromptAtendimento({ pergunta: 'oi', situacaoFiscalTexto: null });
    expect(p.toLowerCase()).not.toMatch(/primeira mensagem|saudação/);
  });

  it('com primeiraInteracao, avisa que a saudacao ja vem pronta e PROIBE cumprimentar', () => {
    // Mudou em 19/08/2026: a saudação virou texto fixo em código
    // (`SAUDACAO_INICIAL`), então o prompt deixou de PEDIR a apresentação e
    // passou a proibi-la — senão a mensagem chega com duas aberturas.
    const p = montarPromptAtendimento({ pergunta: 'oi', situacaoFiscalTexto: null, primeiraInteracao: true });
    expect(p.toLowerCase()).toMatch(/primeira mensagem/);
    expect(p).toMatch(/NÃO cumprimente/);
    expect(p).toMatch(/começe direto|comece direto/i);
  });

  it('instrui a admitir ser IA se perguntado diretamente', () => {
    const p = montarPromptAtendimento({ pergunta: 'oi', situacaoFiscalTexto: null });
    expect(p.toLowerCase()).toMatch(/inteligência artificial|assistente virtual/);
    expect(p.toLowerCase()).toMatch(/responda honestamente/);
  });

  // GARANTIA CENTRAL, MAIS FORTE AGORA: mesmo com a persona nova, a IA
  // continua proibida de citar lei/artigo/prazo/multa que nao esteja no
  // texto ja calculado — o documento original que inspirou o tom pedia o
  // oposto disso, e o usuario decidiu NAO adotar essa parte.
  it('mesmo com a persona nova, continua proibido citar lei/artigo/prazo/multa fora do texto', () => {
    const p = montarPromptAtendimento({
      pergunta: 'quanto eu pago?',
      situacaoFiscalTexto: 'Você paga R$ 75,90 de INSS.',
    }).toLowerCase();
    expect(p).toMatch(/nunca invente valor, data, norma, lei, artigo, prazo ou multa/);
  });

  it('e determinístico com e sem primeiraInteracao', () => {
    const s = { pergunta: 'oi', situacaoFiscalTexto: null as string | null };
    expect(montarPromptAtendimento(s)).toBe(montarPromptAtendimento(s));
    expect(montarPromptAtendimento({ ...s, primeiraInteracao: true }))
      .toBe(montarPromptAtendimento({ ...s, primeiraInteracao: true }));
  });
});

describe('assimetria de registro — entende informal, responde profissional', () => {
  const p = montarPromptAtendimento({ pergunta: 'qnt eh o mei', situacaoFiscalTexto: null, tipoPergunta: 'geral' });

  it('manda COMPREENDER giria, abreviacao e erro de digitacao', () => {
    expect(p).toMatch(/gíria/i);
    expect(p).toMatch(/qnt eh o mei/);          // exemplo real de entrada torta
    expect(p).toMatch(/sem pedir para reformular/i);
  });

  it('manda RESPONDER em portugues correto, sem giria', () => {
    // O pedido do usuario em 19/08/2026: a IA precisa ENTENDER o modo casual,
    // mas nunca responder nele. Sem esta metade, o modelo espelha o registro de
    // quem escreveu — foi o que o prompt anterior permitia ao autorizar
    // "expressoes do dia a dia".
    expect(p).toMatch(/NUNCA use gíria/);
    expect(p).toMatch(/nem imite o jeito de escrever de quem/i);
    expect(p).toMatch(/português correto/i);
  });

  it('nao volta a autorizar linguagem informal na saida', () => {
    expect(p).not.toMatch(/pode usar expressões do dia a dia/i);
    expect(p).not.toMatch(/como se fala no WhatsApp/i);
  });

  it('proibe o nao-atendimento', () => {
    expect(p).toMatch(/NUNCA responda apenas/);
    expect(p).toMatch(/ficar sem resposta/i);
  });
});

describe('saudacao inicial — texto fixo, definido pelo usuario', () => {
  it('e exatamente a frase acordada, ja com a ortografia corrigida', () => {
    expect(SAUDACAO_INICIAL).toBe(
      'Olá! Sou o Balu, assistente do sistema Balu Contábil. Diga-me como posso ajudá-lo hoje.');
    // Os quatro erros do texto original nao podem voltar.
    expect(SAUDACAO_INICIAL).toMatch(/^Olá!/);          // pontuacao apos a interjeicao
    expect(SAUDACAO_INICIAL).toContain('Balu, assistente');  // virgula do aposto
    expect(SAUDACAO_INICIAL).toContain('ajudá-lo');     // acento agudo
    expect(SAUDACAO_INICIAL).not.toMatch(/ajuda-lo|Balucontábil|me diga/i);
  });

  it('so aparece na PRIMEIRA mensagem da conversa', () => {
    expect(comSaudacao('O MEI é ...', true)).toBe(SAUDACAO_INICIAL + '\n\nO MEI é ...');
    expect(comSaudacao('O MEI é ...', false)).toBe('O MEI é ...');
  });

  it('nao duplica se o modelo desobedecer e ja cumprimentar', () => {
    const jaComSaudacao = SAUDACAO_INICIAL + '\n\nO ICMS é estadual.';
    expect(comSaudacao(jaComSaudacao, true)).toBe(jaComSaudacao);
  });

  it('o prompt PROIBE o modelo de cumprimentar por conta propria', () => {
    // Antes o prompt PEDIA a saudacao ao modelo, que devolvia uma parafrase
    // diferente a cada conversa. Agora quem cumprimenta e o codigo.
    const p = montarPromptAtendimento({
      pergunta: 'o que é MEI?', situacaoFiscalTexto: null, primeiraInteracao: true,
    });
    expect(p).toMatch(/NÃO cumprimente/);
    expect(p).not.toMatch(/comece com uma saudação/i);
  });
});

describe('modo escritorio — fecho proprio', () => {
  it('com carteira, NAO manda encaminhar para o contador', () => {
    // O smoke de 19/08/2026 pegou isto em producao: com a carteira inteira no
    // prompt, o modelo respondia "nao localizamos informacoes, vou encaminhar
    // para o contador" — para o proprio contador. O fecho de 'especifica'
    // vencia o dado que estava logo acima.
    const p = montarPromptAtendimento({
      pergunta: 'quantos clientes estao irregulares?',
      situacaoFiscalTexto: null,
      tipoPergunta: 'especifica',
      carteiraTexto: '2 cliente(s) na carteira: 1 em dia, 0 em atencao, 1 irregular(es).',
    });

    expect(p).toContain('2 cliente(s) na carteira');
    expect(p).toMatch(/NÃO diga que vai encaminhar/);
  });

  it('sem carteira, o fecho de sempre continua valendo', () => {
    const p = montarPromptAtendimento({
      pergunta: 'quanto é o meu DAS?', situacaoFiscalTexto: null, tipoPergunta: 'especifica',
    });
    expect(p).toMatch(/encaminhar para o contador/i);
  });
});
