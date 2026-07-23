// @custom — Parse do FormData da abertura, compartilhado entre o fluxo do
// empresário (onboarding) e o do escritório (contador). Módulo puro (não é
// 'use server'), então pode exportar funções síncronas.
import 'server-only';
import { ABERTURA_TEXT_FIELDS, EMPTY_ABERTURA, type AberturaData, type DocKey } from '@/types/abertura';

export function parseAberturaForm(fd: FormData): AberturaData {
  const d: AberturaData = { ...EMPTY_ABERTURA };
  for (const k of ABERTURA_TEXT_FIELDS) {
    const raw = fd.get(k);
    if (k === 'empresa_cnaes_secundarios') {
      (d as unknown as Record<string, unknown>)[k] = String(raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    } else if (k === 'sede_mesmo_que_titular') {
      (d as unknown as Record<string, unknown>)[k] = String(raw ?? '') === 'true';
    } else if (k === 'titular_cpf') {
      // Normaliza CPF para dígitos-only antes de armazenar e comparar (previne bypass da UNIQUE)
      (d as unknown as Record<string, unknown>)[k] = String(raw ?? '').replace(/\D/g, '');
    } else {
      (d as unknown as Record<string, unknown>)[k] = String(raw ?? '');
    }
  }
  return d;
}

export async function aberturaFileEntry(
  fd: FormData, k: DocKey,
): Promise<{ bytes: Buffer; ext: string; type: string } | null> {
  const f = fd.get(k);
  if (!(f instanceof File) || f.size === 0) return null;
  const bytes = Buffer.from(await f.arrayBuffer());
  const ext = (f.name.split('.').pop() || 'bin').toLowerCase();
  return { bytes, ext, type: f.type || 'application/octet-stream' };
}
