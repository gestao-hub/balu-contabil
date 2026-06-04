import { describe, it, expect } from 'vitest';
import { mapCnae } from './cnae-catalog';

describe('mapCnae', () => {
  it('mapeia o shape do catálogo Focus (/v2/codigos_cnae)', () => {
    const raw = {
      codigo: '8599603',
      codigo_formatado: '8599-6/03',
      descricao: 'Treinamento em informática',
      secao: 'P',
      descricao_secao: 'Educação',
      grupo: '859',
    };
    expect(mapCnae(raw)).toEqual({
      codigo: '8599603',
      codigoFormatado: '8599-6/03',
      descricao: 'Treinamento em informática',
      secao: 'P',
      descricaoSecao: 'Educação',
    });
  });

  it('coage codigo numérico para string', () => {
    expect(mapCnae({ codigo: 8599603 })?.codigo).toBe('8599603');
  });

  it('null/sem codigo → null', () => {
    expect(mapCnae(null)).toBeNull();
    expect(mapCnae({})).toBeNull();
    expect(mapCnae({ descricao: 'x' })).toBeNull();
  });

  it('remove markup HTML da descrição (resultados de busca)', () => {
    const raw = { codigo: '1830003', descricao: '<html>Reprodução de <i>software</i> em qualquer suporte</html>' };
    expect(mapCnae(raw)?.descricao).toBe('Reprodução de software em qualquer suporte');
  });

  it('campos ausentes viram null (não undefined)', () => {
    expect(mapCnae({ codigo: '4120400' })).toEqual({
      codigo: '4120400',
      codigoFormatado: null,
      descricao: null,
      secao: null,
      descricaoSecao: null,
    });
  });
});
