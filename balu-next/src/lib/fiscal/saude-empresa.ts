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
  // Timestamps locais usados pra detectar drift Balu↔Focus (Focus 2.1).
  // Quando max(updated_at) > focusSnapshot.syncEm, há mudanças não sincronizadas.
  companiesUpdatedAt: string | null;
  empresaFiscalUpdatedAt: string | null;
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
 * Grupo de checks: alguns itens são agregados num card único (Cert + Focus
 * cadastro). O status do grupo é a roll-up dos items (erro > pendente > ok).
 */
export type CheckGroup = {
  key: 'cidade' | 'certificado' | 'serpro' | 'focus';
  label: string;
  items: CheckResult[];
  /** Roll-up: se algum item tem erro, grupo = erro; se algum pendente, grupo = pendente; senão ok. */
  status: CheckStatus;
  /** Ação contextual no header do grupo (priorizada do primeiro item não-ok). */
  action: CheckActionKey;
  /** Linha extra abaixo dos itens (ex: "Sincronizado em DD/MM HH:MM" ou alerta de drift). */
  meta?: string;
};

/** Roll-up de status: erro > pendente > ok. */
function rollupStatus(items: CheckResult[]): CheckStatus {
  if (items.some((i) => i.status === 'erro')) return 'erro';
  if (items.some((i) => i.status === 'pendente')) return 'pendente';
  return 'ok';
}

/**
 * "Há mudanças não sincronizadas com a Focus?"
 * True quando o último save local (companies.updated_at ou empresa_fiscal.updated_at)
 * é mais novo que focusSnapshot.syncEm. Sem syncEm ainda → false (cobre pelo
 * estado "não cadastrada"; não queremos mostrar drift antes do primeiro POST).
 *
 * **Margem de 60s** pra evitar falso positivo logo após o sync:
 * `focus_sync_em` é calculado no Node antes dos UPDATEs em `companies` e
 * `empresas_fiscais`, e os triggers `tg_set_updated_at` no banco gravam
 * `updated_at = now()` na hora do UPDATE — o que naturalmente é 1-3s depois
 * (PUT na Focus + GET snapshot + roundtrips). Sem essa margem, todo sync
 * dispararia drift fantasma. 60s é folgado o suficiente pra não pegar edits
 * humanos (que levam muito mais que 1 minuto entre clicks).
 */
const DRIFT_MARGIN_MS = 60_000;

export function detectFocusDrift(state: SaudeState): { drift: boolean; lastEditAt: string | null } {
  const syncAt = state.focusSnapshot?.syncEm ?? null;
  if (!syncAt) return { drift: false, lastEditAt: null };

  const candidates = [state.companiesUpdatedAt, state.empresaFiscalUpdatedAt]
    .filter((t): t is string => !!t)
    .map((t) => Date.parse(t))
    .filter((t) => Number.isFinite(t));
  if (candidates.length === 0) return { drift: false, lastEditAt: null };

  const lastEdit = Math.max(...candidates);
  const syncMs = Date.parse(syncAt);
  if (!Number.isFinite(syncMs)) return { drift: false, lastEditAt: null };

  const drift = lastEdit - syncMs > DRIFT_MARGIN_MS;
  return {
    drift,
    lastEditAt: drift ? new Date(lastEdit).toISOString() : null,
  };
}

/** Ação do grupo: pega do primeiro item não-ok (com fallback null). */
function pickGroupAction(items: CheckResult[]): CheckActionKey {
  const firstNotOk = items.find((i) => i.status !== 'ok' && i.action);
  return firstNotOk?.action ?? null;
}

/**
 * Versão agregada do `buildSaudeChecks` que monta 4 grupos para a UI:
 *   1. Cidade credenciada para NFS-e   (1 item)
 *   2. Certificado A1                  (2 itens: enviado, válido)
 *   3. SERPRO conectada                (1 item)
 *   4. Cadastro na Focus               (2 itens: empresa cadastrada, autenticação)
 */
export function buildSaudeGroups(state: SaudeState, now: Date = new Date()): CheckGroup[] {
  const cidade = cidadeNfseCheck(state, now);
  const certEnviado = certPresenteCheck(state);
  const certValido = certValidoCheck(state, now);
  const serpro = serproCheck(state, now);
  const focusEmpresa = focusEmpresaCadastradaCheck(state);
  const focusAuth = focusAutenticacaoCheck(state);

  const certItems = [
    { ...certEnviado, label: 'Enviado' },
    { ...certValido, label: 'Válido' },
  ];
  const focusItems = [
    { ...focusEmpresa, label: 'Empresa cadastrada' },
    { ...focusAuth, label: 'Autenticação funcionando' },
  ];

  return [
    {
      key: 'cidade',
      label: cidade.label,
      items: [cidade],
      status: cidade.status,
      action: cidade.action,
    },
    {
      key: 'certificado',
      label: 'Certificado A1',
      items: certItems,
      status: rollupStatus(certItems),
      action: pickGroupAction(certItems),
    },
    {
      key: 'serpro',
      label: serpro.label,
      items: [serpro],
      status: serpro.status,
      action: serpro.action,
    },
    buildFocusGroup(state, focusItems),
  ];
}

