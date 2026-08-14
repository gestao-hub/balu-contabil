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
 * Códigos de regime que este caminho cobre.
 *
 * MESMO CORTE de `impostos/actions.ts` (o gate do PGDAS-D), e ele é a metade
 * declarada do escopo: **MEI fica de fora**. A consulta de pagamentos do MEI
 * não foi investigada, e como metade do piloto é MEI, isso está escrito na
 * spec como limite conhecido — não é descuido a descobrir em produção.
 */
export const REGIMES_COM_DAS_SIMPLES = new Set(['1', '2']);

/**
 * Só vale gastar uma chamada SERPRO por empresa que tenha o que conciliar.
 *
 * Empresa sem guia em aberto não tem baixa possível: o cron não CRIA guia a
 * partir do PAGTOWEB (quem cria é a sincronização da tela, pelo
 * CONSDECLARACAO13). Consultar assim mesmo queimaria cota de contrato para
 * jogar o resultado fora.
 */
export function podeConsultar(e: EmpresaParaConsultar): boolean {
  return REGIMES_COM_DAS_SIMPLES.has(e.regimeCode) && e.guiasEmAberto > 0;
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
