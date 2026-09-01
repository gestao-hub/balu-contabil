import { describe, it, expect } from 'vitest';
import { dataBrt, dataHoraBrt, mesAnoBrt, mesAnoCompetencia } from './data-brt';

// A INVARIANTE QUE ESTES TESTES EXISTEM PARA TRAVAR: o resultado não pode
// depender do fuso de quem renderiza. Rodam sob o TZ do processo (o vitest não
// fixa nenhum), e passam igual em UTC e em BRT — que é justamente a propriedade
// que faltava a `toLocaleDateString('pt-BR')` e produziu o BUG-006.
describe('data-brt', () => {
  // 02:00 UTC = 23:00 do dia ANTERIOR em BRT. É a janela onde servidor (UTC) e
  // cliente (BRT) discordavam da data, e a que a auditoria pegou.
  const MADRUGADA = '2026-09-01T02:00:00Z';

  it('vira o dia para trás na janela 00:00–03:00 UTC — é a data de Brasília que vale', () => {
    expect(dataBrt(MADRUGADA)).toBe('31/08/2026');
  });

  it('hora sempre em BRT: 02:00Z é 23:00 do dia anterior', () => {
    expect(dataHoraBrt(MADRUGADA)).toBe('31/08/2026, 23:00');
  });

  it('mês/ano acompanha a virada do dia', () => {
    expect(mesAnoBrt(MADRUGADA)).toBe('agosto de 2026');
  });

  it('fora da janela, data igual nos dois fusos', () => {
    expect(dataBrt('2026-09-01T12:00:00Z')).toBe('01/09/2026');
    expect(mesAnoBrt('2026-09-01T12:00:00Z')).toBe('setembro de 2026');
  });

  it('aceita Date, número e string ISO', () => {
    const d = new Date('2026-09-01T12:00:00Z');
    expect(dataBrt(d)).toBe('01/09/2026');
    expect(dataBrt(d.getTime())).toBe('01/09/2026');
    expect(dataBrt(d.toISOString())).toBe('01/09/2026');
  });

  // O valor vem do banco e de APIs de terceiros: string quebrada não pode
  // estampar "Invalid Date" em inglês no meio de uma tabela em português.
  it('ausente ou inválido devolve o marcador, nunca "Invalid Date"', () => {
    for (const v of [null, undefined, '', 'nao-e-data', NaN]) {
      expect(dataBrt(v)).toBe('—');
      expect(dataHoraBrt(v)).toBe('—');
      expect(mesAnoBrt(v)).toBe('—');
    }
  });

  it('o marcador de ausência é escolhível', () => {
    expect(dataBrt(null, 'sem data')).toBe('sem data');
    expect(dataHoraBrt(null, '')).toBe('');
  });

  // Meia-noite BRT e o último segundo do dia: as bordas onde um off-by-one de
  // fuso apareceria.
  it('bordas do dia em BRT', () => {
    expect(dataBrt('2026-09-01T03:00:00Z')).toBe('01/09/2026'); // 00:00 BRT
    expect(dataHoraBrt('2026-09-01T03:00:00Z')).toBe('01/09/2026, 00:00');
    expect(dataBrt('2026-09-02T02:59:59Z')).toBe('01/09/2026'); // 23:59:59 BRT
  });
});

// A ARMADILHA QUE ESTA FUNÇÃO EXISTE PARA EVITAR. O código anterior fazia
// `new Date(ano, mes-1)` — meia-noite LOCAL — e formatava com fuso de Brasília.
// No servidor (UTC) isso vira 21:00 do dia anterior em BRT, e o mês do
// honorário aparecia como o ANTERIOR. Não é hidratação: é dado errado.
describe('mesAnoCompetencia', () => {
  it('setembro continua setembro, rode onde rodar', () => {
    expect(mesAnoCompetencia('2026-09')).toBe('setembro de 2026');
    expect(mesAnoCompetencia('2026-09-01')).toBe('setembro de 2026');
    expect(mesAnoCompetencia('202609')).toBe('setembro de 2026');
  });

  it('janeiro e dezembro — as bordas do vetor', () => {
    expect(mesAnoCompetencia('2026-01')).toBe('janeiro de 2026');
    expect(mesAnoCompetencia('2026-12')).toBe('dezembro de 2026');
  });

  it('entrada inválida devolve o marcador', () => {
    for (const v of [null, undefined, '', '  ', '2026-13', '2026-00', 'abacaxi']) {
      expect(mesAnoCompetencia(v)).toBe('—');
    }
  });
});
