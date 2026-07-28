import { describe, it, expect } from 'vitest';
import { rotuloStatus, corStatus, estaEmAberto, podePagar, totalEmAberto } from './cobranca-escritorio-vm';

// Os quatro do CHECK `cobrancas_escritorio_status_check` (migration 0053).
const STATUS = ['pendente', 'paga', 'vencida', 'estornada'] as const;

describe('rotuloStatus / corStatus', () => {
  it('rotula os quatro status do banco sem cair no fallback', () => {
    expect(STATUS.map(rotuloStatus)).toEqual(['Em aberto', 'Paga', 'Vencida', 'Estornada']);
  });

  it('status desconhecido não quebra a tela e não afirma nada sobre o dinheiro', () => {
    expect(rotuloStatus('CHARGEBACK_DISPUTE')).toBe('Em aberto');
    expect(corStatus('CHARGEBACK_DISPUTE')).toBe(corStatus('pendente'));
  });

  it('cada status tem cor por token da marca (nunca hex fixo)', () => {
    for (const s of STATUS) expect(corStatus(s)).not.toMatch(/#|rgb/);
  });
});

describe('estaEmAberto', () => {
  it('vencida continua em aberto — o boleto vencido do Asaas ainda é pagável', () => {
    expect(estaEmAberto('vencida')).toBe(true);
    expect(estaEmAberto('pendente')).toBe(true);
  });

  it('paga e estornada não pedem mais dinheiro', () => {
    expect(estaEmAberto('paga')).toBe(false);
    expect(estaEmAberto('estornada')).toBe(false);
  });
});

describe('podePagar', () => {
  it('oferece pagar no que está em aberto e tem fatura', () => {
    expect(podePagar({ status: 'pendente', linkFatura: 'https://x' })).toBe(true);
    expect(podePagar({ status: 'vencida', linkFatura: 'https://x' })).toBe(true);
  });

  it('NUNCA oferece pagar cobrança estornada — o dinheiro já voltou', () => {
    expect(podePagar({ status: 'estornada', linkFatura: 'https://x' })).toBe(false);
  });

  it('não oferece pagar o que já foi pago', () => {
    expect(podePagar({ status: 'paga', linkFatura: 'https://x' })).toBe(false);
  });

  it('sem link de fatura não há botão — não inventamos para onde mandar o cliente', () => {
    expect(podePagar({ status: 'vencida', linkFatura: null })).toBe(false);
  });
});

describe('totalEmAberto', () => {
  it('soma só pendente e vencida', () => {
    const total = totalEmAberto([
      { status: 'pendente', valorCentavos: 10_000 },
      { status: 'vencida', valorCentavos: 5_000 },
      { status: 'paga', valorCentavos: 90_000 },
      { status: 'estornada', valorCentavos: 70_000 },
    ]);
    expect(total).toBe(15_000);
  });

  it('lista vazia soma zero', () => {
    expect(totalEmAberto([])).toBe(0);
  });
});
