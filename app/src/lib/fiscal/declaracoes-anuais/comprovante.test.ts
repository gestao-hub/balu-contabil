// src/lib/fiscal/declaracoes-anuais/comprovante.test.ts
import { describe, it, expect } from 'vitest';
import { validarComprovante, caminhoComprovante, MAX_COMPROVANTE_BYTES, BUCKET_COMPROVANTES } from './comprovante';

describe('validarComprovante', () => {
  it('aceita PDF dentro do limite', () => {
    expect(validarComprovante({ mime: 'application/pdf', tamanho: 1024 })).toEqual({ ok: true });
  });

  it('aceita PNG e JPEG', () => {
    expect(validarComprovante({ mime: 'image/png', tamanho: 1024 }).ok).toBe(true);
    expect(validarComprovante({ mime: 'image/jpeg', tamanho: 1024 }).ok).toBe(true);
  });

  it('rejeita tipo não suportado', () => {
    const r = validarComprovante({ mime: 'application/zip', tamanho: 1024 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('PDF');
  });

  it('rejeita arquivo acima do limite', () => {
    const r = validarComprovante({ mime: 'application/pdf', tamanho: MAX_COMPROVANTE_BYTES + 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('5 MB');
  });

  it('rejeita arquivo vazio', () => {
    expect(validarComprovante({ mime: 'application/pdf', tamanho: 0 }).ok).toBe(false);
  });
});

describe('caminhoComprovante', () => {
  it('gera path determinístico por empresa, tipo e ano', () => {
    expect(caminhoComprovante('abc-123', 'DASN-SIMEI', 2025, 'application/pdf'))
      .toBe('abc-123/DASN-SIMEI-2025.pdf');
  });

  it('usa a extensão do tipo enviado', () => {
    expect(caminhoComprovante('abc-123', 'DEFIS', 2025, 'image/png')).toBe('abc-123/DEFIS-2025.png');
  });

  // Path determinístico é o que faz a retificadora substituir o recibo anterior
  // em vez de acumular lixo no bucket.
  it('repete o mesmo path para o mesmo trio', () => {
    const a = caminhoComprovante('x', 'DEFIS', 2024, 'application/pdf');
    const b = caminhoComprovante('x', 'DEFIS', 2024, 'application/pdf');
    expect(a).toBe(b);
  });

  it('rejeita companyId com barra (path traversal)', () => {
    expect(() => caminhoComprovante('../etc', 'DEFIS', 2025, 'application/pdf')).toThrow();
  });
});

describe('BUCKET_COMPROVANTES', () => {
  it('aponta para o bucket criado na 0048', () => {
    expect(BUCKET_COMPROVANTES).toBe('declaracoes-comprovantes');
  });
});
