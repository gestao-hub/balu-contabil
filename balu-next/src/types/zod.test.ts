import { describe, it, expect } from 'vitest';
import { EmpresaFiscalSchema, CompanySchema, CompanyCreateSchema, AberturaCreateSchema, HonorarioSchema } from './zod';
import { EMPTY_ABERTURA } from '@/types/abertura';

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
  const ok = { cnpj: '11222333000181', razao_social: 'Empresa X', logradouro: 'Rua A', numero: '100', municipio: 'Curitiba', uf: 'PR', Code_regime_tributario: '1' as const };
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
  it('exige Code_regime_tributario no cadastro', () => {
    const { Code_regime_tributario: _omit, ...semRegime } = ok;
    expect(CompanyCreateSchema.safeParse(semRegime).success).toBe(false);
    expect(CompanyCreateSchema.safeParse({ ...ok, Code_regime_tributario: '5' }).success).toBe(false);
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

describe('AberturaCreateSchema', () => {
  const valid = {
    ...EMPTY_ABERTURA,
    titular_nome_completo: 'Ana Souza',
    titular_cpf: '52998224725', // CPF válido
    empresa_razao_social_1: 'Ana Souza ME',
    empresa_tipo: 'MEI',
    empresa_regime_tributario: 'MEI',
    sede_tipo_endereco: 'Residencial',
  };

  it('aceita um payload mínimo válido', () => {
    expect(AberturaCreateSchema.safeParse(valid).success).toBe(true);
  });

  it('rejeita CPF inválido', () => {
    expect(AberturaCreateSchema.safeParse({ ...valid, titular_cpf: '11111111111' }).success).toBe(false);
  });

  it('rejeita empresa_tipo fora do enum', () => {
    expect(AberturaCreateSchema.safeParse({ ...valid, empresa_tipo: 'SA' }).success).toBe(false);
  });

  it('exige razão social 1 e nome do titular', () => {
    expect(AberturaCreateSchema.safeParse({ ...valid, empresa_razao_social_1: '' }).success).toBe(false);
    expect(AberturaCreateSchema.safeParse({ ...valid, titular_nome_completo: '' }).success).toBe(false);
  });
});

describe('HonorarioSchema', () => {
  const base = {
    cliente_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    company_id: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    mes_referencia: '202606',
    valor: 500,
    data_vencimento: '2026-06-10',
  };

  it('aceita payload mínimo válido', () => {
    expect(HonorarioSchema.safeParse(base).success).toBe(true);
  });

  it('rejeita mes_referencia com formato inválido', () => {
    expect(HonorarioSchema.safeParse({ ...base, mes_referencia: '062026' }).success).toBe(false);
    expect(HonorarioSchema.safeParse({ ...base, mes_referencia: '2026-06' }).success).toBe(false);
  });

  it('rejeita valor negativo', () => {
    expect(HonorarioSchema.safeParse({ ...base, valor: -1 }).success).toBe(false);
  });

  it('rejeita cliente_id não-UUID', () => {
    expect(HonorarioSchema.safeParse({ ...base, cliente_id: 'nao-uuid' }).success).toBe(false);
  });

  it('data_vencimento é obrigatória', () => {
    const { data_vencimento, ...sem } = base;
    expect(HonorarioSchema.safeParse(sem).success).toBe(false);
  });
});
