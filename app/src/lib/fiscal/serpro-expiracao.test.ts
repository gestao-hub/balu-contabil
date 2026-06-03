import { describe, it, expect } from 'vitest';
import { proximaMeiaNoiteSaoPaulo } from './serpro-expiracao';

describe('proximaMeiaNoiteSaoPaulo', () => {
  it('gerado 00:05 SP → expira ~24h depois (00:00 SP do dia seguinte)', () => {
    // 2026-06-03T03:05:00Z == 00:05 em SP (UTC-3) no dia 03
    const exp = proximaMeiaNoiteSaoPaulo(new Date('2026-06-03T03:05:00Z'));
    expect(exp).toBe('2026-06-04T03:00:00.000Z'); // 00:00 SP do dia 04
  });

  it('gerado 23:00 SP → expira ~1h depois (mesma virada de dia)', () => {
    // 2026-06-04T02:00:00Z == 23:00 em SP no dia 03
    const exp = proximaMeiaNoiteSaoPaulo(new Date('2026-06-04T02:00:00Z'));
    expect(exp).toBe('2026-06-04T03:00:00.000Z'); // 00:00 SP do dia 04
  });

  it('vira o mês corretamente', () => {
    // 2026-06-30T12:00:00Z == 09:00 SP do dia 30/06
    const exp = proximaMeiaNoiteSaoPaulo(new Date('2026-06-30T12:00:00Z'));
    expect(exp).toBe('2026-07-01T03:00:00.000Z'); // 00:00 SP do dia 01/07
  });
});
