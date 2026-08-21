// A regra de quem vê o quê no menu lateral.
//
// O caso que motivou o arquivo é o de "Assinatura": ele SOME para empresa de
// carteira (o escritório paga) e PRECISA aparecer para empresa avulsa (ela paga
// a própria). Errar para o lado de esconder demais impede alguém de pagar — e
// isso não aparece em `tsc`, em build, nem numa leitura do diff.
import { describe, it, expect } from 'vitest';
import { itensVisiveis, type ContextoMenu, type ItemVisivel } from './menu-visibilidade';

const ASSINATURA: ItemVisivel = {
  href: '/conta/assinatura', precisaEmpresa: true, ocultaEmCarteira: true,
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
    expect(vistos).not.toContain('/conta/assinatura');
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
