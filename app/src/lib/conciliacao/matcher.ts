// Bloco 7, Task 10 — o matcher da conciliação bancária.
//
// Função pura, sem banco e sem rede: dado o extrato e as guias em aberto,
// decide o que é baixa automática e o que vira sugestão para um humano.
//
// ⚠️ O RISCO AQUI NÃO É SIMÉTRICO. Falso-negativo (não reconhecer um pagamento)
// só mantém o aviso que já existe — o cliente continua vendo "DAS a vencer" de
// algo que pagou, chato e reversível. Falso-positivo (dar baixa errada) faz o
// cliente achar que está quitado, não pagar, e tomar multa e juros. Por isso
// toda regra abaixo é conservadora: na dúvida, sugere; nunca conclui.
//
// ⚠️ UNIDADES. `guias_fiscais.valor_total` é numeric(15,2) em REAIS
// (verificado no banco em 12/08/2026: "12666.19"); `conciliacao_transacoes.
// valor_centavos` é bigint em CENTAVOS. A conversão acontece SÓ aqui, na
// fronteira, e nunca comparamos float com float.

/** Guia em aberto, como vem do banco (valor em reais, string ou number). */
export type GuiaCandidata = {
  id: string;
  valorTotal: number | string | null;
  dataVencimento: string | null;   // YYYY-MM-DD
};

/** Transação de crédito importada do extrato. */
export type TransacaoCandidata = {
  id: string;
  valorCentavos: number;
  data: string;                    // YYYY-MM-DD
  tipo: 'credito' | 'debito';
};

export type Casamento = {
  transacaoId: string;
  guiaId: string;
  /** `baixa` = inequívoco, dá baixa sozinho. `sugestao` = precisa de humano. */
  decisao: 'baixa' | 'sugestao';
  motivo: string;
};

/** Janela de datas aceita ao redor do vencimento, em dias. */
const DIAS_ANTES = 30;
const DIAS_DEPOIS = 60;

/**
 * Reais (numeric do Postgres, que o driver entrega como string para não perder
 * precisão) → centavos inteiros.
 *
 * `Math.round` e não `Math.trunc`: em ponto flutuante, 126.66 * 100 pode dar
 * 12665.999999999998, e truncar perderia um centavo — que é exatamente a
 * diferença que faz o match falhar.
 */
export function reaisParaCentavos(valor: number | string | null): number | null {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = typeof valor === 'string' ? Number(valor) : valor;
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function diasEntre(a: string, b: string): number {
  const ma = Date.parse(`${a}T12:00:00Z`);
  const mb = Date.parse(`${b}T12:00:00Z`);
  if (!Number.isFinite(ma) || !Number.isFinite(mb)) return Number.NaN;
  return Math.round((ma - mb) / 86_400_000);
}

/** A transação cai na janela aceitável em torno do vencimento da guia? */
function naJanela(dataTransacao: string, vencimento: string): boolean {
  const d = diasEntre(dataTransacao, vencimento);
  if (!Number.isFinite(d)) return false;
  return d >= -DIAS_ANTES && d <= DIAS_DEPOIS;
}

/**
 * Casa transações com guias.
 *
 * Regra de baixa automática — as quatro ao mesmo tempo:
 *   1. é crédito (débito nunca paga guia nenhuma);
 *   2. o valor bate EXATAMENTE, em centavos;
 *   3. a data está na janela [vencimento-30, vencimento+60];
 *   4. há exatamente UM candidato de cada lado (uma transação para uma guia).
 *
 * Qualquer ambiguidade — duas transações do mesmo valor, duas guias do mesmo
 * valor — vira `sugestao`. É onde um sistema descuidado erraria: com dois DAS
 * de R$ 500 em aberto, escolher "o mais antigo" tem 50% de chance de quitar a
 * competência errada, e o cliente descobre no mês seguinte.
 */
export function casar(
  transacoes: TransacaoCandidata[],
  guias: GuiaCandidata[],
): Casamento[] {
  const guiasValidas = guias
    .map((g) => ({ ...g, centavos: reaisParaCentavos(g.valorTotal) }))
    .filter((g): g is typeof g & { centavos: number; dataVencimento: string } =>
      g.centavos !== null && g.centavos > 0 && !!g.dataVencimento);

  const creditos = transacoes.filter((t) => t.tipo === 'credito');
  const resultado: Casamento[] = [];

  for (const t of creditos) {
    const candidatas = guiasValidas.filter(
      (g) => g.centavos === t.valorCentavos && naJanela(t.data, g.dataVencimento),
    );

    if (candidatas.length === 0) continue;   // nada a dizer sobre esta transação

    if (candidatas.length > 1) {
      // Uma entrada, várias guias possíveis: quem escolhe é gente.
      for (const g of candidatas) {
        resultado.push({
          transacaoId: t.id, guiaId: g.id, decisao: 'sugestao',
          motivo: `${candidatas.length} guias com o mesmo valor na janela — precisa de confirmação`,
        });
      }
      continue;
    }

    const g = candidatas[0];
    // A recíproca também precisa valer: se DUAS transações batem com esta
    // guia, nenhuma delas pode dar baixa sozinha — uma pagou, a outra é
    // outra coisa (um estorno reaplicado, um pagamento em duplicidade), e
    // adivinhar qual é o mesmo erro de antes com os papéis trocados.
    const transacoesQueCasam = creditos.filter(
      (o) => o.valorCentavos === g.centavos && naJanela(o.data, g.dataVencimento),
    );
    if (transacoesQueCasam.length > 1) {
      resultado.push({
        transacaoId: t.id, guiaId: g.id, decisao: 'sugestao',
        motivo: `${transacoesQueCasam.length} entradas batem com a mesma guia — precisa de confirmação`,
      });
      continue;
    }

    resultado.push({
      transacaoId: t.id, guiaId: g.id, decisao: 'baixa',
      motivo: 'valor exato e data na janela, sem ambiguidade',
    });
  }

  return resultado;
}
