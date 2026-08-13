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
      dataInicioAtividade: null,
    });
  });

  it('tolera ausência de secundários e descrição', () => {
    expect(mapBrasilApiCnpj({ cnae_fiscal: 4120400 })).toEqual({
      cnaePrincipal: { codigo: '4120400', descricao: null },
      cnaesSecundarios: [],
      dataInicioAtividade: null,
    });
  });

  it('null/sem cnae_fiscal → principal null', () => {
    expect(mapBrasilApiCnpj({})).toEqual({ cnaePrincipal: null, cnaesSecundarios: [], dataInicioAtividade: null });
    expect(mapBrasilApiCnpj(null)).toEqual({ cnaePrincipal: null, cnaesSecundarios: [], dataInicioAtividade: null });
  });

  it('ignora secundário código 0/ausente (BrasilAPI usa 0 quando não há)', () => {
    const raw = { cnae_fiscal: 4120400, cnaes_secundarios: [{ codigo: 0, descricao: '' }] };
    expect(mapBrasilApiCnpj(raw).cnaesSecundarios).toEqual([]);
  });
});

describe('data de início de atividade (0082)', () => {
  const data = (v: unknown) => mapBrasilApiCnpj({ data_inicio_atividade: v }).dataInicioAtividade;

  it('extrai a data que a resposta sempre trouxe e nós não líamos', () => {
    expect(data('2025-03-14')).toBe('2025-03-14');
  });

  it('recusa formato diferente em vez de tentar adivinhar', () => {
    // Data errada não some: vira RBT12 anualizado por um número de meses
    // errado, e daí alíquota errada. Melhor ficar sem o campo — o cálculo
    // já trata a ausência.
    expect(data('14/03/2025')).toBeNull();
    expect(data('2025-03-14T00:00:00Z')).toBeNull();
    expect(data(20250314)).toBeNull();
    expect(data(null)).toBeNull();
  });

  it('recusa data que não existe no calendário', () => {
    expect(data('2025-02-31')).toBeNull();
  });

  it('recusa abertura no futuro — é erro da fonte, não novidade', () => {
    expect(data('2099-01-01')).toBeNull();
  });
});
