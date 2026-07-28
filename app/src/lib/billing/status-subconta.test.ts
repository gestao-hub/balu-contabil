// Bloco 4B — o mapeamento do KYC da subconta.
//
// O caso que este teste existe para travar: `aprovada` so pode sair de um
// payload em que os QUATRO eixos vieram `APPROVED`. Afrouxar isso (por exemplo
// passar a olhar so `general`) marca a subconta como apta a cobrar antes de o
// Asaas deixar — e a falha aparece na cara do escritorio, no momento em que
// ele cobra o cliente dele.
//
// O payload de referencia e o que o sandbox devolveu de verdade em
// GET /v3/myAccount/status (ver cabecalho de status-subconta.ts).
import { describe, it, expect } from 'vitest';
import { mapearStatusSubconta, EIXOS_KYC, type StatusContaAsaas } from './status-subconta';

const TUDO_APROVADO: StatusContaAsaas = {
  commercialInfo: 'APPROVED',
  bankAccountInfo: 'APPROVED',
  documentation: 'APPROVED',
  general: 'APPROVED',
};

describe('mapearStatusSubconta — aprovada', () => {
  it('o payload observado no sandbox (quatro eixos APPROVED) vira aprovada', () => {
    expect(mapearStatusSubconta(TUDO_APROVADO)).toBe('aprovada');
  });

  it('tolera espaço e caixa, que é normalização e não afrouxamento', () => {
    expect(mapearStatusSubconta({
      commercialInfo: ' approved ', bankAccountInfo: 'Approved',
      documentation: 'APPROVED', general: 'APPROVED',
    })).toBe('aprovada');
  });
});

describe('mapearStatusSubconta — nenhum eixo sozinho aprova', () => {
  for (const eixo of EIXOS_KYC) {
    it(`${eixo} pendente segura tudo em 'pendente', mesmo com os outros três aprovados`, () => {
      expect(mapearStatusSubconta({ ...TUDO_APROVADO, [eixo]: 'PENDING' })).toBe('pendente');
    });

    it(`${eixo} ausente segura tudo em 'pendente' — eixo que não veio não é eixo aprovado`, () => {
      expect(mapearStatusSubconta({ ...TUDO_APROVADO, [eixo]: undefined })).toBe('pendente');
    });
  }

  it("general APPROVED sozinho NAO aprova — a doc diz que 'general' nao olha bankAccountInfo", () => {
    expect(mapearStatusSubconta({
      commercialInfo: 'APPROVED', bankAccountInfo: 'PENDING',
      documentation: 'APPROVED', general: 'APPROVED',
    })).toBe('pendente');
  });

  it('AWAITING_APPROVAL ainda é espera, não aprovação', () => {
    expect(mapearStatusSubconta({ ...TUDO_APROVADO, documentation: 'AWAITING_APPROVAL' }))
      .toBe('pendente');
  });
});

describe('mapearStatusSubconta — recusa', () => {
  for (const eixo of EIXOS_KYC) {
    it(`${eixo} REJECTED vira 'recusada' mesmo com os outros aprovados`, () => {
      expect(mapearStatusSubconta({ ...TUDO_APROVADO, [eixo]: 'REJECTED' })).toBe('recusada');
    });
  }
});

describe('mapearStatusSubconta — o desconhecido nunca aprova', () => {
  it('payload nulo ou indefinido cai em pendente', () => {
    expect(mapearStatusSubconta(null)).toBe('pendente');
    expect(mapearStatusSubconta(undefined)).toBe('pendente');
    expect(mapearStatusSubconta({})).toBe('pendente');
  });

  it('valor que o Asaas invente amanhã cai em pendente, nunca em aprovada', () => {
    // `EXPIRED`/`EXPIRING_SOON` existem como evento de webhook de
    // commercialInfo; qualquer valor fora do conjunto tem de degradar para o
    // lado seguro.
    for (const v of ['EXPIRED', 'EXPIRING_SOON', 'BLOCKED', 'APPROVED_PARTIALLY', '', 'ok']) {
      expect(mapearStatusSubconta({ ...TUDO_APROVADO, commercialInfo: v })).not.toBe('aprovada');
    }
  });

  it('nunca devolve o valor cru do Asaas — a saída é o vocabulário da coluna', () => {
    const saidas = new Set([
      mapearStatusSubconta(TUDO_APROVADO),
      mapearStatusSubconta({ ...TUDO_APROVADO, general: 'REJECTED' }),
      mapearStatusSubconta({}),
    ]);
    for (const s of saidas) expect(['pendente', 'aprovada', 'recusada']).toContain(s);
  });
});
