// @custom — Focus 2.1: mapper puro estado do Balu → payload do PUT /v2/empresas/:cnpj.
// Sem deps de React/Supabase — testável isoladamente.
//
// Doc: https://doc.focusnfe.com.br/reference/atualizar_empresa
// O PUT é idempotente: pode reenviar o mesmo payload sem efeito colateral.
//
// **Decisão da flag NFS-e** (28-mai):
//   - Município aderente NFSe Nacional + env=hom → `habilita_nfsen_homologacao: true`
//   - Município aderente NFSe Nacional + env=prod → `habilita_nfsen_producao: true`
//   - Município legado → `habilita_nfse: true` + `login_responsavel` + `senha_responsavel`
// A escolha sai de `isAderenteNfsenNacional(codigoIbge)`.

import type { FocusEnv } from '../clients/focus-nfe';
import type { RegimeCode } from './regime';
import { isAderenteNfsenNacional } from './municipios-nfsen-nacional';
import { regimeCodeToFocus, type FocusEmpresaCompany } from './focus-empresa-payload';

/** Subset de `empresas_fiscais` necessário pro PUT. */
export type FocusEmpresaFiscalForUpdate = {
  Code_regime_tributario: RegimeCode | string | null;
  nfse_usuario_login: string | null;
  nfse_senha_login: string | null;
  empresa_fiscal_ativada?: boolean | null;
};

export type FocusEmpresaUpdatePayload = {
  // Identificação
  nome: string;
  nome_fantasia?: string;
  cnpj: string;
  inscricao_estadual?: string;
  inscricao_municipal?: string;

  // Endereço
  logradouro: string;
  numero: string;
  complemento?: string;
  bairro: string;
  cep: string;
  municipio: string;
  uf: string;
  codigo_municipio?: string;

  // Contato
  email?: string;
  telefone?: string;

  // Fiscal
  regime_tributario: number;

  // Habilitação NFS-e (exatamente uma das três é true por env)
  habilita_nfse?: boolean;
  habilita_nfsen_producao?: boolean;
  habilita_nfsen_homologacao?: boolean;

  // Credenciais prefeitura (só legado)
  login_responsavel?: string;
  senha_responsavel?: string;
};

function digits(s: string | null | undefined): string {
  return (s ?? '').replace(/\D+/g, '');
}
function optString(v: string | null | undefined): string | undefined {
  const s = (v ?? '').trim();
  return s.length ? s : undefined;
}

/**
 * Decide qual flag de habilitação NFS-e setar.
 * - aderente NFSe Nacional → flag `nfsen_*` do ambiente
 * - senão → flag legada `nfse`
 *
 * `empresaAtivada` controla o valor — se a empresa fiscal estiver desativada
 * localmente, mandamos `false` (Focus desabilita emissão sem deletar config).
 */
export function decidirFlagsNfse(
  codigoIbge: string | null | undefined,
  env: FocusEnv,
  empresaAtivada: boolean,
  now: Date = new Date(),
): Pick<FocusEmpresaUpdatePayload, 'habilita_nfse' | 'habilita_nfsen_producao' | 'habilita_nfsen_homologacao'> {
  const aderente = isAderenteNfsenNacional(codigoIbge, now);
  if (aderente) {
    return env === 'prod'
      ? { habilita_nfsen_producao: empresaAtivada }
      : { habilita_nfsen_homologacao: empresaAtivada };
  }
  return { habilita_nfse: empresaAtivada };
}

/**
 * Monta o payload do PUT a partir do estado atual de `companies` + `empresas_fiscais`.
 * Lança Error se algum obrigatório estiver vazio.
 *
 * Parâmetros:
 *   - company:        linha de `companies` (snapshot atual)
 *   - empresaFiscal:  linha de `empresas_fiscais` (regime + credenciais prefeitura)
 *   - codigoIbge:     código do município (vem de `companies.codigo_municipio`
 *                     ou do snapshot Focus `empresas_fiscais.focus_codigo_municipio`)
 *   - env:            ambiente alvo das emissões ('hom' ou 'prod')
 *   - now:            injeção pra teste de data
 */
export function buildFocusEmpresaUpdatePayload(
  company: FocusEmpresaCompany,
  empresaFiscal: FocusEmpresaFiscalForUpdate,
  codigoIbge: string | null,
  env: FocusEnv,
  now: Date = new Date(),
): FocusEmpresaUpdatePayload {
  const cnpj = digits(company.cnpj);
  if (cnpj.length !== 14) throw new Error('CNPJ deve ter 14 dígitos.');

  const nome = (company.razao_social ?? '').trim();
  if (!nome) throw new Error('Razão social é obrigatória.');

  const municipio = (company.municipio ?? '').trim();
  if (!municipio) throw new Error('Município é obrigatório.');

  const uf = (company.uf ?? '').trim().toUpperCase();
  if (uf.length !== 2) throw new Error('UF deve ter 2 letras.');

  const logradouro = (company.logradouro ?? '').trim();
  if (!logradouro) throw new Error('Logradouro é obrigatório.');

  const bairro = (company.bairro ?? '').trim();
  if (!bairro) throw new Error('Bairro é obrigatório.');

  const cep = digits(company.cep);
  if (cep.length !== 8) throw new Error('CEP deve ter 8 dígitos.');

  const numero = company.sem_numero
    ? 'SN'
    : (company.numero ?? '').trim();
  if (!numero) throw new Error('Número do endereço é obrigatório (ou marque sem número).');

  const regimeCode = empresaFiscal.Code_regime_tributario;
  if (!regimeCode) throw new Error('Regime tributário é obrigatório.');

  // Empresa ativada por default; se explicitamente false, desabilita.
  const ativada = empresaFiscal.empresa_fiscal_ativada !== false;
  const flagsNfse = decidirFlagsNfse(codigoIbge, env, ativada, now);

  const payload: FocusEmpresaUpdatePayload = {
    nome,
    cnpj,
    logradouro,
    numero,
    bairro,
    cep,
    municipio,
    uf,
    regime_tributario: regimeCodeToFocus(regimeCode),
    ...flagsNfse,
  };

  const nomeFantasia = optString(company.nome);
  if (nomeFantasia && nomeFantasia !== nome) payload.nome_fantasia = nomeFantasia;

  const complemento = optString(company.complemento);
  if (complemento) payload.complemento = complemento;

  const codMun = optString(codigoIbge);
  if (codMun) payload.codigo_municipio = codMun;

  const email = optString(company.email);
  if (email) payload.email = email;

  const tel = digits(company.telefone);
  if (tel.length >= 10) payload.telefone = tel;

  const ie = optString(company.inscricao_estadual);
  if (ie) payload.inscricao_estadual = ie;

  const im = optString(company.inscricao_municipal);
  if (im) payload.inscricao_municipal = im;

  // Credenciais prefeitura: só para município legado (não-aderente NFSe Nacional)
  // e só quando ambas (login + senha) estão preenchidas — mandar uma sem a outra
  // seria inválido pra prefeitura.
  if (payload.habilita_nfse !== undefined) {
    const login = optString(empresaFiscal.nfse_usuario_login);
    const senha = optString(empresaFiscal.nfse_senha_login);
    if (login && senha) {
      payload.login_responsavel = login;
      payload.senha_responsavel = senha;
    }
  }

  return payload;
}
