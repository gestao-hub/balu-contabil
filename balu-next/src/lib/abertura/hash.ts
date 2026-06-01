// src/lib/abertura/hash.ts
import { createHash } from 'node:crypto';
import { ABERTURA_TEXT_FIELDS, DOC_KEYS, type AberturaData, type DocKey } from '@/types/abertura';

export type CanonicalObject = { fields: Record<string, unknown>; docs: Record<string, string | null> };

function normalizeValue(v: unknown): unknown {
  if (Array.isArray(v)) return [...v].map(String).map((s) => s.trim()).sort();
  if (typeof v === 'string') return v.trim();
  return v;
}

/** Monta o objeto canônico (chaves ordenadas) a partir dos dados + content-hash dos docs. */
export function canonical(data: AberturaData, docHashes: Partial<Record<DocKey, string>>): CanonicalObject {
  const fields: Record<string, unknown> = {};
  for (const k of [...ABERTURA_TEXT_FIELDS].sort()) {
    fields[k] = normalizeValue((data as unknown as Record<string, unknown>)[k]);
  }
  const docs: Record<string, string | null> = {};
  for (const k of [...DOC_KEYS].sort()) docs[k] = docHashes[k] ?? null;
  return { fields, docs };
}

export function dadosHash(c: CanonicalObject): string {
  return createHash('sha256').update(JSON.stringify(c)).digest('hex');
}

export function sha256File(bytes: Buffer | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
