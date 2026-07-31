import { describe, it, expect } from 'vitest';
import { palavrasChaveDaSituacao } from './palavras-chave';
import { situacaoDasMei, situacaoPgdas } from '@/lib/fiscal/situacao-fiscal';

describe('palavrasChaveDaSituacao', () => {
  it('das-mei inclui MEI e so os componentes desta situacao', () => {
    const p = palavrasChaveDaSituacao(situacaoDasMei('Prestacao de Servicos'));
    expect(p).toContain('MEI');
    expect(p).toContain('INSS');
    expect(p).toContain('ISS');
    expect(p).not.toContain('ICMS');
  });

  it('pgdas inclui o anexo e Fator R so quando se aplica', () => {
    const comFatorR = palavrasChaveDaSituacao(situacaoPgdas('Anexo III', true));
    expect(comFatorR).toContain('Anexo III');
    expect(comFatorR).toContain('Fator R');

    const semFatorR = palavrasChaveDaSituacao(situacaoPgdas('Anexo I', false));
    expect(semFatorR).not.toContain('Fator R');
  });

  it('sempre inclui Simples Nacional, o guarda-chuva comum as duas situacoes', () => {
    expect(palavrasChaveDaSituacao(situacaoDasMei('Comercio ou Industria'))).toContain('Simples Nacional');
    expect(palavrasChaveDaSituacao(situacaoPgdas('Anexo I', false))).toContain('Simples Nacional');
  });
});
