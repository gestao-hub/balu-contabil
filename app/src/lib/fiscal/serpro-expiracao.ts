// Puro (sem server-only) — testável. Calcula a expiração do autenticar_procurador_token.
// Regra oficial Serpro: "o token válido fica disponível até a meia-noite do dia seguinte"
// (horário de Brasília, UTC-3 fixo desde 2019 — sem horário de verão).

const SP_OFFSET_MS = 3 * 60 * 60 * 1000; // UTC-3

/**
 * Retorna (ISO) o instante 00:00 do dia seguinte ao da geração, em São Paulo.
 * Gerou 00:05 → ~24h; gerou 23:00 → ~1h. Determinístico via `now` injetável.
 */
export function proximaMeiaNoiteSaoPaulo(now: Date = new Date()): string {
  // Desloca pra "relógio de parede" de SP tratando como UTC para extrair a data local.
  const sp = new Date(now.getTime() - SP_OFFSET_MS);
  const y = sp.getUTCFullYear();
  const m = sp.getUTCMonth();
  const d = sp.getUTCDate();
  // 00:00 SP do dia seguinte, expresso como wall-clock; volta pra UTC somando o offset.
  const wallNextMidnight = Date.UTC(y, m, d + 1, 0, 0, 0, 0);
  return new Date(wallNextMidnight + SP_OFFSET_MS).toISOString();
}
