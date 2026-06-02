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
  it('null/undefined → nenhum', () => {
    expect(credenciaisDaAutenticacao(null)).toEqual({ login: false, token: false, certificado: false });
    expect(credenciaisDaAutenticacao(undefined)).toEqual({ login: false, token: false, certificado: false });
  });
  it('provedor não-Nacional sem requer_certificado → login+token, sem cert', () => {
    expect(credenciaisDaAutenticacao({ provedor_nfse: 'eGoverne', requer_certificado_nfse: false }))
      .toEqual({ login: true, token: true, certificado: false });
  });
  it('provedor não-Nacional com requer_certificado → login+token+cert', () => {
    expect(credenciaisDaAutenticacao({ provedor_nfse: 'eGoverne', requer_certificado_nfse: true }))
      .toEqual({ login: true, token: true, certificado: true });
  });
  it('provedor Nacional → só certificado', () => {
    expect(credenciaisDaAutenticacao({ provedor_nfse: 'NacionalAbrasf', requer_certificado_nfse: false }))
      .toEqual({ login: false, token: false, certificado: false });
    expect(credenciaisDaAutenticacao({ provedor_nfse: 'NacionalAbrasf', requer_certificado_nfse: true }))
      .toEqual({ login: false, token: false, certificado: true });
  });
  it('provedor null → login+token', () => {
    expect(credenciaisDaAutenticacao({ provedor_nfse: null, requer_certificado_nfse: null }))
      .toEqual({ login: true, token: true, certificado: false });
  });
});
