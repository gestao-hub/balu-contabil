import { describe, it, expect } from 'vitest';
import { mapBrasilApiCnpj } from './brasilapi';

describe('mapBrasilApiCnpj', () => {
  it('extrai principal + secundários (código string + descrição)', () => {
    const raw = {
      cnae_fiscal: 4299501,
      cnae_fiscal_descricao: 'Construção de instalações esportivas e recreativas',
      cnaes_secundarios: [
        { codigo: 4322301, descricao: 'Instalações hidráulicas, sanitárias e de gás' },
        { codigo: 4120400, descricao: 'Construção de edifícios' },
      ],
    };
    expect(mapBrasilApiCnpj(raw)).toEqual({
      cnaePrincipal: { codigo: '4299501', descricao: 'Construção de instalações esportivas e recreativas' },
      cnaesSecundarios: [
        { codigo: '4322301', descricao: 'Instalações hidráulicas, sanitárias e de gás' },
        { codigo: '4120400', descricao: 'Construção de edifícios' },
      ],
    });
  });

  it('tolera ausência de secundários e descrição', () => {
    expect(mapBrasilApiCnpj({ cnae_fiscal: 4120400 })).toEqual({
      cnaePrincipal: { codigo: '4120400', descricao: null },
      cnaesSecundarios: [],
    });
  });

  it('null/sem cnae_fiscal → principal null', () => {
    expect(mapBrasilApiCnpj({})).toEqual({ cnaePrincipal: null, cnaesSecundarios: [] });
    expect(mapBrasilApiCnpj(null)).toEqual({ cnaePrincipal: null, cnaesSecundarios: [] });
  });

  it('ignora secundário código 0/ausente (BrasilAPI usa 0 quando não há)', () => {
    const raw = { cnae_fiscal: 4120400, cnaes_secundarios: [{ codigo: 0, descricao: '' }] };
    expect(mapBrasilApiCnpj(raw).cnaesSecundarios).toEqual([]);
  });
});
