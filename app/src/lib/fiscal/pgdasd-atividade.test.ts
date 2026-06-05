import { describe, it, expect } from 'vitest';
import { idAtividadePadrao } from './pgdasd-atividade';

describe('idAtividadePadrao', () => {
  it('Fator R → 11 (serviço sujeito ao fator r; SERPRO decide III/V via folha)', () => {
    expect(idAtividadePadrao('Anexo III', true)).toBe(11);
    expect(idAtividadePadrao('Anexo V', true)).toBe(11);
    expect(idAtividadePadrao(null, true)).toBe(11);
  });
  it('Anexo I → 1 (revenda)', () => { expect(idAtividadePadrao('Anexo I', false)).toBe(1); });
  it('Anexo II → 4 (indústria)', () => { expect(idAtividadePadrao('Anexo II', false)).toBe(4); });
  it('Anexo III não-fator-r → 14', () => { expect(idAtividadePadrao('Anexo III', false)).toBe(14); });
  it('Anexo IV → 17', () => { expect(idAtividadePadrao('Anexo IV', false)).toBe(17); });
  it('Anexo V sem fator → 11 (V só ocorre via fator r)', () => { expect(idAtividadePadrao('Anexo V', false)).toBe(11); });
  it('sem anexo → 1 (fallback comércio)', () => { expect(idAtividadePadrao(null, false)).toBe(1); });
});
