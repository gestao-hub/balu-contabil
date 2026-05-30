import { describe, it, expect } from 'vitest';
import { buildNfePayload, toBrasiliaISO, type NfeEmitente, type NfeDestinatario, type NfeItem } from './nfe-payload';

const NOW = new Date('2026-05-30T15:30:00Z');
const EMITENTE: NfeEmitente = { cnpj: '10358425000120', regime: '1' };
const DEST: NfeDestinatario = { cnpj: '12345678000100', cpf: null, nome: 'Cliente PJ Ltda' };
const ITEM: NfeItem = {
  descricao: 'Piscina fibra 3m', ncm: '39269090', cfop: '5102',
  unidade: 'UN', quantidade: 1, valorUnitario: 5000,
};

describe('buildNfePayload', () => {
  it('monta payload modelo 55 com defaults', () => {
    const p = buildNfePayload(EMITENTE, DEST, [ITEM], 'Venda de mercadoria', NOW);
    expect(p.natureza_operacao).toBe('Venda de mercadoria');
    expect(p.finalidade_emissao).toBe('1');
    expect(p.cnpj_emitente).toBe('10358425000120');
    expect(p.cnpj_destinatario).toBe('12345678000100');
    expect(p.nome_destinatario).toBe('Cliente PJ Ltda');
    expect(p.items).toHaveLength(1);
    expect(p.items[0]).toMatchObject({
      numero_item: 1, descricao: 'Piscina fibra 3m', codigo_ncm: '39269090',
      cfop: '5102', unidade_comercial: 'UN', quantidade_comercial: 1,
      valor_unitario_comercial: 5000, valor_bruto: 5000,
      icms_origem: 0,
    });
  });

  it('aceita destinatário PF (CPF)', () => {
    const p = buildNfePayload(EMITENTE, { cnpj: null, cpf: '12345678901', nome: 'João' }, [ITEM], 'Venda', NOW);
    expect(p.cpf_destinatario).toBe('12345678901');
    expect(p.cnpj_destinatario).toBeUndefined();
  });

  it('calcula valor_bruto = quantidade × valorUnitario', () => {
    const p = buildNfePayload(EMITENTE, DEST, [{ ...ITEM, quantidade: 3, valorUnitario: 100 }], 'Venda', NOW);
    expect(p.items[0].valor_bruto).toBe(300);
  });

  it('rejeita lista de itens vazia', () => {
    expect(() => buildNfePayload(EMITENTE, DEST, [], 'Venda', NOW)).toThrow(/item/i);
  });

  it('rejeita CNPJ emitente inválido', () => {
    expect(() => buildNfePayload({ cnpj: '123', regime: '1' }, DEST, [ITEM], 'Venda', NOW)).toThrow(/14 díg/i);
  });

  it('rejeita destinatário sem CPF e sem CNPJ', () => {
    expect(() => buildNfePayload(EMITENTE, { cnpj: null, cpf: null, nome: 'X' }, [ITEM], 'Venda', NOW)).toThrow(/CPF ou CNPJ/i);
  });

  it('rejeita natureza_operacao vazia', () => {
    expect(() => buildNfePayload(EMITENTE, DEST, [ITEM], '   ', NOW)).toThrow(/natureza/i);
  });

  it('regime Simples (1) usa CSOSN 102', () => {
    const p = buildNfePayload(EMITENTE, DEST, [ITEM], 'Venda', NOW);
    expect(p.items[0].icms_csosn).toBe('102');
    expect(p.items[0].icms_situacao_tributaria).toBeUndefined();
  });

  it('regime Normal (3) usa CST 00', () => {
    const emitente3: NfeEmitente = { cnpj: '10358425000120', regime: '3' };
    const p = buildNfePayload(emitente3, DEST, [ITEM], 'Venda', NOW);
    expect(p.items[0].icms_situacao_tributaria).toBe('00');
    expect(p.items[0].icms_csosn).toBeUndefined();
  });
});

describe('toBrasiliaISO', () => {
  it('15:30 UTC → 12:30-03:00 mesmo dia', () => {
    expect(toBrasiliaISO(new Date('2026-05-28T15:30:00Z'))).toBe('2026-05-28T12:30:00-03:00');
  });
  it('02:00 UTC → 23:00-03:00 do dia anterior', () => {
    expect(toBrasiliaISO(new Date('2026-05-28T02:00:00Z'))).toBe('2026-05-27T23:00:00-03:00');
  });
  it('formata segundos com zero-padding', () => {
    expect(toBrasiliaISO(new Date('2026-05-28T15:30:05Z'))).toBe('2026-05-28T12:30:05-03:00');
  });
});
