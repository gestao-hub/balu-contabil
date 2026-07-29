// Bloco 6A — a chave canônica de uma SITUAÇÃO fiscal.
//
// POR QUE ESTE MÓDULO EXISTE
// O catálogo de explicações é indexado por situação, não por cliente. Esta é a
// função que decide o que "mesma situação" significa — e ela é a peça mais
// delicada do bloco: chave instável produz catálogo com buracos que ninguém
// entende, e chave duplicada faz o admin aprovar a mesma coisa duas vezes.
//
// A RÉGUA: a chave carrega só o que muda a EXPLICAÇÃO, nunca o que muda o
// NÚMERO. No DAS-MEI, o que muda a explicação é quais componentes existem —
// R$ 61,60 e R$ 75,00 se explicam com o mesmo texto. No PGDAS-D, é o anexo e se
// o Fator R se aplica.
//
// Puro de propósito: sem I/O, sem `server-only`. A tela do cliente e a tela do
// admin têm de derivar a MESMA chave, e uma regra dessas não pode existir em
// duas versões.
import { componentesDasMei } from './das-mei';
import { fatorRAplicavel } from './regime';

export type SituacaoFiscal =
  | { tributo: 'das-mei'; componentes: readonly string[] }
  | { tributo: 'pgdas'; anexo: string; fatorR: boolean };

export function situacaoDasMei(atividade: string | null | undefined): SituacaoFiscal {
  return { tributo: 'das-mei', componentes: Object.keys(componentesDasMei(atividade)) };
}

export function situacaoPgdas(anexo: string | null | undefined, usaFatorR: boolean): SituacaoFiscal {
  return {
    tributo: 'pgdas',
    anexo: (anexo ?? 'desconhecido').toLowerCase().replace(/\s+/g, '-'),
    // Fator R só existe em Anexo III/V — a regra já mora em `regime.ts` e não
    // é reimplementada aqui.
    fatorR: usaFatorR && fatorRAplicavel(anexo),
  };
}

/**
 * A chave. **Ordenação alfabética dos componentes é obrigatória**: sem ela,
 * `inss+icms` e `icms+inss` viram duas entradas para a mesma situação e o
 * catálogo duplica sozinho.
 */
export function chaveDaSituacao(s: SituacaoFiscal): string {
  if (s.tributo === 'das-mei') {
    return `das-mei:${[...s.componentes].sort().join('+')}`;
  }
  return `pgdas:${s.anexo}${s.fatorR ? '+fator-r' : ''}`;
}
