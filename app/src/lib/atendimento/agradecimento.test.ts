import { describe, it, expect } from 'vitest';
import { ehAgradecimento, MINUTOS_ATE_ENCERRAR, TEXTO_ENCERRAMENTO } from './agradecimento';

describe('ehAgradecimento', () => {
  it('reconhece o agradecimento sozinho', () => {
    for (const t of [
      'obrigado', 'Obrigada', 'OBRIGADO!', 'obg', 'vlw', 'valeu', 'Grato',
      'muito obrigado', 'Muito obrigada!!', 'agradeço', 'brigado', 'tks',
    ]) expect(ehAgradecimento(t), t).toBe(true);
  });

  it('reconhece o agradecimento com o recheio que costuma vir colado', () => {
    for (const t of [
      'Ok obrigado',              // o caso real, achado em producao 25/08
      'ok, obrigado!',
      'blz, valeu',
      'muito obrigado, ajudou demais',
      'obrigado pela ajuda',
      'obrigada pela atenção',
      'perfeito, obrigado',
      'entendi, obrigado',
      'era isso mesmo, obrigado',
      'obrigado, até mais',
      'valeu, tchau',
      'obrigado por enquanto',
    ]) expect(ehAgradecimento(t), t).toBe(true);
  });

  it('NAO e agradecimento quando sobra assunto — encerrar ali deixaria a pessoa falando sozinha', () => {
    for (const t of [
      'obrigado, mas ainda tenho uma dúvida',
      'obrigado! e sobre o DAS?',
      'valeu, agora me explica o Simples',
      'obrigado, quanto custa',
      'obrigado pela resposta anterior sobre o MEI, mas preciso de outra coisa agora',
    ]) expect(ehAgradecimento(t), t).toBe(false);
  });

  it('NAO e agradecimento sem agradecimento — "ok" e recebido, nao despedida', () => {
    // Sem esta metade, "ok" e "entendi" armariam o encerramento de uma conversa
    // que a pessoa so pausou para ler.
    for (const t of [
      'ok', 'blz', 'certo', 'entendi', 'perfeito', 'ta bom', 'show',
      'até mais', 'tchau', 'sim', '',
    ]) expect(ehAgradecimento(t), t).toBe(false);
  });

  it('mensagem longa nao e despedida, mesmo comecando com obrigado', () => {
    expect(ehAgradecimento(
      'obrigado ' + 'muito '.repeat(20),
    )).toBe(false);
  });

  it('as constantes do encerramento estao onde se espera', () => {
    expect(MINUTOS_ATE_ENCERRAR).toBe(5);
    expect(TEXTO_ENCERRAMENTO).toContain('disposição');
  });
});
