// src/types/abertura.ts
// Tipos e configuração data-driven do wizard de abertura de empresa.
// Os nomes das chaves espelham EXATAMENTE as colunas de public.abertura_empresas.

export const DOC_KEYS = [
  'doc_rg_frente',
  'doc_rg_verso',
  'doc_cnh_frente',
  'doc_cnh_verso',
  'doc_cpf',
  'doc_comprovante_titular',
  'doc_comprovante_sede',
  'doc_declaracao_uso',
] as const;
export type DocKey = (typeof DOC_KEYS)[number];

export const EMPRESA_TIPOS = ['MEI', 'EI', 'LTDA'] as const;
export const REGIMES = ['MEI', 'Simples Nacional', 'Lucro Presumido', 'Lucro Real'] as const;
export const SEDE_TIPOS = ['Residencial', 'Comercial', 'Virtual'] as const;

// Campos textuais que entram no hash canônico e no raw_json da alteração.
export interface AberturaData {
  // titular
  titular_nome_completo: string;
  titular_cpf: string;
  titular_rg_numero: string;
  titular_rg_orgao_emissor: string;
  titular_rg_uf: string;
  titular_data_nascimento: string; // YYYY-MM-DD
  titular_estado_civil: string;
  titular_nome_mae: string;
  titular_nacionalidade: string;
  titular_telefone: string;
  titular_email: string;
  titular_naturalidade_cidade: string;
  titular_naturalidade_uf: string;
  // endereço titular
  titular_cep: string;
  titular_logradouro: string;
  titular_numero: string;
  titular_complemento: string;
  titular_bairro: string;
  titular_cidade: string;
  titular_uf: string;
  // empresa pretendida
  empresa_razao_social_1: string;
  empresa_razao_social_2: string;
  empresa_razao_social_3: string;
  empresa_nome_fantasia: string;
  empresa_tipo: (typeof EMPRESA_TIPOS)[number] | '';
  empresa_capital_social: string; // numérico como string no form
  empresa_objeto_social: string;
  empresa_cnae_principal: string;
  empresa_cnaes_secundarios: string[];
  empresa_regime_tributario: (typeof REGIMES)[number] | '';
  // sede
  sede_mesmo_que_titular: boolean;
  sede_tipo_endereco: (typeof SEDE_TIPOS)[number] | '';
  sede_cep: string;
  sede_logradouro: string;
  sede_numero: string;
  sede_complemento: string;
  sede_bairro: string;
  sede_cidade: string;
  sede_uf: string;
}

export const ABERTURA_TEXT_FIELDS = [
  'titular_nome_completo','titular_cpf','titular_rg_numero','titular_rg_orgao_emissor',
  'titular_rg_uf','titular_data_nascimento','titular_estado_civil','titular_nome_mae',
  'titular_nacionalidade','titular_telefone','titular_email','titular_naturalidade_cidade',
  'titular_naturalidade_uf','titular_cep','titular_logradouro','titular_numero',
  'titular_complemento','titular_bairro','titular_cidade','titular_uf',
  'empresa_razao_social_1','empresa_razao_social_2','empresa_razao_social_3',
  'empresa_nome_fantasia','empresa_tipo','empresa_capital_social','empresa_objeto_social',
  'empresa_cnae_principal','empresa_cnaes_secundarios','empresa_regime_tributario',
  'sede_mesmo_que_titular','sede_tipo_endereco','sede_cep','sede_logradouro','sede_numero',
  'sede_complemento','sede_bairro','sede_cidade','sede_uf',
] as const satisfies readonly (keyof AberturaData)[];

export const EMPTY_ABERTURA: AberturaData = {
  titular_nome_completo: '', titular_cpf: '', titular_rg_numero: '', titular_rg_orgao_emissor: '',
  titular_rg_uf: '', titular_data_nascimento: '', titular_estado_civil: '', titular_nome_mae: '',
  titular_nacionalidade: 'brasileiro(a)', titular_telefone: '', titular_email: '',
  titular_naturalidade_cidade: '', titular_naturalidade_uf: '',
  titular_cep: '', titular_logradouro: '', titular_numero: '', titular_complemento: '',
  titular_bairro: '', titular_cidade: '', titular_uf: '',
  empresa_razao_social_1: '', empresa_razao_social_2: '', empresa_razao_social_3: '',
  empresa_nome_fantasia: '', empresa_tipo: '', empresa_capital_social: '', empresa_objeto_social: '',
  empresa_cnae_principal: '', empresa_cnaes_secundarios: [], empresa_regime_tributario: '',
  sede_mesmo_que_titular: false, sede_tipo_endereco: '', sede_cep: '', sede_logradouro: '',
  sede_numero: '', sede_complemento: '', sede_bairro: '', sede_cidade: '', sede_uf: '',
};
