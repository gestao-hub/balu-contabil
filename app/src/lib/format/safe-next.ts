// src/lib/format/safe-next.ts
// Valida um `?next=` recebido de login/cadastro antes de usar em redirect().
// Só aceita path interno (`/algo`), nunca uma URL que o browser resolva para
// outra origem. Vetores cobertos:
//   - `//host` e `http(s)://host` → redirect externo direto
//   - `/\host` → o browser resolve `\` como `/`, virando `//host`
//   - `/\t/host`, `/\n/host` → o WHATWG URL remove TAB/CR/LF antes de parsear,
//     então `/\t/evil.com` vira `//evil.com` (open redirect). Por isso rejeitamos
//     QUALQUER caractere de controle C0 (0–31) e DEL (127).
// Allow-list conservador é mais seguro que caçar cada bypass individual.

/** True se `s` tem algum caractere de controle C0 (0–31) ou DEL (127). */
function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c <= 31 || c === 127) return true;
  }
  return false;
}

/** Retorna `next` se for um path interno seguro, senão `null`. */
export function safeNext(next: string): string | null {
  if (
    next.startsWith('/') &&
    !next.startsWith('//') &&
    !next.includes('://') &&
    !next.includes('\\') &&
    !hasControlChar(next)
  ) {
    return next;
  }
  return null;
}
