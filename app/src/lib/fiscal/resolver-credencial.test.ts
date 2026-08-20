// Bloco 5 — a guarda de producao. O teste central do bloco.
import { describe, it, expect } from 'vitest';
import { decidirCredencial, type EstadoFiscal } from './resolver-credencial';

const AMANHA = new Date(Date.now() + 86_400_000).toISOString();
const ONTEM = new Date(Date.now() - 86_400_000).toISOString();

const PRONTA: EstadoFiscal = {
  origem: 'balu',
  ambiente: 'prod',
  tokenHom: 'tok-hom',
  tokenProd: 'tok-prod',
  certNotAfter: AMANHA,
  habilitaProducaoFocus: true,
  producaoDeclarada: false,
};

describe('decidirCredencial', () => {
  it('as quatro verdadeiras → producao', () => {
    expect(decidirCredencial(PRONTA)).toEqual({ ok: true, ambiente: 'prod', token: 'tok-prod' });
  });

  it('ambiente hom → homologacao, sem exigir nada de producao', () => {
    const r = decidirCredencial({ ...PRONTA, ambiente: 'hom', tokenProd: null, certNotAfter: null });
    expect(r).toEqual({ ok: true, ambiente: 'hom', token: 'tok-hom' });
  });

  // NUNCA cair em homologacao quando pediram producao (decisao D5).
  it('sem token de producao → ERRO nomeado, nao queda para hom', () => {
    const r = decidirCredencial({ ...PRONTA, tokenProd: null });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.motivo).toBe('sem_token_producao');
  });

  it('certificado vencido → erro nomeado', () => {
    const r = decidirCredencial({ ...PRONTA, certNotAfter: ONTEM });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.motivo).toBe('certificado_invalido');
  });

  it('sem certificado nenhum → erro nomeado', () => {
    const r = decidirCredencial({ ...PRONTA, certNotAfter: null });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.motivo).toBe('certificado_invalido');
  });

  it('origem balu sem habilitacao na Focus → erro', () => {
    const r = decidirCredencial({ ...PRONTA, habilitaProducaoFocus: false });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.motivo).toBe('producao_nao_habilitada');
  });

  // Para origem propria a habilitacao NAO e verificavel (GET /v2/empresas
  // bloqueado). Vale a DECLARACAO de quem cadastrou.
  it('origem propria aceita a declaracao no lugar do snapshot', () => {
    const r = decidirCredencial({
      ...PRONTA, origem: 'propria', habilitaProducaoFocus: false, producaoDeclarada: true,
    });
    expect(r).toEqual({ ok: true, ambiente: 'prod', token: 'tok-prod' });
  });

  it('origem propria sem declaracao → erro', () => {
    const r = decidirCredencial({
      ...PRONTA, origem: 'propria', habilitaProducaoFocus: false, producaoDeclarada: false,
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.motivo).toBe('producao_nao_habilitada');
  });

  it('homologacao sem token de homologacao → erro, nao token de producao', () => {
    const r = decidirCredencial({ ...PRONTA, ambiente: 'hom', tokenHom: null });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.motivo).toBe('sem_token_homologacao');
  });
});
