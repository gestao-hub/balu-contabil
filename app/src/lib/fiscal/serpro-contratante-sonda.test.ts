import { describe, it, expect } from 'vitest';
import { classificarSondaContratanteSerpro } from './serpro-contratante-sonda';

describe('classificarSondaContratanteSerpro', () => {
  it('sem erro (autenticou) → aceito', () => {
    expect(classificarSondaContratanteSerpro(null)).toEqual({ status: 'aceito' });
    expect(classificarSondaContratanteSerpro(undefined)).toEqual({ status: 'aceito' });
  });

  it('401 → recusado', () => {
    const r = classificarSondaContratanteSerpro(new Error('SERPRO /authenticate → 401: denied'));
    expect(r.status).toBe('recusado');
    if (r.status === 'recusado') expect(r.motivo).toMatch(/401/);
  });

  it('403 → recusado', () => {
    const r = classificarSondaContratanteSerpro(new Error('SERPRO /authenticate → 403: forbidden'));
    expect(r.status).toBe('recusado');
  });

  it('5xx → indeterminado — o SERPRO não tem um "404 é ok" equivalente ao da Focus', () => {
    const r = classificarSondaContratanteSerpro(new Error('SERPRO /authenticate → 502: bad gateway'));
    expect(r.status).toBe('indeterminado');
  });

  it('timeout/erro de rede sem status → indeterminado', () => {
    const r = classificarSondaContratanteSerpro(new Error('ETIMEDOUT'));
    expect(r.status).toBe('indeterminado');
  });

  it('credenciais não configuradas → indeterminado (não é recusa da Receita)', () => {
    const r = classificarSondaContratanteSerpro(
      new Error('Credenciais do SERPRO não configuradas — preencha em /admin/configuracoes/serpro.'),
    );
    expect(r.status).toBe('indeterminado');
  });
});
