// Casamento entre o que a SERPRO DECLARA (CONSDECLARACAO13) e o que ela diz
// estar PAGO (PAGTOWEB / PAGAMENTOS71) — puro, sem rede nem banco.
//
// POR QUE ISTO É UM MÓDULO, E NÃO CÓDIGO SOLTO NA ACTION
// Dois consumidores precisam exatamente da mesma regra: a sincronização pela
// tela (`impostos/actions.ts`) e a varredura diária do cron (Frente 3, Task 3).
// Duas cópias da normalização do número do documento é o tipo de divergência
// que ninguém nota — uma delas passa a casar menos DAS e a outra continua
// funcionando, então o sintoma é "às vezes não confirma", não um erro.
//
// A CHAVE É O NÚMERO DO DOCUMENTO, NÃO O VALOR. É identificador de verdade, e
// por isso esta fonte não tem o risco de falso-positivo que obrigou a
// conciliação bancária a exigir match inequívoco por valor+data.

import type { PagamentoDas } from '@/lib/fiscal/serpro-pagamentos-parse';

/**
 * Normaliza um número de DAS para casamento: só dígitos, sem zeros à esquerda.
 * O CONSDECLARACAO13 traz "07202610733758790" e o PAGAMENTOS71 "7202610733758790" —
 * mesmo documento, só diferindo no zero inicial.
 */
export function normalizarNumeroDas(v: string | null | undefined): string {
  return String(v ?? '').replace(/\D+/g, '').replace(/^0+/, '');
}

/** Índice dos pagamentos por número de documento normalizado. */
export function indexarPagamentos(pagamentos: PagamentoDas[]): Map<string, PagamentoDas> {
  const ix = new Map<string, PagamentoDas>();
  for (const p of pagamentos) {
    const chave = normalizarNumeroDas(p.numeroDocumento);
    if (chave) ix.set(chave, p);
  }
  return ix;
}

/** O DAS pago correspondente a um número declarado, se existir. */
export function casarPagamento(
  numeroDas: string | null | undefined,
  indice: Map<string, PagamentoDas>,
): PagamentoDas | undefined {
  const chave = normalizarNumeroDas(numeroDas);
  return chave ? indice.get(chave) : undefined;
}

export type BaixaPlanejada = {
  /**
   * A IDENTIDADE DA LINHA QUE FOI CASADA, quando o chamador a conhece.
   *
   * O casamento é por `numeroDas`; a competência é só carona. Quem chama a
   * partir de linhas do BANCO precisa disto porque `guias_fiscais
   * .competencia_referencia` é NULLABLE — e `UNIQUE (company_id,
   * competencia_referencia)` não impede duas linhas NULL na mesma empresa
   * (no Postgres, NULL nunca colide com NULL num índice único). Reencontrar a
   * guia por competência depois do plano faria o `find` devolver a PRIMEIRA
   * linha de competência nula: a baixa cairia na guia errada, com a data de
   * pagamento de outra, e a guia realmente paga continuaria cobrando o cliente.
   *
   * Opcional porque o outro chamador (a sincronização da tela) planeja sobre
   * situações vindas da SERPRO, que ainda não têm linha no banco — lá o id só
   * existe depois do upsert.
   */
  id?: string;
  competencia: string;
  dataPagamento: string;
  pagamento: PagamentoDas;
};

export type PlanoDeBaixa = {
  /** As baixas que podem ser registradas pela RPC. */
  baixas: BaixaPlanejada[];
  /**
   * DAS que a Receita devolveu como pago mas SEM data de arrecadação.
   *
   * Não viram baixa. Marcar 'paga' com data nula — o que o sync fazia antes de
   * 14/08/2026 — quebra a idempotência de `registrar_pagamento_guia`, que usa
   * `data_pagamento IS NOT NULL` como sinal de "já quitada": toda rodada
   * seguinte reprocessaria a mesma guia. Fica em aberto e é reencontrado na
   * consulta seguinte, quando a data existir.
   */
  semDataDePagamento: number;
};

/**
 * Decide, para uma lista de competências declaradas, quais têm DAS pago e podem
 * receber baixa. Não escreve nada — quem escreve é `registrar_pagamento_guia`.
 */
export function planejarBaixas(
  declaradas: { id?: string; competencia: string; numeroDas: string | null }[],
  pagamentos: PagamentoDas[],
): PlanoDeBaixa {
  const indice = indexarPagamentos(pagamentos);
  const baixas: BaixaPlanejada[] = [];
  let semDataDePagamento = 0;

  for (const d of declaradas) {
    const pagamento = casarPagamento(d.numeroDas, indice);
    if (!pagamento) continue;
    if (pagamento.dataPagamento) {
      // `id` viaja junto: é ele que amarra a baixa à linha exata que casou.
      baixas.push({
        id: d.id, competencia: d.competencia, dataPagamento: pagamento.dataPagamento, pagamento,
      });
    } else {
      semDataDePagamento++;
    }
  }

  return { baixas, semDataDePagamento };
}
