// Datas do domínio fiscal são datas de CALENDÁRIO no fuso de Brasília
// (America/Sao_Paulo, UTC-3). Usar toISOString() (UTC) causa erro de 1 dia nas
// ~3h finais do dia BRT (a data UTC já virou). Este helper formata qualquer
// instante como a data BRT correspondente, sem depender do TZ do processo
// (Vercel roda em UTC por padrão).

const FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Data BRT de `d` (default: agora) no formato 'YYYY-MM-DD'. */
export function ymdBrt(d: Date = new Date()): string {
  return FMT.format(d); // en-CA => 'YYYY-MM-DD'
}

/** Mês BRT (1–12) de `d`. */
export function mesBrt(d: Date = new Date()): number {
  return Number(ymdBrt(d).slice(5, 7));
}
