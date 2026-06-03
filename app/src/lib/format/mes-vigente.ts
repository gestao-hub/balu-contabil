// Primeiro/último dia do mês corrente em BRT (UTC-3), em ISO 'YYYY-MM-DD'.
// Mesma lógica usada no HonorarioList.

export function primeiroDiaMesISO(): string {
  const brt = new Date(Date.now() - 3 * 60 * 60 * 1000);
  return `${brt.getFullYear()}-${String(brt.getMonth() + 1).padStart(2, '0')}-01`;
}

export function ultimoDiaMesISO(): string {
  const brt = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const last = new Date(brt.getFullYear(), brt.getMonth() + 1, 0).getDate();
  return `${brt.getFullYear()}-${String(brt.getMonth() + 1).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}
