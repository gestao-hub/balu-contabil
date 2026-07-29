// Bloco 6A — a chave do provedor de IA, cifrada em repouso.
//
// Mesmo molde de `lib/billing/credencial-subconta.ts`, que o 4B provou em
// produção. Não é abstração compartilhada de propósito: são segredos de domínios
// diferentes, e juntá-los faria uma mudança de regra de um alcançar o outro.
import { cifrarCampo, decifrarCampo, PREFIXO } from '@/lib/crypto/envelope';

export function guardarChaveIa(chave: string): string {
  if (!chave) throw new Error('guardarChaveIa: chave vazia');
  const cifrada = cifrarCampo(chave);
  // `cifrarCampo` devolve o próprio valor quando recebe '' — barrado acima. Se
  // um dia a cifra falhar em silêncio, gravar em claro seria pior que falhar.
  if (cifrada === chave) throw new Error('guardarChaveIa: cifra nao aplicada');
  return cifrada;
}

export function lerChaveIa(cifrada: string | null): string | null {
  if (!cifrada) return null;
  // A coluna nasceu na 0056 e `guardarChaveIa` recusa gravar sem cifra: valor
  // sem prefixo só pode ser gravação corrompida. O fallback silencioso de
  // `decifrarCampo` (que existe para certificado legado) esconderia isso.
  if (!cifrada.startsWith(PREFIXO)) {
    throw new Error('lerChaveIa: chave do provedor sem cifra — gravacao corrompida');
  }
  return decifrarCampo(cifrada);
}

/** Única forma permitida de mencionar a chave fora deste módulo. */
export function mascararChaveIa(chave: string | null): string {
  if (!chave || chave.length < 12) return '…';
  return `${chave.slice(0, 4)}…${chave.slice(-4)}`;
}
