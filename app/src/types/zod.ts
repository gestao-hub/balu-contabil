// Auto-gerado — esquemas Zod para os payloads mais usados.
// Estender conforme as pages forem implementadas.
import { z } from 'zod';
import { isValidCnpj } from '@/lib/validators/cnpj';
import { normalizarValorBRL } from '@/lib/format/dinheiro';
import { EMPRESA_TIPOS, REGIMES, SEDE_TIPOS } from '@/types/abertura';

export const ClienteSchema = z.object({
  person_type: z.enum(['PF','PJ']),
  razao_social: z.string().min(2),
  document: z.string().min(11),
  inscricao_estadual: z.string().optional(),
  indicador_inscricao_estadual: z.number().int().min(0).max(9).optional(),
  inscricao_municipal: z.string().optional(),
  email: z.string().email().optional(),
  telefone: z.string().optional(),
  logradouro: z.string().optional(),
  numero: z.string().optional(),
  complemento: z.string().optional(),
  bairro: z.string().optional(),
  municipio: z.string().optional(),
  uf: z.string().length(2).optional(),
  cep: z.string().optional(),
  pais: z.string().default('Brasil'),
});
export type ClienteInput = z.infer<typeof ClienteSchema>;

const companyObject = z.object({
  cnpj: z.string().length(14, 'CNPJ deve ter 14 dígitos.'),
  razao_social: z.string().min(2),
  nome: z.string().optional(),
  inscricao_estadual: z.string().optional(),
  inscricao_municipal: z.string().optional(),
  codigo_municipio: z.string().optional(),
  // Endereço obrigatório (rua/cidade/estado). CEP e bairro são opcionais.
  // `numero` é obrigatório, EXCETO quando `sem_numero` = true (ver refine abaixo).
  logradouro: z.string().trim().min(1, 'Logradouro (rua) é obrigatório.'),
  numero: z.string().optional(),
  sem_numero: z.boolean().optional(),
  complemento: z.string().optional(),
  bairro: z.string().optional(),
  municipio: z.string().trim().min(1, 'Município (cidade) é obrigatório.'),
  uf: z.string().trim().length(2, 'UF (estado) é obrigatória.'),
  cep: z.string().optional(),
  telefone: z.string().optional(),
  email: z.string().email().optional(),
  // Regime tributário (mora em empresas_fiscais; coletado no cadastro pra alimentar
  // o POST /v2/empresas da Focus). Opcional aqui pra não quebrar o form de edição;
  // o CompanyCreateSchema reforça como obrigatório.
  Code_regime_tributario: z.enum(['1', '2', '3', '4']).optional(),
  // CNAE principal — capturado da consulta de CNPJ no cadastro; mora em empresas_fiscais.
  cnae_principal: z.string().optional(),
});

// Número obrigatório, salvo quando "Sem número" (sem_numero) estiver marcado.
const numeroOuSemNumero = (d: { numero?: string; sem_numero?: boolean }) =>
  d.sem_numero === true || (typeof d.numero === 'string' && d.numero.trim().length > 0);
const numeroError = { message: 'Informe o número ou marque "Sem número".', path: ['numero'] };

export const CompanySchema = companyObject.refine(numeroOuSemNumero, numeroError);
export type CompanyInput = z.infer<typeof companyObject>;

// Cadastro de empresa: valida também o CNPJ pelos dígitos verificadores
// (na edição o CNPJ não é editável, então usa-se CompanySchema).
export const CompanyCreateSchema = companyObject
  .extend({
    cnpj: z.string().length(14, 'CNPJ deve ter 14 dígitos.').refine(isValidCnpj, 'CNPJ inválido.'),
    Code_regime_tributario: z.enum(['1', '2', '3', '4'], {
      errorMap: () => ({ message: 'Selecione o regime tributário.' }),
    }),
  })
  .refine(numeroOuSemNumero, numeroError);

export const HonorarioSchema = z.object({
  cliente_id:      z.string().uuid('cliente_id deve ser UUID.'),
  company_id:      z.string().uuid('company_id deve ser UUID.'),
  mes_referencia:  z.string().regex(/^\d{4}(0[1-9]|1[0-2])$/, 'Formato esperado: YYYYMM (ex: 202606).'),
  valor:           z.number({ invalid_type_error: 'Valor deve ser numérico.' }).nonnegative('Valor não pode ser negativo.'),
  data_vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data_vencimento em YYYY-MM-DD.'),
  observacao:      z.string().optional(),
});
export type HonorarioInput = z.infer<typeof HonorarioSchema>;

export const EmpresaFiscalSchema = z.object({
  // 'simples' abrange Code 1-3 (Simples Nacional e Regime Normal); 'mei' = Code 4
  regime_tributario: z.enum(['simples', 'mei']),
  Code_regime_tributario: z.enum(['1', '2', '3', '4']),
  anexo_simples: z.enum(['Anexo I', 'Anexo II', 'Anexo III', 'Anexo IV', 'Anexo V']).nullable().optional(),
  usa_fator_r: z.boolean().nullable().optional(),
  cnae_principal: z.string().trim().min(1, 'CNAE inválido.').nullable().optional(),
  atividade_mei: z.enum(['Comercio ou Industria', 'Prestacao de Servicos', 'Comercio e Servicos']).nullable().optional(),
  // NFS-e (PR 1.5) — todos opcionais (o upsert é parcial).
  municipio_id: z.string().uuid().nullable().optional(),
  inscricao_municipal: z.string().nullable().optional(),
  serie_rps: z.string().nullable().optional(),
  numero_rps_inicial: z.coerce.number().int().nonnegative().nullable().optional(),
  nfse_autenticacao_tipo: z.string().nullable().optional(),
  nfse_usuario_login: z.string().nullable().optional(),
  nfse_senha_login: z.string().nullable().optional(),
  nfse_token_api: z.string().nullable().optional(),
  nfse_habilitada: z.boolean().nullable().optional(),
  empresa_fiscal_ativada: z.boolean().nullable().optional(),
});
export type EmpresaFiscalInput = z.infer<typeof EmpresaFiscalSchema>;

