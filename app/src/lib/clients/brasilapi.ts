import 'server-only';

// Consulta de CNPJ na BrasilAPI (pública). Usada SÓ p/ obter a lista de CNAEs
// (principal + secundários) — a Focus /v2/cnpjs não traz secundários.
export type BrasilApiCnae = { codigo: string; descricao: string | null };
export type BrasilApiCnpj = { cnaePrincipal: BrasilApiCnae | null; cnaesSecundarios: BrasilApiCnae[] };

function codigoStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).replace(/\D+/g, '');
  return s.length >= 6 && !/^0+$/.test(s) ? s : null; // CNAE tem 7 dígitos; 0 = "não há"
}
function descStr(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  return s.length ? s : null;
}

export function mapBrasilApiCnpj(raw: unknown): BrasilApiCnpj {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pCod = codigoStr(o.cnae_fiscal);
  const cnaePrincipal = pCod ? { codigo: pCod, descricao: descStr(o.cnae_fiscal_descricao) } : null;
  const sec = Array.isArray(o.cnaes_secundarios) ? o.cnaes_secundarios : [];
  const cnaesSecundarios: BrasilApiCnae[] = [];
  for (const s of sec) {
    const r = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
    const cod = codigoStr(r.codigo);
    if (cod) cnaesSecundarios.push({ codigo: cod, descricao: descStr(r.descricao) });
  }
  return { cnaePrincipal, cnaesSecundarios };
}

/** GET https://brasilapi.com.br/api/cnpj/v1/{cnpj}. null em erro (best-effort). */
export async function consultarCnpjBrasilApi(cnpj: string): Promise<BrasilApiCnpj | null> {
  const d = (cnpj ?? '').replace(/\D+/g, '');
  if (d.length !== 14) return null;
  try {
    const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${d}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return mapBrasilApiCnpj(await res.json());
  } catch {
    return null;
  }
}
