import { describe, it, expect } from 'vitest';
import { valoresDoDasMei } from './valores-mei';
import { valorDasMei } from '@/lib/fiscal/das-mei';

// ⚠️ `toLocaleString('pt-BR', { style: 'currency' })` separa o "R$" do número com
// ESPAÇO NÃO-QUEBRÁVEL (U+00A0), não com espaço comum. Escrito com espaço normal,
// a asserção falha exibindo duas strings visualmente idênticas. Estes literais
// usam ` ` de propósito — é o que o cliente realmente vê.
const RS = (n: string) => `R$ ${n}`;

// Salário mínimo passado explicitamente: o que este arquivo testa é a decisão
// de explicar ou não, e ela não pode passar a depender de qual ano o fallback
// do módulo carrega hoje.
const SM_2025 = 1518;

describe('valores do DAS-MEI para a explicação', () => {
  it('devolve um valor formatado por componente', () => {
    const v = valoresDoDasMei('Prestacao de Servicos', valorDasMei('Prestacao de Servicos', SM_2025), SM_2025);
    expect(v).toEqual({ inss: RS('75,90'), iss: RS('5,00') });
  });

  it('comércio e serviços traz os três', () => {
    const v = valoresDoDasMei('Comercio e Servicos', valorDasMei('Comercio e Servicos', SM_2025), SM_2025);
    expect(Object.keys(v ?? {})).toEqual(['inss', 'icms', 'iss']);
  });

  // ═══ A DECISÃO QUE ESTA FUNÇÃO EXISTE PARA TOMAR ═══
  // A tela mostra o valor da GUIA quando ela existe — e a guia vem do SERPRO,
  // não da nossa tabela. Se o total na tela não for a soma dos componentes que a
  // explicação cita, o cliente leria peças que não fecham com o número logo
  // acima. Explicar errado sobre imposto é pior que não explicar.
  it('recusa quando o total exibido não é a soma dos componentes', () => {
    expect(valoresDoDasMei('Prestacao de Servicos', 81.90)).toBeNull();
  });

  it('recusa quando não há total na tela', () => {
    expect(valoresDoDasMei('Prestacao de Servicos', null)).toBeNull();
  });

  // Centavo de arredondamento não pode esconder a explicação.
  it('tolera diferença de arredondamento de um centavo', () => {
    const total = valorDasMei('Prestacao de Servicos');
    expect(valoresDoDasMei('Prestacao de Servicos', total + 0.004)).not.toBeNull();
    expect(valoresDoDasMei('Prestacao de Servicos', total + 0.02)).toBeNull();
  });

  // ACHADO DO CODE-REVIEW. `Math.abs(a - b) > 0.01` NÃO é simétrico em IEEE-754:
  //   |80,91 − 80,90| = 0,009999999999990905  -> aceitava
  //   |80,89 − 80,90| = 0,010000000000005116  -> RECUSAVA
  // Um centavo ACIMA mostrava a explicação e um centavo ABAIXO a escondia, sem
  // nenhuma razão de negócio. A suíte não pegava porque testava ±0,004 e ±0,02,
  // nunca exatamente um centavo. Dinheiro se compara em centavos inteiros.
  it.each([-0.01, 0.01])('a folga de um centavo é simétrica (%s)', (delta) => {
    const total = valorDasMei('Prestacao de Servicos');
    expect(valoresDoDasMei('Prestacao de Servicos', total + delta)).not.toBeNull();
  });

  it.each([-0.02, 0.02])('dois centavos recusam dos dois lados (%s)', (delta) => {
    const total = valorDasMei('Prestacao de Servicos');
    expect(valoresDoDasMei('Prestacao de Servicos', total + delta)).toBeNull();
  });

  // Atividade desconhecida cai em Serviços — o MESMO fallback que a estimativa
  // usa. Se divergisse, a explicação falaria de um tributo que o número não tem.
  it('atividade nula segue o mesmo fallback da estimativa', () => {
    expect(valoresDoDasMei(null, valorDasMei(null, SM_2025), SM_2025)).toEqual({ inss: RS('75,90'), iss: RS('5,00') });
  });

  // Os marcadores que a explicação pode usar são exatamente estas chaves —
  // qualquer divergência faria `renderizar` falhar fechado e a explicação sumir
  // sem ninguém entender por quê.
  it.each(['Comercio ou Industria', 'Prestacao de Servicos', 'Comercio e Servicos'] as const)(
    'as chaves de %s são as mesmas que o catálogo permite',
    async (atividade) => {
      const { marcadoresDaChave } = await import('./marcadores');
      const { chaveDaSituacao, situacaoDasMei } = await import('@/lib/fiscal/situacao-fiscal');
      const v = valoresDoDasMei(atividade, valorDasMei(atividade));
      expect(Object.keys(v ?? {}).sort())
        .toEqual(marcadoresDaChave(chaveDaSituacao(situacaoDasMei(atividade))));
    },
  );
});
