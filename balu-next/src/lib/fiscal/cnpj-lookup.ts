import 'server-only';
import { focus } from '@/lib/clients/focus-nfe';

// Consulta de CNPJ na Focus (GET /v2/cnpjs/:cnpj), compartilhada pelos cadastros
// de empresa e cliente. O endpoint só existe em PRODUÇÃO (404 em homologação) e é
// read-only da Receita, então forçamos 'prod' independente de FOCUS_NFE_ENV.

export type CnpjLookup = {
  razao_social?: string;
  nome_fantasia?: string;
  inscricao_estadual?: string;
  inscricao_municipal?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
  cep?: string;
  telefone?: string;
  email?: string;
};

export type CnpjLookupResult =
  | { ok: true; data: CnpjLookup }
  | { ok: false; error: string };

function onlyDigits(s: string): string {
  return (s ?? '').replace(/\D+/g, '');
}

function normCnpj(s: string): string {
  return onlyDigits(s).padStart(14, '0').slice(-14);
}

function stringOrUndef(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function mapLookup(raw: Record<string, unknown>): CnpjLookup {
  return {
    razao_social:        stringOrUndef(raw['razao_social'] ?? raw['nome']),
    nome_fantasia:       stringOrUndef(raw['nome_fantasia'] ?? raw['fantasia']),
    inscricao_estadual:  stringOrUndef(raw['inscricao_estadual']),
    inscricao_municipal: stringOrUndef(raw['inscricao_municipal']),
    logradouro:          stringOrUndef(raw['logradouro']),
    numero:              stringOrUndef(raw['numero']),
    complemento:         stringOrUndef(raw['complemento']),
    bairro:              stringOrUndef(raw['bairro']),
    municipio:           stringOrUndef(raw['municipio']),
    uf:                  stringOrUndef(raw['uf']),
    cep:                 stringOrUndef(raw['cep'])?.replace(/\D+/g, ''),
    telefone:            stringOrUndef(raw['telefone']),
    email:               stringOrUndef(raw['email']),
  };
}

export async function lookupCnpj(cnpj: string): Promise<CnpjLookupResult> {
  const d = normCnpj(cnpj);
  if (d.length !== 14 || /^0+$/.test(d)) return { ok: false, error: 'CNPJ inválido.' };
  try {
    const raw = await focus.consultarCnpj(d, 'prod');
    return { ok: true, data: mapLookup(raw) };
  } catch (e) {
    return { ok: false, error: classifyError(e) };
  }
}

function classifyError(_e: unknown): string {
  // Substituído na Task 2 — placeholder mínimo só pra compilar o caminho de sucesso.
  return 'Falha ao consultar CNPJ.';
}
