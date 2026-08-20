import { describe, it, expect } from 'vitest';
import { classificarSondaRevendaFocus } from './focus-revenda-sonda';

describe('classificarSondaRevendaFocus', () => {
  it('sem erro (sondagem passou) → aceito', () => {
    expect(classificarSondaRevendaFocus(null)).toEqual({ status: 'aceito' });
    expect(classificarSondaRevendaFocus(undefined)).toEqual({ status: 'aceito' });
  });

  it('404 → aceito — token válido na revenda, só não achou o id da sonda', () => {
    const r = classificarSondaRevendaFocus(new Error('Focus GET /v2/empresas/1 → 404: not found'));
    expect(r).toEqual({ status: 'aceito' });
  });

  it('401 → recusado', () => {
    const r = classificarSondaRevendaFocus(new Error('Focus GET /v2/empresas/1 → 401: denied'));
    expect(r.status).toBe('recusado');
    if (r.status === 'recusado') expect(r.motivo).toMatch(/401/);
  });

  it('403 → recusado', () => {
    const r = classificarSondaRevendaFocus(new Error('Focus GET /v2/empresas/1 → 403: forbidden'));
    expect(r.status).toBe('recusado');
  });

  it('5xx → indeterminado, não recusado', () => {
    const r = classificarSondaRevendaFocus(new Error('Focus GET /v2/empresas/1 → 500: boom'));
    expect(r.status).toBe('indeterminado');
  });

  it('erro de rede sem status → indeterminado', () => {
    const r = classificarSondaRevendaFocus(new Error('ETIMEDOUT'));
    expect(r.status).toBe('indeterminado');
    if (r.status === 'indeterminado') expect(r.motivo).toBe('ETIMEDOUT');
  });

  it('erro que não é instância de Error é convertido para string', () => {
    const r = classificarSondaRevendaFocus('→ 401 string crua');
    expect(r.status).toBe('recusado');
  });
});
