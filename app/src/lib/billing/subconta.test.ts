import { describe, it, expect } from 'vitest';
import { validarDadosSubconta, montarPayloadSubconta, soDigitos } from './subconta';

const pj = {
  name: 'Escritorio Teste Contabil LTDA', cpfCnpj: '11.222.333/0001-81',
  email: 'contato@escritorio.com.br', mobilePhone: '(11) 99999-9999',
  incomeValue: 25000, address: 'Rua das Flores', addressNumber: '100',
  province: 'Centro', postalCode: '01001-000', birthDate: null,
  companyType: 'LIMITED' as const,
};
const pf = { ...pj, cpfCnpj: '123.456.789-09', companyType: null, birthDate: '1985-03-12' };

describe('validarDadosSubconta', () => {
  it('aceita PJ completo sem data de nascimento', () => {
    expect(validarDadosSubconta(pj)).toEqual({ ok: true });
  });

  it('aceita PF com data de nascimento', () => {
    expect(validarDadosSubconta(pf)).toEqual({ ok: true });
  });

  // O achado do sandbox: birthDate so e exigido para CPF. Cobrar de PJ
  // travaria o onboarding de todo escritorio com CNPJ.
  it('exige data de nascimento apenas para CPF', () => {
    const semData = { ...pf, birthDate: null };
    const r = validarDadosSubconta(semData);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('nascimento');
  });

  it('exige companyType para CNPJ', () => {
    const r = validarDadosSubconta({ ...pj, companyType: null });
    expect(r.ok).toBe(false);
  });

  it.each([
    ['nome', { name: '' }],
    ['documento', { cpfCnpj: '' }],
    ['e-mail', { email: '' }],
    ['celular', { mobilePhone: '' }],
    ['CEP', { postalCode: '' }],
  ])('recusa sem %s', (_r, patch) => {
    expect(validarDadosSubconta({ ...pj, ...patch }).ok).toBe(false);
  });

  it('recusa documento que nao tem 11 nem 14 digitos', () => {
    expect(validarDadosSubconta({ ...pj, cpfCnpj: '123' }).ok).toBe(false);
  });

  it('recusa faturamento estimado zerado ou negativo', () => {
    expect(validarDadosSubconta({ ...pj, incomeValue: 0 }).ok).toBe(false);
  });
});

describe('montarPayloadSubconta', () => {
  it('manda documento e celular so com digitos', () => {
    const p = montarPayloadSubconta(pj);
    expect(p.cpfCnpj).toBe('11222333000181');
    expect(p.mobilePhone).toBe('11999999999');
    expect(p.postalCode).toBe('01001000');
  });

  it('nao manda birthDate para PJ', () => {
    expect(montarPayloadSubconta(pj).birthDate).toBeUndefined();
  });

  it('manda birthDate e omite companyType para PF', () => {
    const p = montarPayloadSubconta(pf);
    expect(p.birthDate).toBe('1985-03-12');
    expect(p.companyType).toBeUndefined();
  });
});

describe('soDigitos', () => {
  it('remove tudo que nao for digito', () => {
    expect(soDigitos('(11) 9 9999-9999')).toBe('11999999999');
  });
});
