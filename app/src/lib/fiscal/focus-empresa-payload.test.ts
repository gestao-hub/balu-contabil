import { describe, it, expect } from 'vitest';
import {
  buildFocusEmpresaPayload,
  regimeCodeToFocus,
  type FocusEmpresaCompany,
} from './focus-empresa-payload';

const BASE: FocusEmpresaCompany = {
  cnpj: '12345678000123',
  razao_social: 'Acme Ltda',
  nome: 'Acme',
  logradouro: 'Rua João da Silva',
  numero: '153',
  sem_numero: false,
  complemento: null,
  bairro: 'Vila Isabel',
  municipio: 'Curitiba',
  uf: 'PR',
  cep: '80210000',
  email: null,
  telefone: null,
  inscricao_estadual: null,
  inscricao_municipal: null,
};

describe('regimeCodeToFocus', () => {
  it('mapeia "1" → 1, "2" → 2, ...', () => {
    expect(regimeCodeToFocus('1')).toBe(1);
    expect(regimeCodeToFocus('2')).toBe(2);
    expect(regimeCodeToFocus('3')).toBe(3);
    expect(regimeCodeToFocus('4')).toBe(4);
  });
  it('lança em código inválido', () => {
    expect(() => regimeCodeToFocus('0')).toThrow();
    expect(() => regimeCodeToFocus('5')).toThrow();
    expect(() => regimeCodeToFocus('abc')).toThrow();
  });
});

describe('buildFocusEmpresaPayload', () => {
  it('mínimo: só campos obrigatórios quando opcionais estão vazios', () => {
    const p = buildFocusEmpresaPayload(BASE, '1');
    expect(p).toEqual({
      nome: 'Acme Ltda',
      nome_fantasia: 'Acme',
      cnpj: '12345678000123',
      regime_tributario: 1,
      municipio: 'Curitiba',
      uf: 'PR',
      logradouro: 'Rua João da Silva',
      numero: '153',
      bairro: 'Vila Isabel',
      cep: '80210000',
    });
    // opcionais ausentes não aparecem no payload
    expect(p).not.toHaveProperty('complemento');
    expect(p).not.toHaveProperty('email');
    expect(p).not.toHaveProperty('telefone');
  });

  it('inclui opcionais quando preenchidos', () => {
    const p = buildFocusEmpresaPayload(
      {
        ...BASE,
        complemento: 'Loja 1',
        email: 'a@b.com',
        telefone: '(41) 3033-3333',
        inscricao_estadual: '1234',
        inscricao_municipal: '46532',
      },
      '3',
    );
    expect(p.complemento).toBe('Loja 1');
    expect(p.email).toBe('a@b.com');
    expect(p.telefone).toBe('4130333333');
    expect(p.inscricao_estadual).toBe('1234');
    expect(p.inscricao_municipal).toBe('46532');
    expect(p.regime_tributario).toBe(3);
  });

  it('strip máscaras: cnpj/cep/telefone só dígitos', () => {
    const p = buildFocusEmpresaPayload(
      { ...BASE, cnpj: '12.345.678/0001-23', cep: '80210-000', telefone: '41 3033-3333' },
      '1',
    );
    expect(p.cnpj).toBe('12345678000123');
    expect(p.cep).toBe('80210000');
    expect(p.telefone).toBe('4130333333');
  });

  it('UF é maiusculizado e validado (2 letras)', () => {
    const p = buildFocusEmpresaPayload({ ...BASE, uf: 'pr' }, '1');
    expect(p.uf).toBe('PR');
    expect(() => buildFocusEmpresaPayload({ ...BASE, uf: 'PRS' }, '1')).toThrow();
  });

  it('sem_numero=true gera numero="SN"', () => {
    const p = buildFocusEmpresaPayload({ ...BASE, sem_numero: true, numero: '' }, '1');
    expect(p.numero).toBe('SN');
  });

  it('nome_fantasia omitido quando igual à razão social', () => {
    const p = buildFocusEmpresaPayload({ ...BASE, nome: 'Acme Ltda' }, '1');
    expect(p).not.toHaveProperty('nome_fantasia');
  });

  it('lança em CNPJ inválido', () => {
    expect(() => buildFocusEmpresaPayload({ ...BASE, cnpj: '123' }, '1')).toThrow(/CNPJ/);
  });

  it('lança quando obrigatórios estão vazios', () => {
    expect(() => buildFocusEmpresaPayload({ ...BASE, razao_social: '' }, '1')).toThrow(/Razão social/);
    expect(() => buildFocusEmpresaPayload({ ...BASE, municipio: '' }, '1')).toThrow(/Município/);
    expect(() => buildFocusEmpresaPayload({ ...BASE, logradouro: '  ' }, '1')).toThrow(/Logradouro/);
    expect(() => buildFocusEmpresaPayload({ ...BASE, bairro: '' }, '1')).toThrow(/Bairro/);
    expect(() => buildFocusEmpresaPayload({ ...BASE, cep: '123' }, '1')).toThrow(/CEP/);
    expect(() => buildFocusEmpresaPayload({ ...BASE, sem_numero: false, numero: '' }, '1')).toThrow(/Número/);
  });

  it('telefone com menos de 10 dígitos é descartado (Focus exige formato completo)', () => {
    const p = buildFocusEmpresaPayload({ ...BASE, telefone: '12345' }, '1');
    expect(p).not.toHaveProperty('telefone');
  });
});
