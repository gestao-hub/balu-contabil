// @custom — Parser puro da resposta do Serpro PGMEI / GERARDASPDF21.
// O envelope traz `dados` como STRING JSON (às vezes já objeto). Sem rede.

export type DasMeiResult = {
  numeroDocumento: string | null;
  dataVencimento: string | null; // ISO "YYYY-MM-DD"
  valores: { principal: number; multa: number; juros: number; total: number };
  codigoDeBarras: string[];
  pdfBase64: string | null;
};

function isoFromAaaammdd(s: unknown): string | null {
  if (typeof s !== 'string' || !/^\d{8}$/.test(s)) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export function parseDasMei(envelope: unknown): DasMeiResult {
  const env = (envelope ?? {}) as { dados?: unknown };
  let dados: unknown = env.dados;
  if (typeof dados === 'string') {
    try {
      dados = JSON.parse(dados);
    } catch {
      throw new Error('Serpro retornou `dados` em formato inválido.');
    }
  }
  const first = Array.isArray(dados) ? dados[0] : dados;
  const obj = (first ?? {}) as { detalhamento?: unknown; pdf?: unknown };
  const det = Array.isArray(obj.detalhamento) ? obj.detalhamento[0] : undefined;
  if (!det) throw new Error('Serpro não retornou DAS para a competência.');

  const d = det as {
    numeroDocumento?: unknown;
    dataVencimento?: unknown;
    valores?: { principal?: unknown; multa?: unknown; juros?: unknown; total?: unknown };
    codigoDeBarras?: unknown;
  };
  const v = d.valores ?? {};
  return {
    numeroDocumento: typeof d.numeroDocumento === 'string' ? d.numeroDocumento : null,
    dataVencimento: isoFromAaaammdd(d.dataVencimento),
    valores: { principal: num(v.principal), multa: num(v.multa), juros: num(v.juros), total: num(v.total) },
    codigoDeBarras: Array.isArray(d.codigoDeBarras) ? d.codigoDeBarras.map(String) : [],
    pdfBase64: typeof obj.pdf === 'string' ? obj.pdf : null,
  };
}
