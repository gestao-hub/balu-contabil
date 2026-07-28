// Bloco 4B — a credencial da subconta, cifrada em repouso.
//
// ESTE E O SEGREDO MAIS SENSIVEL DO SISTEMA. Mais que a SERVICE_ROLE_KEY:
// com ela se movimenta dinheiro na conta de OUTRA PESSOA, e o dano e
// imediato e irreversivel.
//
// Regras, todas obrigatorias (spec §3):
//  - cifrada em repouso, sempre;
//  - nunca sai para o cliente;
//  - nunca entra em log, INCLUSIVE log de erro — dai `mascarar`;
//  - so este modulo decifra. Quem precisa da chave chama `lerCredencial` e
//    passa direto para `asaasSub`, sem guardar em variavel de escopo largo.
import { cifrarCampo, decifrarCampo } from '@/lib/crypto/envelope';

export function guardarCredencial(apiKey: string): string {
  if (!apiKey) throw new Error('guardarCredencial: apiKey vazia');
  const cifrada = cifrarCampo(apiKey);
  // cifrarCampo devolve o proprio valor quando recebe '' — aqui isso ja foi
  // barrado acima, mas se um dia a cifra falhar em silencio, gravar em claro
  // seria pior que falhar.
  if (cifrada === apiKey) throw new Error('guardarCredencial: cifra nao aplicada');
  return cifrada;
}

export function lerCredencial(cifrada: string | null): string | null {
  if (!cifrada) return null;
  // `decifrarCampo` devolve o proprio valor quando nao ha o prefixo, para
  // conviver com certificado gravado em claro antes do Bloco E. Aqui NAO ha
  // legado: a coluna nasceu na 0053 e `guardarCredencial` recusa gravar sem
  // cifra. Entao valor sem prefixo so pode ser gravacao corrompida — e o
  // fallback silencioso a devolveria como se fosse chave boa, escondendo que
  // o segredo mais sensivel do sistema esta em claro no banco.
  if (!cifrada.startsWith('enc:v1:')) {
    throw new Error('lerCredencial: credencial da subconta sem cifra — gravacao corrompida');
  }
  return decifrarCampo(cifrada);
}

/** Única forma permitida de mencionar a chave fora deste módulo. */
export function mascarar(apiKey: string | null): string {
  if (!apiKey || apiKey.length < 12) return '…';
  return `${apiKey.slice(0, 6)}…${apiKey.slice(-4)}`;
}
