import { describe, it, expect } from 'vitest';
import {
  podeApurar, ordenarFila, dentroDoOrcamento, competenciaAlvo,
  type EmpresaParaApurar, type ApuracaoExistente,
} from './apuracao-cron-plano';

const emp = (id: string): EmpresaParaApurar => ({
  companyId: id, ownerUserId: 'u', regimeCode: '1', anexoSimples: 'Anexo I',
  atividadeMei: null, dataInicioAtividade: null,
});
const ap = (id: string, status: string | null, quando: string | null): ApuracaoExistente => ({
  companyId: id, status, atualizadaEm: quando,
});

describe('podeApurar', () => {
  it('empresa sem apuração pode', () => {
    expect(podeApurar(undefined)).toBe(true);
  });

  it('apuração apenas calculada pode ser recalculada', () => {
    // Recalcular é o comportamento desejado: notas chegam durante o mês e o
    // número precisa acompanhar.
    expect(podeApurar(ap('a', 'calculada', null))).toBe(true);
  });

  it('apuração já transmitida ou declarada é intocável', () => {
    // Reescrever isso faria o app discordar do que foi entregue à Receita —
    // e o app estaria errado por cima de um ato já praticado. Retificar é
    // decisão humana.
    expect(podeApurar(ap('a', 'transmitida', null))).toBe(false);
    expect(podeApurar(ap('a', 'declarada', null))).toBe(false);
    expect(podeApurar(ap('a', 'retificada', null))).toBe(false);
  });

  it('não se importa com maiúsculas', () => {
    expect(podeApurar(ap('a', 'TRANSMITIDA', null))).toBe(false);
  });
});

describe('ordenarFila', () => {
  it('quem nunca foi apurado vem antes de quem já foi', () => {
    const fila = ordenarFila(
      [emp('b'), emp('a')],
      new Map([['b', ap('b', 'calculada', '2026-08-01T00:00:00Z')]]),
    );
    expect(fila.map((e) => e.companyId)).toEqual(['a', 'b']);
  });

  it('entre apuradas, a mais antiga vem primeiro', () => {
    const fila = ordenarFila(
      [emp('a'), emp('b')],
      new Map([
        ['a', ap('a', 'calculada', '2026-08-10T00:00:00Z')],
        ['b', ap('b', 'calculada', '2026-08-01T00:00:00Z')],
      ]),
    );
    // É esta ordem que faz o corte por orçamento ser justo: sem ela, o cron
    // apuraria eternamente as mesmas empresas do começo da lista.
    expect(fila.map((e) => e.companyId)).toEqual(['b', 'a']);
  });

  it('as intocáveis saem da fila', () => {
    const fila = ordenarFila(
      [emp('a'), emp('b')],
      new Map([['a', ap('a', 'transmitida', null)]]),
    );
    expect(fila.map((e) => e.companyId)).toEqual(['b']);
  });

  it('ordem estável quando tudo empata', () => {
    const fila = ordenarFila([emp('c'), emp('a'), emp('b')], new Map());
    expect(fila.map((e) => e.companyId)).toEqual(['a', 'b', 'c']);
  });

  it('não muta o array recebido', () => {
    const entrada = [emp('c'), emp('a')];
    ordenarFila(entrada, new Map());
    expect(entrada.map((e) => e.companyId)).toEqual(['c', 'a']);
  });
});

describe('dentroDoOrcamento', () => {
  it('cabe enquanto o gasto mais a próxima empresa couberem', () => {
    expect(dentroDoOrcamento(0, 5000, 8000, 400)).toBe(true);
  });

  it('corta ANTES de estourar, não depois', () => {
    // 7.700 + 400 = 8.100 > 8.000: para agora. Se a conta fosse só
    // "já passei do orçamento?", a última empresa entraria e o estouro
    // aconteceria dentro dela — e timeout de wall-clock mata a invocação
    // inteira, sem try/catch que salve.
    expect(dentroDoOrcamento(0, 7700, 8000, 400)).toBe(false);
  });

  it('o limite exato ainda cabe', () => {
    expect(dentroDoOrcamento(0, 7600, 8000, 400)).toBe(true);
  });
});

describe('competenciaAlvo', () => {
  it('é o mês anterior — o último já fechado', () => {
    expect(competenciaAlvo('202608')).toBe('202607');
  });

  it('vira o ano corretamente', () => {
    expect(competenciaAlvo('202601')).toBe('202512');
  });

  it('entrada inválida não inventa competência', () => {
    expect(competenciaAlvo('')).toBe('000000');
    expect(competenciaAlvo('202613')).toBe('202613');
  });
});
