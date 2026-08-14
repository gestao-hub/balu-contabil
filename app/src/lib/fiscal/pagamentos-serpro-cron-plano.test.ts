import { describe, it, expect } from 'vitest';
import {
  podeConsultar, ordenarFilaConsulta, dentroDoOrcamento, REGIMES_COM_DAS,
  type EmpresaParaConsultar,
} from './pagamentos-serpro-cron-plano';

function emp(over: Partial<EmpresaParaConsultar> = {}): EmpresaParaConsultar {
  return { companyId: 'c1', regimeCode: '1', consultadaEm: null, guiasEmAberto: 1, ...over };
}

describe('podeConsultar', () => {
  it('Simples com guia em aberto entra', () => {
    expect(podeConsultar(emp())).toBe(true);
    expect(podeConsultar(emp({ regimeCode: '2' }))).toBe(true);
  });

  it('MEI (código 4) ENTRA na varredura', () => {
    // Entrou em 14/08/2026. O corte antigo dizia "a consulta de pagamentos do
    // MEI não foi investigada" — mas a investigação da casa
    // (docs/investigations/SERPRO-INVESTIGACAO.md) registra que o filtro usado
    // aqui, código 9, "inclui DAS-MEI e DAS do Simples". Metade do piloto é MEI,
    // e sem isto o DAS-MEI pago nunca era reconhecido.
    expect(podeConsultar(emp({ regimeCode: '4' }))).toBe(true);
    expect(REGIMES_COM_DAS.has('4')).toBe(true);
  });

  it('Regime Normal (código 3) fica de fora — não recolhe DAS', () => {
    // ⚠️ Os testes antigos chamavam o código 3 de "MEI". Não é: 3 é Regime
    // Normal (Lucro Real/Presumido) e 4 é MEI. O limite estava provado com o
    // código errado, e o MEI de verdade nunca foi testado.
    expect(podeConsultar(emp({ regimeCode: '3' }))).toBe(false);
    expect(REGIMES_COM_DAS.has('3')).toBe(false);
  });

  it('sem guia em aberto não gasta chamada SERPRO', () => {
    expect(podeConsultar(emp({ guiasEmAberto: 0 }))).toBe(false);
  });

  it('regime ausente não entra', () => {
    expect(podeConsultar(emp({ regimeCode: '' }))).toBe(false);
  });
});

describe('ordenarFilaConsulta', () => {
  it('quem nunca foi consultado vem antes de quem já foi', () => {
    const fila = ordenarFilaConsulta([
      emp({ companyId: 'antiga', consultadaEm: '2026-08-01T00:00:00Z' }),
      emp({ companyId: 'nunca', consultadaEm: null }),
      emp({ companyId: 'hoje', consultadaEm: '2026-08-14T00:00:00Z' }),
    ]);
    expect(fila.map((e) => e.companyId)).toEqual(['nunca', 'antiga', 'hoje']);
  });

  it('empate desempata por id — ordem estável entre rodadas', () => {
    const fila = ordenarFilaConsulta([
      emp({ companyId: 'b' }), emp({ companyId: 'a' }),
    ]);
    expect(fila.map((e) => e.companyId)).toEqual(['a', 'b']);
  });

  it('filtra os inelegíveis antes de ordenar', () => {
    const fila = ordenarFilaConsulta([
      emp({ companyId: 'regime-normal', regimeCode: '3' }),
      emp({ companyId: 'quitada', guiasEmAberto: 0 }),
      emp({ companyId: 'ok' }),
    ]);
    expect(fila.map((e) => e.companyId)).toEqual(['ok']);
  });

  it('a fila de amanhã começa por quem o corte deixou para trás', () => {
    // O que torna o corte por orçamento justo: sem esta ordem, uma lista sempre
    // na mesma sequência consultaria eternamente as mesmas empresas do começo.
    const hoje = ordenarFilaConsulta([
      emp({ companyId: 'a', consultadaEm: null }),
      emp({ companyId: 'b', consultadaEm: null }),
      emp({ companyId: 'c', consultadaEm: null }),
    ]);
    const atendidas = hoje.slice(0, 2).map((e) => e.companyId); // orçamento só deu para 2
    const amanha = ordenarFilaConsulta([
      emp({ companyId: 'a', consultadaEm: '2026-08-14T10:00:00Z' }),
      emp({ companyId: 'b', consultadaEm: '2026-08-14T10:00:01Z' }),
      emp({ companyId: 'c', consultadaEm: null }),
    ]);
    expect(atendidas).toEqual(['a', 'b']);
    expect(amanha[0].companyId).toBe('c');
  });
});

describe('dentroDoOrcamento (reexportado do plano da apuração)', () => {
  it('cabe mais uma quando sobra tempo', () => {
    expect(dentroDoOrcamento(0, 5_000, 12_000, 2_500)).toBe(true);
  });
  it('não cabe quando a próxima estouraria o teto', () => {
    expect(dentroDoOrcamento(0, 10_000, 12_000, 2_500)).toBe(false);
  });
  it('a fronteira exata cabe', () => {
    expect(dentroDoOrcamento(0, 9_500, 12_000, 2_500)).toBe(true);
  });
});
