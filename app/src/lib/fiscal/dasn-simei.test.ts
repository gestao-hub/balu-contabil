import { describe, it, expect } from 'vitest';
import { montarDasnSimei } from './dasn-simei';

describe('montarDasnSimei', () => {
  it('monta o `dados` do TRANSDECLARACAO151 (anoCalendario string, declaração com os 3 campos)', () => {
    const dados = montarDasnSimei({
      cnpj: '00000000000100',
      anoCalendario: 2025,
      valorReceitaComercio: 82000,
      valorReceitaServico: 0,
      indicadorEmpregado: false,
    });
    expect(dados).toEqual({
      cnpjCompleto: '00000000000100',
      anoCalendario: '2025',
      declaracao: {
        valorReceitaComercio: 82000,
        valorReceitaServico: 0,
        indicadorEmpregado: false,
      },
    });
  });

  it('normaliza o CNPJ para só dígitos', () => {
    const dados = montarDasnSimei({
      cnpj: '00.000.000/0001-00',
      anoCalendario: 2025,
      valorReceitaComercio: 0,
      valorReceitaServico: 50000,
      indicadorEmpregado: true,
    });
    expect((dados as { cnpjCompleto: string }).cnpjCompleto).toBe('00000000000100');
  });
});
