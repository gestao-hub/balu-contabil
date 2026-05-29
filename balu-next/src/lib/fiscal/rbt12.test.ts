import { describe, it, expect } from 'vitest';
import { calcularRbt12 } from './rbt12';
import type { ReceitaApuracao } from './apuracao-types';

const mk = (comp: string, valor: number): ReceitaApuracao => ({ competencia: comp, valor });

describe('calcularRbt12', () => {
  it('exclui a competência atual da janela (Bug 2)', () => {
    const receitas = [mk('202505', 1000), mk('202506', 9999)]; // 202506 = competência atual
    const { rbt12 } = calcularRbt12(receitas, '202506');
    expect(rbt12).toBe(1000); // 9999 da competência atual NÃO entra
  });
  it('janela = 12 meses anteriores, virando o ano', () => {
    const receitas = [
      mk('202412', 100), // entra (jan/2025 apura dez/2024..jan? não: 202501 apura 202401..202412)
      mk('202401', 50),  // entra
      mk('202312', 999), // fora (antes da janela)
    ];
    const { rbt12 } = calcularRbt12(receitas, '202501');
    expect(rbt12).toBe(150);
  });
  it('12 meses cheios não anualiza', () => {
    const receitas = Array.from({ length: 12 }, (_, i) =>
      mk(`2024${String(i + 1).padStart(2, '0')}`, 1000),
    );
    const r = calcularRbt12(receitas, '202501');
    expect(r.rbt12).toBe(12000);
    expect(r.anualizado).toBe(false);
  });
  it('< 12 meses de atividade anualiza proporcionalmente', () => {
    // início em 202411; competência 202501 → janela 202401..202412; meses ativos = nov+dez = 2
    const receitas = [mk('202411', 1000), mk('202412', 1000)];
    const r = calcularRbt12(receitas, '202501', '2024-11-15');
    expect(r.mesesConsiderados).toBe(2);
    expect(r.anualizado).toBe(true);
    expect(r.rbt12).toBe(12000); // 2000 * 12 / 2
  });
});
