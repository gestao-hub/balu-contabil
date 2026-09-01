import { describe, it, expect } from 'vitest';
import { primeiroDiaMesISO, ultimoDiaMesISO } from './mes-vigente';

/**
 * O teste que faltava. O anterior (`notas-filtros.test.ts`) comparava o helper
 * com uma reimplementação da MESMA conta — então concordava com o defeito.
 *
 * Aqui o instante é fixo e a resposta é conhecida, e é isso que torna o teste
 * capaz de discordar do código.
 */
describe('mes-vigente — sempre o calendário de Brasília', () => {
  // 04:00Z = 01:00 BRT do dia 1º. O mês é SETEMBRO nos dois lados do app.
  const MADRUGADA_DO_DIA_1 = new Date('2026-09-01T04:00:00Z');

  it('01:00 BRT do dia 1º já é o mês novo', () => {
    expect(primeiroDiaMesISO(MADRUGADA_DO_DIA_1)).toBe('2026-09-01');
    expect(ultimoDiaMesISO(MADRUGADA_DO_DIA_1)).toBe('2026-09-30');
  });

  // A borda do outro lado: 02:00Z do dia 1º ainda é 23:00 BRT do dia 31.
  it('23:00 BRT do último dia ainda é o mês velho', () => {
    const d = new Date('2026-09-01T02:00:00Z');
    expect(primeiroDiaMesISO(d)).toBe('2026-08-01');
    expect(ultimoDiaMesISO(d)).toBe('2026-08-31');
  });

  it('fevereiro bissexto e não bissexto', () => {
    expect(ultimoDiaMesISO(new Date('2028-02-10T15:00:00Z'))).toBe('2028-02-29');
    expect(ultimoDiaMesISO(new Date('2026-02-10T15:00:00Z'))).toBe('2026-02-28');
  });

  it('dezembro não vira janeiro do ano seguinte', () => {
    expect(ultimoDiaMesISO(new Date('2026-12-15T15:00:00Z'))).toBe('2026-12-31');
    expect(primeiroDiaMesISO(new Date('2026-12-15T15:00:00Z'))).toBe('2026-12-01');
  });
});
