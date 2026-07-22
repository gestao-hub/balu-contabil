// Só permite baixar de hosts conhecidos da Focus; bloqueia SSRF para rede interna.
// Estreito de propósito: dentro de amazonaws.com só S3 é aceito (nunca Lambda
// Function URL / API Gateway / ELB), pois esses permitiriam um endpoint controlado
// que redireciona para alvo interno. Combinado com redirect:'manual' no fetch,
// fecha o bypass por 3xx.
const SUFIXO_FOCUS = '.focusnfe.com.br';

/** true se o host é um endpoint S3 (qualquer região), path- ou virtual-hosted. */
function ehHostS3(host: string): boolean {
  if (!host.endsWith('.amazonaws.com')) return false;
  // virtual-hosted: bucket.s3.amazonaws.com / bucket.s3.<region>.amazonaws.com
  // path-style: s3.amazonaws.com / s3.<region>.amazonaws.com / s3-<region>...
  return /(^|\.)s3[.-]/.test(host);
}

function ehAlvoInterno(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, ''); // tira colchetes de IPv6
  if (h === 'localhost') return true;
  // IPv6 loopback / ULA / não especificado / IPv4 mapeado
  if (h === '::1' || h === '::' || h.startsWith('fc') || h.startsWith('fd')) return true;
  if (h.startsWith('::ffff:')) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 0) return true;                       // 0.0.0.0/8
  if (a === 127) return true;                     // loopback
  if (a === 10) return true;                       // privado
  if (a === 192 && b === 168) return true;         // privado
  if (a === 172 && b >= 16 && b <= 31) return true; // privado
  if (a === 169 && b === 254) return true;         // link-local / metadata
  return false;
}

export function urlDownloadPermitida(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (ehAlvoInterno(host)) return false;
  return host === SUFIXO_FOCUS.slice(1) || host.endsWith(SUFIXO_FOCUS) || ehHostS3(host);
}
