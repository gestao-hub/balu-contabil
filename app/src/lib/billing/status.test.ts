import { describe, it, expect } from 'vitest';
import { statusEfetivo } from './status';

describe('statusEfetivo', () => {
  it('cortesia sempre libera, mesmo sem trial nem plano', () => {
    expect(statusEfetivo({ status: 'cortesia', trial_termina_em: null }, '2026-07-27')).toBe('liberado');
  });

  it('ativa libera', () => {
    expect(statusEfetivo({ status: 'ativa', trial_termina_em: null }, '2026-07-27')).toBe('liberado');
  });

  it('trial libera no ULTIMO dia (inclusive)', () => {
    expect(statusEfetivo({ status: 'trial', trial_termina_em: '2026-07-27' }, '2026-07-27')).toBe('liberado');
  });

  it('trial bloqueia no dia seguinte ao fim, sem depender de cron', () => {
    expect(statusEfetivo({ status: 'trial', trial_termina_em: '2026-07-26' }, '2026-07-27')).toBe('bloqueado');
  });

  it('trial sem data de fim bloqueia — estado incoerente nao pode liberar', () => {
    expect(statusEfetivo({ status: 'trial', trial_termina_em: null }, '2026-07-27')).toBe('bloqueado');
  });

  it('inadimplente bloqueia', () => {
    expect(statusEfetivo({ status: 'inadimplente', trial_termina_em: null }, '2026-07-27')).toBe('bloqueado');
  });

  it('cancelada bloqueia', () => {
    expect(statusEfetivo({ status: 'cancelada', trial_termina_em: null }, '2026-07-27')).toBe('bloqueado');
  });

  // DISCRIMINANTE: sem este caso, uma implementacao que ignorasse a data e
  // sempre liberasse 'trial' passaria em todos os testes de liberacao acima.
  it('trial vencido ha muito tempo continua bloqueado', () => {
    expect(statusEfetivo({ status: 'trial', trial_termina_em: '2020-01-01' }, '2026-07-27')).toBe('bloqueado');
  });

  // Fronteira de ano: comparacao lexicografica de YYYY-MM-DD tem de ordenar
  // certo na virada, senao 2027-01-01 pareceria menor que 2026-12-31.
  it('trial que termina em 31/12 libera no dia e bloqueia em 01/01', () => {
    expect(statusEfetivo({ status: 'trial', trial_termina_em: '2026-12-31' }, '2026-12-31')).toBe('liberado');
    expect(statusEfetivo({ status: 'trial', trial_termina_em: '2026-12-31' }, '2027-01-01')).toBe('bloqueado');
  });
});
