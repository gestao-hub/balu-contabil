import { describe, it, expect } from 'vitest';
import { EmpresaFiscalSchema, CompanySchema, CompanyCreateSchema } from './zod';

describe('EmpresaFiscalSchema', () => {
  it('aceita Simples + Anexo III + Fator R', () => {
    const r = EmpresaFiscalSchema.partial().safeParse({
      regime_tributario: 'simples', Code_regime_tributario: '1',
      anexo_simples: 'Anexo III', usa_fator_r: true, cnae_principal: '6201-5/01',
    });
    expect(r.success).toBe(true);
  });
  it('rejeita Code inválido', () => {
    const r = EmpresaFiscalSchema.partial().safeParse({ Code_regime_tributario: '9' });
    expect(r.success).toBe(false);
  });
  it('aceita MEI sem anexo (partial)', () => {
    const r = EmpresaFiscalSchema.partial().safeParse({ regime_tributario: 'mei', Code_regime_tributario: '4' });
    expect(r.success).toBe(true);
  });
  it('rejeita cnae_principal vazio', () => {
    const r = EmpresaFiscalSchema.partial().safeParse({ cnae_principal: '' });
    expect(r.success).toBe(false);
  });
});

describe('CompanySchema — endereço obrigatório (edição)', () => {
  const base = { cnpj: '45987654000132', razao_social: 'Empresa X', logradouro: 'Rua A', municipio: 'Curitiba', uf: 'PR' };
  it('aceita com endereço (CNPJ só por comprimento — edição não revalida dígitos)', () => {
    expect(CompanySchema.safeParse(base).success).toBe(true);
  });
  it('rejeita sem logradouro/municipio/uf', () => {
    expect(CompanySchema.safeParse({ cnpj: '45987654000132', razao_social: 'Empresa X' }).success).toBe(false);
    expect(CompanySchema.safeParse({ ...base, logradouro: '' }).success).toBe(false);
    expect(CompanySchema.safeParse({ ...base, municipio: '' }).success).toBe(false);
    expect(CompanySchema.safeParse({ ...base, uf: '' }).success).toBe(false);
  });
});

describe('CompanyCreateSchema — cadastro (CNPJ válido + endereço)', () => {
  const ok = { cnpj: '11222333000181', razao_social: 'Empresa X', logradouro: 'Rua A', municipio: 'Curitiba', uf: 'PR' };
  it('aceita cadastro com CNPJ válido + endereço', () => {
    expect(CompanyCreateSchema.safeParse(ok).success).toBe(true);
  });
  it('rejeita CNPJ inválido (dígitos verificadores)', () => {
    expect(CompanyCreateSchema.safeParse({ ...ok, cnpj: '45987654000132' }).success).toBe(false);
  });
  it('rejeita endereço incompleto', () => {
    expect(CompanyCreateSchema.safeParse({ ...ok, logradouro: '' }).success).toBe(false);
  });
});
