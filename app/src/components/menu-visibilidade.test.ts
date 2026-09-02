// A regra de quem vê o quê no menu lateral.
//
// O caso que motivou o arquivo é o de "Assinatura": ele SOME para empresa de
// carteira (o escritório paga) e PRECISA aparecer para empresa avulsa (ela paga
// a própria). Errar para o lado de esconder demais impede alguém de pagar — e
// isso não aparece em `tsc`, em build, nem numa leitura do diff.
import { describe, it, expect } from 'vitest';
import {
  itensVisiveis, assinaturaVisivel, type ContextoMenu, type ItemVisivel,
} from './menu-visibilidade';

// O item REAL do menu, com o predicado de produção — nao uma copia. Se a regra
// mudar em `menu-visibilidade.ts`, e este arquivo que avisa.
const ASSINATURA: ItemVisivel = {
  href: '/conta/assinatura', visivelSe: assinaturaVisivel,
};
const IMPOSTOS: ItemVisivel = { href: '/impostos', precisaEmpresa: true };
const ESCRITORIO: ItemVisivel = { href: '/contador', roles: ['contador'] };
const EQUIPE: ItemVisivel = { href: '/contador/equipe', roles: ['contador'] };
const COBRANCAS: ItemVisivel = {
  href: '/cobrancas', precisaEmpresa: true, precisaCobranca: true,
};
const HOME: ItemVisivel = { href: '/' };
const ADMIN: ItemVisivel = { href: '/admin', roles: ['adminbalu'] };

const TODOS = [HOME, ASSINATURA, IMPOSTOS, ESCRITORIO, EQUIPE, COBRANCAS, ADMIN];

const EMPRESARIO: ContextoMenu = {
  userRole: 'empresa',
  qtdEmpresas: 1,
  temEscritorio: false,
  temCobrancasDoEscritorio: false,
  escritorioProprio: false,
  empresaDeCarteira: false,
};

const hrefs = (ctx: ContextoMenu) => itensVisiveis(TODOS, ctx).map((i) => i.href);

describe('Assinatura da empresa', () => {
  it('empresa AVULSA vê Assinatura — ela paga a própria', () => {
    expect(hrefs({ ...EMPRESARIO, empresaDeCarteira: false })).toContain('/conta/assinatura');
  });

  it('empresa DE CARTEIRA não vê Assinatura — quem paga é o escritório', () => {
    expect(hrefs({ ...EMPRESARIO, empresaDeCarteira: true })).not.toContain('/conta/assinatura');
  });

  it('esconder Assinatura não esconde os outros itens de empresa', () => {
    // A regra é cirúrgica: se o filtro pegasse `precisaEmpresa` em vez de
    // `ocultaEmCarteira`, a empresa de carteira perderia o app inteiro.
    const vistos = hrefs({ ...EMPRESARIO, empresaDeCarteira: true });
    expect(vistos).toContain('/impostos');
    expect(vistos).toContain('/');
  });
});

/**
 * O DEFEITO DE 02/09/2026, relatado da tela: "no login de contador aparecem 2
 * botões de assinatura".
 *
 * Eram dois itens de NAV com o MESMO rótulo — `/contador/assinatura`
 * (roles: contador) e `/conta/assinatura` (precisaEmpresa + ocultaEmCarteira).
 * O contador que também tem empresa própria fora de carteira passava nos dois
 * filtros e via "Assinatura" duas vezes, sem nada dizendo de quem era cada uma.
 *
 * Viraram UM item, e a tela mostra os dois blocos identificados. Estes testes
 * fixam as quatro combinações de papel — porque a correção óbvia (deixar só o
 * item do contador) esconderia a cobrança da empresa avulsa, e a outra correção
 * óbvia (deixar só o da empresa) esconderia a do escritório de quem não tem
 * empresa própria. Os dois erros impedem alguém de pagar.
 */
