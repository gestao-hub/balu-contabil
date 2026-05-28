// @custom — Focus 3: helpers puros pra montar o painel "Saúde da empresa".
// Recebe o estado já resolvido (companies + arquivos_auxiliares + empresas_fiscais
// + municipios_nfse) e devolve a lista de 5 checks com status + ação contextual.
// Sem deps de React/Supabase — testável isoladamente (saude-empresa.test.ts).

export type CheckStatus = 'ok' | 'pendente' | 'erro';
export type CheckActionKey = 'sync_focus' | 'upload_cert' | 'reauth_serpro' | 'editar_endereco' | null;

export type CheckResult = {
  key: 'cidade_nfse' | 'cert_presente' | 'cert_valido' | 'serpro' | 'focus_cadastro';
  label: string;
  status: CheckStatus;
  hint: string;
  action: CheckActionKey;
  /** Timestamp ISO da última verificação relevante, se aplicável. */
  lastCheck?: string | null;
};

export type SaudeState = {
  // Endereço atual (pra check 1)
  municipio: string | null;
  uf: string | null;
  // Resolvido por resolveMunicipioNfse: presença = município conhecido; null = desconhecido
  municipioInfo: {
    producao_disponivel: string | null;
    homologacao_disponivel: string | null;
    provedor: string | null;
  } | null;
  // Cert (arquivos_auxiliares)
  certPresente: boolean;
  certNotAfter: string | null;   // ISO; null se ausente
  // SERPRO (empresas_fiscais)
  serproTokenExpiration: string | null; // ISO; null se nunca autenticado
  // Focus (companies)
  focusStatus: 'ok' | 'erro' | null;
  focusToken: string | null;
  focusLastCheck: string | null;
  focusLastError: string | null;
  // Snapshot Focus → empresas_fiscais (Focus 2.0). Quando preenchido, é a
  // fonte de verdade para "está habilitada pra NFS-e?" (suplanta o lookup
  // estático em municipios_nfse, especialmente pras cidades que migraram
  // pra NFSe Nacional em 2026 — caso Londrina).
  focusSnapshot: {
    habilitaNfse: boolean | null;
    habilitaNfsenProducao: boolean | null;
    habilitaNfsenHomologacao: boolean | null;
    syncEm: string | null;
  } | null;
};

const SKEW_MS = 5 * 60 * 1000;

/** Retorna true se a data ISO está no futuro (com folga `skew`). */
export function isInFutureISO(iso: string | null, now: Date = new Date(), skewMs = 0): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  return t - skewMs > now.getTime();
}

/** Dias entre `iso` e `now` (positivo se no futuro, negativo se no passado). */
export function daysUntilISO(iso: string | null, now: Date = new Date()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.floor((t - now.getTime()) / (24 * 60 * 60 * 1000));
}

export function buildSaudeChecks(state: SaudeState, now: Date = new Date()): CheckResult[] {
  return [
    cidadeNfseCheck(state),
    certPresenteCheck(state),
    certValidoCheck(state, now),
    serproCheck(state, now),
    focusCadastroCheck(state),
  ];
}

