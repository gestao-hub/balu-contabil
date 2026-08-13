import 'server-only';

// Consulta de CNPJ na BrasilAPI (pública). Usada SÓ p/ obter a lista de CNAEs
// (principal + secundários) — a Focus /v2/cnpjs não traz secundários.
export type BrasilApiCnae = { codigo: string; descricao: string | null };
export type BrasilApiCnpj = {
  cnaePrincipal: BrasilApiCnae | null;
  cnaesSecundarios: BrasilApiCnae[];
  /**
   * `YYYY-MM-DD` do início de atividade, ou null.
   *
   * A resposta sempre trouxe este campo; nós é que não líamos. É o dado que
   * faltava para anualizar o RBT12 de empresa com menos de 12 meses — o
   * cálculo já sabia fazer (`rbt12.ts` recebe `dataInicioAtividade`), e a
   * apuração passava sem ele porque não havia de onde tirar. Aproveitar a
   * consulta que já acontece no cadastro é melhor do que uma chamada nova.
   */
  dataInicioAtividade: string | null;
};

function codigoStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).replace(/\D+/g, '');
  return s.length >= 6 && !/^0+$/.test(s) ? s : null; // CNAE tem 7 dígitos; 0 = "não há"
}
function descStr(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  return s.length ? s : null;
}

/**
 * Aceita só `YYYY-MM-DD` real, e recusa o resto em silêncio.
 *
 * Data de abertura errada não some: ela vira RBT12 anualizado por um número de
 * meses errado, e daí alíquota errada. Melhor ficar sem o campo (o cálculo já
 * trata a ausência) do que gravar uma data que ninguém conferiu.
 */
function dataStr(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return null;
  // Empresa aberta no futuro é erro da fonte, não novidade.
  if (d.getTime() > Date.now()) return null;
  return s;
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
  return { cnaePrincipal, cnaesSecundarios, dataInicioAtividade: dataStr(o.data_inicio_atividade) };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * GET https://brasilapi.com.br/api/cnpj/v1/{cnpj}. null em erro (best-effort).
 *
 * O endpoint `/cnpj/v1` é lento e limita agressivamente (429) — uma única tentativa
 * com timeout curto falha com frequência e deixava os CNAEs secundários sem popular.
 * Tenta até 3 vezes com backoff (timeout maior que o anterior 8s); só desiste em erro
 * que não seja transitório (4xx ≠ 429).
 */
export async function consultarCnpjBrasilApi(cnpj: string): Promise<BrasilApiCnpj | null> {
  const d = (cnpj ?? '').replace(/\D+/g, '');
  if (d.length !== 14) return null;

  const MAX_TENTATIVAS = 3;
  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    try {
      const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${d}`, {
        // SEM User-Agent o undici (fetch do Node) manda UA vazio e a BrasilAPI
        // responde 403 — era ESTE o motivo dos secundários nunca popularem (curl
        // funcionava por mandar seu próprio UA). Qualquer UA não-vazio resolve.
        headers: { Accept: 'application/json', 'User-Agent': 'Balu/1.0 (+https://balu.com.br)' },
        signal: AbortSignal.timeout(12000),
      });
      if (res.ok) return mapBrasilApiCnpj(await res.json());
      // 4xx (exceto 429) é definitivo — CNPJ não existe / inválido; não adianta repetir.
      if (res.status !== 429 && res.status >= 400 && res.status < 500) return null;
      // 429/5xx: transitório — cai pro backoff.
    } catch {
      // timeout/rede: transitório — cai pro backoff.
    }
    if (tentativa < MAX_TENTATIVAS) await sleep(tentativa * 1500); // 1.5s, 3s
  }
  return null;
}