describe('Assinatura é UM item só (02/09/2026)', () => {
  const CONTADOR: ContextoMenu = {
    ...EMPRESARIO, userRole: 'contador', temEscritorio: true, qtdEmpresas: 0,
  };

  it('contador COM empresa própria vê Assinatura UMA vez, não duas', () => {
    const vistos = hrefs({ ...CONTADOR, qtdEmpresas: 1, empresaDeCarteira: false });
    expect(vistos.filter((h) => h === '/conta/assinatura')).toHaveLength(1);
  });

  it('contador SEM empresa própria continua vendo — o escritório paga', () => {
    // `precisaEmpresa` sozinha esconderia: era por isso que existia um segundo
    // item só para o contador.
    expect(hrefs(CONTADOR)).toContain('/conta/assinatura');
  });

  it('contador cuja empresa ativa é da PRÓPRIA carteira continua vendo', () => {
    // `ocultaEmCarteira` sozinha esconderia — e a assinatura do escritório
    // dele, que é o que ele de fato paga, sumiria do menu.
    expect(hrefs({ ...CONTADOR, qtdEmpresas: 1, empresaDeCarteira: true }))
      .toContain('/conta/assinatura');
  });

  it('contador SEM escritório e SEM empresa não vê — não há o que pagar', () => {
    expect(hrefs({ ...CONTADOR, temEscritorio: false, qtdEmpresas: 0 }))
      .not.toContain('/conta/assinatura');
  });

  it('admin não vê: a tela dele é /admin/assinaturas', () => {
    expect(hrefs({ ...EMPRESARIO, userRole: 'adminbalu', qtdEmpresas: 0 }))
      .not.toContain('/conta/assinatura');
  });

  it('a rota antiga do contador não está mais no menu', () => {
    // Ela continua existindo e redirecionando (é destino de aviso do cron e de
    // link em três telas), mas nao deve reaparecer como item.
    expect(hrefs({ ...CONTADOR, qtdEmpresas: 1 })).not.toContain('/contador/assinatura');
  });
});

describe('papel e escritório', () => {
  it('contador sem escritório vê /contador mas não as sub-rotas', () => {
    const vistos = hrefs({
      ...EMPRESARIO, userRole: 'contador', qtdEmpresas: 0, temEscritorio: false,
    });
    expect(vistos).toContain('/contador');
    expect(vistos).not.toContain('/contador/equipe');
  });

  it('contador com escritório vê as sub-rotas', () => {
    const vistos = hrefs({
      ...EMPRESARIO, userRole: 'contador', qtdEmpresas: 0, temEscritorio: true,
    });
    expect(vistos).toContain('/contador/equipe');
  });

  it('contador sem empresa própria não vê itens de empresa', () => {
    const vistos = hrefs({
      ...EMPRESARIO, userRole: 'contador', qtdEmpresas: 0, temEscritorio: true,
    });
    expect(vistos).not.toContain('/impostos');
    // ⚠️ MUDANÇA DE COMPORTAMENTO (02/09/2026), não teste dobrado para passar:
    // até esta data `/conta/assinatura` era o item DA EMPRESA e a asserção
    // aqui era `not.toContain`. Hoje ele é o item ÚNICO, e o contador precisa
    // dele para pagar o ESCRITÓRIO — que é o que ele de fato deve. Continuar
    // escondendo tiraria do contador sem empresa própria o único caminho para
    // a assinatura dele. Ver `assinaturaVisivel`.
    expect(vistos).toContain('/conta/assinatura');
  });

  it('admin não vê a home de empresa nem itens de outro papel', () => {
    const vistos = hrefs({ ...EMPRESARIO, userRole: 'adminbalu', qtdEmpresas: 0 });
    expect(vistos).not.toContain('/');
    expect(vistos).toContain('/admin');
    expect(vistos).not.toContain('/contador');
  });
});

describe('Cobranças do escritório', () => {
  it('sem boleto emitido, não aparece', () => {
    expect(hrefs({ ...EMPRESARIO, temCobrancasDoEscritorio: false })).not.toContain('/cobrancas');
  });

  it('com boleto, o CLIENTE vê', () => {
    expect(hrefs({ ...EMPRESARIO, temCobrancasDoEscritorio: true })).toContain('/cobrancas');
  });

  it('o contador olhando o PRÓPRIO escritório não vê — ele cobra pelo painel dele', () => {
    const vistos = hrefs({
      ...EMPRESARIO, temCobrancasDoEscritorio: true, escritorioProprio: true,
    });
    expect(vistos).not.toContain('/cobrancas');
  });
});
