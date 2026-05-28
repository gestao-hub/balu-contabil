import { describe, it, expect } from 'vitest';
import {
  buildNfsePayload,
  regimeToOpcaoSimples,
  gerarNumeroDps,
  type NfsePrestadorCompany,
  type NfsePrestadorFiscal,
  type NfseTomador,
  type NfseServico,
} from './nfse-payload';

const NOW = new Date('2026-05-28T15:30:00Z');

const PRESTADOR_COMPANY: NfsePrestadorCompany = {
  cnpj: '10358425000120',
  codigo_municipio: '4113700', // Londrina
};

const PRESTADOR_FISCAL: NfsePrestadorFiscal = {
  Code_regime_tributario: '1', // Simples Nacional
};

const TOMADOR_PJ: NfseTomador = { cnpj: '12345678000100', cpf: null, razaoSocial: 'Cliente PJ Ltda' };
const TOMADOR_PF: NfseTomador = { cnpj: null, cpf: '12345678901', razaoSocial: 'João da Silva' };

const SERVICO: NfseServico = {
  codigoTributacao: '010701',
  descricao: 'Consultoria em informática',
  valor: 1000,
  aliquotaIssPercentual: 5,
};

describe('regimeToOpcaoSimples (enum NFSe Nacional 1=Não Optante, 2=MEI, 3=ME/EPP)', () => {
  it('1 Simples → 3 ME/EPP', () => expect(regimeToOpcaoSimples('1')).toBe(3));
  it('4 MEI → 2', () => expect(regimeToOpcaoSimples('4')).toBe(2));
  it('3 Lucro Real → 1 não-optante', () => expect(regimeToOpcaoSimples('3')).toBe(1));
  it('null → 3 (default Simples)', () => expect(regimeToOpcaoSimples(null)).toBe(3));
});

describe('gerarNumeroDps', () => {
  it('retorna inteiro positivo', () => {
    const n = gerarNumeroDps(NOW);
    expect(Number.isInteger(n)).toBe(true);
    expect(n).toBeGreaterThan(0);
    expect(n.toString().length).toBeLessThanOrEqual(9);
  });
});

