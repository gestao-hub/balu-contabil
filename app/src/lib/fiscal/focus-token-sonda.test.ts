import { describe, it, expect } from 'vitest';
import { classificarSondaTokenFocus, combinarSondaProducao } from './focus-token-sonda';

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

// A regra que separa o token PRINCIPAL de produção de um token qualquer da
// conta (27/08/2026). Pura, então testável sem rede — e é a que decide o que o
// admin vê na tela.
describe('combinarSondaProducao', () => {
  const RECUSA = { status: 'recusado', motivo: 'Focus → 401: permissao_negada' } as const;
  const DUVIDA = { status: 'indeterminado', motivo: 'ETIMEDOUT' } as const;
  const OK = { status: 'aceito' } as const;

  it('catálogo aceito + empresas aceito → aceito', () => {
    expect(combinarSondaProducao(OK, OK)).toEqual({ status: 'aceito' });
  });

  it('catálogo aceito + empresas 401 → nao_principal, e o motivo nomeia o endpoint', () => {
    const r = combinarSondaProducao(OK, RECUSA);
    expect(r.status).toBe('nao_principal');
    // Positivo, não "não é recusado": o motivo é o que vira instrução na tela.
    if (r.status === 'nao_principal') expect(r.motivo).toMatch(/GET \/v2\/empresas/);
  });

  it('catálogo recusado NÃO vira nao_principal — o erro é campo trocado, não token secundário', () => {
    // Um token de homologação colado no campo de produção leva 401 nas DUAS
    // sondas. Chamá-lo de "não principal" mandaria o admin ao painel da Focus
    // procurar um token que ele já tem.
    expect(combinarSondaProducao(RECUSA, RECUSA)).toEqual(RECUSA);
    expect(combinarSondaProducao(RECUSA, OK)).toEqual(RECUSA);
  });

  it('dúvida no catálogo encerra o assunto — a segunda pergunta não tem base', () => {
    expect(combinarSondaProducao(DUVIDA, OK)).toEqual(DUVIDA);
  });

  it('catálogo aceito + empresas indeterminado → indeterminado, NUNCA aceito', () => {
    // Dizer "aceito" aqui é a mentira exata que esta correção existe para
    // acabar: o token está provado válido, e não provado principal.
    const r = combinarSondaProducao(OK, DUVIDA);
    expect(r.status).toBe('indeterminado');
    if (r.status === 'indeterminado') expect(r.motivo).toMatch(/\/v2\/empresas/);
  });
});
