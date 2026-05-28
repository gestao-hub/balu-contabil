import { describe, it, expect } from 'vitest';
import {
  buildFocusEmpresaUpdatePayload,
  decidirFlagsNfse,
  withCertificado,
  withCredenciaisPrefeitura,
  type FocusEmpresaFiscalForUpdate,
  type FocusEmpresaUpdatePayload,
} from './focus-empresa-update-payload';
import type { FocusEmpresaCompany } from './focus-empresa-payload';

const COMPANY: FocusEmpresaCompany = {
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
  email: 'contato@acme.com',
  telefone: '4133221100',
  inscricao_estadual: '1234567890',
  inscricao_municipal: '987654',
};

const FISCAL: FocusEmpresaFiscalForUpdate = {
  Code_regime_tributario: '1',
  empresa_fiscal_ativada: true,
};

const LONDRINA = '4113700';
const CURITIBA = '4106902';
const NOW_HOJE = new Date('2026-05-28T12:00:00Z');

describe('decidirFlagsNfse', () => {
  it('aderente NFSe Nacional + hom → habilita_nfsen_homologacao', () => {
    expect(decidirFlagsNfse(LONDRINA, 'hom', true, NOW_HOJE)).toEqual({
      habilita_nfsen_homologacao: true,
    });
  });

  it('aderente NFSe Nacional + prod → habilita_nfsen_producao', () => {
    expect(decidirFlagsNfse(LONDRINA, 'prod', true, NOW_HOJE)).toEqual({
      habilita_nfsen_producao: true,
    });
  });

  it('cidade legada → habilita_nfse', () => {
    expect(decidirFlagsNfse(CURITIBA, 'hom', true, NOW_HOJE)).toEqual({
      habilita_nfse: true,
    });
  });

  it('empresa desativada → flag = false (não some)', () => {
    expect(decidirFlagsNfse(LONDRINA, 'hom', false, NOW_HOJE)).toEqual({
      habilita_nfsen_homologacao: false,
    });
    expect(decidirFlagsNfse(CURITIBA, 'hom', false, NOW_HOJE)).toEqual({
      habilita_nfse: false,
    });
  });

  it('codigoIbge null → cidade tratada como legada', () => {
    expect(decidirFlagsNfse(null, 'hom', true, NOW_HOJE)).toEqual({
      habilita_nfse: true,
    });
  });
});

describe('buildFocusEmpresaUpdatePayload', () => {
  it('Londrina (aderente) hom → habilita_nfsen_homologacao, sem login_responsavel', () => {
    const p = buildFocusEmpresaUpdatePayload(COMPANY, FISCAL, LONDRINA, 'hom', NOW_HOJE);
    expect(p.habilita_nfsen_homologacao).toBe(true);
    expect(p.habilita_nfse).toBeUndefined();
    expect(p.habilita_nfsen_producao).toBeUndefined();
    expect(p.login_responsavel).toBeUndefined();
    expect(p.senha_responsavel).toBeUndefined();
    expect(p.codigo_municipio).toBe(LONDRINA);
  });

  it('payload BASE nunca inclui credenciais prefeitura', () => {
    // Por design (Focus 2.2): credenciais saem no upsertEmpresaFiscalAction via
    // withCredenciaisPrefeitura, não no payload base. O tipo
    // FocusEmpresaFiscalForUpdate inclusive não aceita mais esses campos.
    const p = buildFocusEmpresaUpdatePayload(COMPANY, FISCAL, CURITIBA, 'hom', NOW_HOJE);
    expect(p.habilita_nfse).toBe(true);
    expect(p.login_responsavel).toBeUndefined();
    expect(p.senha_responsavel).toBeUndefined();
  });

  it('payload BASE nunca inclui cert/senha_certificado', () => {
    const p = buildFocusEmpresaUpdatePayload(COMPANY, FISCAL, CURITIBA, 'hom', NOW_HOJE);
    expect(p.arquivo_certificado_base64).toBeUndefined();
    expect(p.senha_certificado).toBeUndefined();
  });

  it('endereço, IE, IM, telefone, email, regime — preenchidos vão no payload', () => {
    const p = buildFocusEmpresaUpdatePayload(COMPANY, FISCAL, CURITIBA, 'hom', NOW_HOJE);
    expect(p.nome).toBe('Acme Ltda');
    expect(p.nome_fantasia).toBe('Acme');
    expect(p.cnpj).toBe('12345678000123');
    expect(p.regime_tributario).toBe(1);
    expect(p.logradouro).toBe('Rua João da Silva');
    expect(p.numero).toBe('153');
    expect(p.bairro).toBe('Vila Isabel');
    expect(p.cep).toBe('80210000');
    expect(p.municipio).toBe('Curitiba');
    expect(p.uf).toBe('PR');
    expect(p.email).toBe('contato@acme.com');
    expect(p.telefone).toBe('4133221100');
    expect(p.inscricao_estadual).toBe('1234567890');
    expect(p.inscricao_municipal).toBe('987654');
    expect(p.codigo_municipio).toBe(CURITIBA);
  });

  it('sem_numero=true → numero="SN"', () => {
    const sn: FocusEmpresaCompany = { ...COMPANY, sem_numero: true, numero: null };
    const p = buildFocusEmpresaUpdatePayload(sn, FISCAL, CURITIBA, 'hom', NOW_HOJE);
    expect(p.numero).toBe('SN');
  });

  it('CNPJ com máscara → strip; CEP idem; telefone idem', () => {
    const masked: FocusEmpresaCompany = {
      ...COMPANY,
      cnpj: '12.345.678/0001-23',
      cep: '80210-000',
      telefone: '(41) 3322-1100',
    };
    const p = buildFocusEmpresaUpdatePayload(masked, FISCAL, CURITIBA, 'hom', NOW_HOJE);
    expect(p.cnpj).toBe('12345678000123');
    expect(p.cep).toBe('80210000');
    expect(p.telefone).toBe('4133221100');
  });

  it('nome_fantasia=razao_social → omite nome_fantasia', () => {
    const igual: FocusEmpresaCompany = { ...COMPANY, nome: 'Acme Ltda' };
    const p = buildFocusEmpresaUpdatePayload(igual, FISCAL, CURITIBA, 'hom', NOW_HOJE);
    expect(p.nome_fantasia).toBeUndefined();
  });

  it('regime ausente → lança', () => {
    const sem: FocusEmpresaFiscalForUpdate = { ...FISCAL, Code_regime_tributario: null };
    expect(() => buildFocusEmpresaUpdatePayload(COMPANY, sem, CURITIBA, 'hom', NOW_HOJE)).toThrow(/Regime/);
  });

  it('CNPJ inválido → lança', () => {
    const ruim: FocusEmpresaCompany = { ...COMPANY, cnpj: '123' };
    expect(() => buildFocusEmpresaUpdatePayload(ruim, FISCAL, CURITIBA, 'hom', NOW_HOJE)).toThrow(/CNPJ/);
  });

  it('empresa_fiscal_ativada=false → flag vira false', () => {
    const desativada: FocusEmpresaFiscalForUpdate = { ...FISCAL, empresa_fiscal_ativada: false };
    const p = buildFocusEmpresaUpdatePayload(COMPANY, desativada, LONDRINA, 'hom', NOW_HOJE);
    expect(p.habilita_nfsen_homologacao).toBe(false);
  });
});

