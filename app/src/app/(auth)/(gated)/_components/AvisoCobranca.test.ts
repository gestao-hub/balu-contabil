// Achado nº 3 da revisao: a faixa de cobranca era renderizada
// incondicionalmente no layout de (gated), e /conta — a tela de exportar e
// excluir dados — vive sob esse layout. O proprio docblock do componente
// proibia isso.
//
// A regra virou funcao pura justamente para poder ser fixada por teste.
import { describe, it, expect } from 'vitest';
import { faixaPermitida } from './AvisoCobranca';

describe('faixaPermitida — onde a faixa de cobranca NAO pode aparecer', () => {
  // LGPD art. 18 (acesso, correcao, portabilidade, eliminacao) e §5º, que
  // obriga atendimento SEM CUSTO. Cobranca acima do botao de exportar ou
  // excluir dados sugere que o direito depende de pagamento.
  it('nao aparece em /conta (exportar e excluir dados)', () => {
    expect(faixaPermitida('/conta')).toBe(false);
  });

  it('nao aparece nas subrotas de /conta', () => {
    expect(faixaPermitida('/conta/dados')).toBe(false);
    expect(faixaPermitida('/conta/notificacoes')).toBe(false);
  });

  it('nao aparece em /aceite (gate de termos)', () => {
    expect(faixaPermitida('/aceite')).toBe(false);
  });

  // Excecao deliberada: e a tela onde a cobranca e o assunto.
  it('APARECE em /conta/assinatura', () => {
    expect(faixaPermitida('/conta/assinatura')).toBe(true);
  });

  // DISCRIMINANTE: sem estes, uma implementacao que escondesse a faixa em
  // TODA tela passaria nos casos acima.
  it('aparece nas telas comerciais', () => {
    expect(faixaPermitida('/')).toBe(true);
    expect(faixaPermitida('/notas_fiscais')).toBe(true);
    expect(faixaPermitida('/clientes')).toBe(true);
    expect(faixaPermitida('/impostos')).toBe(true);
    expect(faixaPermitida('/contador/assinatura')).toBe(true);
  });

  // Prefixo tem de casar segmento inteiro: /contador nao e /conta.
  it('nao confunde /contador com /conta', () => {
    expect(faixaPermitida('/contador')).toBe(true);
    expect(faixaPermitida('/contador/clientes')).toBe(true);
  });
});
