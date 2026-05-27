// Auto-gerado — esquemas Zod para os payloads mais usados.
// Estender conforme as pages forem implementadas.
import { z } from 'zod';
import { isValidCnpj } from '@/lib/validators/cnpj';

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
  bairro: z.string().optional(),
  municipio: z.string().trim().min(1, 'Município (cidade) é obrigatório.'),
  uf: z.string().trim().length(2, 'UF (estado) é obrigatória.'),
  cep: z.string().optional(),
  telefone: z.string().optional(),
  email: z.string().email().optional(),
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
  })
  .refine(numeroOuSemNumero, numeroError);

export const HonorarioSchema = z.object({
  cliente_id: z.string().uuid(),
  company_id: z.string().uuid(),
  mes_referencia: z.string().regex(/^\d{6}$/),
  valor: z.number().nonnegative(),
  data_vencimento: z.string().optional(),
  observacao: z.string().optional(),
});
export type HonorarioInput = z.infer<typeof HonorarioSchema>;

export const EmpresaFiscalSchema = z.object({
  // 'simples' abrange Code 1-3 (Simples Nacional e Regime Normal); 'mei' = Code 4
  regime_tributario: z.enum(['simples', 'mei']),
  Code_regime_tributario: z.enum(['1', '2', '3', '4']),
  anexo_simples: z.enum(['Anexo I', 'Anexo II', 'Anexo III', 'Anexo IV', 'Anexo V']).nullable().optional(),
  usa_fator_r: z.boolean().nullable().optional(),
  cnae_principal: z.string().trim().min(1, 'CNAE inválido.').nullable().optional(),
});
export type EmpresaFiscalInput = z.infer<typeof EmpresaFiscalSchema>;