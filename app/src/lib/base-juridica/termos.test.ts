import { describe, it, expect } from 'vitest';
import { termosDaPergunta } from './termos';

describe('termosDaPergunta', () => {
  it('puxa os termos do domínio fiscal da frase', () => {
    expect(termosDaPergunta('Preciso do DAS deste mês')).toContain('das');
  });

  it('prioriza termo do domínio sobre palavra comum', () => {
    const t = termosDaPergunta('gostaria de entender melhor a alíquota do simples');
    expect(t[0]).toBe('alíquota');
    expect(t).toContain('simples');
  });

  it('descarta saudação e frase sem conteúdo pesquisável', () => {
    // Buscar a base inteira por "oi" traria ruído e gastaria contexto do
    // modelo com texto irrelevante.
    expect(termosDaPergunta('oi')).toEqual([]);
    expect(termosDaPergunta('Bom dia!')).toEqual([]);
    expect(termosDaPergunta('obrigado')).toEqual([]);
  });

  it('ignora acento na comparação, mas devolve a palavra como veio', () => {
    expect(termosDaPergunta('qual a declaração anual?')).toContain('declaração');
  });

  it('não repete termo', () => {
    expect(termosDaPergunta('das, das e mais das')).toEqual(['das']);
  });

  it('limita a quantidade', () => {
    const t = termosDaPergunta('das mei dasn defis simples nacional pgdas inss iss icms', 4);
    expect(t).toHaveLength(4);
  });

  it('pergunta longa sem termo fiscal ainda extrai palavras significativas', () => {
    const t = termosDaPergunta('meu contador pediu documentos para regularizar pendências');
    expect(t.length).toBeGreaterThan(0);
    expect(t).not.toContain('meu');
    expect(t).not.toContain('para');
  });

  it('entrada vazia ou lixo não explode', () => {
    expect(termosDaPergunta('')).toEqual([]);
    expect(termosDaPergunta('??? !!!')).toEqual([]);
  });
});
