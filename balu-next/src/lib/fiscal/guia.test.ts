import { describe, it, expect } from 'vitest';
import {
  statusGuiaBadge,
  competenciaReferenciaBrt,
  competenciaLabel,
  brl,
  dataBR,
  isGuiaVencida,
} from './guia';

describe('statusGuiaBadge', () => {
  it('mapeia os 5 canônicos', () => {
    expect(statusGuiaBadge('paga').label).toBe('Paga');
    expect(statusGuiaBadge('gerada').label).toBe('Gerada');
    expect(statusGuiaBadge('pendente').label).toBe('Pendente');
    expect(statusGuiaBadge('vencida').label).toBe('Vencida');
    expect(statusGuiaBadge('erro').label).toBe('Erro');
  });
  it('case-insensitive', () => {
    expect(statusGuiaBadge('Paga').label).toBe('Paga');
    expect(statusGuiaBadge('PENDENTE').label).toBe('Pendente');
  });
  it('desconhecido → fallback com o string original', () => {
    expect(statusGuiaBadge('foo').label).toBe('foo');
    expect(statusGuiaBadge(null).label).toBe('—');
    expect(statusGuiaBadge(undefined).label).toBe('—');
  });
});

describe('competenciaReferenciaBrt', () => {
  it('15:30 UTC → 202605 (mesmo dia em BRT)', () => {
    expect(competenciaReferenciaBrt(new Date('2026-05-28T15:30:00Z'))).toBe('202605');
  });
  it('02:00 UTC vira mês anterior em BRT (virada de dia)', () => {
    // 01 de junho 02:00 UTC = 31 de maio 23:00 BRT
    expect(competenciaReferenciaBrt(new Date('2026-06-01T02:00:00Z'))).toBe('202605');
  });
});

describe('competenciaLabel', () => {
  it('formata YYYYMM', () => {
    expect(competenciaLabel('202605')).toBe('Maio/2026');
    expect(competenciaLabel('202401')).toBe('Janeiro/2024');
    expect(competenciaLabel('202612')).toBe('Dezembro/2026');
  });
  it('null/inválido → fallback', () => {
    expect(competenciaLabel(null)).toBe('—');
    expect(competenciaLabel('2026')).toBe('2026');
    expect(competenciaLabel('999999')).toBe('999999');
  });
});

describe('brl', () => {
  it('formata número', () => {
    expect(brl(1234.5)).toMatch(/R\$\s*1\.234,50/);
    expect(brl(0)).toMatch(/R\$\s*0,00/);
  });
  it('null/inválido → traço', () => {
    expect(brl(null)).toBe('—');
    expect(brl(undefined)).toBe('—');
    expect(brl(Number.NaN)).toBe('—');
  });
});

describe('dataBR', () => {
  it('formata ISO', () => {
    // 28-05-2026 15:00 UTC = 12:00 BRT = mesmo dia
    expect(dataBR('2026-05-28T15:00:00Z')).toBe('28/05/2026');
  });
  it('null → traço', () => {
    expect(dataBR(null)).toBe('—');
    expect(dataBR(undefined)).toBe('—');
  });
  it('string inválida → traço', () => {
    expect(dataBR('not-a-date')).toBe('—');
  });
});

describe('isGuiaVencida', () => {
  const NOW = new Date('2026-05-28T15:00:00Z');

  it('vencimento passado + não paga → vencida', () => {
    expect(isGuiaVencida('2026-05-20', 'pendente', NOW)).toBe(true);
    expect(isGuiaVencida('2026-05-20', 'gerada', NOW)).toBe(true);
  });
  it('vencimento futuro → não vencida', () => {
    expect(isGuiaVencida('2026-06-15', 'pendente', NOW)).toBe(false);
  });
  it('paga nunca vencida (mesmo passada)', () => {
    expect(isGuiaVencida('2026-01-01', 'paga', NOW)).toBe(false);
  });
  it('null/inválido → false', () => {
    expect(isGuiaVencida(null, 'pendente', NOW)).toBe(false);
    expect(isGuiaVencida('foo', 'pendente', NOW)).toBe(false);
  });
});