describe('withCertificado', () => {
  const BASE: FocusEmpresaUpdatePayload = buildFocusEmpresaUpdatePayload(
    COMPANY, FISCAL, CURITIBA, 'hom', NOW_HOJE,
  );

  it('compõe arquivo_certificado_base64 + senha_certificado', () => {
    const p = withCertificado(BASE, 'ZmFrZS1wZng=', 'minha-senha');
    expect(p.arquivo_certificado_base64).toBe('ZmFrZS1wZng=');
    expect(p.senha_certificado).toBe('minha-senha');
  });

  it('não muta o payload original (retorna novo objeto)', () => {
    const p = withCertificado(BASE, 'X', 'Y');
    expect(BASE.arquivo_certificado_base64).toBeUndefined();
    expect(BASE.senha_certificado).toBeUndefined();
    expect(p).not.toBe(BASE);
  });

  it('lança se faltar pfxBase64 ou senha', () => {
    expect(() => withCertificado(BASE, '', 'X')).toThrow(/obrigatórios/);
    expect(() => withCertificado(BASE, 'X', '')).toThrow(/obrigatórios/);
  });

  it('preserva os demais campos do payload base', () => {
    const p = withCertificado(BASE, 'A', 'B');
    expect(p.cnpj).toBe(BASE.cnpj);
    expect(p.regime_tributario).toBe(BASE.regime_tributario);
    expect(p.habilita_nfse).toBe(BASE.habilita_nfse);
  });
});

describe('withCredenciaisPrefeitura', () => {
  const BASE: FocusEmpresaUpdatePayload = buildFocusEmpresaUpdatePayload(
    COMPANY, FISCAL, CURITIBA, 'hom', NOW_HOJE,
  );

  it('compõe login_responsavel + senha_responsavel quando ambos presentes', () => {
    const p = withCredenciaisPrefeitura(BASE, 'meu.login', 'minha-senha');
    expect(p.login_responsavel).toBe('meu.login');
    expect(p.senha_responsavel).toBe('minha-senha');
  });

  it('SEM login ou SEM senha → retorna payload inalterado (idempotente)', () => {
    expect(withCredenciaisPrefeitura(BASE, 'login', null).login_responsavel).toBeUndefined();
    expect(withCredenciaisPrefeitura(BASE, null, 'senha').login_responsavel).toBeUndefined();
    expect(withCredenciaisPrefeitura(BASE, '', 'X').login_responsavel).toBeUndefined();
    expect(withCredenciaisPrefeitura(BASE, 'X', '   ').login_responsavel).toBeUndefined();
  });

  it('faz trim antes de avaliar', () => {
    const p = withCredenciaisPrefeitura(BASE, '  user  ', '  pwd  ');
    expect(p.login_responsavel).toBe('user');
    expect(p.senha_responsavel).toBe('pwd');
  });

  it('não muta o payload original', () => {
    const p = withCredenciaisPrefeitura(BASE, 'u', 'p');
    expect(BASE.login_responsavel).toBeUndefined();
    expect(p).not.toBe(BASE);
  });
});