function cidadeNfseCheck(state: SaudeState): CheckResult {
  const label = 'Cidade credenciada para NFS-e';
  const lugar = state.municipio && state.uf ? `${state.municipio}/${state.uf}` : '—';

  // (a) Endereço da empresa não preenchido.
  if (!state.municipio || !state.uf) {
    return {
      key: 'cidade_nfse', label,
      status: 'pendente',
      hint: 'Endereço da empresa incompleto. Preencha em "Dados da empresa".',
      action: 'editar_endereco',
    };
  }

  // (a.5) Snapshot Focus disponível → fonte de verdade (Focus 2.0).
  // Cobre o caso das cidades migradas pra NFSe Nacional (Londrina em 01/01/2026)
  // que a `municipios_nfse` legacy do Bubble não reflete.
  if (state.focusSnapshot) {
    if (state.focusSnapshot.habilitaNfsenProducao === true) {
      return {
        key: 'cidade_nfse', label,
        status: 'ok',
        hint: `${lugar} · habilitada via NFSe Nacional (produção).`,
        action: null,
        lastCheck: state.focusSnapshot.syncEm,
      };
    }
    if (state.focusSnapshot.habilitaNfse === true) {
      return {
        key: 'cidade_nfse', label,
        status: 'ok',
        hint: `${lugar} · habilitada via NFS-e municipal.`,
        action: null,
        lastCheck: state.focusSnapshot.syncEm,
      };
    }
    if (state.focusSnapshot.habilitaNfsenHomologacao === true) {
      return {
        key: 'cidade_nfse', label,
        status: 'pendente',
        hint: `${lugar} · NFSe Nacional só em homologação (produção precisa ser habilitada).`,
        action: null,
        lastCheck: state.focusSnapshot.syncEm,
      };
    }
    // Snapshot existe mas todas as flags = false/null → Focus conhece a empresa
    // mas ela não foi habilitada pra emitir. Não é erro de cidade — é cadastro
    // incompleto na Focus (vai ser resolvido pelo PUT do Focus 2.1).
    return {
      key: 'cidade_nfse', label,
      status: 'pendente',
      hint: `${lugar} · cadastro na Focus aguardando habilitação (será feito pelo PUT enriquecendo).`,
      action: null,
      lastCheck: state.focusSnapshot.syncEm,
    };
  }

  // (b) Município nem existe na base municipios_nfse.
  if (!state.municipioInfo) {
    return {
      key: 'cidade_nfse', label,
      status: 'erro',
      hint: `${lugar} ainda não consta na base de municípios com NFS-e suportada.`,
      action: null,
    };
  }

  const isSim = (v: string | null) => !!v && v.trim().toLowerCase() === 'sim';
  const prodOk = isSim(state.municipioInfo.producao_disponivel);
  const homOk = isSim(state.municipioInfo.homologacao_disponivel);
  const provedor = state.municipioInfo.provedor;
  // Cadastro da linha incompleto: existe na base mas faltam dados-chave (provedor
  // OU ambas as flags de ambiente). Sem isso a Focus não emite — e a UI antiga
  // dizia "apenas em homologação" mesmo quando homologacao_disponivel também era null.
  const cadastroIncompleto = !provedor && !prodOk && !homOk;

  // (c) Cadastro da cidade vazio na base.
  if (cadastroIncompleto) {
    return {
      key: 'cidade_nfse', label,
      status: 'pendente',
      hint: `${lugar} está na base mas sem provedor/portais cadastrados. Verifique com a prefeitura ou aguarde atualização da base.`,
      action: null,
    };
  }

  // (d) Produção liberada.
  if (prodOk) {
    return {
      key: 'cidade_nfse', label,
      status: 'ok',
      hint: `${lugar} · provedor ${provedor ?? '—'}`,
      action: null,
    };
  }

  // (e) Só homologação liberada.
  if (homOk) {
    return {
      key: 'cidade_nfse', label,
      status: 'pendente',
      hint: `${lugar} suportada apenas em homologação (produção ainda não disponível).`,
      action: null,
    };
  }

  // (f) Fallback raro: há provedor mas sem flags. Trata como cadastro incompleto.
  return {
    key: 'cidade_nfse', label,
    status: 'pendente',
    hint: `${lugar} · provedor ${provedor ?? '—'} sem disponibilidade declarada.`,
    action: null,
  };
}

function certPresenteCheck(state: SaudeState): CheckResult {
  if (state.certPresente) {
    return {
      key: 'cert_presente',
      label: 'Certificado A1 enviado',
      status: 'ok',
      hint: 'Certificado armazenado de forma segura.',
      action: null,
    };
  }
  return {
    key: 'cert_presente',
    label: 'Certificado A1 enviado',
    status: 'pendente',
    hint: 'Nenhum certificado foi enviado. Suba o .pfx em "Emissão fiscal".',
    action: 'upload_cert',
  };
}

