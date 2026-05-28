// @custom — PR 2.1 — mapper puro estado do Balu → payload do POST /v2/nfsen.
// Sem deps de React/Supabase — testável isoladamente.
//
// Doc Focus: https://doc.focusnfe.com.br/reference/emitir_dps_nacional
// Doc completa: https://campos.focusnfe.com.br/nfse_nacional/EmissaoDPSXml.html
//
// Lista de campos NFSe Nacional (DPS — Padrão Nacional, pós-Reforma):
//   data_emissao, serie_dps, numero_dps, data_competencia, emitente_dps,
//   codigo_municipio_emissora (IBGE 7d), cnpj_prestador,
//   codigo_opcao_simples_nacional (1-4), cnpj_tomador | cpf_tomador | nif_tomador,
//   codigo_municipio_prestacao (IBGE 7d), codigo_tributacao_nacional_iss (6d),
//   descricao_servico, valor_servico, tributacao_iss
//
// Nota: o **prestador é derivado** da empresa (cnpj + codigo_municipio). O Focus
// completa endereço/IE/IM pelo cadastro da empresa-na-Focus (feito em Focus 1).

import type { RegimeCode } from './regime';

/** Subset de `companies` necessário pra montar o payload. */
export type NfsePrestadorCompany = {
  cnpj: string;
  codigo_municipio: string | null; // IBGE 7d; obrigatório pra NFSe Nacional
};

/** Subset de `empresas_fiscais` (regime + flag de cobrança em hom). */
export type NfsePrestadorFiscal = {
  Code_regime_tributario: RegimeCode | string | null;
};

/**
 * Tomador (cliente). Aceita PF (CPF) OU PJ (CNPJ).
 *
 * NFSe Nacional exige pelo menos um identificador (`cnpj_tomador` |
 * `cpf_tomador` | `nif_tomador`) E pelo menos uma das children do elemento
 * `toma` (CAEPF, IM, xNome). Usamos sempre `xNome` (razao_social_tomador)
 * pra garantir aceitação do schema.
 */
export type NfseTomador = {
  cnpj: string | null;
  cpf: string | null;
  razaoSocial: string;
};

/** Dados do serviço (vêm do form de emissão). */
export type NfseServico = {
  codigoTributacao: string;  // 6 dígitos Lista Nacional
  descricao: string;
  valor: number;             // R$
  /** Alíquota ISS (em percentual, ex: 5.0). */
  aliquotaIssPercentual: number;
};

export type NfsePayload = {
  data_emissao: string;
  serie_dps: number;
  numero_dps: number;
  data_competencia: string;
  emitente_dps: number;
  codigo_municipio_emissora: number;
  cnpj_prestador: string;
  codigo_opcao_simples_nacional: number;
  regime_especial_tributacao: number;
  codigo_municipio_prestacao: number;
  codigo_tributacao_nacional_iss: string;
  descricao_servico: string;
  valor_servico: number;
  // Enum 1-4 (não é alíquota): 1=Operação tributável, 2=Imunidade,
  // 3=Exportação, 4=Não Incidência. Pra MVP sempre 1.
  tributacao_iss: number;
  // Enum 1-3: 1=Não Retido, 2=Retido pelo Tomador, 3=Retido pelo Intermediário.
  // Pra MVP sempre 1.
  tipo_retencao_iss: number;
  // Reforma Tributária — required. 0 = NFS-e regular.
  finalidade_emissao: number;
  cnpj_tomador?: string;
  cpf_tomador?: string;
  razao_social_tomador: string;
  // Alíquota informada quando município não está parametrizado no Sistema
  // Nacional. Pra municípios parametrizados o sistema ignora; mandar é seguro.
  percentual_aliquota_relativa_municipio?: number;

  // Reforma Tributária (obrigatórios a partir de 2026):
  consumidor_final: number;             // 0=Não, 1=Sim
  codigo_indicador_operacao?: string;   // opcional 6c; presente quando o caso exige
  indicador_destinatario?: number;      // opcional, depende do contexto
  ibs_cbs_situacao_tributaria: string;  // CST IBS/CBS (3 chars)
  ibs_cbs_classificacao_tributaria: string; // 6 chars
  valor_total_tributos_federais: number; // pode ser 0
};

function digits(s: string | null | undefined): string {
  return (s ?? '').replace(/\D+/g, '');
}

/**
 * Decide código_opcao_simples_nacional (1-3) a partir do regime do Balu.
 *
 * Enum oficial NFSe Nacional:
 *   1 = Não Optante
 *   2 = Optante - Microempreendedor Individual (MEI)
 *   3 = Optante - Microempresa ou Empresa de Pequeno Porte (ME/EPP)
 *
 * Mapeamento do Balu:
 *   - Regime 1 (Simples Nacional)              → 3 (ME/EPP)
 *   - Regime 2 (Simples + excesso de sublimite)→ 3 (ME/EPP)
 *   - Regime 3 (Regime Normal / Lucro Real)    → 1 (Não Optante)
 *   - Regime 4 (MEI)                           → 2 (MEI)
 */
