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
  const base = { cnpj: '45987654000132', razao_social: 'Empresa X', logradouro: 'Rua A', numero: '100', municipio: 'Curitiba', uf: 'PR' };
  it('aceita com endereço (CNPJ só por comprimento — edição não revalida dígitos)', () => {
    expect(CompanySchema.safeParse(base).success).toBe(true);
  });
  it('rejeita sem logradouro/municipio/uf', () => {
    expect(CompanySchema.safeParse({ cnpj: '45987654000132', razao_social: 'Empresa X', numero: '100' }).success).toBe(false);
    expect(CompanySchema.safeParse({ ...base, logradouro: '' }).success).toBe(false);
    expect(CompanySchema.safeParse({ ...base, municipio: '' }).success).toBe(false);
    expect(CompanySchema.safeParse({ ...base, uf: '' }).success).toBe(false);
  });
  it('número obrigatório, exceto quando sem_numero=true', () => {
    expect(CompanySchema.safeParse({ ...base, numero: '' }).success).toBe(false);
    expect(CompanySchema.safeParse({ ...base, numero: '', sem_numero: true }).success).toBe(true);
    expect(CompanySchema.safeParse({ cnpj: '45987654000132', razao_social: 'Empresa X', logradouro: 'Rua A', municipio: 'Curitiba', uf: 'PR', sem_numero: true }).success).toBe(true);
  });
});

describe('CompanyCreateSchema — cadastro (CNPJ válido + endereço)', () => {
  const ok = { cnpj: '11222333000181', razao_social: 'Empresa X', logradouro: 'Rua A', numero: '100', municipio: 'Curitiba', uf: 'PR' };
  it('aceita cadastro com CNPJ válido + endereço', () => {
    expect(CompanyCreateSchema.safeParse(ok).success).toBe(true);
  });
  it('rejeita CNPJ inválido (dígitos verificadores)', () => {
    expect(CompanyCreateSchema.safeParse({ ...ok, cnpj: '45987654000132' }).success).toBe(false);
  });
  it('rejeita endereço incompleto', () => {
    expect(CompanyCreateSchema.safeParse({ ...ok, logradouro: '' }).success).toBe(false);
  });
  it('número obrigatório, exceto quando sem_numero=true', () => {
    expect(CompanyCreateSchema.safeParse({ ...ok, numero: '' }).success).toBe(false);
    expect(CompanyCreateSchema.safeParse({ ...ok, numero: '', sem_numero: true }).success).toBe(true);
  });
});

describe('EmpresaFiscalSchema — campos NFS-e (PR 1.5)', () => {
  it('aceita campos NFS-e (partial)', () => {
    const r = EmpresaFiscalSchema.partial().safeParse({
      municipio_id: '084333fa-1d48-4b6c-bdeb-b5da5cd3d73a',
      inscricao_municipal: '12345',
      serie_rps: 'RPS',
      numero_rps_inicial: 1,
      nfse_autenticacao_tipo: 'Login e Senha',
      nfse_usuario_login: 'user',
      nfse_senha_login: 'pass',
      nfse_habilitada: true,
      empresa_fiscal_ativada: true,
    });
    expect(r.success).toBe(true);
  });
  it('coage numero_rps_inicial de string', () => {
    const r = EmpresaFiscalSchema.partial().safeParse({ numero_rps_inicial: '10' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.numero_rps_inicial).toBe(10);
  });
  it('rejeita municipio_id não-uuid', () => {
    expect(EmpresaFiscalSchema.partial().safeParse({ municipio_id: 'abc' }).success).toBe(false);
  });
});
