// A parte PENSANTE da apuração automática: quem apurar, em que ordem, e quando
// parar. Pura, sem banco — é o que dá para testar de verdade.
//
// POR QUE ISTO EXISTE SEPARADO DO LAÇO: a decisão de "não estourar o cron" não
// pode morar dentro de um `for` cheio de `await` de banco. Ali ela vira uma
// condição que ninguém consegue exercitar; aqui ela é uma função com entrada e
// saída.

export type EmpresaParaApurar = {
  companyId: string;
  ownerUserId: string | null;
  regimeCode: string;
  anexoSimples: string | null;
  atividadeMei: string | null;
  /** Da Receita (0082). null = desconhecido; o cálculo então não anualiza. */
  dataInicioAtividade: string | null;
};

export type ApuracaoExistente = {
  companyId: string;
  status: string | null;
  atualizadaEm: string | null;
};

/**
 * Status a partir dos quais a apuração NÃO pode ser reescrita pelo cron.
 *
 * Recalcular uma competência já declarada apagaria a base do que foi
 * transmitido à Receita — o número no PGDAS-D deixaria de bater com o número
 * no app, e o app estaria errado por cima de um ato já praticado. Retificar é
 * decisão humana, com efeito legal; não é trabalho de cron.
 */
const STATUS_INTOCAVEIS = new Set(['transmitida', 'declarada', 'retificada']);

export function podeApurar(existente: ApuracaoExistente | undefined): boolean {
  if (!existente) return true;
  return !STATUS_INTOCAVEIS.has((existente.status ?? '').toLowerCase());
}

/**
 * A ordem em que as empresas entram na fila.
 *
 * QUEM NUNCA FOI APURADO VEM PRIMEIRO, depois quem foi apurado há mais tempo.
 * É isso que faz o corte por orçamento ser justo: se só der para dez hoje, as
 * dez que ficaram para trás são as primeiras amanhã. Sem essa ordem, uma lista
 * sempre na mesma sequência apuraria eternamente as mesmas empresas do começo
 * e nunca chegaria ao fim da base.
 */
export function ordenarFila(
  empresas: EmpresaParaApurar[],
  existentes: Map<string, ApuracaoExistente>,
): EmpresaParaApurar[] {
  return [...empresas]
    .filter((e) => podeApurar(existentes.get(e.companyId)))
    .sort((a, b) => {
      const ea = existentes.get(a.companyId);
      const eb = existentes.get(b.companyId);
      const ta = ea?.atualizadaEm ?? '';
      const tb = eb?.atualizadaEm ?? '';
      // '' (nunca apurada) ordena antes de qualquer timestamp ISO.
      if (ta === tb) return a.companyId.localeCompare(b.companyId);
      return ta < tb ? -1 : 1;
    });
}

/**
 * Quanto tempo o laço ainda pode gastar.
 *
 * O `maxDuration` da rota é 60s, e ele é COMPARTILHADO com a materialização, os
 * e-mails, o WhatsApp, a conciliação e o billing. Timeout de wall-clock não é
 * capturável por try/catch: se estourar, a invocação morre inteira e o que
 * viesse depois simplesmente não acontece.
 *
 * A defesa é o laço se cortar ANTES da plataforma cortar. A apuração é a última
 * da fila justamente porque é a única que pode ser interrompida sem prejuízo:
 * ela é mensal e o cron é diário — sobram ~30 passadas para terminar o mês.
 */
export function dentroDoOrcamento(
  inicioMs: number,
  agoraMs: number,
  orcamentoMs: number,
  custoEstimadoMs: number,
): boolean {
  return agoraMs - inicioMs + custoEstimadoMs <= orcamentoMs;
}

/** Competência YYYYMM do mês anterior ao da data dada (a última já fechada). */
export function competenciaAlvo(competenciaAtual: string): string {
  const r = String(competenciaAtual ?? '').padStart(6, '0');
  const y = Number(r.slice(0, 4));
  const m = Number(r.slice(4, 6));
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return r;
  const idx = y * 12 + (m - 1) - 1;
  return `${Math.floor(idx / 12)}${String((idx % 12) + 1).padStart(2, '0')}`;
}
