// @custom — DATA E HORA PARA A TELA, SEMPRE EM BRT.
//
// ─── POR QUE ESTE MÓDULO EXISTE: O BUG-006 ──────────────────────────────────
// A auditoria de 29/08/2026 capturou um erro React #418 (hidratação) e não
// conseguiu isolar o escopo. A causa foi medida em 01/09/2026, comparando a
// MESMA expressão nos dois lados:
//
//   new Date('2026-09-01T02:00:00Z').toLocaleDateString('pt-BR')
//     servidor (Node, TZ=UTC como na Vercel)  → "01/09/2026"
//     cliente  (Chromium, America/Sao_Paulo)  → "31/08/2026"
//
// Um client component renderiza NOS DOIS LADOS: o servidor produz o HTML, o
// cliente hidrata. Strings diferentes = mismatch, que é o #418.
//
// O tamanho do problema, por formato:
//   - só data  → diverge para todo timestamp entre 00:00 e 03:00 UTC, ou seja
//                12,5% dos horários. Intermitente, que foi como a auditoria viu.
//   - com hora → diverge SEMPRE. BRT é UTC-3 o ano inteiro (o horário de verão
//                acabou em 2019), então a hora nunca coincide.
//
// Isso explica cada evidência do BUG-006 melhor que a hipótese do service
// worker que estava registrada em `sw.ts`: só o PRIMEIRO carregamento hidrata,
// então o erro aparece uma vez e some na navegação seguinte; e uma aba limpa
// que caia numa tela sem data não repete.
//
// ─── POR QUE FUSO FIXO, E NÃO O DO NAVEGADOR ────────────────────────────────
// Fixar `America/Sao_Paulo` faz servidor e cliente escreverem a mesma string —
// e é também a resposta CERTA para o produto. Prazo de DAS, vencimento de guia
// e validade de certificado são datas fiscais brasileiras: quem abre o app de
// outro fuso precisa ver o prazo de Brasília, não o do lugar onde está. Ler o
// relógio do dispositivo daria a resposta errada para essa pessoa.
//
// A outra saída conhecida — renderizar só depois do `mounted` — troca o erro
// por um salto de layout em toda tela com data, e ainda deixa a primeira
// pintura sem a informação. Pior, e mais espalhado.
//
// ⚠️ NÃO volte a usar `toLocaleDateString`/`toLocaleString` sem `timeZone` em
// componente de tela. É o mesmo defeito, e ele volta silencioso: em produção o
// React só emite um erro minificado, uma vez.

const FUSO = 'America/Sao_Paulo';

// `Intl.DateTimeFormat` é caro de construir e estas telas formatam em laço
// (listas de honorários, notas, aberturas). Instância por formato, criada uma
// vez por processo.
const fData = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO, day: '2-digit', month: '2-digit', year: 'numeric',
});
const fDataHora = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO, day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit',
});
const fMesAno = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO, month: 'long', year: 'numeric',
});

export type EntradaData = string | number | Date | null | undefined;

/**
 * Normaliza a entrada para `Date`, ou `null` quando não dá.
 *
 * Data inválida devolve `null` em vez de "Invalid Date" na tela: o valor vem do
 * banco e de APIs de terceiros, e uma string quebrada não é motivo para
 * estampar texto em inglês no meio de uma tabela em português.
 */
function paraData(v: EntradaData): Date | null {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** `dd/mm/aaaa` em BRT. `ausente` (padrão `'—'`) quando não há data. */
export function dataBrt(v: EntradaData, ausente = '—'): string {
  const d = paraData(v);
  return d ? fData.format(d) : ausente;
}

/** `dd/mm/aaaa, hh:mm` em BRT. */
export function dataHoraBrt(v: EntradaData, ausente = '—'): string {
  const d = paraData(v);
  return d ? fDataHora.format(d) : ausente;
}

/** `setembro de 2026` em BRT. */
export function mesAnoBrt(v: EntradaData, ausente = '—'): string {
  const d = paraData(v);
  return d ? fMesAno.format(d) : ausente;
}

/**
 * `setembro de 2026` a partir de uma COMPETÊNCIA (`'2026-09'`, `'2026-09-01'`
 * ou `'202609'`) — sem passar por `Date`, e portanto sem fuso nenhum.
 *
 * ⚠️ A DIFERENÇA COM `mesAnoBrt` É O BUG QUE ESTA FUNÇÃO EVITA. Competência é
 * rótulo de calendário, não instante no tempo. O código anterior fazia
 * `new Date(ano, mes - 1)`, que é meia-noite LOCAL: no servidor (UTC) isso é
 * `2026-09-01T00:00Z`, e formatar esse instante no fuso de Brasília devolve
 * **agosto**. O mês do honorário mudaria sozinho dependendo de onde o código
 * roda — pior que o mismatch de hidratação, porque estaria errado nos dois
 * lados de forma diferente.
 *
 * Aqui não há instante: o mês vem de uma tabela, indexada pelo número.
 */
const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

export function mesAnoCompetencia(competencia: string | null | undefined, ausente = '—'): string {
  const s = (competencia ?? '').trim();
  if (!s) return ausente;
  // Aceita os dois formatos que convivem no banco: 'YYYY-MM[-DD]' e 'YYYYMM'
  // (a divergência que a migration 0036 já corrigiu no semáforo, e que segue
  // valendo como formato de entrada).
  const m = s.match(/^(\d{4})-?(\d{2})/);
  if (!m) return ausente;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12) return ausente;
  return `${MESES[mes - 1]} de ${ano}`;
}
