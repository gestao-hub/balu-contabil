import { describe, it, expect } from 'vitest';
import { montarPromptAtendimento } from './prompt';

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

  it('com primeiraInteracao, instrui a saudar como Assistente Balu uma unica vez', () => {
    const p = montarPromptAtendimento({ pergunta: 'oi', situacaoFiscalTexto: null, primeiraInteracao: true });
    expect(p).toContain('Assistente Balu');
    expect(p.toLowerCase()).toMatch(/primeira mensagem/);
    expect(p.toLowerCase()).toMatch(/não repita/);
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
