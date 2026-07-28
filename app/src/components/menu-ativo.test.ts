// A regra de qual item do menu acende.
//
// Existe por causa da seção "Cobranças" do 4B, que introduziu os primeiros
// hrefs que são PREFIXO uns dos outros no menu. Cada caso aqui morde uma
// mudança que `tsc` e `next build` deixam passar — e que o usuário só notaria
// vendo dois itens acesos ao mesmo tempo, ou o item errado aceso.
import { describe, it, expect } from 'vitest';
import { hrefAtivo } from './menu-ativo';

// Os hrefs reais que criaram o problema.
const MENU = [
  '/',
  '/contador',
  '/contador/honorarios',
  '/contador/cobrancas',
  '/contador/configuracoes',
  '/contador/configuracoes/subconta',
  '/contador/configuracoes/avulsos',
  '/notas_fiscais',
];

describe('hrefAtivo', () => {
  it('sub-rota acende o item MAIS ESPECÍFICO, e só ele', () => {
    // Era aqui que acendiam dois: "Config. escritório" e "Conta de recebimento".
    expect(hrefAtivo(MENU, '/contador/configuracoes/subconta')).toBe('/contador/configuracoes/subconta');
    expect(hrefAtivo(MENU, '/contador/configuracoes/avulsos')).toBe('/contador/configuracoes/avulsos');
  });

  it('a rota-pai continua acendendo o pai', () => {
    expect(hrefAtivo(MENU, '/contador/configuracoes')).toBe('/contador/configuracoes');
    expect(hrefAtivo(MENU, '/contador')).toBe('/contador');
  });

  it('rota filha SEM item próprio acende o ancestral mais próximo', () => {
    // /contador/clientes/<id> não está no menu; quem acende é "Escritório".
    expect(hrefAtivo(MENU, '/contador/clientes/abc-123')).toBe('/contador');
    expect(hrefAtivo(MENU, '/notas_fiscais/42')).toBe('/notas_fiscais');
  });

  it('a ordem da lista não decide — decide o comprimento', () => {
    const invertido = [...MENU].reverse();
    expect(hrefAtivo(invertido, '/contador/configuracoes/subconta')).toBe('/contador/configuracoes/subconta');
  });

  it('irmão de nome parecido NÃO acende o vizinho', () => {
    // Sem a barra no prefixo, `/contador` casaria com `/contadores` e o menu
    // acenderia "Escritório" numa tela que não tem nada a ver.
    expect(hrefAtivo(MENU, '/contadores')).toBe(null);
    expect(hrefAtivo(MENU, '/notas_fiscais_antigas')).toBe(null);
  });

  it('a raiz só acende nela mesma — ela é prefixo de tudo', () => {
    expect(hrefAtivo(MENU, '/')).toBe('/');
    expect(hrefAtivo(MENU, '/impostos')).toBe(null);
  });
});