/**
 * Monta o grupo "Cadastro na Focus" aplicando drift detection.
 * Se itens estão OK mas há mudanças locais não sincronizadas, downgrade pra pendente
 * e expõe a ação "sync_focus".
 *
 * Meta line:
 *  - cadastrado e sem drift → "Sincronizado em DD/MM HH:MM"
 *  - cadastrado e com drift  → "Há mudanças não sincronizadas desde DD/MM HH:MM"
 *  - não cadastrado          → sem meta
 */
function buildFocusGroup(state: SaudeState, items: CheckResult[]): CheckGroup {
  const rolledUp = rollupStatus(items);
  const action = pickGroupAction(items);
  const syncAt = state.focusSnapshot?.syncEm ?? null;
  const { drift, lastEditAt } = detectFocusDrift(state);

  let status: CheckStatus = rolledUp;
  let resolvedAction: CheckActionKey = action;
  let meta: string | undefined;

  if (syncAt && drift) {
    // Itens individuais continuam refletindo o estado da Focus, mas o grupo
    // sinaliza que há mudanças locais pendentes de PUT.
    if (status === 'ok') status = 'pendente';
    resolvedAction = 'sync_focus';
    meta = `Há mudanças não sincronizadas desde ${formatBR(lastEditAt ?? '')}. Clique em Sincronizar.`;
  } else if (syncAt) {
    meta = `Sincronizado em ${formatBR(syncAt)}.`;
  }

  return {
    key: 'focus',
    label: 'Cadastro na Focus',
    items,
    status,
    action: resolvedAction,
    meta,
  };
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
 * Sub-check 5a — "A empresa existe na Focus?"
 * Granularidade: só o cadastro inicial. NÃO julga se está habilitada nem se tem
 * cert. Aceitação: focus_token presente E focus_status='ok'.
 */
function focusEmpresaCadastradaCheck(state: SaudeState): CheckResult {
  const label = 'Empresa cadastrada';
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
  if (state.focusToken && state.focusStatus === 'ok') {
    return {
      key: 'focus_cadastro', label,
      status: 'ok',
      hint: state.focusLastCheck
        ? `Cadastrada na Focus em ${formatBR(state.focusLastCheck)}.`
        : 'Cadastrada na Focus.',
      action: null,
      lastCheck: state.focusLastCheck,
    };
  }
  return {
    key: 'focus_cadastro', label,
    status: 'pendente',
    hint: 'Empresa ainda não foi cadastrada na Focus.',
    action: 'sync_focus',
  };
}

/**
 * Sub-check 5b — "A autenticação na Focus está funcionando?"
 * Aceitação: alguma `habilita_*=true` no snapshot E cert A1 presente no Balu
 * (o cert vai ser enviado pra Focus no PUT 2.1; pré-requisito).
 * Não faz sentido avaliar quando a empresa nem foi cadastrada (5a fica `pendente`
 * e este aqui também `pendente` por dependência).
 */
function focusAutenticacaoCheck(state: SaudeState): CheckResult {
  const label = 'Autenticação funcionando';

  if (!state.focusToken || state.focusStatus !== 'ok') {
    return {
      key: 'focus_cadastro', label,
      status: 'pendente',
      hint: 'Aguarda o cadastro da empresa na Focus.',
      action: null,
    };
  }

  const habilitada =
    state.focusSnapshot?.habilitaNfse === true ||
    state.focusSnapshot?.habilitaNfsenProducao === true ||
    state.focusSnapshot?.habilitaNfsenHomologacao === true;
  const certOnFile = state.certPresente;

  if (habilitada && certOnFile) {
    return {
      key: 'focus_cadastro', label,
      status: 'ok',
      hint: 'Habilitada para emissão (cert + flag na Focus).',
      action: null,
    };
  }

  const faltas: string[] = [];
  if (!habilitada) faltas.push('habilitação na Focus (NFS-e / NFSe Nacional)');
  if (!certOnFile) faltas.push('certificado A1');

  return {
    key: 'focus_cadastro', label,
    status: 'pendente',
    hint: `Faltam: ${faltas.join(', ')}. Será feito pelo PUT enriquecendo (Focus 2.1).`,
    action: 'sync_focus',
  };
}

/**
 * @deprecated — use `buildSaudeGroups` na UI. Mantido só para compatibilidade
 * de testes legados; agrega 5a+5b internamente.
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
