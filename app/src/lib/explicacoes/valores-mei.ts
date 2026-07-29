// Bloco 6A — os valores que preenchem os marcadores do DAS-MEI.
//
// É AQUI QUE O NÚMERO DO CONTRIBUINTE ENCONTRA O TEXTO DO CATÁLOGO — dentro da
// Balu, muito depois de a IA ter ido embora. O catálogo guarda "{inss} de INSS";
// esta função diz quanto é `{inss}` para esta atividade.
//
// ⚠️ E É AQUI QUE A EXPLICAÇÃO PODE SER RECUSADA. A tela mostra o valor da GUIA
// quando ela existe, e a guia vem do SERPRO — não da nossa tabela. Quando os
// dois não fecham, o cliente leria componentes que não somam o número logo
// acima, e ficaria com a impressão de que um dos dois está errado (estaria).
// Explicar errado sobre imposto é pior que não explicar: devolve `null` e a tela
// simplesmente não mostra explicação nenhuma.
//
// Isso torna VISÍVEL a dívida do salário mínimo de 2025 registrada em
// `das-mei.ts`: enquanto a tabela estiver desatualizada, guia real e estimativa
// divergem e a explicação não aparece para quem tem guia emitida. É o desfecho
// certo — some em vez de mentir —, mas é a razão pela qual atualizar
// `INSS_MENSAL` importa mais do que parecia.
//
// Puro: sem I/O, sem React.
import { componentesDasMei, valorDasMei } from '@/lib/fiscal/das-mei';
import { brl } from '@/lib/fiscal/guia';

/** Um centavo de folga, para arredondamento não esconder a explicação. */
const TOLERANCIA = 0.01;

/**
 * Os valores formatados de cada componente, ou `null` quando não é seguro
 * explicar.
 *
 * As chaves são exatamente os marcadores que o catálogo permite para esta
 * situação (ver `marcadoresDaChave`) — se divergissem, `renderizar` falharia
 * fechado e a explicação sumiria sem ninguém entender por quê.
 */
export function valoresDoDasMei(
  atividade: string | null | undefined,
  totalExibido: number | null | undefined,
): Record<string, string> | null {
  if (totalExibido == null || !Number.isFinite(totalExibido)) return null;

  const soma = valorDasMei(atividade);
  if (Math.abs(totalExibido - soma) > TOLERANCIA) return null;

  const componentes = componentesDasMei(atividade);
  return Object.fromEntries(
    Object.entries(componentes).map(([chave, valor]) => [chave, brl(valor)]),
  );
}
