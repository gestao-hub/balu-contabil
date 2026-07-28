// Bloco 4B — regras puras do catalogo de servicos avulsos do escritorio.
//
// Percentual desde o comeco (spec §5): recuperacao de credito e cobrada como
// % do valor recuperado e taxa de urgencia como % do servico-base. Migrar
// depois para incluir isso sairia caro.
//
// Puro de proposito (mesmo motivo de subconta.ts e status-subconta.ts): este
// modulo e importado por Client Component (tela da Task 8) e por Server
// Action — zero import, zero I/O, zero env, zero `server-only`.

// Lista, e nao union escrita a mao, porque o schema zod da fronteira
// (`ServicoAvulsoSchema`) monta o enum a partir DELA: assim o que o tipo aceita
// e o que a fronteira aceita nao podem divergir em silencio — mesmo arranjo de
// `COMPANY_TYPES` em subconta.ts.
export const TIPOS_VALOR = ['fixo', 'percentual'] as const;
export type TipoValor = (typeof TIPOS_VALOR)[number];

export type ServicoAvulso = {
  nome: string;
  tipoValor: TipoValor;
  valorCentavos: number | null;
  percentual: number | null;
};

export type ResultadoValidacao = { ok: true } | { ok: false; error: string };

/**
 * Espelha `servicos_avulsos_valor_check` da migration 0053, nos dois
 * sentidos: cada tipo EXIGE o seu campo e PROIBE o outro. Uma linha 'fixo'
 * com percentual preenchido nao diz qual dos dois vale — por isso a proibicao
 * nao e cosmetica, e o mesmo motivo que o CHECK do banco tem. Se a tela
 * aceitasse o que o CHECK recusa, o escritorio veria um erro de Postgres no
 * meio do cadastro.
 */
export function validarServicoAvulso(s: ServicoAvulso): ResultadoValidacao {
  if (!s.nome?.trim()) return { ok: false, error: 'Informe o nome do serviço.' };

  if (s.tipoValor === 'fixo') {
    if (!s.valorCentavos || s.valorCentavos <= 0) return { ok: false, error: 'Informe o valor do serviço.' };
    if (s.percentual != null) return { ok: false, error: 'Serviço de valor fixo não leva percentual.' };
    return { ok: true };
  }

  if (!s.percentual || s.percentual <= 0) return { ok: false, error: 'Informe o percentual.' };
  // 100 nao esta no CHECK do banco (que so exige > 0), mas cobrar mais que
  // 100% do valor recuperado ou do servico-base nao faz sentido de negocio —
  // e quase certo digitacao errada (ex.: 200 no lugar de 20). Regra mais
  // estrita que o banco so recusa a mais, nunca aceita o que o banco recusa.
  if (s.percentual > 100) return { ok: false, error: 'O percentual não pode passar de 100%.' };
  if (s.valorCentavos != null) return { ok: false, error: 'Serviço percentual não leva valor fixo.' };
  return { ok: true };
}

/**
 * Valor a cobrar. `base` e o valor sobre o qual o percentual incide (o
 * credito recuperado, o servico-base da taxa de urgencia). `null` quando o
 * servico e percentual e nao ha base — e ai a cobranca NAO PODE SER EMITIDA,
 * porque emitir por zero e pior que recusar: sai de graca sem ninguem notar.
 *
 * ARREDONDAMENTO: `Math.round` — meio para cima (padrao comercial brasileiro:
 * 12,5 centavos vira 13, nunca 12). Escolhido, e nao truncamento (Math.floor),
 * porque truncar sistematicamente favorece quem paga em vez de dividir o
 * empate — um vies que se acumula cobranca apos cobranca. Nao ha meio-par
 * (banker's rounding) aqui porque nao ha um par natural a favorecer: dinheiro
 * em centavos nao tem "par" e "impar" com sentido de negocio, so tem "quem
 * fica com o centavo do empate", e a convencao comercial brasileira decide
 * isso para cima.
 */
export function valorFinalCentavos(
  s: Pick<ServicoAvulso, 'tipoValor' | 'valorCentavos' | 'percentual'>,
  baseCentavos: number | null,
): number | null {
  const bruto = s.tipoValor === 'fixo'
    ? s.valorCentavos
    : (baseCentavos == null || !s.percentual)
      ? null
      : Math.round((baseCentavos * s.percentual) / 100);

  // Zero e negativo saem como `null`, e nao como numero, pelo mesmo motivo do
  // paragrafo acima: emitir por zero e pior que recusar. Nao e caso teorico —
  // 0,01% sobre R$ 1,00 arredonda para 0 centavo. Devolver 0 aqui jogaria o
  // problema no `cobrancas_escritorio_valor_check` da 0053, que barra, mas
  // como erro de Postgres na cara do escritorio em vez de recusa explicada.
  return bruto != null && bruto > 0 ? bruto : null;
}

/** Seed sugerido (spec §5) — editavel pelo escritorio, nunca imposto. */
export const CATALOGO_SUGERIDO: Array<{
  nome: string;
  categoria: string;
  tipoValor: TipoValor;
  valorCentavos?: number;
  percentual?: number;
}> = [
  { nome: 'Abertura de empresa',         categoria: 'Societário',    tipoValor: 'fixo', valorCentavos: 90000 },
  { nome: 'Alteração contratual',        categoria: 'Societário',    tipoValor: 'fixo', valorCentavos: 60000 },
  { nome: 'Baixa / encerramento',        categoria: 'Societário',    tipoValor: 'fixo', valorCentavos: 80000 },
  { nome: 'Enquadramento de regime',     categoria: 'Societário',    tipoValor: 'fixo', valorCentavos: 40000 },
  { nome: 'Parcelamento de débitos',     categoria: 'Fiscal',        tipoValor: 'fixo', valorCentavos: 35000 },
  { nome: 'Certidão negativa',           categoria: 'Fiscal',        tipoValor: 'fixo', valorCentavos: 8000 },
  { nome: 'Recuperação de crédito',      categoria: 'Fiscal',        tipoValor: 'percentual', percentual: 20 },
  { nome: 'IRPF do sócio',               categoria: 'Pessoa física', tipoValor: 'fixo', valorCentavos: 45000 },
  { nome: 'Admissão de funcionário',     categoria: 'Trabalhista',   tipoValor: 'fixo', valorCentavos: 20000 },
  { nome: 'Rescisão',                    categoria: 'Trabalhista',   tipoValor: 'fixo', valorCentavos: 25000 },
  { nome: 'Certificado digital A1',      categoria: 'Outros',        tipoValor: 'fixo', valorCentavos: 19000 },
  { nome: 'Hora técnica de consultoria', categoria: 'Outros',        tipoValor: 'fixo', valorCentavos: 25000 },
  { nome: 'Taxa de urgência',            categoria: 'Outros',        tipoValor: 'percentual', percentual: 30 },
];
