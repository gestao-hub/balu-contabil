import { describe, it, expect } from 'vitest';
import {
  validarComprovanteGuia, caminhoComprovanteGuia, nomeExibivel,
  MAX_COMPROVANTE_GUIA_BYTES, BUCKET_COMPROVANTES_GUIA,
} from './comprovante-guia';

describe('validarComprovanteGuia', () => {
  it('aceita PDF, PNG e JPEG', () => {
    for (const mime of ['application/pdf', 'image/png', 'image/jpeg']) {
      expect(validarComprovanteGuia({ mime, tamanho: 1024 }).ok).toBe(true);
    }
  });

  it('recusa qualquer outro tipo — lista de permitidos, não de proibidos', () => {
    // O que não está na lista é recusado com nome, e não aceito por omissão.
    for (const mime of ['application/zip', 'text/html', 'image/svg+xml', '']) {
      expect(validarComprovanteGuia({ mime, tamanho: 1024 }).ok).toBe(false);
    }
  });

  it('recusa arquivo vazio', () => {
    expect(validarComprovanteGuia({ mime: 'application/pdf', tamanho: 0 }).ok).toBe(false);
  });

  it('recusa acima de 5 MB e aceita exatamente 5 MB', () => {
    expect(validarComprovanteGuia({ mime: 'application/pdf', tamanho: MAX_COMPROVANTE_GUIA_BYTES + 1 }).ok).toBe(false);
    expect(validarComprovanteGuia({ mime: 'application/pdf', tamanho: MAX_COMPROVANTE_GUIA_BYTES }).ok).toBe(true);
  });
});

describe('caminhoComprovanteGuia', () => {
  const empresa = 'c2410872-c9c0-47b5-a0e9-4d3e699a614e';
  const guia = '8f14e45f-ceea-467a-9c1e-1a1b2c3d4e5f';

  it('endereça por empresa e guia, com a extensão do MIME', () => {
    expect(caminhoComprovanteGuia(empresa, guia, 'application/pdf')).toBe(`${empresa}/${guia}.pdf`);
    expect(caminhoComprovanteGuia(empresa, guia, 'image/jpeg')).toBe(`${empresa}/${guia}.jpg`);
  });

  it('é determinístico: reanexar substitui em vez de acumular órfão', () => {
    expect(caminhoComprovanteGuia(empresa, guia, 'application/pdf'))
      .toBe(caminhoComprovanteGuia(empresa, guia, 'application/pdf'));
  });

  it('recusa id com barra ou ponto-ponto — path traversal não vira caminho', () => {
    // A empresa no começo do path é o que prende o arquivo ao dono; deixar um
    // `../` passar desmontaria essa garantia.
    expect(() => caminhoComprovanteGuia('../outra', guia, 'application/pdf')).toThrow();
    expect(() => caminhoComprovanteGuia(empresa, '../../etc/passwd', 'application/pdf')).toThrow();
    expect(() => caminhoComprovanteGuia(empresa, `${guia}/..`, 'application/pdf')).toThrow();
  });

  it('recusa MIME não suportado em vez de inventar extensão', () => {
    expect(() => caminhoComprovanteGuia(empresa, guia, 'application/zip')).toThrow();
  });

  it('o bucket é o privado desta feature', () => {
    expect(BUCKET_COMPROVANTES_GUIA).toBe('guias-comprovantes');
  });
});

describe('nomeExibivel', () => {
  it('preserva o nome que o cliente baixou do banco', () => {
    expect(nomeExibivel('comprovante_2026-07-19.pdf')).toBe('comprovante_2026-07-19.pdf');
  });

  it('tira separadores de caminho — o nome não endereça nada', () => {
    expect(nomeExibivel('../../etc/passwd')).toBe('....etcpasswd');
    expect(nomeExibivel('C:\\temp\\nota.pdf')).toBe('C:tempnota.pdf');
  });

  it('vazio ou só espaços vira um rótulo utilizável', () => {
    // Devolver '' deixaria o botão de download sem texto na tela.
    expect(nomeExibivel('')).toBe('comprovante');
    expect(nomeExibivel('   ')).toBe('comprovante');
    expect(nomeExibivel(null)).toBe('comprovante');
  });

  it('corta nome absurdamente longo', () => {
    expect(nomeExibivel('a'.repeat(500)).length).toBe(120);
  });
});
