// DAS-MEI: INSS 5% do salário mínimo + ICMS (R$ 1) e/ou ISS (R$ 5).
// Base: salário mínimo R$ 1.518 (2025) → INSS R$ 75,90.
//
// ⚠️ DÍVIDA CONHECIDA: este valor é o de 2025. O salário mínimo de 2026 já é
// oficial e NÃO foi conferido — a estimativa do DAS-MEI pode estar desatualizada.
// Conferir e atualizar `INSS_MENSAL`; o resto se ajusta sozinho (ver abaixo).
//
// A COMPOSIÇÃO É DADO, NÃO COMENTÁRIO. Antes, os três totais eram digitados à
// mão e a quebra vivia num comentário — mudar o INSS exigia editar três números
// e torcer para não errar. Agora o total é a SOMA, e há teste que morde se
// divergirem. É também o que permite a explicação do Bloco 6A dizer
// "{inss} de INSS" com o valor certo.

const INSS_MENSAL = 75.90;
const ICMS_MENSAL = 1.00;
const ISS_MENSAL = 5.00;

/** Ordem das chaves é estável e importa: ela vira a ordem do texto na tela. */
export type ComponentesDasMei = {
  inss: number;
  icms?: number;
  iss?: number;
};

const COMPOSICAO = {
  'Comercio ou Industria': { inss: INSS_MENSAL, icms: ICMS_MENSAL },
  'Prestacao de Servicos': { inss: INSS_MENSAL, iss: ISS_MENSAL },
  'Comercio e Servicos':   { inss: INSS_MENSAL, icms: ICMS_MENSAL, iss: ISS_MENSAL },
} as const satisfies Record<string, ComponentesDasMei>;

/** Atividade desconhecida cai em Serviços — comportamento herdado, preservado
 *  de propósito: é o mais comum e mudá-lo alteraria estimativa já exibida. */
const PADRAO = 'Prestacao de Servicos';

function chave(atividade: string | null | undefined): keyof typeof COMPOSICAO {
  return atividade && atividade in COMPOSICAO
    ? (atividade as keyof typeof COMPOSICAO)
    : PADRAO;
}

export function componentesDasMei(atividade: string | null | undefined): ComponentesDasMei {
  return { ...COMPOSICAO[chave(atividade)] };
}

/** O total é a SOMA dos componentes — nunca um número digitado ao lado deles. */
export function valorDasMei(atividade: string | null | undefined): number {
  const c = componentesDasMei(atividade);
  return Number((c.inss + (c.icms ?? 0) + (c.iss ?? 0)).toFixed(2));
}
