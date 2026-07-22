// Só permite baixar de hosts conhecidos da Focus; bloqueia SSRF para rede interna.
const SUFIXOS_PERMITIDOS = ['.focusnfe.com.br', '.amazonaws.com'];

function ehIpInterno(host: string): boolean {
  if (host === 'localhost') return true;
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 127) return true;                 // loopback
  if (a === 10) return true;                   // privado
  if (a === 192 && b === 168) return true;     // privado
  if (a === 172 && b >= 16 && b <= 31) return true; // privado
  if (a === 169 && b === 254) return true;     // link-local / metadata
  return false;
}

export function urlDownloadPermitida(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (ehIpInterno(host)) return false;
  return SUFIXOS_PERMITIDOS.some((s) => host === s.slice(1) || host.endsWith(s));
}
