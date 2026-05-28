// @custom — Focus 1: mapeamento puro de input do form → payload do POST /v2/empresas.
// Sem deps de React/Supabase — testável isoladamente (focus-empresa-payload.test.ts).
//
// Doc oficial: https://doc.focusnfe.com.br/reference/criar_empresa
// Campos exigidos no painel da Focus (body_focus.txt, validado pelo usuário em 2026-05-28):
//   nome, nome_fantasia, cnpj, regime_tributario, municipio, uf,
//   logradouro, numero, bairro, cep
// Opcionais incluídos quando preenchidos:
//   complemento, email, inscricao_estadual, inscricao_municipal, telefone

import type { RegimeCode } from './regime';

/** Subset de `companies` necessário pra montar o payload Focus. */
export type FocusEmpresaCompany = {
  cnpj: string;
  razao_social: string | null;
  nome: string | null;            // nome fantasia (campo `nome` em companies)
  logradouro: string | null;
  numero: string | null;
  sem_numero: boolean | null;
  complemento: string | null;
  bairro: string | null;
  municipio: string | null;
  uf: string | null;
  cep: string | null;
  email: string | null;
  telefone: string | null;
  inscricao_estadual: string | null;
  inscricao_municipal: string | null;
};

export type FocusEmpresaPayload = {
  nome: string;
  nome_fantasia?: string;
  cnpj: string;
  regime_tributario: number;
  municipio: string;
  uf: string;
  logradouro: string;
  numero: string;
  bairro: string;
  cep: string;
  complemento?: string;
  email?: string;
  inscricao_estadual?: string;
  inscricao_municipal?: string;
  telefone?: string;
};

/** Mapeia código do regime ('1'..'4') → integer da Focus. */
export function regimeCodeToFocus(code: RegimeCode | string): number {
  const n = Number(code);
  if (!Number.isInteger(n) || n < 1 || n > 4) {
    throw new Error(`Regime tributário inválido para Focus: ${code}`);
  }
  return n;
}

/** Remove máscara: deixa só dígitos. Útil pra CNPJ/CEP/telefone. */
function digits(s: string | null | undefined): string {
  return (s ?? '').replace(/\D+/g, '');
}

/** Inclui só se preenchido (não-vazio após trim). */
function optString(v: string | null | undefined): string | undefined {
  const s = (v ?? '').trim();
  return s.length ? s : undefined;
}

/**
 * Monta o payload Focus a partir do estado da empresa + regime tributário.
 * Lança Error se algum obrigatório estiver vazio (já validado upstream pelo Zod,
 * mas reforça aqui pra falhar próximo da origem).
 *
 * `regimeCode` vem separado porque mora em `empresas_fiscais`, não em `companies`.
 */
export function buildFocusEmpresaPayload(
  company: FocusEmpresaCompany,
  regimeCode: RegimeCode | string,
): FocusEmpresaPayload {
  const cnpj = digits(company.cnpj);
  if (cnpj.length !== 14) throw new Error('CNPJ deve ter 14 dígitos.');

  const nome = (company.razao_social ?? '').trim();
  if (!nome) throw new Error('Razão social é obrigatória para cadastro na Focus.');

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

  // `numero`: aceitar string "SN" quando `sem_numero=true` (Focus exige campo presente).
  const numero = company.sem_numero
    ? 'SN'
    : (company.numero ?? '').trim();
  if (!numero) throw new Error('Número do endereço é obrigatório (ou marque sem número).');

  const payload: FocusEmpresaPayload = {
    nome,
    cnpj,
    regime_tributario: regimeCodeToFocus(regimeCode),
    municipio,
    uf,
    logradouro,
    numero,
    bairro,
    cep,
  };

  // Opcionais — só inclui quando preenchidos.
  const nomeFantasia = optString(company.nome);
  if (nomeFantasia && nomeFantasia !== nome) payload.nome_fantasia = nomeFantasia;

  const complemento = optString(company.complemento);
  if (complemento) payload.complemento = complemento;

  const email = optString(company.email);
  if (email) payload.email = email;

  const ie = optString(company.inscricao_estadual);
  if (ie) payload.inscricao_estadual = ie;

  const im = optString(company.inscricao_municipal);
  if (im) payload.inscricao_municipal = im;

  const tel = digits(company.telefone);
  if (tel.length >= 10) payload.telefone = tel;

  return payload;
}
