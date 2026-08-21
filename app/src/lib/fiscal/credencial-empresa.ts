// Bloco 5 — os tokens DA EMPRESA (emissão), cifrados em repouso.
//
// NÃO confundir com `config-focus.ts`, que guarda a credencial da PLATAFORMA
// (a que cadastra empresas em /v2/empresas). São níveis diferentes: esta aqui
// emite nota em nome de UM CNPJ; aquela age em nome de todos.
//
// Módulos separados de propósito, como `config-ia` e `config-focus` já são: uma
// mudança de regra em um não pode alcançar o outro.
import 'server-only';
import { cifrarCampo, decifrarCampo, PREFIXO } from '@/lib/crypto/envelope';

export function guardarTokenEmpresa(token: string): string {
  if (!token) throw new Error('guardarTokenEmpresa: token vazio');
  const cifrado = cifrarCampo(token);
  // `cifrarCampo` devolve o próprio valor quando recebe '' — barrado acima. Se
  // um dia a cifra falhar em silêncio, gravar em claro seria pior que falhar.
  if (cifrado === token) throw new Error('guardarTokenEmpresa: cifra nao aplicada');
  return cifrado;
}

export function lerTokenEmpresa(cifrado: string | null): string | null {
  if (!cifrado) return null;
  // As colunas de token nasceram na 0096 e foram derrubadas pela 0097, que as
  // moveu para `empresa_credenciais_focus`. `guardarTokenEmpresa` recusa gravar
  // sem cifra: valor sem prefixo só pode ser gravação corrompida. O fallback
  // silencioso de `decifrarCampo` (que existe para certificado legado)
  // esconderia isso.
  if (!cifrado.startsWith(PREFIXO)) {
    throw new Error('lerTokenEmpresa: token da empresa sem cifra — gravacao corrompida');
  }
  return decifrarCampo(cifrado);
}
