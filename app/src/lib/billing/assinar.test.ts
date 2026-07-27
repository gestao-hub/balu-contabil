import { describe, it, expect } from 'vitest';
import { primeiroVencimento, DIAS_ATE_PRIMEIRO_VENCIMENTO } from './assinar';
import { statusEfetivo } from './status';

describe('primeiroVencimento', () => {
  it('soma os dias como data civil', () => {
    expect(primeiroVencimento('2026-07-27', 3)).toBe('2026-07-30');
  });

  it('atravessa a virada de mes', () => {
    expect(primeiroVencimento('2026-07-30', 3)).toBe('2026-08-02');
  });

  it('atravessa a virada de ano', () => {
    expect(primeiroVencimento('2026-12-30', 3)).toBe('2027-01-02');
  });

  it('atravessa 29 de fevereiro em ano bissexto', () => {
    expect(primeiroVencimento('2028-02-27', 3)).toBe('2028-03-01');
  });

  it('usa 3 dias por padrao', () => {
    expect(primeiroVencimento('2026-07-27')).toBe('2026-07-30');
    expect(DIAS_ATE_PRIMEIRO_VENCIMENTO).toBe(3);
  });
});

// A regra que o bug expos: contratar com o teste JA VENCIDO nao pode
// deixar o titular bloqueado esperando o boleto compensar. `assinar.ts`
// empurra trial_termina_em para o primeiro vencimento; estes casos fixam a
// consequencia no gate.
describe('acesso entre contratar e o primeiro pagamento', () => {
  it('teste vencido + contratou hoje = LIBERADO ate o vencimento', () => {
    const venc = primeiroVencimento('2026-07-27');           // 2026-07-30
    expect(statusEfetivo({ status: 'trial', trial_termina_em: venc }, '2026-07-27')).toBe('liberado');
    expect(statusEfetivo({ status: 'trial', trial_termina_em: venc }, '2026-07-30')).toBe('liberado');
  });

  it('passou do vencimento sem pagar e sem webhook = BLOQUEADO sozinho', () => {
    const venc = primeiroVencimento('2026-07-27');
    expect(statusEfetivo({ status: 'trial', trial_termina_em: venc }, '2026-07-31')).toBe('bloqueado');
  });

  // DISCRIMINANTE: sem este caso, uma implementacao que simplesmente
  // liberasse tudo apos contratar passaria nos dois acima.
  it('inadimplente declarado pelo webhook bloqueia mesmo dentro da janela', () => {
    const venc = primeiroVencimento('2026-07-27');
    expect(statusEfetivo({ status: 'inadimplente', trial_termina_em: venc }, '2026-07-28'))
      .toBe('bloqueado');
  });
});
