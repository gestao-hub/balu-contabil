import { describe, it, expect } from 'vitest';
import { EmpresaFiscalSchema } from './zod';

describe('EmpresaFiscalSchema', () => {
  it('aceita Simples + Anexo III + Fator R', () => {
    const r = EmpresaFiscalSchema.partial().safeParse({
      regime_tributario: 'simples', Code_regime_tributario: '1',
      anexo_simples: 'Anexo III', usa_fator_r: true, cnae_principal: '6201-5/01',
    });
    expect(r.success).toBe(true);
  });
  it('rejeita Code inválido', () => {
    const r = EmpresaFiscalSchema.partial().safeParse({ Code_regime_tributario: '9' });
    expect(r.success).toBe(false);
  });
  it('aceita MEI sem anexo (partial)', () => {
    const r = EmpresaFiscalSchema.partial().safeParse({ regime_tributario: 'mei', Code_regime_tributario: '4' });
    expect(r.success).toBe(true);
  });
  it('rejeita cnae_principal vazio', () => {
    const r = EmpresaFiscalSchema.partial().safeParse({ cnae_principal: '' });
    expect(r.success).toBe(false);
  });
});
