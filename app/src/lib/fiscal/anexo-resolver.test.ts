import { describe, it, expect } from 'vitest';
import { resolverAnexo } from './anexo-resolver';
import type { FatorRResult } from './fator-r';

const sufIII: FatorRResult = { fatorR: 0.31, anexoDecidido: 'Anexo III', suficiente: true };
const insuf: FatorRResult = { fatorR: null, anexoDecidido: null, suficiente: false };

describe('resolverAnexo', () => {
  it('CNAE mapeado sem Fator R usa o catálogo', () => {
    const r = resolverAnexo({
      cnaePrincipal: '4744005',
      cnaeAnexo: { codigo: '4744005', anexo_base: 'Anexo I', fator_r: false },
      anexoManual: 'Anexo III',
    });
    expect(r.anexo).toBe('Anexo I');
    expect(r.origem).toBe('cnae');
  });

  it('Fator R suficiente crava o anexo decidido com % no aviso', () => {
    const r = resolverAnexo({
      cnaePrincipal: '6201501',
      cnaeAnexo: { codigo: '6201501', anexo_base: null, fator_r: true },
      anexoManual: 'Anexo V',
      fatorR: sufIII,
    });
    expect(r.anexo).toBe('Anexo III');
    expect(r.origem).toBe('fator_r');
    expect(r.fatorR).toBeCloseTo(0.31, 5);
    expect(r.aviso).toContain('31.0%');
  });

  it('Fator R insuficiente cai no manual pedindo a folha', () => {
    const r = resolverAnexo({
      cnaePrincipal: '6201501',
      cnaeAnexo: { codigo: '6201501', anexo_base: null, fator_r: true },
      anexoManual: 'Anexo V',
      fatorR: insuf,
    });
    expect(r.anexo).toBe('Anexo V');
    expect(r.origem).toBe('manual');
    expect(r.aviso).toContain('folha');
  });

  it('Fator R sem dado (undefined) mantém o comportamento atual (manual)', () => {
    const r = resolverAnexo({
      cnaePrincipal: '6201501',
      cnaeAnexo: { codigo: '6201501', anexo_base: null, fator_r: true },
      anexoManual: 'Anexo III',
    });
    expect(r.origem).toBe('manual');
  });

  it('sem CNAE cai no manual', () => {
    const r = resolverAnexo({ cnaePrincipal: null, cnaeAnexo: null, anexoManual: 'Anexo III' });
    expect(r.origem).toBe('manual');
    expect(r.anexo).toBe('Anexo III');
  });
});
