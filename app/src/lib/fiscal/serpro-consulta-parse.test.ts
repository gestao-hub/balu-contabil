import { describe, it, expect } from 'vitest';
import { parseConsultaDeclaracoes } from './serpro-consulta-parse';

// Envelope SERPRO real: { ..., dados: "<json string>" }. Fixture baseada na resposta capturada
// (scripts/test-serpro-procurador-al-piscinas.mjs), + 2 meses sintéticos p/ cobrir 'gerada' e 'pendente'.
function envelope(periodos: unknown[]): unknown {
  return {
    status: 200,
    responseDateTime: '2026-06-03T10:00:13.373Z',
    dados: JSON.stringify({ anoCalendario: 2025, periodos }),
  };
}

const PAGA = {
  periodoApuracao: 202501,
  operacoes: [
    { tipoOperacao: 'Original', indiceDeclaracao: { numeroDeclaracao: '10358425202501001', dataHoraTransmissao: '20250214101623', malha: '' }, indiceDas: null },
    { tipoOperacao: 'Geração de DAS', indiceDeclaracao: null, indiceDas: { numeroDas: '07202504580937145', datahoraEmissaoDas: '20250214101627', dasPago: true } },
  ],
};
const GERADA = {
  periodoApuracao: 202502,
  operacoes: [
    { tipoOperacao: 'Original', indiceDeclaracao: { numeroDeclaracao: '10358425202502001', dataHoraTransmissao: '20250312105231', malha: '' }, indiceDas: null },
    { tipoOperacao: 'Geração de DAS', indiceDeclaracao: null, indiceDas: { numeroDas: '07202507153208526', datahoraEmissaoDas: '20250312105234', dasPago: false } },
  ],
};
const PENDENTE = {
  periodoApuracao: 202503,
  operacoes: [
    { tipoOperacao: 'Original', indiceDeclaracao: { numeroDeclaracao: '10358425202503001', dataHoraTransmissao: '20250409162156', malha: '' }, indiceDas: null },
  ],
};

describe('parseConsultaDeclaracoes', () => {
  it('mapeia período por período com competência YYYYMM', () => {
    const out = parseConsultaDeclaracoes(envelope([PAGA, GERADA, PENDENTE]));
    expect(out.map((s) => s.competencia)).toEqual(['202501', '202502', '202503']);
  });

  it('status: dasPago→paga, DAS não pago→gerada, só declaração→pendente', () => {
    const out = parseConsultaDeclaracoes(envelope([PAGA, GERADA, PENDENTE]));
    expect(out[0].status).toBe('paga');
    expect(out[0].numeroDas).toBe('07202504580937145');
    expect(out[0].dasPago).toBe(true);
    expect(out[1].status).toBe('gerada');
    expect(out[1].dasPago).toBe(false);
    expect(out[2].status).toBe('pendente');
    expect(out[2].numeroDas).toBeNull();
  });

  it('extrai numeroDeclaracao e parseia dataTransmissao (YYYYMMDDHHmmss → ISO)', () => {
    const out = parseConsultaDeclaracoes(envelope([PAGA]));
    expect(out[0].numeroDeclaracao).toBe('10358425202501001');
    expect(out[0].dataTransmissao?.startsWith('2025-02-14')).toBe(true);
  });

  it('defensivo: envelope sem dados / dados inválido → []', () => {
    expect(parseConsultaDeclaracoes({})).toEqual([]);
    expect(parseConsultaDeclaracoes({ dados: 'não-json' })).toEqual([]);
    expect(parseConsultaDeclaracoes(null)).toEqual([]);
  });
});