describe('buildNfsePayload', () => {
  it('payload mínimo válido (PJ tomador)', () => {
    const p = buildNfsePayload(PRESTADOR_COMPANY, PRESTADOR_FISCAL, TOMADOR_PJ, SERVICO, NOW);
    expect(p.cnpj_prestador).toBe('10358425000120');
    expect(p.codigo_municipio_emissora).toBe(4113700);
    expect(p.codigo_municipio_prestacao).toBe(4113700);
    expect(p.cnpj_tomador).toBe('12345678000100');
    expect(p.cpf_tomador).toBeUndefined();
    expect(p.razao_social_tomador).toBe('Cliente PJ Ltda');
    expect(p.codigo_tributacao_nacional_iss).toBe('010701');
    expect(p.descricao_servico).toBe('Consultoria em informática');
    expect(p.valor_servico).toBe(1000);
    expect(p.tributacao_iss).toBe(1);        // enum 1 = Operação tributável
    expect(p.tipo_retencao_iss).toBe(1);     // enum 1 = Não retido
    expect(p.finalidade_emissao).toBe(0);    // 0 = NFS-e regular
    expect(p.regime_especial_tributacao).toBe(0); // 0 = Nenhum
    expect(p.codigo_opcao_simples_nacional).toBe(3); // ME/EPP
    expect(p.percentual_aliquota_relativa_municipio).toBe(5);
    expect(p.emitente_dps).toBe(1);
    expect(p.data_emissao).toBe('2026-05-28T15:30:00.000Z');
    expect(p.data_competencia).toBe('2026-05-28');
  });

  it('tomador PF: usa cpf_tomador (não cnpj_tomador) e mantém razao_social', () => {
    const p = buildNfsePayload(PRESTADOR_COMPANY, PRESTADOR_FISCAL, TOMADOR_PF, SERVICO, NOW);
    expect(p.cpf_tomador).toBe('12345678901');
    expect(p.cnpj_tomador).toBeUndefined();
    expect(p.razao_social_tomador).toBe('João da Silva');
  });

  it('CNPJ tomador com máscara: strip', () => {
    const p = buildNfsePayload(PRESTADOR_COMPANY, PRESTADOR_FISCAL,
      { cnpj: '12.345.678/0001-00', cpf: null, razaoSocial: 'X' }, SERVICO, NOW);
    expect(p.cnpj_tomador).toBe('12345678000100');
  });

  it('aliquota>0 vira percentual_aliquota_relativa_municipio (mapeado, não convertido)', () => {
    const p = buildNfsePayload(PRESTADOR_COMPANY, PRESTADOR_FISCAL, TOMADOR_PJ,
      { ...SERVICO, valor: 1234.567, aliquotaIssPercentual: 7 }, NOW);
    expect(p.valor_servico).toBe(1234.57);
    expect(p.percentual_aliquota_relativa_municipio).toBe(7);
  });

  it('razão social do tomador vazia → lança', () => {
    expect(() => buildNfsePayload(PRESTADOR_COMPANY, PRESTADOR_FISCAL,
      { ...TOMADOR_PJ, razaoSocial: '  ' }, SERVICO, NOW)).toThrow(/Razão social/);
  });

  it('código de tributação inválido (não-numérico ou !=6 dígitos) → lança', () => {
    expect(() => buildNfsePayload(PRESTADOR_COMPANY, PRESTADOR_FISCAL, TOMADOR_PJ,
      { ...SERVICO, codigoTributacao: '01070' }, NOW)).toThrow(/6 dígitos/);
    expect(() => buildNfsePayload(PRESTADOR_COMPANY, PRESTADOR_FISCAL, TOMADOR_PJ,
      { ...SERVICO, codigoTributacao: 'ABCDEF' }, NOW)).toThrow(/6 dígitos/);
  });

  it('descrição vazia → lança', () => {
    expect(() => buildNfsePayload(PRESTADOR_COMPANY, PRESTADOR_FISCAL, TOMADOR_PJ,
      { ...SERVICO, descricao: '  ' }, NOW)).toThrow(/Descrição/);
  });

  it('valor 0 ou negativo → lança', () => {
    expect(() => buildNfsePayload(PRESTADOR_COMPANY, PRESTADOR_FISCAL, TOMADOR_PJ,
      { ...SERVICO, valor: 0 }, NOW)).toThrow(/positivo/);
    expect(() => buildNfsePayload(PRESTADOR_COMPANY, PRESTADOR_FISCAL, TOMADOR_PJ,
      { ...SERVICO, valor: -10 }, NOW)).toThrow(/positivo/);
  });

  it('alíquota negativa → lança', () => {
    expect(() => buildNfsePayload(PRESTADOR_COMPANY, PRESTADOR_FISCAL, TOMADOR_PJ,
      { ...SERVICO, aliquotaIssPercentual: -1 }, NOW)).toThrow(/Alíquota/);
  });

  it('tomador sem CPF nem CNPJ → lança', () => {
    expect(() => buildNfsePayload(PRESTADOR_COMPANY, PRESTADOR_FISCAL,
      { cnpj: null, cpf: null, razaoSocial: 'X' }, SERVICO, NOW)).toThrow(/CPF ou CNPJ/);
  });

  it('CNPJ prestador inválido → lança', () => {
    expect(() => buildNfsePayload({ ...PRESTADOR_COMPANY, cnpj: '123' }, PRESTADOR_FISCAL, TOMADOR_PJ, SERVICO, NOW))
      .toThrow(/14 dígitos/);
  });

  it('código IBGE do município ausente → lança (NFSe Nacional exige)', () => {
    expect(() => buildNfsePayload({ ...PRESTADOR_COMPANY, codigo_municipio: null }, PRESTADOR_FISCAL, TOMADOR_PJ, SERVICO, NOW))
      .toThrow(/Código IBGE/);
  });

  it('Lucro Real (regime 3) → opcao_simples_nacional=1 (não optante)', () => {
    const p = buildNfsePayload(PRESTADOR_COMPANY, { Code_regime_tributario: '3' }, TOMADOR_PJ, SERVICO, NOW);
    expect(p.codigo_opcao_simples_nacional).toBe(1);
  });
});
