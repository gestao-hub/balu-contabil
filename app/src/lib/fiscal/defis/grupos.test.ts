// src/lib/fiscal/defis/grupos.test.ts
import { describe, it, expect } from 'vitest';
import { GRUPOS_DEFIS, camposPlanos, contarPreenchidos } from './grupos';

describe('GRUPOS_DEFIS', () => {
  // Guarda contra alguém remover um grupo: sem isto, o bloco some da tela em
  // silêncio e a declaração fica incompleta sem ninguém perceber.
  it('tem os seis grupos do art. 72', () => {
    expect(GRUPOS_DEFIS.map((g) => g.id)).toEqual([
      'identificacao', 'empregados', 'receitas', 'despesas', 'aquisicoes', 'socios',
    ]);
  });

  it('só o grupo de sócios é repetível', () => {
    expect(GRUPOS_DEFIS.filter((g) => g.repetivel).map((g) => g.id)).toEqual(['socios']);
  });

  it('não tem chave de campo duplicada', () => {
    const chaves = GRUPOS_DEFIS.flatMap((g) => g.campos.map((c) => `${g.id}.${c.chave}`));
    expect(new Set(chaves).size).toBe(chaves.length);
  });

  it('usa camelCase em toda chave', () => {
    for (const g of GRUPOS_DEFIS) {
      for (const c of g.campos) expect(c.chave).toMatch(/^[a-z][a-zA-Z0-9]*$/);
    }
  });
});

describe('camposPlanos', () => {
  it('lista os campos não repetíveis', () => {
    const chaves = camposPlanos().map((c) => c.chave);
    expect(chaves).toContain('receitaBrutaTotal');
    expect(chaves).toContain('estoqueFinal');
    expect(chaves).not.toContain('proLabore'); // é do grupo repetível
  });
});

describe('contarPreenchidos', () => {
  it('conta campos com valor, ignorando vazio e nulo', () => {
    const r = contarPreenchidos({ receitaBrutaTotal: 1000, totalDespesas: 0, estoqueInicial: null, eventoTipo: '' });
    expect(r.preenchidos).toBe(2); // 1000 e 0 contam; null e '' não
    expect(r.total).toBe(camposPlanos().length);
  });
});
