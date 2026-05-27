// Auto-gerado — esquemas Zod para os payloads mais usados.
// Estender conforme as pages forem implementadas.
import { z } from 'zod';

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

export const CompanySchema = z.object({
  cnpj: z.string().length(14),
  razao_social: z.string().min(2),
  nome: z.string().optional(),
  inscricao_estadual: z.string().optional(),
  inscricao_municipal: z.string().optional(),
  codigo_municipio: z.string().optional(),
  logradouro: z.string().optional(),
  numero: z.string().optional(),
  bairro: z.string().optional(),
  municipio: z.string().optional(),
  uf: z.string().length(2).optional(),
  cep: z.string().optional(),
  telefone: z.string().optional(),
  email: z.string().email().optional(),
});
export type CompanyInput = z.infer<typeof CompanySchema>;

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