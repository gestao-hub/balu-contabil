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
  optante_mei?: boolean;
  optante_simples_nacional?: boolean;
  cnae_principal?: string;
};

export type CnpjLookupResult =
  | { ok: true; data: CnpjLookup }
  | { ok: false; error: string };

function onlyDigits(s: string): string {
  return (s ?? '').replace(/\D+/g, '');
}

function normCnpj(s: string): string {
  return onlyDigits(s);
}

function stringOrUndef(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function boolOrUndef(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function mapLookup(raw: Record<string, unknown>): CnpjLookup {
  // A Focus (/v2/cnpjs) devolve o endereço ANINHADO em `endereco`, com o
  // município em `nome_municipio`. Mantemos fallback pro nível raiz p/ tolerar
  // variações/shape plano. nome_fantasia, IE/IM, telefone e email NÃO vêm desse
  // endpoint — ficam undefined (preenchidos à mão).
  const e = asRecord(raw['endereco']);
  return {
    razao_social:        stringOrUndef(raw['razao_social'] ?? raw['nome']),
    nome_fantasia:       stringOrUndef(raw['nome_fantasia'] ?? raw['fantasia']),
    inscricao_estadual:  stringOrUndef(raw['inscricao_estadual']),
    inscricao_municipal: stringOrUndef(raw['inscricao_municipal']),
    logradouro:          stringOrUndef(e['logradouro'] ?? raw['logradouro']),
    numero:              stringOrUndef(e['numero'] ?? raw['numero']),
    complemento:         stringOrUndef(e['complemento'] ?? raw['complemento']),
    bairro:              stringOrUndef(e['bairro'] ?? raw['bairro']),
    municipio:           stringOrUndef(e['nome_municipio'] ?? raw['nome_municipio'] ?? raw['municipio']),
    uf:                  stringOrUndef(e['uf'] ?? raw['uf']),
    cep:                 stringOrUndef(e['cep'] ?? raw['cep'])?.replace(/\D+/g, ''),
    telefone:            stringOrUndef(raw['telefone']),
    email:               stringOrUndef(raw['email']),
    optante_mei:              boolOrUndef(raw['optante_mei']),
    optante_simples_nacional: boolOrUndef(raw['optante_simples_nacional']),
    cnae_principal:           stringOrUndef(raw['cnae_principal']),
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

// O call() da Focus (focus-nfe.ts) lança Error("Focus <method> <path> → <status>: <texto>")
// para respostas com falha; erro de rede/timeout relança o Error original (ex.: "fetch failed").
function classifyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e ?? '');
  if (/→ 404\b/.test(msg) || /nao_encontrado|não encontrado|not found/i.test(msg)) {
    return 'CNPJ não encontrado na Receita.';
  }
  if (/→ 5\d\d\b/.test(msg) || /timeout|fetch failed|network|ECONN|ETIMEDOUT/i.test(msg)) {
    return 'Serviço de consulta indisponível. Tente novamente.';
  }
  return 'Falha ao consultar CNPJ.';
}
