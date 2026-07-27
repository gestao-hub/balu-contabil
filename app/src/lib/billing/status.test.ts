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

  // 'inadimplente' e um sinal OBSERVADO (webhook ou cron viram cobranca
  // vencida). Uma data gravada antes disso nao pode reabrir o acesso —
  // senao quem nao pagou passaria pela porta do trial.
  it('inadimplente bloqueia mesmo com data futura na linha', () => {
    expect(statusEfetivo({ status: 'inadimplente', trial_termina_em: '2027-01-01' }, '2026-07-27')).toBe('bloqueado');
  });

  it('cancelada bloqueia', () => {
    expect(statusEfetivo({ status: 'cancelada', trial_termina_em: null }, '2026-07-27')).toBe('bloqueado');
  });

  // Cancelar e ato deliberado: um vencimento futuro na linha nao pode
  // reabrir a conta por tras da decisao do titular.
  it('cancelada bloqueia MESMO com data futura', () => {
    expect(statusEfetivo({ status: 'cancelada', trial_termina_em: '2027-01-01' }, '2026-07-27')).toBe('bloqueado');
  });

  // DISCRIMINANTE: sem este caso, uma implementacao que ignorasse a data e
  // sempre liberasse 'trial' passaria em todos os testes de liberacao acima.
  it('trial vencido ha muito tempo continua bloqueado', () => {
    expect(statusEfetivo({ status: 'trial', trial_termina_em: '2020-01-01' }, '2026-07-27')).toBe('bloqueado');
  });

  // ── Liberação manual do admin (0051) ────────────────────────────────
  //
  // Existe para quem pagou por boleto e mandou o comprovante antes da
  // compensacao. Marcar 'ativa' na mao nao serviria: a reconciliacao veria
  // o boleto OVERDUE no vencimento e bloquearia de novo na madrugada.
  it('liberacao manual destrava inadimplente', () => {
    expect(statusEfetivo(
      { status: 'inadimplente', trial_termina_em: null, liberado_ate: '2026-08-05' },
      '2026-07-27',
    )).toBe('liberado');
  });

  it('liberacao manual vale ate o ULTIMO dia, inclusive', () => {
    const a = { status: 'inadimplente' as const, trial_termina_em: null, liberado_ate: '2026-07-27' };
    expect(statusEfetivo(a, '2026-07-27')).toBe('liberado');
    expect(statusEfetivo(a, '2026-07-28')).toBe('bloqueado');
  });

  // Nao pode virar acesso eterno por esquecimento.
  it('liberacao manual vencida nao vale mais', () => {
    expect(statusEfetivo(
      { status: 'inadimplente', trial_termina_em: null, liberado_ate: '2026-07-01' },
      '2026-07-27',
    )).toBe('bloqueado');
  });

  // DISCRIMINANTE: a liberacao so LIBERA. Uma implementacao que a usasse
  // como fonte unica bloquearia quem esta em dia e nao tem liberacao.
  it('sem liberacao manual, quem esta ativo continua liberado', () => {
    expect(statusEfetivo(
      { status: 'ativa', trial_termina_em: null, liberado_ate: null },
      '2026-07-27',
    )).toBe('liberado');
  });

  // O campo e opcional: todo chamador que nao o seleciona continua valendo.
  it('ausencia do campo nao muda nada', () => {
    expect(statusEfetivo({ status: 'inadimplente', trial_termina_em: null }, '2026-07-27')).toBe('bloqueado');
    expect(statusEfetivo({ status: 'ativa', trial_termina_em: null }, '2026-07-27')).toBe('liberado');
  });

  // Fronteira de ano: comparacao lexicografica de YYYY-MM-DD tem de ordenar
  // certo na virada, senao 2027-01-01 pareceria menor que 2026-12-31.
  it('trial que termina em 31/12 libera no dia e bloqueia em 01/01', () => {
    expect(statusEfetivo({ status: 'trial', trial_termina_em: '2026-12-31' }, '2026-12-31')).toBe('liberado');
    expect(statusEfetivo({ status: 'trial', trial_termina_em: '2026-12-31' }, '2027-01-01')).toBe('bloqueado');
  });
});
