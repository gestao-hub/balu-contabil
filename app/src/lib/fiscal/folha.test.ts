import { describe, it, expect } from 'vitest';
import { somarFolha12, type FolhaMensal } from './folha';

const f = (competencia: string, proLabore: number, salarios = 0, encargos = 0): FolhaMensal => ({
  competencia, proLabore, salarios, encargos,
});

describe('somarFolha12', () => {
  it('soma os 12 meses anteriores e exclui a própria competência', () => {
    const folhas = [
      f('202505', 1000),  // dentro da janela (mês anterior a 202506)
      f('202406', 2000),  // limite inferior (12 meses antes)
      f('202405', 9999),  // fora (13 meses antes)
      f('202506', 5000),  // a própria competência — excluída
    ];
    const r = somarFolha12(folhas, '202506');
    expect(r.folha12m).toBe(3000); // 1000 + 2000
    expect(r.meses).toBe(2);
  });

  it('soma os três componentes do mês', () => {
    const r = somarFolha12([f('202505', 1000, 500, 200)], '202506');
    expect(r.folha12m).toBe(1700);
    expect(r.meses).toBe(1);
  });

  it('retorna zero quando não há folha na janela', () => {
    const r = somarFolha12([], '202506');
    expect(r.folha12m).toBe(0);
    expect(r.meses).toBe(0);
  });

  it('não conta meses com soma zero em "meses"', () => {
    const r = somarFolha12([f('202505', 0, 0, 0), f('202504', 100)], '202506');
    expect(r.folha12m).toBe(100);
    expect(r.meses).toBe(1);
  });

  // BUG-005 (auditoria 29/08/2026). A auditoria leu "13 competências na tela"
  // como risco de janela errada. A janela está certa — e estes dois testes são
  // o que impede que ela deixe de estar.
  //
  // A virada de ano é onde `competenciaAddMonths` erraria: a aritmética de
  // competência é YYYYMM, não um número, então `202601 - 1` tem de dar `202512`
  // e não `202600`. Em janeiro, um erro aqui derrubaria a janela inteira do
  // Fator R — e só apareceria uma vez por ano.
  it('janela atravessa a virada de ano sem perder mês', () => {
    const folhas = [
      f('202512', 1000),  // mês anterior a 202601 — dentro
      f('202601', 7777),  // a própria competência — fora
      f('202501', 2000),  // limite inferior (12 meses antes de 202601) — dentro
      f('202412', 9999),  // 13 meses antes — fora
    ];
    const r = somarFolha12(folhas, '202601');
    expect(r.folha12m).toBe(3000);
    expect(r.meses).toBe(2);
  });

  it('cabem exatamente 12 competências na janela — nem 11, nem 13', () => {
    // Constrói os 13 meses que a TELA mostra (corrente + 12 anteriores) com
    // R$ 1 cada. Se a janela fosse a da tela, daria 13.
    const meses = ['202601', '202512', '202511', '202510', '202509', '202508', '202507',
      '202506', '202505', '202504', '202503', '202502', '202501'];
    const r = somarFolha12(meses.map((m) => f(m, 1)), '202601');
    expect(r.folha12m).toBe(12);
    expect(r.meses).toBe(12);
  });
});
