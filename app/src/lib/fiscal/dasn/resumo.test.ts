// src/lib/fiscal/dasn/resumo.test.ts
import { describe, it, expect } from 'vitest';
import { resumirReceitasAno, avaliarLimiteMei, LIMITE_MEI_ANUAL } from './resumo';
import type { NotaReceita } from '../declaracoes-anuais/tipos';

const nota = (dataEmissao: string, valor: number, tipoDocumento: NotaReceita['tipoDocumento']): NotaReceita =>
  ({ dataEmissao, valor, tipoDocumento });

describe('resumirReceitasAno', () => {
  it('separa NFSe como serviço e NFe/NFCe como comércio', () => {
    const r = resumirReceitasAno([
      nota('2025-03-10T12:00:00-03:00', 1000, 'NFSe'),
      nota('2025-04-10T12:00:00-03:00', 500, 'NFe'),
      nota('2025-05-10T12:00:00-03:00', 250, 'NFCe'),
    ], 2025);
    expect(r.servico).toBe(1000);
    expect(r.comercio).toBe(750);
    expect(r.total).toBe(1750);
    expect(r.qtdNotas).toBe(3);
  });

  it('inclui a nota de 31/12 23:59 BRT no ano dela', () => {
    const r = resumirReceitasAno([nota('2025-12-31T23:59:00-03:00', 100, 'NFe')], 2025);
    expect(r.total).toBe(100);
    expect(r.qtdNotas).toBe(1);
  });

  it('exclui a nota de 01/01 00:01 BRT do ano anterior', () => {
    const r = resumirReceitasAno([nota('2026-01-01T00:01:00-03:00', 100, 'NFe')], 2025);
    expect(r.total).toBe(0);
    expect(r.qtdNotas).toBe(0);
  });

  // A armadilha: 31/12/2025 22:00 BRT é 01/01/2026 01:00 UTC. Se filtrarmos
  // pelo ano em UTC, essa receita some do ano-calendário certo.
  it('conta pelo fuso de Brasília, não por UTC', () => {
    const r = resumirReceitasAno([nota('2026-01-01T01:00:00Z', 100, 'NFe')], 2025);
    expect(r.total).toBe(100);
  });

  it('devolve zeros quando não há nota nenhuma', () => {
    const r = resumirReceitasAno([], 2025);
    expect(r).toEqual({ comercio: 0, servico: 0, total: 0, qtdNotas: 0 });
  });
});

describe('avaliarLimiteMei', () => {
  it('não excede abaixo do limite', () => {
    const a = avaliarLimiteMei(80000);
    expect(a.excede).toBe(false);
    expect(a.excedeEm20Pct).toBe(false);
    expect(a.excedente).toBe(0);
  });

  it('não excede exatamente no limite', () => {
    expect(avaliarLimiteMei(LIMITE_MEI_ANUAL).excede).toBe(false);
  });

  it('excede um real acima do limite', () => {
    const a = avaliarLimiteMei(81001);
    expect(a.excede).toBe(true);
    expect(a.excedeEm20Pct).toBe(false);
    expect(a.excedente).toBe(1);
  });

  // Acima de 20% (R$ 97.200) o desenquadramento é retroativo ao início do ano.
  it('marca o excesso acima de 20%', () => {
    const a = avaliarLimiteMei(97201);
    expect(a.excede).toBe(true);
    expect(a.excedeEm20Pct).toBe(true);
  });

  it('20% exatos ainda não é excesso retroativo', () => {
    expect(avaliarLimiteMei(97200).excedeEm20Pct).toBe(false);
  });
});
