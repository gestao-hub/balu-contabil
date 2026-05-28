import { describe, it, expect } from 'vitest';
import {
  buildSaudeChecks,
  isInFutureISO,
  daysUntilISO,
  type SaudeState,
} from './saude-empresa';

const NOW = new Date('2026-05-28T12:00:00Z');

const BASE: SaudeState = {
  municipio: 'Londrina',
  uf: 'PR',
  municipioInfo: { producao_disponivel: 'sim', homologacao_disponivel: 'sim', provedor: 'ISSWeb' },
  certPresente: true,
  certNotAfter: '2027-03-20T00:00:00Z',
  serproTokenExpiration: '2026-05-28T13:00:00Z',
  focusStatus: 'ok',
  focusToken: 'XYZ',
  focusLastCheck: '2026-05-28T11:00:00Z',
  focusLastError: null,
};

describe('isInFutureISO', () => {
  it('true para data no futuro além do skew', () => {
    expect(isInFutureISO('2026-05-28T13:00:00Z', NOW, 5*60*1000)).toBe(true);
  });
  it('false para data passada', () => {
    expect(isInFutureISO('2026-05-28T11:59:00Z', NOW, 0)).toBe(false);
  });
  it('false para skew que engole o futuro próximo', () => {
    expect(isInFutureISO('2026-05-28T12:01:00Z', NOW, 5*60*1000)).toBe(false);
  });
  it('false para null/inválido', () => {
    expect(isInFutureISO(null, NOW)).toBe(false);
    expect(isInFutureISO('not-a-date', NOW)).toBe(false);
  });
});

describe('daysUntilISO', () => {
  it('positivo no futuro', () => {
    expect(daysUntilISO('2026-06-07T12:00:00Z', NOW)).toBe(10);
  });
  it('negativo no passado', () => {
    expect(daysUntilISO('2026-05-23T12:00:00Z', NOW)).toBe(-5);
  });
  it('null para inválido', () => {
    expect(daysUntilISO(null, NOW)).toBeNull();
  });
});

describe('buildSaudeChecks — happy path (tudo ok)', () => {
  const checks = buildSaudeChecks(BASE, NOW);
  it('5 checks', () => expect(checks).toHaveLength(5));
  it('todas as labels esperadas', () => {
    expect(checks.map((c) => c.key)).toEqual([
      'cidade_nfse', 'cert_presente', 'cert_valido', 'serpro', 'focus_cadastro',
    ]);
  });
  it('todas com status=ok', () => {
    expect(checks.every((c) => c.status === 'ok')).toBe(true);
  });
});

describe('cidade_nfse', () => {
  it('pendente quando endereço incompleto', () => {
    const [check] = buildSaudeChecks({ ...BASE, municipio: null }, NOW);
    expect(check!.status).toBe('pendente');
    expect(check!.action).toBe('editar_endereco');
  });
  it('erro quando município não está na base', () => {
    const [check] = buildSaudeChecks({ ...BASE, municipioInfo: null }, NOW);
    expect(check!.status).toBe('erro');
  });
  it('pendente quando producao_disponivel != "sim"', () => {
    const [check] = buildSaudeChecks(
      { ...BASE, municipioInfo: { ...BASE.municipioInfo!, producao_disponivel: 'nao' } },
      NOW,
    );
    expect(check!.status).toBe('pendente');
  });
});

describe('cert_presente + cert_valido', () => {
  it('cert_presente=pendente quando ausente; cert_valido sem nada a verificar', () => {
    const checks = buildSaudeChecks({ ...BASE, certPresente: false, certNotAfter: null }, NOW);
    expect(checks[1]!.status).toBe('pendente');
    expect(checks[1]!.action).toBe('upload_cert');
    expect(checks[2]!.status).toBe('pendente'); // cert_valido: sem cert pra verificar
  });
  it('cert_valido=erro quando expirado', () => {
    const checks = buildSaudeChecks({ ...BASE, certNotAfter: '2026-04-01T00:00:00Z' }, NOW);
    expect(checks[2]!.status).toBe('erro');
    expect(checks[2]!.hint).toMatch(/Expirado/);
  });
  it('cert_valido=pendente quando vence em ≤30 dias', () => {
    const checks = buildSaudeChecks({ ...BASE, certNotAfter: '2026-06-15T12:00:00Z' }, NOW);
    expect(checks[2]!.status).toBe('pendente');
    expect(checks[2]!.hint).toMatch(/Vence em/);
  });
});

describe('serpro', () => {
  it('pendente quando token nunca obtido', () => {
    const checks = buildSaudeChecks({ ...BASE, serproTokenExpiration: null }, NOW);
    expect(checks[3]!.status).toBe('pendente');
    expect(checks[3]!.hint).toMatch(/nunca/i);
  });
  it('pendente quando expirado', () => {
    const checks = buildSaudeChecks({ ...BASE, serproTokenExpiration: '2026-05-28T11:00:00Z' }, NOW);
    expect(checks[3]!.status).toBe('pendente');
    expect(checks[3]!.hint).toMatch(/expirado/i);
  });
});

describe('focus_cadastro', () => {
  it('erro quando focusStatus=erro', () => {
    const checks = buildSaudeChecks({ ...BASE, focusStatus: 'erro', focusLastError: 'CNPJ inválido' }, NOW);
    expect(checks[4]!.status).toBe('erro');
    expect(checks[4]!.action).toBe('sync_focus');
    expect(checks[4]!.hint).toMatch(/CNPJ inválido/);
  });
  it('pendente quando nunca tentou', () => {
    const checks = buildSaudeChecks({ ...BASE, focusStatus: null, focusToken: null }, NOW);
    expect(checks[4]!.status).toBe('pendente');
    expect(checks[4]!.action).toBe('sync_focus');
  });
  it('ok exige tanto status=ok quanto token presente', () => {
    const checks = buildSaudeChecks({ ...BASE, focusStatus: 'ok', focusToken: null }, NOW);
    expect(checks[4]!.status).toBe('pendente'); // status=ok mas sem token
  });
});
