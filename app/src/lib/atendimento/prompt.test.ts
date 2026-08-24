import { describe, it, expect } from 'vitest';
import { montarPromptAtendimento, garantirApresentacao, SAUDACAO_INICIAL, IDENTIDADE } from './prompt';

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

  it('com primeiraInteracao, PEDE a apresentacao adaptada ao que foi dito', () => {
    // Inverteu em 24/08/2026, no primeiro teste real com gente de verdade. De
    // 19/08 ate ali o prompt PROIBIA cumprimentar, porque o codigo colava uma
    // frase fixa por cima -- e quem escrevia "ola, como voce esta?" recebia o
    // cumprimento generico grudado numa resposta que ignorava a pergunta.
    const p = montarPromptAtendimento({ pergunta: 'oi', situacaoFiscalTexto: null, primeiraInteracao: true });
    expect(p.toLowerCase()).toMatch(/primeira mensagem/);
    expect(p).toContain(IDENTIDADE);
    expect(p).not.toMatch(/NÃO cumprimente/);
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

describe('apresentacao da primeira mensagem (24/08/2026)', () => {
  // O CONTRATO MUDOU. Ate 24/08 o codigo colava uma frase fixa antes de toda
  // primeira resposta. Isso deu certo em teste e errado na vida: quem escrevia
  // "ola, como voce esta? preciso de ajuda com MEI" recebia um cumprimento
  // generico grudado numa resposta que ignorava a pergunta social.
  //
  // Agora quem cumprimenta e o MODELO, e o codigo garante so o que nao pode
  // faltar: a IDENTIDADE. Estes testes prendem exatamente essa fronteira --
  // liberdade no tom, obrigacao no nome.
  it('resposta que JA se apresenta passa intocada', () => {
    const natural = 'Ola! Eu sou o Assistente da Balu Contabil, tudo bem por aqui. '
      + 'Sobre a abertura do MEI: o primeiro passo e ...';
    expect(garantirApresentacao(natural, true)).toBe(natural);
  });

  it('reconhece a apresentacao SEM acento e em qualquer caixa', () => {
    // A comparacao normaliza de proposito: exigir os acentos exatos faria a
    // rede disparar em cima de uma resposta boa, e o cliente receberia duas
    // aberturas na mesma mensagem.
    const semAcento = 'Ola, sou o assistente da balu contabil. Como posso ajudar?';
    expect(garantirApresentacao(semAcento, true)).toBe(semAcento);
  });

  it('resposta que NAO se apresenta recebe a frase de reserva na frente', () => {
    // A rede embaixo: instrucao em prompt e pedido, nao contrato.
    expect(garantirApresentacao('O MEI e o Microempreendedor Individual.', true))
      .toBe(SAUDACAO_INICIAL + '\n\nO MEI e o Microempreendedor Individual.');
  });

  it('fora da primeira mensagem, nunca acrescenta nada', () => {
    expect(garantirApresentacao('O limite e R$ 81.000.', false)).toBe('O limite e R$ 81.000.');
  });

  it('a frase de reserva contem a identidade que o codigo verifica', () => {
    // Se estas duas se desencontrarem, a reserva entra e a verificacao continua
    // falhando: toda primeira resposta sairia com DUAS aberturas.
    expect(SAUDACAO_INICIAL).toContain(IDENTIDADE);
  });

  it('a frase de reserva e a acordada com o usuario', () => {
    expect(SAUDACAO_INICIAL).toBe(
      'Ol\u00e1, eu sou o Assistente da Balu Cont\u00e1bil. Como posso te ajudar hoje?');
    // O registro INFORMAL e escolha do usuario: a versao anterior era formal
    // ("ajuda-lo"), e a troca faz parte do pedido -- nao e descuido a corrigir.
    expect(SAUDACAO_INICIAL).not.toContain('ajud\u00e1-lo');
  });
});

describe('o prompt PEDE a abertura, em vez de proibi-la', () => {
  const base = { pergunta: 'ola, como voce esta? preciso de ajuda com MEI',
    situacaoFiscalTexto: null, tipoPergunta: 'geral' as const };

  it('na primeira mensagem, manda se identificar e responder ao que foi dito', () => {
    const p = montarPromptAtendimento({ ...base, primeiraInteracao: true });
    expect(p).toContain(IDENTIDADE);
    expect(p).toMatch(/como voc\u00ea est\u00e1/i);   // reciprocidade: responder a pergunta social
    expect(p).toMatch(/pergunte como pode ajudar/i);    // e o caso do "ola" sozinho
    // A PROIBICAO ANTIGA NAO PODE VOLTAR: era ela que produzia a mensagem
    // engessada que o usuario reprovou no primeiro teste real.
    expect(p).not.toMatch(/N\u00c3O cumprimente/);
  });

  it('fora da primeira mensagem, nao fala de apresentacao nenhuma', () => {
    const p = montarPromptAtendimento({ ...base, primeiraInteracao: false });
    expect(p).not.toMatch(/PRIMEIRA MENSAGEM DESTA CONVERSA/);
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
