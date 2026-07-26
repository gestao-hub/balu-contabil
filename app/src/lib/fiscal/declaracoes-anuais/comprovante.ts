// src/lib/fiscal/declaracoes-anuais/comprovante.ts
// Validação e endereçamento do recibo baixado do portal da Receita. Puro:
// a action chama isto ANTES de tocar no storage (spec §5.5).
import type { DeclaracaoAnualTipo } from './tipos';

export const BUCKET_COMPROVANTES = 'declaracoes-comprovantes';
export const MAX_COMPROVANTE_BYTES = 5 * 1024 * 1024;

const EXTENSAO: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
};

export type ResultadoValidacao = { ok: true } | { ok: false; error: string };

export function validarComprovante(c: { mime: string; tamanho: number }): ResultadoValidacao {
  if (!EXTENSAO[c.mime]) return { ok: false, error: 'O comprovante precisa ser PDF, PNG ou JPEG.' };
  if (c.tamanho <= 0) return { ok: false, error: 'O arquivo está vazio.' };
  if (c.tamanho > MAX_COMPROVANTE_BYTES) return { ok: false, error: 'O comprovante passa de 5 MB.' };
  return { ok: true };
}

/**
 * Path determinístico `${companyId}/${tipo}-${ano}.${ext}`. Com upsert, a
 * retificadora substitui o recibo anterior em vez de acumular lixo no bucket.
 */
export function caminhoComprovante(
  companyId: string,
  tipo: DeclaracaoAnualTipo,
  ano: number,
  mime: string,
): string {
  if (!/^[\w-]+$/.test(companyId)) throw new Error('companyId inválido');
  const ext = EXTENSAO[mime];
  if (!ext) throw new Error('MIME não suportado');
  return `${companyId}/${tipo}-${ano}.${ext}`;
}
