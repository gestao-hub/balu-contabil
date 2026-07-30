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
});
