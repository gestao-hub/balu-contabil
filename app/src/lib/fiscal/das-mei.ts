// DAS-MEI: INSS 5% do salário mínimo + ICMS (R$ 1) e/ou ISS (R$ 5).
//
// O SALÁRIO MÍNIMO É PARÂMETRO, NÃO CONSTANTE (12/08/2026). Até aqui o INSS era
// o número 75,90 digitado à mão — 5% de R$ 1.518, o mínimo de 2025 — e cada
// virada de ano exigia um deploy para corrigir imposto. Agora ele é derivado do
// mínimo, e o mínimo vem de `parametros_fiscais` com vigência (chave
// `salario_minimo`), lido em `lib/fiscal/parametros.ts`. Trocar de ano virou
// INSERT de uma linha.
//
// O FALLBACK ACOMPANHA O ANO CORRENTE (R$ 1.621, 2026 — migration 0080). Ele
// só entra em cena quando o SELECT falha, e nesse momento o cálculo quase
// sempre é da competência atual; um fallback parado em 2025 devolveria o
// número errado justamente no caso comum. A contrapartida é honesta e vale
// dizer: com o banco fora do ar, reapurar uma competência de 2025 usaria o
// mínimo de 2026. Precisão histórica depende do banco responder — é ele que
// tem a vigência.
//
// A COMPOSIÇÃO É DADO, NÃO COMENTÁRIO. Antes, os três totais eram digitados à
// mão e a quebra vivia num comentário — mudar o INSS exigia editar três números
// e torcer para não errar. Agora o total é a SOMA, e há teste que morde se
// divergirem. É também o que permite a explicação do Bloco 6A dizer
// "{inss} de INSS" com o valor certo.

/** Salário mínimo de 2026. Só é usado quando `parametros_fiscais` não responde. */
export const SALARIO_MINIMO_FALLBACK = 1621;

/** LC 123/2006, art. 18-A, §3º, V — contribuição do MEI: 5% do salário mínimo. */
export const ALIQUOTA_INSS_MEI = 0.05;

/** O INSS do mês para um dado salário mínimo. R$ 1.518 → R$ 75,90. */
export function inssMensal(salarioMinimo: number = SALARIO_MINIMO_FALLBACK): number {
  const sm = Number.isFinite(salarioMinimo) && salarioMinimo > 0 ? salarioMinimo : SALARIO_MINIMO_FALLBACK;
  return Number((sm * ALIQUOTA_INSS_MEI).toFixed(2));
}

const ICMS_MENSAL = 1.00;
const ISS_MENSAL = 5.00;

/** Ordem das chaves é estável e importa: ela vira a ordem do texto na tela. */
export type ComponentesDasMei = {
  inss: number;
  icms?: number;
  iss?: number;
};

/**
 * Quais componentes cada atividade tem. Só a FORMA mora aqui; o valor do INSS
 * entra na hora, porque depende do salário mínimo da competência. Antes esta
 * era uma tabela de números congelados no módulo — e um `const` no topo do
 * arquivo não tem como saber de que ano é a guia.
 */
const COMPOSICAO = {
  'Comercio ou Industria': { inss: true, icms: true },
  'Prestacao de Servicos': { inss: true, iss: true },
  'Comercio e Servicos':   { inss: true, icms: true, iss: true },
} as const satisfies Record<string, Partial<Record<keyof ComponentesDasMei, true>>>;

/**
 * Todo componente que um DAS-MEI pode ter, DERIVADO da composição — nunca uma
 * lista escrita à parte, que divergiria no dia em que um componente novo
 * entrasse. `situacao-fiscal.ts` usa isto para recusar chave com componente
 * inventado (`das-mei:xyz`) antes que ela vire prompt.
 */
export const COMPONENTES_DAS_MEI: readonly string[] =
  [...new Set(Object.values(COMPOSICAO).flatMap((c) => Object.keys(c)))].sort();

/** Atividade desconhecida cai em Serviços — comportamento herdado, preservado
 *  de propósito: é o mais comum e mudá-lo alteraria estimativa já exibida. */
const PADRAO = 'Prestacao de Servicos';

function chave(atividade: string | null | undefined): keyof typeof COMPOSICAO {
  return atividade && atividade in COMPOSICAO
    ? (atividade as keyof typeof COMPOSICAO)
    : PADRAO;
}

/**
 * Os componentes com valor, para a atividade e o salário mínimo dados.
 *
 * `salarioMinimo` é opcional para que todo chamador que não conhece a
 * competência continue funcionando como sempre — e é passado explicitamente
 * por quem lê `parametros_fiscais`. A ordem das chaves segue o tipo
 * `ComponentesDasMei` (inss, icms, iss), que é a ordem do texto na tela.
 */
export function componentesDasMei(
  atividade: string | null | undefined,
  salarioMinimo?: number,
): ComponentesDasMei {
  const forma = COMPOSICAO[chave(atividade)] as Partial<Record<keyof ComponentesDasMei, true>>;
  const out: ComponentesDasMei = { inss: inssMensal(salarioMinimo) };
  if (forma.icms) out.icms = ICMS_MENSAL;
  if (forma.iss) out.iss = ISS_MENSAL;
  return out;
}

/** O total é a SOMA dos componentes — nunca um número digitado ao lado deles. */
export function valorDasMei(atividade: string | null | undefined, salarioMinimo?: number): number {
  const c = componentesDasMei(atividade, salarioMinimo);
  return Number((c.inss + (c.icms ?? 0) + (c.iss ?? 0)).toFixed(2));
}
