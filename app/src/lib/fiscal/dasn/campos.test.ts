// src/lib/fiscal/dasn/campos.test.ts
import { describe, it, expect } from 'vitest';
import { DasnCamposSchema, sugerirCampos, paraPayloadSerpro } from './campos';

describe('DasnCamposSchema', () => {
  it('aceita os três campos válidos', () => {
    const r = DasnCamposSchema.safeParse({ receitaComercio: 1000, receitaServico: 500, possuiEmpregado: false });
    expect(r.success).toBe(true);
  });

  it('rejeita receita negativa', () => {
    const r = DasnCamposSchema.safeParse({ receitaComercio: -1, receitaServico: 0, possuiEmpregado: false });
    expect(r.success).toBe(false);
  });

  it('rejeita campo faltando', () => {
    const r = DasnCamposSchema.safeParse({ receitaComercio: 10, receitaServico: 0 });
    expect(r.success).toBe(false);
  });
});

describe('sugerirCampos', () => {
  it('pré-preenche a partir do resumo das notas', () => {
    const c = sugerirCampos({ comercio: 750, servico: 1000, total: 1750, qtdNotas: 3 });
    expect(c).toEqual({ receitaComercio: 750, receitaServico: 1000, possuiEmpregado: false });
  });
});

describe('paraPayloadSerpro', () => {
  it('entrega o payload no formato do montarDasnSimei', () => {
    const p = paraPayloadSerpro(
      { receitaComercio: 750, receitaServico: 1000, possuiEmpregado: true },
      '12.345.678/0001-95',
      2025,
    ) as { cnpjCompleto: string; anoCalendario: string; declaracao: Record<string, unknown> };
    expect(p.cnpjCompleto).toBe('12345678000195');
    expect(p.anoCalendario).toBe('2025');
    expect(p.declaracao).toEqual({
      valorReceitaComercio: 750,
      valorReceitaServico: 1000,
      indicadorEmpregado: true,
    });
  });
});
