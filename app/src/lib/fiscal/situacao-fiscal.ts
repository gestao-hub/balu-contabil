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

/** Sufixo que a chave usa para marcar o Fator R. Uma constante para que a ida
 *  (`chaveDaSituacao`) e a volta (`situacaoDaChave`) não possam divergir. */
const SUFIXO_FATOR_R = '+fator-r';

/**
 * O CAMINHO DE VOLTA: da chave para a situação.
 *
 * Existe porque quem tem a chave — a lista de situações sem texto, uma linha do
 * catálogo — precisa da SITUAÇÃO para montar o prompt, e `montarPrompt` recebe
 * `SituacaoFiscal` de propósito: é o tipo que torna o vazamento de dado de
 * contribuinte impossível de compilar. Sem este parse, a tentação seria afrouxar
 * aquela assinatura para aceitar string.
 *
 * Devolve `null` para o que não reconhece, em vez de inventar uma situação
 * vazia: chave vem do banco ou da URL, e uma situação inventada faria a IA
 * redigir sobre coisa nenhuma — e o texto entraria no catálogo com aparência de
 * legítimo.
 */
export function situacaoDaChave(chave: string): SituacaoFiscal | null {
  const i = chave.indexOf(':');
  if (i <= 0) return null;
  const tributo = chave.slice(0, i);
  const resto = chave.slice(i + 1);
  if (!resto) return null;

  if (tributo === 'das-mei') {
    const componentes = resto.split('+');
    // Minúsculas e sem vazio: a chave é canônica por construção, e aceitar
    // 'INSS' aqui criaria uma segunda grafia para o mesmo componente.
    if (componentes.some((c) => !/^[a-z0-9]+$/.test(c))) return null;
    return { tributo: 'das-mei', componentes };
  }

  if (tributo === 'pgdas') {
    const fatorR = resto.endsWith(SUFIXO_FATOR_R);
    const anexo = fatorR ? resto.slice(0, -SUFIXO_FATOR_R.length) : resto;
    if (!/^[a-z0-9-]+$/.test(anexo)) return null;
    return { tributo: 'pgdas', anexo, fatorR };
  }

  return null;
}

/**
 * O rótulo legível de um anexo a partir do slug que vive na chave
 * (`anexo-iii` → `Anexo III`). O prompt precisa dele para descrever a situação
 * em português; sem isto, cada consumidor faria sua própria conversão e a
 * terceira delas erraria.
 */
export function rotuloDoAnexo(slug: string): string {
  const achatadoSlug = slug.trim().toLowerCase();
  const achar = FAIXA_OPTIONS.find(
    (f) => achatar(f.anexo).replace(/\s+/g, '-') === achatadoSlug,
  );
  return achar?.anexo ?? slug;
}
