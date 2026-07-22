// Dinheiro trafega como string decimal (numeric do Postgres) e é manipulado em centavos int.
export function valorToCentavos(v: string | number): number {
  const s = typeof v === 'number' ? v.toFixed(2) : v;
  const [int, frac = ''] = s.replace(',', '.').split('.');
  return parseInt(int, 10) * 100 + parseInt((frac + '00').slice(0, 2), 10) * (s.startsWith('-') ? -1 : 1);
}
export function centavosToValor(c: number): string {
  const sign = c < 0 ? '-' : '';
  const abs = Math.abs(c);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
export function formatBRL(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
