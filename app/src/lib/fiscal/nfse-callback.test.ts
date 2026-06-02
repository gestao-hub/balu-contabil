import { describe, it, expect } from 'vitest';
import { extrairCamposNota } from './nfse-callback';

// Fixture REAL extraído do banco (callback Focus NFS-e Nacional, prod-restrita,
// validado 2026-05-28). NFS-e NÃO traz `chave_nfe` nem `protocolo` — a chave de
// acesso (50 dígitos) vem em `codigo_verificacao` e o nº da nota em `numero`.
const CALLBACK_NFSE = {
  ref: '41a9c2a4-bbd37ce0-e938-4c3c-ac92-2eb8c7d160a5',
  url: 'https://www.producaorestrita.nfse.gov.br/consultapublica/?tpc=1&chave=41137002210358425000120000000000000826055372910178',
  numero: '8',
  status: 'autorizado',
  tipo_rps: '1',
  serie_rps: '1',
  numero_rps: '8353362',
  url_danfse: 'https://focusnfe.s3.sa-east-1.amazonaws.com/.../NFS...178.pdf',
  data_emissao: '2026-05-28T19:45:51-03:00',
  cnpj_prestador: '10358425000120',
  codigo_verificacao: '41137002210358425000120000000000000826055372910178',
  caminho_xml_nota_fiscal: '/.../NFS...178-nfse.xml',
};

describe('extrairCamposNota', () => {
  it('mapeia a chave de acesso da NFS-e a partir de codigo_verificacao', () => {
    expect(extrairCamposNota(CALLBACK_NFSE).chaveAcesso).toBe(
      '41137002210358425000120000000000000826055372910178',
    );
  });

  it('expõe número da NFS-e e URL de consulta pública', () => {
    const c = extrairCamposNota(CALLBACK_NFSE);
    expect(c.numero).toBe('8');
    expect(c.urlConsulta).toBe(CALLBACK_NFSE.url);
  });

  it('NFS-e não tem protocolo de autorização → null', () => {
    expect(extrairCamposNota(CALLBACK_NFSE).protocolo).toBeNull();
  });

  it('mapeia PDF (url_danfse) e XML (caminho_xml_nota_fiscal) da NFS-e', () => {
    const c = extrairCamposNota(CALLBACK_NFSE);
    expect(c.pdf).toBe(CALLBACK_NFSE.url_danfse);
    expect(c.xml).toBe(CALLBACK_NFSE.caminho_xml_nota_fiscal);
  });

  it('fallback NF-e: chave_nfe → chaveAcesso, protocolo preservado', () => {
    const c = extrairCamposNota({
      chave_nfe: '4113...0000',
      protocolo: '135250000123456',
      numero: 42,
      serie: 1,
      caminho_danfe: '/x.pdf',
      xml_url: '/x.xml',
    });
    expect(c.chaveAcesso).toBe('4113...0000');
    expect(c.protocolo).toBe('135250000123456');
    expect(c.numero).toBe('42');
    expect(c.serie).toBe('1');
    expect(c.pdf).toBe('/x.pdf');
    expect(c.xml).toBe('/x.xml');
  });

  it('codigo_verificacao tem prioridade sobre chave_nfe quando ambos vierem', () => {
    expect(extrairCamposNota({ codigo_verificacao: 'CV', chave_nfe: 'NFE' }).chaveAcesso).toBe('CV');
  });

  it('callback vazio → tudo null', () => {
    expect(extrairCamposNota({})).toEqual({
      chaveAcesso: null,
      protocolo: null,
      numero: null,
      serie: null,
      pdf: null,
      xml: null,
      urlConsulta: null,
    });
  });
});
