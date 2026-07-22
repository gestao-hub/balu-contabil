// src/lib/format/safe-next.ts
// Valida um `?next=` recebido de login/cadastro antes de usar em redirect().
// Só aceita path interno (`/algo`) — nunca `//host`, `http(s)://host` nem
// `/\host` (browsers resolvem `\` como `/`, então `new URL('/\\evil.com', origin)`
// vira `https://evil.com/` — vetor de open redirect se não bloqueado).

/** Retorna `next` se for um path interno seguro, senão `null`. */
export function safeNext(next: string): string | null {
  if (
    next.startsWith('/') &&
    !next.startsWith('//') &&
    !next.includes('://') &&
    !next.includes('\\')
  ) {
    return next;
  }
  return null;
}
