import { describe, it, expect } from 'vitest';
import {
  buildSaudeChecks,
  buildSaudeGroups,
  isInFutureISO,
  daysUntilISO,
  type SaudeState,
} from './saude-empresa';

const NOW = new Date('2026-05-28T12:00:00Z');

const BASE: SaudeState = {
  municipio: 'Londrina',
  uf: 'PR',
  codigoMunicipio: null,
  municipioInfo: { nfse_habilitada: true, status_nfse: 'ativo', provedor_nfse: 'ISSWeb', possui_ambiente_homologacao_nfse: true },
  certPresente: true,
  certNotAfter: '2027-03-20T00:00:00Z',
  serproTokenExpiration: '2026-05-28T13:00:00Z',
  contratanteConfigurado: true,
  focusStatus: 'ok',
  focusToken: 'XYZ',
  focusLastCheck: '2026-05-28T11:00:00Z',
  focusLastError: null,
  focusSnapshot: {
    habilitaNfse: true,                // habilitada → check 5 ok
    habilitaNfsenProducao: null,
    habilitaNfsenHomologacao: null,
    syncEm: '2026-05-28T10:00:00Z',
  },
  // Sem drift (dirty ≤ syncEm 10:00) — happy path do BASE.
  focusFieldsDirtyAt: '2026-05-28T09:30:00Z',
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

describe('cidade_nfse — pura capacidade Focus (independente da empresa)', () => {
  it('(a) pendente quando endereço incompleto', () => {
    const [check] = buildSaudeChecks({ ...BASE, municipio: null }, NOW);
    expect(check!.status).toBe('pendente');
    expect(check!.action).toBe('editar_endereco');
  });
  it('(b) aderente NFSe Nacional (Londrina codigo 4113700) → ok, mesmo sem municipios_nfse', () => {
    const [check] = buildSaudeChecks(
      { ...BASE, codigoMunicipio: '4113700', municipioInfo: null },
      NOW,
    );
    expect(check!.status).toBe('ok');
    expect(check!.hint).toMatch(/NFSe Nacional/);
  });
  it('(c) erro quando município não consta em lugar nenhum', () => {
    const [check] = buildSaudeChecks(
      { ...BASE, codigoMunicipio: '9999999', municipioInfo: null },
      NOW,
    );
    expect(check!.status).toBe('erro');
    expect(check!.hint).toMatch(/não consta/);
  });
  it('(d) producao_disponivel="Sim" → ok "atendida em produção"', () => {
    const [check] = buildSaudeChecks(
      { ...BASE, municipioInfo: { nfse_habilitada: true, status_nfse: 'ativo', provedor_nfse: 'Elotech', possui_ambiente_homologacao_nfse: true } },
      NOW,
    );
    expect(check!.status).toBe('ok');
    expect(check!.hint).toMatch(/produção/);
    expect(check!.hint).toMatch(/Elotech/);
  });
  it('(e) só homologação disponível → pendente "apenas em hom"', () => {
    const [check] = buildSaudeChecks(
      { ...BASE, municipioInfo: { nfse_habilitada: false, status_nfse: 'nao_implementado', provedor_nfse: 'X', possui_ambiente_homologacao_nfse: true } },
      NOW,
    );
    expect(check!.status).toBe('pendente');
    expect(check!.hint).toMatch(/apenas em homologação/);
  });
  it('(f) linha existe mas tudo null → pendente "aguardando atualização" (não engana com "só hom")', () => {
    const [check] = buildSaudeChecks(
      { ...BASE, municipioInfo: { nfse_habilitada: false, status_nfse: null, provedor_nfse: null, possui_ambiente_homologacao_nfse: null } },
      NOW,
    );
    expect(check!.status).toBe('pendente');
    expect(check!.hint).toMatch(/sem disponibilidade declarada/);
    expect(check!.hint).not.toMatch(/apenas em homologação/);
  });
  it('snapshot da Focus NÃO interfere no check de cidade (capacidade ≠ habilitação da empresa)', () => {
    // Mesmo com a empresa habilitada na Focus, se a cidade não consta E não é
    // aderente Nacional, o check 1 reporta erro de capacidade.
    const [check] = buildSaudeChecks(
      {
        ...BASE,
        codigoMunicipio: '9999999',
        municipioInfo: null,
        focusSnapshot: { habilitaNfse: true, habilitaNfsenProducao: true, habilitaNfsenHomologacao: null, syncEm: 'x' },
      },
      NOW,
    );
    expect(check!.status).toBe('erro');
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

describe('serproCheck — gate do contratante', () => {
  it('contratante não configurado → erro (gate global)', () => {
    const checks = buildSaudeChecks({ ...BASE, contratanteConfigurado: false }, NOW);
    const serpro = checks.find((c) => c.key === 'serpro')!;
    expect(serpro.status).toBe('erro');
    expect(serpro.label).toBe('Contratante SERPRO não configurado');
  });

  it('contratante ok + token válido → ok', () => {
    const checks = buildSaudeChecks(
      { ...BASE, contratanteConfigurado: true, serproTokenExpiration: '2026-05-28T13:00:00Z' },
      NOW,
    );
    expect(checks.find((c) => c.key === 'serpro')!.status).toBe('ok');
  });
});

describe('buildSaudeGroups — 4 grupos com roll-up', () => {
  it('retorna 4 grupos na ordem: cidade, certificado, serpro, focus', () => {
    const groups = buildSaudeGroups(BASE, NOW);
    expect(groups.map((g) => g.key)).toEqual(['cidade', 'certificado', 'serpro', 'focus']);
  });

  it('cidade e serpro têm 1 item; certificado e focus têm 2', () => {
    const groups = buildSaudeGroups(BASE, NOW);
    expect(groups[0]!.items).toHaveLength(1);
    expect(groups[1]!.items).toHaveLength(2);
    expect(groups[2]!.items).toHaveLength(1);
    expect(groups[3]!.items).toHaveLength(2);
  });

  it('certificado: roll-up erro quando algum item está erro', () => {
    const groups = buildSaudeGroups({ ...BASE, certNotAfter: '2026-04-01T00:00:00Z' }, NOW);
    const cert = groups.find((g) => g.key === 'certificado')!;
    expect(cert.status).toBe('erro');
    expect(cert.items[1]!.status).toBe('erro'); // Válido
  });

  it('certificado: roll-up pendente quando enviado=false e válido=pendente', () => {
    const groups = buildSaudeGroups({ ...BASE, certPresente: false, certNotAfter: null }, NOW);
    const cert = groups.find((g) => g.key === 'certificado')!;
    expect(cert.status).toBe('pendente');
    expect(cert.items.every((i) => i.status === 'pendente')).toBe(true);
  });

  it('certificado: roll-up ok quando ambos itens ok', () => {
    const groups = buildSaudeGroups(BASE, NOW);
    const cert = groups.find((g) => g.key === 'certificado')!;
    expect(cert.status).toBe('ok');
  });

  it('focus: separado em "Empresa cadastrada" + "Autenticação funcionando"', () => {
    const groups = buildSaudeGroups(BASE, NOW);
    const focus = groups.find((g) => g.key === 'focus')!;
    expect(focus.items[0]!.label).toBe('Empresa cadastrada');
    expect(focus.items[1]!.label).toBe('Autenticação funcionando');
  });

  it('focus: cadastrada=ok mas autenticação=pendente → grupo pendente (caso AL Piscinas)', () => {
    const groups = buildSaudeGroups(
      {
        ...BASE,
        focusSnapshot: { habilitaNfse: false, habilitaNfsenProducao: null, habilitaNfsenHomologacao: null, syncEm: 'x' },
      },
      NOW,
    );
    const focus = groups.find((g) => g.key === 'focus')!;
    expect(focus.status).toBe('pendente');
    expect(focus.items[0]!.status).toBe('ok');       // cadastrada
    expect(focus.items[1]!.status).toBe('pendente'); // autenticação
    expect(focus.items[1]!.hint).toMatch(/habilitação/);
  });

  it('focus: erro → erro no grupo + erro no item "Empresa cadastrada"', () => {
    const groups = buildSaudeGroups({ ...BASE, focusStatus: 'erro', focusLastError: 'oops' }, NOW);
    const focus = groups.find((g) => g.key === 'focus')!;
    expect(focus.status).toBe('erro');
    expect(focus.items[0]!.status).toBe('erro');
    expect(focus.items[1]!.status).toBe('pendente'); // 5b aguarda 5a
  });

  it('action do grupo: vem do primeiro item não-ok com action', () => {
    const groups = buildSaudeGroups({ ...BASE, certPresente: false, certNotAfter: null }, NOW);
    const cert = groups.find((g) => g.key === 'certificado')!;
    expect(cert.action).toBe('upload_cert');
  });

  it('focus.meta: sem drift → "Sincronizado em ..."', () => {
    const groups = buildSaudeGroups(BASE, NOW);
    const focus = groups.find((g) => g.key === 'focus')!;
    expect(focus.status).toBe('ok');
    expect(focus.meta).toMatch(/Sincronizado em/);
  });

  it('focus.meta: COM drift (dirty > syncEm) → grupo vira pendente + meta de drift', () => {
    const groups = buildSaudeGroups(
      { ...BASE, focusFieldsDirtyAt: '2026-05-28T11:30:00Z' /* > syncEm 10:00 */ },
      NOW,
    );
    const focus = groups.find((g) => g.key === 'focus')!;
    expect(focus.status).toBe('pendente');
    expect(focus.action).toBe('sync_focus');
    expect(focus.meta).toMatch(/mudanças não sincronizadas/);
  });

  it('focus.meta: token SERPRO renovado (dirty null) NÃO conta como drift', () => {
    // Regressão do bug da AL Piscinas: renovar o token SERPRO bumpava
    // empresas_fiscais.updated_at (via trigger) e disparava falso drift. Agora o
    // drift olha só focus_fields_dirty_at — escritas não-Focus não o tocam.
    const groups = buildSaudeGroups({ ...BASE, focusFieldsDirtyAt: null }, NOW);
    const focus = groups.find((g) => g.key === 'focus')!;
    expect(focus.status).toBe('ok');
    expect(focus.meta).toMatch(/Sincronizado em/);
  });

  it('focus.meta: dirty igual a syncEm (re-sincronizado) → sem drift', () => {
    const groups = buildSaudeGroups(
      { ...BASE, focusFieldsDirtyAt: BASE.focusSnapshot!.syncEm },
      NOW,
    );
    const focus = groups.find((g) => g.key === 'focus')!;
    expect(focus.status).toBe('ok');
    expect(focus.meta).toMatch(/Sincronizado em/);
  });

  it('focus.meta: sem cadastro (syncEm null) → sem meta', () => {
    const groups = buildSaudeGroups(
      { ...BASE, focusToken: null, focusStatus: null, focusSnapshot: null },
      NOW,
    );
    const focus = groups.find((g) => g.key === 'focus')!;
    expect(focus.meta).toBeUndefined();
  });
});

describe('focus_cadastro — agregado (token + habilita_* + cert)', () => {
  it('erro quando focusStatus=erro', () => {
    const checks = buildSaudeChecks({ ...BASE, focusStatus: 'erro', focusLastError: 'CNPJ inválido' }, NOW);
    expect(checks[4]!.status).toBe('erro');
    expect(checks[4]!.action).toBe('sync_focus');
    expect(checks[4]!.hint).toMatch(/CNPJ inválido/);
  });
  it('pendente "nunca cadastrada" quando focus_token ausente', () => {
    const checks = buildSaudeChecks({ ...BASE, focusStatus: null, focusToken: null }, NOW);
    expect(checks[4]!.status).toBe('pendente');
    expect(checks[4]!.hint).toMatch(/ainda não foi cadastrada/);
  });
  it('ok quando: token + alguma habilita_*=true + certPresente', () => {
    const checks = buildSaudeChecks(BASE, NOW); // BASE já tem todos os 3 ok
    expect(checks[4]!.status).toBe('ok');
    expect(checks[4]!.hint).toMatch(/habilitado para emissão/);
  });
  it('pendente "falta habilitação" quando token presente mas habilita_* todos false/null', () => {
    const checks = buildSaudeChecks(
      {
        ...BASE,
        focusSnapshot: { habilitaNfse: false, habilitaNfsenProducao: null, habilitaNfsenHomologacao: null, syncEm: 'x' },
      },
      NOW,
    );
    expect(checks[4]!.status).toBe('pendente');
    expect(checks[4]!.hint).toMatch(/habilitação na Focus/);
  });
  it('pendente "falta cert" quando habilitado mas sem cert', () => {
    const checks = buildSaudeChecks({ ...BASE, certPresente: false }, NOW);
    expect(checks[4]!.status).toBe('pendente');
    expect(checks[4]!.hint).toMatch(/certificado A1/);
  });
  it('pendente lista AMBOS quando faltam habilitação e cert', () => {
    const checks = buildSaudeChecks(
      {
        ...BASE,
        focusSnapshot: { habilitaNfse: false, habilitaNfsenProducao: null, habilitaNfsenHomologacao: null, syncEm: 'x' },
        certPresente: false,
      },
      NOW,
    );
    expect(checks[4]!.status).toBe('pendente');
    expect(checks[4]!.hint).toMatch(/habilitação na Focus/);
    expect(checks[4]!.hint).toMatch(/certificado A1/);
  });
});
