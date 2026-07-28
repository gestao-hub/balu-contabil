// Bloco 4B — regras puras do cadastro da subconta Asaas.
//
// Puro de proposito: a action valida ANTES de chamar o Asaas. Um payload
// recusado la volta como erro cru em ingles, e o escritorio no meio do
// onboarding nao tem o que fazer com isso.
//
// PJ e PF sao conjuntos DIFERENTES de campos, levantado contra o sandbox:
// `birthDate` e obrigatorio so para CPF; com `companyType` de PJ o validador
// do Asaas deixa de pedir.

/** Os quatro valores que o Asaas aceita em `companyType`. Lista (e nao union
 *  solta) porque `SubcontaSchema` (@/types/zod) confere a entrada da action
 *  contra ela em RUNTIME — union de tipo some na compilacao. */
export const COMPANY_TYPES = ['MEI', 'LIMITED', 'INDIVIDUAL', 'ASSOCIATION'] as const;
export type CompanyType = (typeof COMPANY_TYPES)[number];

export type DadosSubconta = {
  name: string;
  cpfCnpj: string;
  email: string;
  mobilePhone: string;
  incomeValue: number;
  address: string;
  addressNumber: string;
  province: string;
  postalCode: string;
  birthDate: string | null;
  companyType: CompanyType | null;
};

export type ResultadoValidacao = { ok: true } | { ok: false; error: string };

/**
 * Retorno de `criarSubcontaAction`.
 *
 * MORA AQUI, e nao no `actions.ts`, porque arquivo `'use server'` so pode
 * exportar funcao async — exportar o tipo de la quebra no `next build` sem o
 * `tsc --noEmit` reclamar.
 *
 * `terminal` marca os caminhos em que UMA SEGUNDA TENTATIVA criaria outra
 * subconta no Asaas: a subconta ja nasceu (ou pode ter nascido) e a chave se
 * perdeu, entao o banco continua sem `asaas_subconta_id` e nada no servidor
 * barra o proximo clique. Quem barra e a tela — pelo CAMPO, nunca pelo texto
 * da mensagem: casamento por trecho de frase quebra em silencio na primeira
 * vez que alguem reescreve a mensagem.
 */
export type ResultadoCriarSubconta =
  | { ok: true }
  | { ok: false; error: string; terminal?: boolean };

export const soDigitos = (v: string): string => (v ?? '').replace(/\D+/g, '');

/** 11 digitos = CPF (pessoa fisica); 14 = CNPJ (pessoa juridica). */
export function ehPessoaJuridica(cpfCnpj: string): boolean {
  return soDigitos(cpfCnpj).length === 14;
}

export function validarDadosSubconta(d: DadosSubconta): ResultadoValidacao {
  if (!d.name?.trim()) return { ok: false, error: 'Informe o nome do escritório.' };

  const doc = soDigitos(d.cpfCnpj);
  if (doc.length !== 11 && doc.length !== 14) {
    return { ok: false, error: 'Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido.' };
  }
  // Sem o `@` o Asaas devolve `invalid_email` em ingles — que e exatamente o
  // modo de falha que este modulo existe para evitar. Esquecer o arroba e erro
  // de digitacao corriqueiro, e a mensagem em portugues ja mora aqui.
  const email = d.email?.trim() ?? '';
  if (!email || !email.includes('@')) {
    return { ok: false, error: 'Informe o e-mail do responsável.' };
  }
  if (soDigitos(d.mobilePhone).length < 10) {
    return { ok: false, error: 'Informe o celular com DDD.' };
  }
  if (!(d.incomeValue > 0)) {
    return { ok: false, error: 'Informe o faturamento mensal estimado.' };
  }
  if (!d.address?.trim() || !d.addressNumber?.trim() || !d.province?.trim()) {
    return { ok: false, error: 'Informe endereço, número e bairro.' };
  }
  if (soDigitos(d.postalCode).length !== 8) {
    return { ok: false, error: 'Informe o CEP com 8 dígitos.' };
  }

  if (ehPessoaJuridica(d.cpfCnpj)) {
    if (!d.companyType) return { ok: false, error: 'Informe o tipo da empresa.' };
  } else {
    if (!d.birthDate) return { ok: false, error: 'Informe a data de nascimento do responsável.' };
  }
  return { ok: true };
}

/**
 * `birthDate` no formato que o Asaas exige: `YYYY-MM-DD`.
 *
 * POR QUE NORMALIZAR EM VEZ DE SO CONFIAR NO FORMULARIO: este repo ja
 * converte DD/MM/YYYY → YYYY-MM-DD no cliente (HonorarioFormDialog), entao a
 * data em formato brasileiro e uma entrada real aqui dentro. Um `13/05/1985`
 * chegando cru ao Asaas volta como recusa em ingles no meio do KYC.
 *
 * POR QUE RECUSAR TUDO O QUE NAO FOR ESSES DOIS FORMATOS, em vez de tentar
 * adivinhar: `birthDate` entra numa submissao de KYC que a guarda de "ja tem
 * subconta" impede de refazer. Adivinhar errado entre DD/MM e MM/DD nao da
 * erro — da uma subconta criada com a data errada, que so aparece quando o
 * Asaas recusa a analise. Melhor uma mensagem em portugues pedindo a data de
 * novo do que um palpite silencioso.
 *
 * Valida calendario de verdade (31/02 nao existe) e faixa plausivel — o
 * titular nasceu, no minimo, ha 18 anos.
 */
export type ResultadoBirthDate = { ok: true; valor: string } | { ok: false; error: string };

const ERRO_BIRTHDATE =
  'Informe a data de nascimento do responsável no formato AAAA-MM-DD (ou DD/MM/AAAA).';

export function normalizarBirthDate(v: string | null | undefined): ResultadoBirthDate {
  const s = (v ?? '').trim();
  if (!s) return { ok: false, error: 'Informe a data de nascimento do responsável.' };

  let ano: string, mes: string, dia: string;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (iso) [, ano, mes, dia] = iso;
  else if (br) [, dia, mes, ano] = br;
  else return { ok: false, error: ERRO_BIRTHDATE };

  // `new Date('2001-02-31')` nao lanca: rola para 03/03. Comparar de volta e a
  // unica forma de pegar dia que nao existe no mes.
  const canonico = `${ano}-${mes}-${dia}`;
  const d = new Date(`${canonico}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== canonico) {
    return { ok: false, error: 'Essa data de nascimento não existe no calendário.' };
  }

  const anoNum = Number(ano);
  const anoAtual = new Date().getUTCFullYear();
  if (anoNum < 1900 || anoNum > anoAtual - 18) {
    return { ok: false, error: 'A data de nascimento do responsável não parece válida.' };
  }
  return { ok: true, valor: canonico };
}

/** Payload já no formato que o Asaas espera: documento, celular e CEP só com
 *  dígitos, e o campo do "outro tipo" ausente em vez de nulo. */
export function montarPayloadSubconta(d: DadosSubconta): Record<string, unknown> {
  const pj = ehPessoaJuridica(d.cpfCnpj);
  return {
    name: d.name.trim(),
    email: d.email.trim(),
    cpfCnpj: soDigitos(d.cpfCnpj),
    mobilePhone: soDigitos(d.mobilePhone),
    incomeValue: d.incomeValue,
    address: d.address.trim(),
    addressNumber: d.addressNumber.trim(),
    province: d.province.trim(),
    postalCode: soDigitos(d.postalCode),
    ...(pj ? { companyType: d.companyType } : { birthDate: d.birthDate }),
  };
}
