// Bloco 6A — quais marcadores uma situação fiscal permite.
//
// FONTE ÚNICA DE DUAS DECISÕES QUE PRECISAM CONCORDAR:
//  - o PROMPT (Task 8) diz à IA quais marcadores usar;
//  - a APROVAÇÃO (Task 9) recusa texto com marcador fora do conjunto.
// Se cada lado tivesse sua lista, a IA receberia um contrato e o revisor
// aplicaria outro — e o rascunho nasceria impossível de aprovar.
//
// Puro: sem I/O, sem `server-only`. A tela do admin e a do cliente derivam a
// mesma regra.
import { situacaoDaChave } from '@/lib/fiscal/situacao-fiscal';

/**
 * Os marcadores que a tela sabe preencher para esta situação, em ordem
 * alfabética estável.
 *
 * Chave desconhecida devolve lista VAZIA — e não um palpite. Com lista vazia, a
 * aprovação recusa qualquer texto com marcador, que é o desfecho certo para uma
 * situação que ninguém sabe descrever.
 */
export function marcadoresDaChave(chave: string): string[] {
  const s = situacaoDaChave(chave);
  if (!s) return [];

  if (s.tributo === 'das-mei') {
    // Um marcador por componente: são exatamente os valores que
    // `componentesDasMei` entrega para a tela preencher.
    return [...s.componentes].sort();
  }

  // PGDAS-D, nesta rodada, explica o TOTAL. A repartição entre os tributos do
  // Simples depende de faixa e anexo, e a apuração ainda não a entrega — prometer
  // `{irpj}` agora seria oferecer marcador que a tela não sabe resolver, e a
  // falha fechada de `renderizar` esconderia a explicação inteira por causa dele.
  return ['total'];
}
