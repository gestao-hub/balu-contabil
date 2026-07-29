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
import { fatorRAplicavel, FAIXA_OPTIONS } from './regime';

export type SituacaoFiscal =
  | { tributo: 'das-mei'; componentes: readonly string[] }
  | { tributo: 'pgdas'; anexo: string; fatorR: boolean };

export function situacaoDasMei(atividade: string | null | undefined): SituacaoFiscal {
  return { tributo: 'das-mei', componentes: Object.keys(componentesDasMei(atividade)) };
}

/** Caixa e espaço não distinguem anexo: 'anexo iii', ' Anexo  III ' e
 *  'Anexo III' são o mesmo. */
function achatar(bruto: string | null | undefined): string {
  return (bruto ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * O literal canônico ('Anexo III') de qualquer grafia, ou `null` se não for um
 * anexo conhecido. A lista canônica vem de `FAIXA_OPTIONS` — copiá-la aqui
 * criaria uma segunda verdade sobre quais anexos existem.
 */
function anexoCanonico(bruto: string | null | undefined): string | null {
  const achatado = achatar(bruto);
  if (!achatado) return null;
  return FAIXA_OPTIONS.find((f) => achatar(f.anexo) === achatado)?.anexo ?? null;
}

export function situacaoPgdas(anexo: string | null | undefined, usaFatorR: boolean): SituacaoFiscal {
  // UMA normalização só, e os dois campos derivam DELA. Antes, a chave era
  // normalizada (minúscula + traço) e o valor CRU ia para `fatorRAplicavel`,
  // que compara com os literais exatos de `regime.ts` — então 'anexo iii'
  // perdia o Fator R em silêncio e caía numa chave diferente de 'Anexo III'.
  // Duas normalizações do mesmo dado é o que produz a chave instável que o
  // cabeçalho deste módulo chama de pior falha do bloco.
  const canonico = anexoCanonico(anexo);
  const base = canonico ?? achatar(anexo);

  return {
    tributo: 'pgdas',
    anexo: (base || 'desconhecido').toLowerCase().replace(/\s+/g, '-'),
    // Fator R só existe em Anexo III/V — a regra já mora em `regime.ts` e não
    // é reimplementada aqui; o que muda é receber o valor canônico em vez do cru.
    fatorR: usaFatorR && fatorRAplicavel(canonico),
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
