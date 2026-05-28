// @custom — Focus 3: helpers puros pra montar o painel "Saúde da empresa".
// Recebe o estado já resolvido (companies + arquivos_auxiliares + empresas_fiscais
// + municipios_nfse) e devolve a lista de 5 checks com status + ação contextual.
// Sem deps de React/Supabase — testável isoladamente (saude-empresa.test.ts).
//
// Semântica dos checks:
//   1. cidade_nfse:    "A Focus ATENDE essa cidade?"  (capacidade do produto)
//   2. cert_presente:  "Subimos o cert no Balu?"
//   3. cert_valido:    "O cert subido está dentro da validade?"
//   4. serpro:         "Token SERPRO ativo?"
//   5. focus_cadastro: "Empresa PRONTA pra emitir na Focus?" (agregado)
import { isAderenteNfsenNacional } from './municipios-nfsen-nacional';

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
  /** Código IBGE do município (companies.codigo_municipio ou snapshot.focus_codigo_municipio). */
  codigoMunicipio: string | null;
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
    cidadeNfseCheck(state, now),
    certPresenteCheck(state),
    certValidoCheck(state, now),
    serproCheck(state, now),
    focusCadastroCheck(state),
  ];
}

/**
 * "A Focus ATENDE essa cidade?" — pura capacidade do produto, independente da
 * empresa do usuário. Não consome o snapshot da empresa: o snapshot informa
 * o cadastro DELA, não a oferta da Focus.
 */
function cidadeNfseCheck(state: SaudeState, now: Date): CheckResult {
  const label = 'Cidade credenciada para NFS-e';
  const lugar = state.municipio && state.uf ? `${state.municipio}/${state.uf}` : '—';

  // (a) Endereço da empresa não preenchido — sem como verificar.
  if (!state.municipio || !state.uf) {
    return {
      key: 'cidade_nfse', label,
      status: 'pendente',
      hint: 'Endereço da empresa incompleto. Preencha em "Dados da empresa".',
      action: 'editar_endereco',
    };
  }

  // (b) Município é aderente ao NFSe Nacional → Focus atende automaticamente
  // (via endpoint /v2/nfsen). Cobre cidades migradas em 2026 (Londrina/PR etc)
  // sem depender da tabela legacy `municipios_nfse`.
  if (isAderenteNfsenNacional(state.codigoMunicipio, now)) {
    return {
      key: 'cidade_nfse', label,
      status: 'ok',
      hint: `${lugar} · atendida via NFSe Nacional.`,
      action: null,
    };
  }

  // (c) Município nem existe na base de cidades suportadas pelo padrão antigo.
  if (!state.municipioInfo) {
    return {
      key: 'cidade_nfse', label,
      status: 'erro',
      hint: `${lugar} não consta na lista de cidades atendidas pela Focus.`,
      action: null,
    };
  }

  const isSim = (v: string | null) => !!v && v.trim().toLowerCase() === 'sim';
  const prodOk = isSim(state.municipioInfo.producao_disponivel);
  const homOk = isSim(state.municipioInfo.homologacao_disponivel);
  const provedor = state.municipioInfo.provedor;

  // (d) Produção disponível → Focus atende em prod.
  if (prodOk) {
    return {
      key: 'cidade_nfse', label,
      status: 'ok',
      hint: `${lugar} · atendida em produção${provedor ? ` · provedor ${provedor}` : ''}.`,
      action: null,
    };
  }

  // (e) Só homologação.
  if (homOk) {
    return {
      key: 'cidade_nfse', label,
      status: 'pendente',
      hint: `${lugar} atendida apenas em homologação (produção ainda não disponível).`,
      action: null,
    };
  }

  // (f) Linha existe mas sem dados — base desatualizada pra essa cidade.
  return {
    key: 'cidade_nfse', label,
    status: 'pendente',
    hint: `${lugar} está na base mas sem disponibilidade declarada. Aguardando atualização do cadastro do município.`,
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

/**
 * "Empresa PRONTA pra emitir na Focus?" — agregado das 3 condições mínimas:
 *  (i)   cadastro inicial feito (focus_token presente, focus_status='ok')
 *  (ii)  alguma habilitação ligada no painel Focus (habilita_nfse OU
 *        habilita_nfsen_producao OU habilita_nfe…) — feito pelo PUT do Focus 2.1
 *  (iii) certificado A1 presente no Balu (que será enviado pra Focus no PUT)
 *
 * Estados:
 *   ✓ ok      → todas as 3 ok
 *   ⚠ pendente → (i) ok mas (ii) ou (iii) falta
 *   ✗ erro    → focus_status='erro' OU sem cadastro nenhum
 */
function focusCadastroCheck(state: SaudeState): CheckResult {
  const label = 'Cadastro na Focus funcional';

  // (a) falha técnica registrada — erro duro.
  if (state.focusStatus === 'erro') {
    return {
      key: 'focus_cadastro', label,
      status: 'erro',
      hint: state.focusLastError
        ? `Última tentativa falhou: ${truncate(state.focusLastError, 140)}`
        : 'Última tentativa de cadastro na Focus falhou.',
      action: 'sync_focus',
      lastCheck: state.focusLastCheck,
    };
  }

  // (b) Nunca cadastrada.
  if (!state.focusToken || state.focusStatus !== 'ok') {
    return {
      key: 'focus_cadastro', label,
      status: 'pendente',
      hint: 'Empresa ainda não foi cadastrada na Focus.',
      action: 'sync_focus',
    };
  }

  // (c) Cadastrada — verifica os pré-requisitos pra emissão.
  const habilitada =
    state.focusSnapshot?.habilitaNfse === true ||
    state.focusSnapshot?.habilitaNfsenProducao === true ||
    state.focusSnapshot?.habilitaNfsenHomologacao === true;

  const certOnFile = state.certPresente;

  if (habilitada && certOnFile) {
    return {
      key: 'focus_cadastro', label,
      status: 'ok',
      hint: `Cadastro completo e habilitado para emissão${state.focusLastCheck ? ` (${formatBR(state.focusLastCheck)})` : ''}.`,
      action: null,
      lastCheck: state.focusLastCheck,
    };
  }

  // (d) Cadastrada mas faltam pré-requisitos — pendente, lista o que falta.
  const faltas: string[] = [];
  if (!habilitada) faltas.push('habilitação na Focus (NFS-e / NFSe Nacional)');
  if (!certOnFile) faltas.push('certificado A1');

  return {
    key: 'focus_cadastro', label,
    status: 'pendente',
    hint: `Cadastrada na Focus, mas faltam: ${faltas.join(', ')}. Será feito pelo PUT enriquecendo (Focus 2.1).`,
    action: 'sync_focus',
    lastCheck: state.focusLastCheck,
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
