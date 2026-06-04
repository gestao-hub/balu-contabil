import type { CnpjLookup } from './cnpj-lookup';
import type { CompanyInput } from '@/types/zod';

// Campos de `companies` que vêm do registro da Receita → read-only no app (refletem a Receita).
// `codigo_municipio` é oficial/read-only mas NÃO vem do /v2/cnpjs (mantido pelo cadastro/snapshot).
export const CAMPOS_OFICIAIS_RECEITA = [
  'razao_social', 'logradouro', 'numero', 'sem_numero', 'complemento',
  'bairro', 'municipio', 'uf', 'cep', 'codigo_municipio',
] as const;

// Campos que a Receita NÃO fornece → editáveis manualmente.
export const CAMPOS_MANUAIS = [
  'nome', 'inscricao_estadual', 'inscricao_municipal', 'telefone', 'email',
] as const;

/**
 * Patch dos campos oficiais que a consulta de CNPJ (Focus /v2/cnpjs) realmente traz:
 * razão social + endereço. `codigo_municipio` NÃO vem do endpoint → não entra aqui.
 * Ignora valores nulos/vazios (não sobrescreve com vazio).
 */
export function camposOficiaisDaReceita(lookup: Partial<CnpjLookup>): Partial<CompanyInput> {
  const out: Partial<CompanyInput> = {};
  const set = <K extends keyof CompanyInput>(k: K, v: string | undefined) => {
    if (v != null && v !== '') out[k] = v as CompanyInput[K];
  };
  set('razao_social', lookup.razao_social);
  set('logradouro', lookup.logradouro);
  set('numero', lookup.numero);
  set('complemento', lookup.complemento);
  set('bairro', lookup.bairro);
  set('municipio', lookup.municipio);
  set('uf', lookup.uf);
  set('cep', lookup.cep);
  return out;
}
