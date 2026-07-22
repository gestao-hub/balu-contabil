// src/lib/fiscal/semaforo.test.ts
import { describe, it, expect } from 'vitest';
import { classificarSemaforo, type FatosCliente } from './semaforo';

const LIMITES = { mei: 81000, simples: 4800000 };
const HOJE = new Date('2026-07-15T12:00:00-03:00');
const base: FatosCliente = {
  regimeCode: '1', dasVencidos: 0, pgdasMesAnteriorTransmitida: true,
  dasnAnoAnteriorTransmitida: true, faturamentoAno: 0, certNotAfter: null,
};

describe('classificarSemaforo', () => {
  it('verde quando nada pendente', () => {
    expect(classificarSemaforo(base, LIMITES, HOJE).cor).toBe('verde');
  });
  it('🔴 DAS vencido (LC 123/2006, art. 21)', () => {
    const r = classificarSemaforo({ ...base, dasVencidos: 2 }, LIMITES, HOJE);
    expect(r.cor).toBe('vermelho');
    expect(r.motivos[0].norma).toContain('art. 21');
  });
  it('🔴 PGDAS-D do mês anterior ausente (Res. CGSN 140/2018, art. 38) — só Simples', () => {
    const r = classificarSemaforo({ ...base, pgdasMesAnteriorTransmitida: false }, LIMITES, HOJE);
    expect(r.cor).toBe('vermelho');
    expect(r.motivos[0].norma).toContain('art. 38');
  });
  it('MEI não é cobrado por PGDAS-D', () => {
    const r = classificarSemaforo({ ...base, regimeCode: '4', pgdasMesAnteriorTransmitida: false,
      dasnAnoAnteriorTransmitida: true }, LIMITES, HOJE);
    expect(r.cor).toBe('verde');
  });
  it('🔴 DASN-SIMEI pendente após 31/05 (Res. CGSN 140/2018, art. 109) — só MEI', () => {
    const r = classificarSemaforo({ ...base, regimeCode: '4', dasnAnoAnteriorTransmitida: false }, LIMITES, HOJE);
    expect(r.cor).toBe('vermelho');
    expect(r.motivos[0].norma).toContain('art. 109');
  });
  it('DASN pendente ANTES de 31/05 não marca (prazo aberto)', () => {
    const r = classificarSemaforo({ ...base, regimeCode: '4', dasnAnoAnteriorTransmitida: false },
      LIMITES, new Date('2026-03-10T12:00:00-03:00'));
    expect(r.cor).toBe('verde');
  });
  it('🟡 faturamento ≥ 80% do limite (LC 123/2006, arts. 3º/18-A)', () => {
    const r = classificarSemaforo({ ...base, regimeCode: '4', faturamentoAno: 65000 }, LIMITES, HOJE);
    expect(r.cor).toBe('amarelo');
  });
  it('regime 3 (normal) não tem teto', () => {
    const r = classificarSemaforo({ ...base, regimeCode: '3', faturamentoAno: 99_000_000 }, LIMITES, HOJE);
    expect(r.cor).toBe('verde');
  });
  it('🟡 certificado A1 vence em < 30 dias', () => {
    const r = classificarSemaforo({ ...base, certNotAfter: '2026-08-01T00:00:00Z' }, LIMITES, HOJE);
    expect(r.cor).toBe('amarelo');
  });
  it('vermelho vence amarelo e acumula motivos', () => {
    const r = classificarSemaforo({ ...base, dasVencidos: 1, faturamentoAno: 4_000_000 }, LIMITES, HOJE);
    expect(r.cor).toBe('vermelho');
    expect(r.motivos.length).toBe(2);
  });
  it('prazo DASN usa mês BRT: 31/05 23h BRT (=01/06 02h UTC) ainda é maio → verde', () => {
    // Instante = 2026-06-01T02:00:00Z, que em BRT (UTC-3) ainda é 31/05 23h.
    // Com getMonth() UTC daria junho (>5) e marcaria vermelho indevidamente.
    const quaseMeiaNoiteBrt = new Date('2026-06-01T02:00:00Z');
    const r = classificarSemaforo(
      { ...base, regimeCode: '4', dasnAnoAnteriorTransmitida: false },
      LIMITES, quaseMeiaNoiteBrt,
    );
    expect(r.cor).toBe('verde');
  });
});
