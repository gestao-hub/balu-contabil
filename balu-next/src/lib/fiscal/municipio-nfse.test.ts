import { describe, it, expect } from 'vitest';
import { normalizeNome, credenciaisDaAutenticacao } from './municipio-nfse';

describe('normalizeNome', () => {
  it('remove acentos, caixa e espaços', () => {
    expect(normalizeNome('São Paulo')).toBe('sao paulo');
    expect(normalizeNome('  CURITIBA ')).toBe('curitiba');
    expect(normalizeNome('Açu')).toBe('acu');
    expect(normalizeNome(null)).toBe('');
  });
  it('nomes equivalentes batem após normalizar', () => {
    expect(normalizeNome('São Paulo')).toBe(normalizeNome('sao paulo'));
  });
});

describe('credenciaisDaAutenticacao', () => {
  it('Login e Senha', () => {
    expect(credenciaisDaAutenticacao('Login e Senha')).toEqual({ login: true, token: false, certificado: false });
  });
  it('Token', () => {
    expect(credenciaisDaAutenticacao('Token')).toEqual({ login: false, token: true, certificado: false });
  });
  it('Certificado digital', () => {
    expect(credenciaisDaAutenticacao('Certificado digital')).toEqual({ login: false, token: false, certificado: true });
  });
  it('combinação Certificado digital, Login e Senha, Token', () => {
    expect(credenciaisDaAutenticacao('Certificado digital, Login e Senha, Token')).toEqual({ login: true, token: true, certificado: true });
  });
  it('Não possui / null → nenhum', () => {
    expect(credenciaisDaAutenticacao('Não possui')).toEqual({ login: false, token: false, certificado: false });
    expect(credenciaisDaAutenticacao(null)).toEqual({ login: false, token: false, certificado: false });
  });
});
