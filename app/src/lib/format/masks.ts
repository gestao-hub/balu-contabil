// @custom — formatadores de máscara para inputs (CNPJ/CEP). Puros, sem deps.
// O valor cru (dígitos) é o que persiste; estas funções só formatam para exibição.

/** "11222333000181" → "11.222.333/0001-81". Tolera entrada parcial ou já mascarada. */
export function formatCnpj(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 14);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/** "80010000" → "80010-000". Tolera entrada parcial ou já mascarada. */
export function formatCep(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

/** "52998224725" → "529.982.247-25". Tolera entrada parcial ou já mascarada. */
export function formatCpf(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/** "4299501" → "4299-5/01" (subclasse CNAE, 7 dígitos). Tolera parcial ou já mascarado. */
export function formatCnae(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 7);
  if (d.length <= 4) return d;
  if (d.length <= 5) return `${d.slice(0, 4)}-${d.slice(4)}`;
  return `${d.slice(0, 4)}-${d.slice(4, 5)}/${d.slice(5)}`;
}

/**
 * Máscara de telefone: detecta fixo (10 dígitos) ou celular (11 dígitos).
 * Fixo:   "3544443333"  → "(35)4444-3333"
 * Celular:"35999568570" → "(35)9 9956-8570"
 */
export function formatTel(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2)  return d.length ? `(${d}` : d;
  if (d.length <= 6)  return `(${d.slice(0, 2)})${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)})${d.slice(2, 6)}-${d.slice(6)}`;
  // 11 dígitos → celular com espaço após o 9
  return `(${d.slice(0, 2)})${d.slice(2, 3)} ${d.slice(3, 7)}-${d.slice(7)}`;
}
