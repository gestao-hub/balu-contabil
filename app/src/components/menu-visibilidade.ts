// Quais itens do menu lateral aparecem, para um dado contexto.
//
// POR QUE SAIU DO COMPONENTE
// Mesmo motivo de `menu-ativo.ts`: a regra passou a valer um teste. O gatilho
// foi a decisão de esconder "Assinatura" para empresa de carteira — se essa
// regra errar para o lado de esconder demais, uma empresa AVULSA perde o
// caminho de ver vencimento, trocar cartão e regularizar inadimplência. Ou
// seja: um bug aqui impede alguém de pagar, e não aparece em `tsc` nem em
// build.
//
// A função é pura de propósito — recebe o contexto pronto e devolve a lista.
// O componente continua dono da renderização.

/** O subconjunto de `NavItem` que a visibilidade consulta. Deliberadamente
 *  estrutural (e não um import do componente): assim este módulo não arrasta
 *  React nem ícones para dentro do teste. */
export type ItemVisivel = {
  href: string;
  roles?: readonly string[];
  precisaEmpresa?: boolean;
  precisaCobranca?: boolean;
  ocultaEmCarteira?: boolean;
  /**
   * Regra PRÓPRIA do item, quando ele serve mais de um público e nenhuma
   * combinação das flags acima o descreve.
   *
   * Existe por causa de "Assinatura" (02/09/2026), que era DOIS itens de mesmo
   * rótulo — um do escritório, outro da empresa — e apareciam juntos para o
   * contador com empresa própria. Virou um item só, e a condição dele é uma
   * disjunção ("escritório OU empresa avulsa") que as flags, todas conjuntivas,
   * não conseguem expressar: `precisaEmpresa` esconderia do contador sem
   * empresa, e `ocultaEmCarteira` esconderia do contador cuja empresa ativa é
   * da própria carteira — os dois casos em que a assinatura DO ESCRITÓRIO
   * continua existindo e precisando ser paga.
   *
   * Quem usa isto abre mão das flags: elas continuam sendo aplicadas, então o
   * item não deve declarar as duas coisas.
   */
  visivelSe?: (ctx: ContextoMenu) => boolean;
};

export type ContextoMenu = {
  userRole: string;
  /** Quantas empresas próprias o usuário tem. */
  qtdEmpresas: number;
  temEscritorio: boolean;
  temCobrancasDoEscritorio: boolean;
  /** `escritorio.proprio` — o contador olhando o próprio escritório. */
  escritorioProprio: boolean;
  /** Empresa ativa é de carteira (`contabilidade_id` preenchido). */
  empresaDeCarteira: boolean;
};

/**
 * A regra do item "Assinatura", que é UM só desde 02/09/2026.
 *
 * Mora aqui, e não inline no `NAV` do componente, para que o teste morda a
 * regra DE PRODUÇÃO em vez de uma cópia — um predicado duplicado no fixture
 * passaria verde enquanto o menu real regredia.
 *
 * São dois pagadores e a condição é uma disjunção:
 *  · o ESCRITÓRIO paga por faixa de clientes — vale mesmo sem empresa própria,
 *    e vale mesmo quando a empresa ativa é da própria carteira;
 *  · a empresa AVULSA paga a própria conta.
 * Empresa de carteira, sozinha, não vê: quem paga por ela é o escritório
 * (`assertAssinaturaEmpresa` em lib/billing/gate.ts libera SEMPRE para empresa
 * com `contabilidade_id`).
 */
export function assinaturaVisivel(ctx: ContextoMenu): boolean {
  const doEscritorio = ctx.userRole === 'contador' && ctx.temEscritorio;
  const daEmpresa = (ctx.userRole === 'empresa' || ctx.qtdEmpresas > 0) && !ctx.empresaDeCarteira;
  return doEscritorio || daEmpresa;
}

export function itensVisiveis<T extends ItemVisivel>(
  itens: readonly T[],
  ctx: ContextoMenu,
): T[] {
  return itens
    // Papel: item sem `roles` é de todo mundo.
    .filter((i) => !i.roles || i.roles.includes(ctx.userRole))
    // `/contador` (o cadastro) aparece sempre para o contador — sem ele, quem
    // ainda não tem escritório não teria por onde criar um. As sub-rotas só
    // aparecem com escritório pronto.
    .filter((i) => i.href === '/contador' || !i.href.startsWith('/contador/') || ctx.temEscritorio)
    // Itens de empresa só com empresa própria (contador/admin sem empresa não os vê).
    .filter((i) => !i.precisaEmpresa || ctx.userRole === 'empresa' || ctx.qtdEmpresas > 0)
    // Existe boleto? `escritorioProprio` é o contador olhando a si mesmo: ele
    // cobra pelo painel /contador/honorarios, não por esta tela de cliente.
    .filter((i) => !i.precisaCobranca || (ctx.temCobrancasDoEscritorio && !ctx.escritorioProprio))
    // Assinatura da empresa de carteira está incluída na do escritório — quem
    // paga é ele (`assertAssinaturaEmpresa` em lib/billing/gate.ts libera SEMPRE
    // para empresa com `contabilidade_id`). Empresa AVULSA continua vendo.
    .filter((i) => !i.ocultaEmCarteira || !ctx.empresaDeCarteira)
    // Admin usa /admin (Visão geral) como home; o "/" (dashboard de empresa)
    // é beco para ele.
    .filter((i) => !(ctx.userRole === 'adminbalu' && i.href === '/'))
    // Regra própria do item, por último: ela decide sozinha e não depende da
    // ordem dos filtros acima.
    .filter((i) => !i.visivelSe || i.visivelSe(ctx));
}
