import { describe, it, expect } from 'vitest';
import { traduzirErroFocus, extrairMensagemErro } from './focus-erro';

describe('traduzirErroFocus', () => {
  it('401 → mensagem amigável + CTA Diagnóstico', () => {
    const r = traduzirErroFocus('Focus POST /v2/nfsen → 401: unauthorized');
    expect(r).toMatch(/Token/);
    expect(r).toMatch(/Sincronizar com Focus/);
  });
  it('"Access denied" também cai em 401 amigável', () => {
    expect(traduzirErroFocus('HTTP Basic: Access denied.')).toMatch(/Sincronizar com Focus/);
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

describe('extrairMensagemErro', () => {
  it('DPS Nacional: callback.erros[0] com codigo e mensagem', () => {
    const payload = {
      request: { /* ... */ },
      callback: {
        status: 'erro_autorizacao',
        erros: [{ codigo: 'E0625', mensagem: 'CPF do tomador não encontrado no cadastro CPF.' }],
      },
    };
    const r = extrairMensagemErro(payload);
    expect(r).toEqual({ msg: 'CPF do tomador não encontrado no cadastro CPF.', codigo: 'E0625' });
  });

  it('multiplos erros: pega só o primeiro', () => {
    const payload = {
      callback: {
        erros: [
          { codigo: 'A', mensagem: 'primeiro' },
          { codigo: 'B', mensagem: 'segundo' },
        ],
      },
    };
    expect(extrairMensagemErro(payload)?.msg).toBe('primeiro');
  });

  it('NFe/NFCe: callback.mensagem (sem erros[])', () => {
    const payload = {
      callback: { status: 'rejeitado', mensagem: 'XML inválido' },
    };
    expect(extrairMensagemErro(payload)).toEqual({ msg: 'XML inválido', codigo: null });
  });

  it('erro síncrono: payload.error (sem callback)', () => {
    const payload = { request: {}, error: 'Focus POST /v2/nfsen → 401: Access denied' };
    expect(extrairMensagemErro(payload)?.msg).toMatch(/401/);
  });

  it('payload vazio → null', () => {
    expect(extrairMensagemErro({})).toBeNull();
    expect(extrairMensagemErro({ callback: {} })).toBeNull();
  });

  it('callback.erros vazio → null (não retorna entrada inválida)', () => {
    expect(extrairMensagemErro({ callback: { erros: [] } })).toBeNull();
  });

  it('erros[0] sem mensagem → null', () => {
    expect(extrairMensagemErro({ callback: { erros: [{ codigo: 'X' }] } })).toBeNull();
  });

  it('mensagem só com whitespace → null', () => {
    expect(extrairMensagemErro({ callback: { mensagem: '   ' } })).toBeNull();
    expect(extrairMensagemErro({ error: '' })).toBeNull();
  });
});
