import { describe, it, expect } from 'vitest';
import { buildNfcePayload, type NfceFormaPagamento } from './nfce-payload';
import type { NfeEmitente, NfeItem } from './nfe-payload';

const NOW = new Date('2026-05-30T15:30:00Z');
const EMITENTE: NfeEmitente = { cnpj: '10358425000120', regime: '1' };
const ITEM: NfeItem = { descricao: 'Boia', ncm: '39269090', cfop: '5102', unidade: 'UN', quantidade: 2, valorUnitario: 50 };
const PGTO: NfceFormaPagamento = { forma: '01', valor: 100 };

describe('buildNfcePayload', () => {
  it('monta payload modelo 65 com defaults e pagamento', () => {
    const p = buildNfcePayload(EMITENTE, [ITEM], [PGTO], null, NOW);
    expect(p.cnpj_emitente).toBe('10358425000120');
    expect(p.presenca_comprador).toBe(1);
    expect(p.modalidade_frete).toBe(9);
    expect(p.local_destino).toBe(1);
    expect(p.items[0].valor_bruto).toBe(100);
    expect(p.formas_pagamento).toEqual([{ forma_pagamento: '01', valor_pagamento: 100 }]);
    expect(p.cpf_destinatario).toBeUndefined();
  });

  it('inclui CPF do consumidor quando informado', () => {
    const p = buildNfcePayload(EMITENTE, [ITEM], [PGTO], { cpf: '12345678901', nome: null }, NOW);
    expect(p.cpf_destinatario).toBe('12345678901');
  });

  it('rejeita sem forma de pagamento', () => {
    expect(() => buildNfcePayload(EMITENTE, [ITEM], [], null, NOW)).toThrow(/pagamento/i);
  });

  it('rejeita itens vazios', () => {
    expect(() => buildNfcePayload(EMITENTE, [], [PGTO], null, NOW)).toThrow(/item/i);
  });

  it('regime 3 (Lucro Real) produz icms_situacao_tributaria no item', () => {
    const emitLucroReal: NfeEmitente = { cnpj: '10358425000120', regime: '3' };
    const p = buildNfcePayload(emitLucroReal, [ITEM], [PGTO], null, NOW);
    expect(p.items[0].icms_situacao_tributaria).toBe('00');
    expect(p.items[0].icms_csosn).toBeUndefined();
  });
});