function certValidoCheck(state: SaudeState, now: Date): CheckResult {
  if (!state.certPresente) {
    return {
      key: 'cert_valido',
      label: 'Certificado A1 válido',
      status: 'pendente',
      hint: 'Sem certificado para verificar.',
      action: null,
    };
  }
  if (!state.certNotAfter) {
    return {
      key: 'cert_valido',
      label: 'Certificado A1 válido',
      status: 'pendente',
      hint: 'Data de validade não detectada — re-upload pode resolver.',
      action: 'upload_cert',
    };
  }
  const days = daysUntilISO(state.certNotAfter, now);
  if (days != null && days < 0) {
    return {
      key: 'cert_valido',
      label: 'Certificado A1 válido',
      status: 'erro',
      hint: `Expirado em ${formatBR(state.certNotAfter)} (${-days} dia(s) atrás). Suba um novo.`,
      action: 'upload_cert',
      lastCheck: state.certNotAfter,
    };
  }
  if (days != null && days <= 30) {
    return {
      key: 'cert_valido',
      label: 'Certificado A1 válido',
      status: 'pendente',
      hint: `Vence em ${days} dia(s) (${formatBR(state.certNotAfter)}). Renove em breve.`,
      action: 'upload_cert',
      lastCheck: state.certNotAfter,
    };
  }
  return {
    key: 'cert_valido',
    label: 'Certificado A1 válido',
    status: 'ok',
    hint: `Válido até ${formatBR(state.certNotAfter)}${days != null ? ` (${days} dia(s))` : ''}.`,
    action: null,
    lastCheck: state.certNotAfter,
  };
}

function serproCheck(state: SaudeState, now: Date): CheckResult {
  if (!state.serproTokenExpiration) {
    return {
      key: 'serpro',
      label: 'SERPRO conectada',
      status: 'pendente',
      hint: 'Token nunca foi obtido. Requer certificado A1 válido para autenticar.',
      action: 'reauth_serpro',
    };
  }
  if (!isInFutureISO(state.serproTokenExpiration, now, SKEW_MS)) {
    return {
      key: 'serpro',
      label: 'SERPRO conectada',
      status: 'pendente',
      hint: `Token expirado em ${formatBR(state.serproTokenExpiration)}. Será renovado na próxima chamada.`,
      action: 'reauth_serpro',
      lastCheck: state.serproTokenExpiration,
    };
  }
  return {
    key: 'serpro',
    label: 'SERPRO conectada',
    status: 'ok',
    hint: `Token válido até ${formatBR(state.serproTokenExpiration)}.`,
    action: null,
    lastCheck: state.serproTokenExpiration,
  };
}

function focusCadastroCheck(state: SaudeState): CheckResult {
  if (state.focusStatus === 'ok' && state.focusToken) {
    return {
      key: 'focus_cadastro',
      label: 'Cadastro na Focus funcional',
      status: 'ok',
      hint: `Empresa cadastrada na Focus${state.focusLastCheck ? ` em ${formatBR(state.focusLastCheck)}` : ''}.`,
      action: null,
      lastCheck: state.focusLastCheck,
    };
  }
  if (state.focusStatus === 'erro') {
    return {
      key: 'focus_cadastro',
      label: 'Cadastro na Focus funcional',
      status: 'erro',
      hint: state.focusLastError
        ? `Última tentativa falhou: ${truncate(state.focusLastError, 140)}`
        : 'Última tentativa de cadastro na Focus falhou.',
      action: 'sync_focus',
      lastCheck: state.focusLastCheck,
    };
  }
  return {
    key: 'focus_cadastro',
    label: 'Cadastro na Focus funcional',
    status: 'pendente',
    hint: 'Empresa ainda não foi cadastrada na Focus.',
    action: 'sync_focus',
  };
}

function formatBR(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
