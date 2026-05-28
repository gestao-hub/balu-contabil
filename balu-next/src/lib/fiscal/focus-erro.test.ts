import { describe, it, expect } from 'vitest';
import { traduzirErroFocus } from './focus-erro';

describe('traduzirErroFocus', () => {
  it('401 → mensagem amigável', () => {
    expect(traduzirErroFocus('Focus POST /v2/nfsen → 401: unauthorized')).toMatch(/Token Focus/);
  });
  it('403 → permissão', () => {
    expect(traduzirErroFocus('Forbidden 403')).toMatch(/permissão/);
  });
  it('CNPJ inválido', () => {
    expect(traduzirErroFocus('CNPJ inválido')).toMatch(/CNPJ inválido/);
  });
  it('certificado expirado', () => {
    expect(traduzirErroFocus('certificado expirado')).toMatch(/expirado/);
  });
  it('webservice prefeitura fora', () => {
    expect(traduzirErroFocus('webservice da prefeitura indisponivel')).toMatch(/prefeitura/);
  });
  it('timeout', () => {
    expect(traduzirErroFocus('ETIMEDOUT')).toMatch(/Tempo esgotado/);
  });
  it('codigo_tributacao inválido', () => {
    expect(traduzirErroFocus('codigo_tributacao não reconhecido')).toMatch(/Código de tributação/);
  });
  it('campo obrigatório', () => {
    const r = traduzirErroFocus('O campo dfe.prestador.cpf_cnpj é obrigatório.');
    expect(r).toMatch(/campo obrigatório/);
    expect(r).toMatch(/cpf_cnpj/);
  });
  it('mensagem desconhecida → fallback com prefixo', () => {
    expect(traduzirErroFocus('Focus POST /v2/nfsen → 500: surto cósmico')).toMatch(/^Erro Focus:/);
  });
  it('fallback: corta payload longo', () => {
    const longo = 'x'.repeat(500);
    expect(traduzirErroFocus(longo).length).toBeLessThan(280);
  });
});
