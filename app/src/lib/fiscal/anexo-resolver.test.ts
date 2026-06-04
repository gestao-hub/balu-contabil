import { describe, it, expect } from 'vitest';
import { resolverAnexo } from './anexo-resolver';

describe('resolverAnexo', () => {
  it('CNAE mapeado com anexo_base e sem Fator R → usa o anexo do catálogo', () => {
    const r = resolverAnexo({
      cnaePrincipal: '4744005',
      cnaeAnexo: { codigo: '4744005', anexo_base: 'Anexo I', fator_r: false },
      anexoManual: 'Anexo III',
    });
    expect(r).toEqual({ anexo: 'Anexo I', origem: 'cnae' });
  });

  it('CNAE sujeito a Fator R → cai no manual com aviso', () => {
    const r = resolverAnexo({
      cnaePrincipal: '6201501',
      cnaeAnexo: { codigo: '6201501', anexo_base: null, fator_r: true },
      anexoManual: 'Anexo III',
    });
    expect(r.anexo).toBe('Anexo III');
    expect(r.origem).toBe('manual');
    expect(r.aviso).toMatch(/Fator R/i);
  });

  it('CNAE não mapeado → cai no manual com aviso', () => {
    const r = resolverAnexo({ cnaePrincipal: '9999999', cnaeAnexo: null, anexoManual: 'Anexo V' });
    expect(r).toEqual({ anexo: 'Anexo V', origem: 'manual', aviso: 'CNAE não mapeado — usando anexo informado.' });
  });

  it('sem CNAE principal → cai no manual com aviso específico', () => {
    const r = resolverAnexo({ cnaePrincipal: null, cnaeAnexo: null, anexoManual: 'Anexo III' });
    expect(r.origem).toBe('manual');
    expect(r.aviso).toMatch(/sem cnae/i);
  });
});
