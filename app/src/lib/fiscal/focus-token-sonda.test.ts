import { describe, it, expect } from 'vitest';
import { classificarSondaTokenFocus } from './focus-token-sonda';

describe('classificarSondaTokenFocus', () => {
  it('sem erro (sondagem passou) → aceito', () => {
    expect(classificarSondaTokenFocus(null)).toEqual({ status: 'aceito' });
    expect(classificarSondaTokenFocus(undefined)).toEqual({ status: 'aceito' });
  });

  it('401 → recusado — token não vale nesse ambiente', () => {
    const r = classificarSondaTokenFocus(
      new Error('Focus GET /v2/codigos_cnae/6201501 → 401: denied'),
    );
    expect(r.status).toBe('recusado');
    if (r.status === 'recusado') expect(r.motivo).toMatch(/401/);
  });

  it('403 → recusado', () => {
    const r = classificarSondaTokenFocus(
      new Error('Focus GET /v2/codigos_cnae/6201501 → 403: forbidden'),
    );
    expect(r.status).toBe('recusado');
  });

  it('404 → indeterminado — o código é fixo e não deveria faltar; não é evidência de token bom nem ruim', () => {
    const r = classificarSondaTokenFocus(
      new Error('Focus GET /v2/codigos_cnae/6201501 → 404: not found'),
    );
    expect(r.status).toBe('indeterminado');
  });

  it('5xx → indeterminado, não recusado', () => {
    const r = classificarSondaTokenFocus(new Error('Focus GET /v2/codigos_cnae/6201501 → 500: boom'));
    expect(r.status).toBe('indeterminado');
  });

  it('erro de rede sem status → indeterminado', () => {
    const r = classificarSondaTokenFocus(new Error('ETIMEDOUT'));
    expect(r.status).toBe('indeterminado');
    if (r.status === 'indeterminado') expect(r.motivo).toBe('ETIMEDOUT');
  });

  it('erro que não é instância de Error é convertido para string', () => {
    const r = classificarSondaTokenFocus('→ 401 string crua');
    expect(r.status).toBe('recusado');
  });
});