// Validador de CPF (isValidCnpj já existe via @/lib/validators/cnpj; não havia isValidCpf).
export function isValidCpf(cpf: string): boolean {
  const c = cpf.replace(/\D/g, '');
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(c[i]) * (len + 1 - i);
    const d = (sum * 10) % 11;
    return d === 10 ? 0 : d;
  };
  return calc(9) === Number(c[9]) && calc(10) === Number(c[10]);
}

export const ContabilidadeSchema = z.object({
  nome: z.string().min(2, 'Informe o nome do escritório.'),
  cnpj: z.string().refine(isValidCnpj, 'CNPJ inválido.'),
  crc: z.string().min(3, 'Informe o registro CRC.'),
  crc_uf: z.string().length(2, 'UF do CRC inválida.'),
});
export type ContabilidadeInput = z.infer<typeof ContabilidadeSchema>;

export const ContabilidadeBrandingSchema = z.object({
  nome: z.string().min(2),
  whatsapp_suporte: z.string().regex(/^\+?\d{10,15}$/, 'WhatsApp inválido (use DDD+número).').optional().or(z.literal('')),
  email_remetente_nome: z.string().max(80).optional().or(z.literal('')),
});
export type ContabilidadeBrandingInput = z.infer<typeof ContabilidadeBrandingSchema>;

export const HonorarioV2Schema = z.object({
  empresa_cliente_id: z.string().uuid('Selecione o cliente.'),
  // Normaliza formatos de moeda reais ("1.200,00", "R$ 1.500", "1200,5") antes de
  // validar — o usuário digita com separador de milhar e o regex cru rejeitava.
  valor: z.preprocess(
    (v) => (typeof v === 'string' ? normalizarValorBRL(v) : v),
    z.string().regex(/^\d+(\.\d{1,2})?$/, 'Valor inválido.').refine((s) => Number(s) > 0, 'Valor deve ser maior que zero.'),
  ),
  mes_referencia: z.string().regex(/^\d{4}-\d{2}$/, 'Competência inválida.'), // YYYY-MM
  data_vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  observacao: z.string().max(500).optional().or(z.literal('')),
  recorrente: z.boolean().default(false),
  recorrencia_dia: z.coerce.number().int().min(1).max(28).optional(),
}).refine((h) => !h.recorrente || h.recorrencia_dia != null,
  { message: 'Informe o dia da recorrência (1–28).' });
export type HonorarioV2Input = z.infer<typeof HonorarioV2Schema>;

export const AberturaCreateSchema = z.object({
  // required
  titular_nome_completo: z.string().trim().min(1, 'Informe o nome completo do titular.'),
  titular_cpf: z.string().refine((v) => isValidCpf(v), 'CPF inválido.'),
  empresa_razao_social_1: z.string().trim().min(1, 'Informe ao menos a 1ª opção de razão social.'),
  empresa_tipo: z.enum([...EMPRESA_TIPOS] as [string, ...string[]], { errorMap: () => ({ message: 'Selecione o tipo de empresa.' }) }),
  empresa_regime_tributario: z.enum([...REGIMES] as [string, ...string[]], { errorMap: () => ({ message: 'Selecione o regime.' }) }),
  sede_tipo_endereco: z.enum([...SEDE_TIPOS] as [string, ...string[]], { errorMap: () => ({ message: 'Selecione o tipo de endereço da sede.' }) }),
  // optional text fields (explicit — sem passthrough para evitar mass assignment)
  titular_rg_numero: z.string().optional(),
  titular_rg_orgao_emissor: z.string().optional(),
  titular_rg_uf: z.string().optional(),
  titular_data_nascimento: z.string().optional(),
  titular_estado_civil: z.string().optional(),
  titular_nome_mae: z.string().optional(),
  titular_nacionalidade: z.string().optional(),
  titular_telefone: z.string().optional(),
  titular_email: z.string().email('E-mail do titular inválido.').or(z.literal('')).optional(),
  titular_naturalidade_cidade: z.string().optional(),
  titular_naturalidade_uf: z.string().length(2).or(z.literal('')).optional(),
  titular_cep: z.string().optional(),
  titular_logradouro: z.string().optional(),
  titular_numero: z.string().optional(),
  titular_complemento: z.string().optional(),
  titular_bairro: z.string().optional(),
  titular_cidade: z.string().optional(),
  titular_uf: z.string().length(2).or(z.literal('')).optional(),
  empresa_razao_social_2: z.string().optional(),
  empresa_razao_social_3: z.string().optional(),
  empresa_nome_fantasia: z.string().optional(),
  empresa_capital_social: z.string().optional(),
  empresa_objeto_social: z.string().optional(),
  empresa_cnae_principal: z.string().optional(),
  empresa_cnaes_secundarios: z.array(z.string()).optional(),
  sede_mesmo_que_titular: z.boolean().optional(),
  sede_cep: z.string().optional(),
  sede_logradouro: z.string().optional(),
  sede_numero: z.string().optional(),
  sede_complemento: z.string().optional(),
  sede_bairro: z.string().optional(),
  sede_cidade: z.string().optional(),
  sede_uf: z.string().length(2).or(z.literal('')).optional(),
});