export function regimeToOpcaoSimples(code: RegimeCode | string | null | undefined): number {
  if (code === '3') return 1;
  if (code === '4') return 2;
  return 3; // default Simples (regimes 1 e 2)
}

/**
 * Próximo número de DPS. MVP: timestamp truncado pra inteiro de 9 dígitos
 * (1..999.999.999). Quando houver emissão concorrente, vira um sequencial
 * por-empresa numa tabela. Por enquanto o `ref` da Focus já dá idempotência.
 */
export function gerarNumeroDps(now: Date = new Date()): number {
  // Trunca pra caber em int32 com folga.
  return Number(String(now.getTime()).slice(-9));
}

export function buildNfsePayload(
  prestadorCompany: NfsePrestadorCompany,
  prestadorFiscal: NfsePrestadorFiscal,
  tomador: NfseTomador,
  servico: NfseServico,
  now: Date = new Date(),
): NfsePayload {
  const cnpjPrestador = digits(prestadorCompany.cnpj);
  if (cnpjPrestador.length !== 14) throw new Error('CNPJ do prestador deve ter 14 dígitos.');

  const codMun = digits(prestadorCompany.codigo_municipio);
  if (codMun.length !== 7) {
    throw new Error('Código IBGE do município do prestador é obrigatório (7 dígitos).');
  }
  const codigoMunicipio = Number(codMun);

  const cnpjTomador = digits(tomador.cnpj);
  const cpfTomador = digits(tomador.cpf);
  if (!cnpjTomador && !cpfTomador) {
    throw new Error('Tomador precisa de CPF ou CNPJ.');
  }
  if (cnpjTomador && cnpjTomador.length !== 14) {
    throw new Error('CNPJ do tomador deve ter 14 dígitos.');
  }
  if (cpfTomador && cpfTomador.length !== 11) {
    throw new Error('CPF do tomador deve ter 11 dígitos.');
  }
  const razaoSocialTomador = tomador.razaoSocial.trim();
  if (!razaoSocialTomador) throw new Error('Razão social/nome do tomador é obrigatório.');

  if (!/^\d{6}$/.test(servico.codigoTributacao)) {
    throw new Error('Código de tributação deve ter 6 dígitos (Lista Nacional).');
  }
  const descricao = servico.descricao.trim();
  if (!descricao) throw new Error('Descrição do serviço é obrigatória.');
  if (descricao.length > 1000) {
    throw new Error('Descrição muito longa (máx 1000 caracteres).');
  }
  if (!Number.isFinite(servico.valor) || servico.valor <= 0) {
    throw new Error('Valor do serviço deve ser positivo.');
  }
  if (!Number.isFinite(servico.aliquotaIssPercentual) || servico.aliquotaIssPercentual < 0) {
    throw new Error('Alíquota ISS inválida.');
  }

  const payload: NfsePayload = {
    data_emissao: now.toISOString(),
    serie_dps: 1,
    numero_dps: gerarNumeroDps(now),
    data_competencia: toDateOnly(now),
    emitente_dps: 1, // 1 = prestador (caso default)
    codigo_municipio_emissora: codigoMunicipio,
    cnpj_prestador: cnpjPrestador,
    codigo_opcao_simples_nacional: regimeToOpcaoSimples(prestadorFiscal.Code_regime_tributario),
    regime_especial_tributacao: 0, // 0 = Nenhum
    codigo_municipio_prestacao: codigoMunicipio,
    codigo_tributacao_nacional_iss: servico.codigoTributacao,
    descricao_servico: descricao,
    valor_servico: round2(servico.valor),
    tributacao_iss: 1,        // 1 = Operação tributável
    tipo_retencao_iss: 1,     // 1 = Não Retido
    finalidade_emissao: 0,    // 0 = NFS-e regular
    razao_social_tomador: razaoSocialTomador.slice(0, 150),
    // Reforma Tributária — defaults seguros pra MVP B2B:
    consumidor_final: 0,            // não é uso pessoal
    // `codigo_indicador_operacao` (cIndOp) é "obrigatório" pelo XSD apesar de
    // marcado `required: false` na doc Focus. Valor "020101" = operação padrão
    // de fornecimento B2B em território nacional (Anexo VII RTC). Vira input
    // do form quando der pra mostrar a tabela pro user; default seguro por agora.
    codigo_indicador_operacao: '020101',
    indicador_destinatario: 0,            // 0 = tomador é destinatário
    ibs_cbs_situacao_tributaria: '000',   // tributação integral
    ibs_cbs_classificacao_tributaria: '000001', // serviço comum
    valor_total_tributos_federais: 0,
  };

  if (cnpjTomador) payload.cnpj_tomador = cnpjTomador;
  else if (cpfTomador) payload.cpf_tomador = cpfTomador;

  // Manda a alíquota também: pra municípios parametrizados a Focus ignora,
  // pra não-parametrizados é necessária.
  if (servico.aliquotaIssPercentual > 0) {
    payload.percentual_aliquota_relativa_municipio = round2(servico.aliquotaIssPercentual);
  }

  return payload;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toDateOnly(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
