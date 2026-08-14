// A parte PENSANTE da varredura de pagamentos na SERPRO: quem consultar, em que
// ordem, e quando parar. Pura, sem banco — é o que dá para testar de verdade.
//
// Mesma divisão de `apuracao-cron-plano.ts`, e pelo mesmo motivo: a decisão de
// "não estourar o cron" não pode morar dentro de um `for` cheio de `await`.

export type EmpresaParaConsultar = {
  companyId: string;
  /** Da `empresas_fiscais`. Só '1' e '2' (Simples) têm DAS no PGDAS-D. */
  regimeCode: string;
  /** Carimbo da 0088. null = nunca consultada. */
  consultadaEm: string | null;
  /** Quantas guias em aberto a empresa tem. Zero = nada a conciliar. */
  guiasEmAberto: number;
};

/**
 * Códigos de regime que este caminho cobre: Simples (1), Simples com excesso de
 * sublimite (2) e **MEI (4)**.
 *
 * ─── POR QUE O MEI ENTROU (14/08/2026) ──────────────────────────────────────
 * A Frente 3 nasceu com MEI fora, e a justificativa escrita era "a consulta de
 * pagamentos do MEI não foi investigada". Ela tinha sido: a investigação da
 * própria casa (`docs/investigations/SERPRO-INVESTIGACAO.md`) diz, sobre o
 * filtro que este caminho usa, que **"Código 9 = DAS. Inclui DAS-MEI e DAS do
 * Simples."** Não era limitação da API — era um limite herdado de
 * `impostos/actions.ts`, onde o corte existe por outro motivo (o PGDAS-D é
 * declaração do Simples, e MEI declara por DASN-SIMEI).
 *
 * O que estava em jogo: MEI **tem** DAS, e o app **gera** essa guia
 * (`gerarDasMeiAction`, via PGMEI). Sem esta varredura, o pagamento do MEI
 * nunca era reconhecido — a guia ficava `data_pagamento IS NULL` para sempre,
 * virava `vencida`, e o cliente que pagou em dia aparecia em atraso para ele
 * mesmo e para o contador (`painel_contador.das_vencidos`), mês após mês.
 * Metade do piloto é MEI.
 *
 * ⚠️ REGIME NORMAL (3) CONTINUA FORA, e por motivo diferente: ele não recolhe
 * DAS nenhum. Não há o que conciliar.
 *
 * ⚠️ MEI SEM TERMO/PROCURAÇÃO: o PAGAMENTOS71 exige o token de procurador
 * (diferente do PGMEI, que gera o DAS-MEI sem procuração). Quem não assinou o
 * Termo falha com a mensagem traduzida, conta como erro, é carimbado e volta
 * para o fim da fila — não trava a varredura dos outros.
 */
export const REGIMES_COM_DAS = new Set(['1', '2', '4']);

/**
 * Só vale gastar uma chamada SERPRO por empresa que tenha o que conciliar.
 *
 * Empresa sem guia em aberto não tem baixa possível: o cron não CRIA guia a
 * partir do PAGTOWEB (quem cria é a sincronização da tela, pelo
 * CONSDECLARACAO13). Consultar assim mesmo queimaria cota de contrato para
 * jogar o resultado fora.
 */
export function podeConsultar(e: EmpresaParaConsultar): boolean {
  return REGIMES_COM_DAS.has(e.regimeCode) && e.guiasEmAberto > 0;
}

/**
 * A ordem em que as empresas entram na fila.
 *
 * QUEM NUNCA FOI CONSULTADO VEM PRIMEIRO, depois quem foi consultado há mais
 * tempo. É isso que torna o corte por orçamento justo: quem ficou para trás
 * hoje é o primeiro amanhã. Sem essa ordem, uma lista sempre na mesma sequência
 * consultaria eternamente as mesmas empresas do começo e as do fim nunca teriam
 * o pagamento reconhecido.
 */
export function ordenarFilaConsulta(empresas: EmpresaParaConsultar[]): EmpresaParaConsultar[] {
  return [...empresas]
    .filter(podeConsultar)
    .sort((a, b) => {
      const ta = a.consultadaEm ?? '';
      const tb = b.consultadaEm ?? '';
      // '' (nunca consultada) ordena antes de qualquer timestamp ISO.
      if (ta === tb) return a.companyId.localeCompare(b.companyId);
      return ta < tb ? -1 : 1;
    });
}

// O corte por orçamento é `dentroDoOrcamento` de `apuracao-cron-plano.ts`,
// importado em vez de recopiado: a fórmula é a mesma, e duas cópias de uma
// regra de "quando parar" divergem no dia em que alguém ajustar uma delas.
export { dentroDoOrcamento } from './apuracao-cron-plano';
