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

// Normaliza entrada monetária livre ("R$ 1.200,50", "1.200", "1200,5") para string
// decimal canônica com ponto ("1200.50"). Heurística BR: vírgula = decimal e pontos =
// milhar; sem vírgula, um único ponto só é decimal com 1–2 casas (senão é milhar).
// Retorna '' quando não sobra dígito — deixando o schema rejeitar como "Valor inválido.".
export function normalizarValorBRL(entrada: string): string {
  let s = String(entrada).trim().replace(/[^\d.,-]/g, ''); // tira "R$", espaços, etc.
  if (!s) return '';
  const neg = s.startsWith('-');
  s = s.replace(/-/g, '');
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');            // 1.200,50 → 1200.50
  } else if ((s.match(/\./g) || []).length > 1) {
    s = s.replace(/\./g, '');                              // 1.200.000 → 1200000
  } else if (s.includes('.')) {
    const frac = s.split('.')[1] ?? '';
    if (frac.length > 2) s = s.replace('.', '');           // 1.200 (milhar) → 1200
  }                                                         // 1200.50 fica como está
  return (neg ? '-' : '') + s;
}
