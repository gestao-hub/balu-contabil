import 'server-only';
import { focus } from '@/lib/clients/focus-nfe';

// Catálogo de CNAE via Focus (GET /v2/codigos_cnae). Só código↔descrição↔hierarquia —
// NÃO traz anexo do Simples / Fator R (essa classificação é curada à parte; ver
// docs/investigations/FATOR-R-CNAE-SEGREGACAO.md). Serve p/ validar/autocompletar CNAE.

export type CnaeInfo = {
  codigo: string;                  // 7 dígitos
  codigoFormatado: string | null;  // ex.: '8599-6/03'
  descricao: string | null;
  secao: string | null;
  descricaoSecao: string | null;
};

/** Mapper puro da resposta do catálogo (testável sem rede). */
export function mapCnae(raw: Record<string, unknown> | null | undefined): CnaeInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const codigoRaw = (raw as Record<string, unknown>).codigo;
  const codigo = typeof codigoRaw === 'string' ? codigoRaw : codigoRaw != null ? String(codigoRaw) : null;
  if (!codigo) return null;
  // A busca (/v2/codigos_cnae?descricao=) devolve a descrição com markup HTML
  // destacando o termo (ex.: "<html>Reprodução de <i>software</i>...</html>").
  // O consultar-por-código vem limpo. Removemos tags nos dois casos.
  const str = (k: string) =>
    typeof raw[k] === 'string' ? (raw[k] as string).replace(/<[^>]*>/g, '').trim() : null;
  return {
    codigo,
    codigoFormatado: str('codigo_formatado'),
    descricao: str('descricao'),
    secao: str('secao'),
    descricaoSecao: str('descricao_secao'),
  };
}

/** Consulta um CNAE pelo código (7 dígitos). null se não achar / erro. */
export async function consultarCnae(codigo: string): Promise<CnaeInfo | null> {
  const d = (codigo ?? '').replace(/\D+/g, '');
  if (!d) return null;
  try {
    return mapCnae(await focus.consultarCnae(d));
  } catch {
    return null;
  }
}

/**
 * Busca CNAEs por termo: só dígitos → busca por `codigo`; senão por `descricao`.
 * Paginado (offset). Devolve [] em erro/sem termo.
 */
export async function buscarCnaes(termo: string, offset = 0): Promise<CnaeInfo[]> {
  const t = (termo ?? '').trim();
  if (!t) return [];
  const digits = t.replace(/\D+/g, '');
  const filtro: Record<string, string | number> =
    digits.length >= 2 && digits.length === t.length ? { codigo: digits } : { descricao: t };
  try {
    const raw = await focus.listarCnaes({ ...filtro, offset });
    return Array.isArray(raw)
      ? raw.map((r) => mapCnae(r as Record<string, unknown>)).filter((x): x is CnaeInfo => x != null)
      : [];
  } catch {
    return [];
  }
}
