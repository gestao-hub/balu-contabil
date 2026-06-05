import { describe, it, expect } from 'vitest';
import { somarFolha12, type FolhaMensal } from './folha';

const f = (competencia: string, proLabore: number, salarios = 0, encargos = 0): FolhaMensal => ({
  competencia, proLabore, salarios, encargos,
});

describe('somarFolha12', () => {
  it('soma os 12 meses anteriores e exclui a própria competência', () => {
    const folhas = [
      f('202505', 1000),  // dentro da janela (mês anterior a 202506)
      f('202406', 2000),  // limite inferior (12 meses antes)
      f('202405', 9999),  // fora (13 meses antes)
      f('202506', 5000),  // a própria competência — excluída
    ];
    const r = somarFolha12(folhas, '202506');
    expect(r.folha12m).toBe(3000); // 1000 + 2000
    expect(r.meses).toBe(2);
  });

  it('soma os três componentes do mês', () => {
    const r = somarFolha12([f('202505', 1000, 500, 200)], '202506');
    expect(r.folha12m).toBe(1700);
    expect(r.meses).toBe(1);
  });

  it('retorna zero quando não há folha na janela', () => {
    const r = somarFolha12([], '202506');
    expect(r.folha12m).toBe(0);
    expect(r.meses).toBe(0);
  });

  it('não conta meses com soma zero em "meses"', () => {
    const r = somarFolha12([f('202505', 0, 0, 0), f('202504', 100)], '202506');
    expect(r.folha12m).toBe(100);
    expect(r.meses).toBe(1);
  });
});
