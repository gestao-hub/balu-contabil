// Validação da tabela do Simples que vem do banco (`parametros_fiscais`).
//
// Separado de `parametros.ts` porque aquele é `server-only` e este precisa ser
// testável sem banco: a decisão que importa aqui — aceitar ou recusar um JSON —
// é pura, e é a que impede um registro torto de virar imposto errado.
//
// FALHA FECHADA, e "fechada" aqui quer dizer o fallback do código, não zero e
// não exceção. Um JSON meio certo é o pior caso possível: um anexo faltando
// daria `undefined[anexo]` na hora de identificar a faixa, e um `nominal`
// vindo como string daria alíquota `NaN` — que atravessa `toFixed` sem
// reclamar e chega à tela como "NaN%" ou, pior, a um DAS de valor errado.
// Por isso a validação é do conjunto inteiro: ou os cinco anexos estão
// completos e coerentes, ou nada é aproveitado.
import type { AnexoSimples } from './regime';
import type { FaixaSimples, TabelaSimples } from './simples';

const ANEXOS: readonly AnexoSimples[] = ['Anexo I', 'Anexo II', 'Anexo III', 'Anexo IV', 'Anexo V'];

/** Quantas faixas cada anexo do Simples tem (LC 123/2006, art. 18). */
const FAIXAS_POR_ANEXO = 6;

function faixaValida(v: unknown, esperada: number): v is FaixaSimples {
  if (typeof v !== 'object' || v === null) return false;
  const f = v as Record<string, unknown>;
  const num = (x: unknown) => typeof x === 'number' && Number.isFinite(x);
  if (!num(f.faixa) || !num(f.ate) || !num(f.nominal) || !num(f.deduzir)) return false;
  // A ordem é a semântica: `identificarFaixa` devolve a PRIMEIRA faixa cujo
  // teto cobre o RBT12. Um array fora de ordem daria a faixa errada sem erro
  // nenhum, então a posição faz parte do que se valida.
  if (f.faixa !== esperada) return false;
  // `nominal` é fração (0.06), não percentual (6). Trocar os dois multiplica o
  // imposto por cem, e é um erro fácil de cometer digitando a linha da lei.
  if ((f.nominal as number) <= 0 || (f.nominal as number) >= 1) return false;
  return (f.ate as number) > 0 && (f.deduzir as number) >= 0;
}

/**
 * Converte o `valor_json` do banco em tabela utilizável, ou `null` se houver
 * qualquer coisa fora do lugar. `null` faz o chamador usar o fallback do
 * código — nunca calcular com tabela parcial.
 */
export function lerTabelaSimples(bruto: unknown): TabelaSimples | null {
  if (typeof bruto !== 'object' || bruto === null || Array.isArray(bruto)) return null;
  const obj = bruto as Record<string, unknown>;
  const out = {} as TabelaSimples;
  for (const anexo of ANEXOS) {
    const faixas = obj[anexo];
    if (!Array.isArray(faixas) || faixas.length !== FAIXAS_POR_ANEXO) return null;
    for (let i = 0; i < faixas.length; i++) {
      if (!faixaValida(faixas[i], i + 1)) return null;
    }
    // Tetos estritamente crescentes: sem isso, uma faixa com teto menor que a
    // anterior ficaria inalcançável e o contribuinte cairia sempre na de cima.
    for (let i = 1; i < faixas.length; i++) {
      if ((faixas[i] as FaixaSimples).ate <= (faixas[i - 1] as FaixaSimples).ate) return null;
    }
    out[anexo] = faixas as FaixaSimples[];
  }
  return out;
}

/**
 * Primeiro dia da competência `YYYYMM` — a data contra a qual a vigência é
 * comparada.
 *
 * É a competência, e não "hoje", que escolhe o parâmetro: reapurar março de
 * 2025 em 2027 tem de usar a tabela e o mínimo de março de 2025. Usar a data
 * corrente daria certo o ano inteiro e erraria exatamente nas retificações,
 * que são justamente quando alguém confere.
 */
export function dataDaCompetencia(competencia: string): string {
  const c = String(competencia ?? '').replace(/\D/g, '');
  if (c.length !== 6) return new Date().toISOString().slice(0, 10);
  const mes = Number(c.slice(4, 6));
  if (mes < 1 || mes > 12) return new Date().toISOString().slice(0, 10);
  return `${c.slice(0, 4)}-${c.slice(4, 6)}-01`;
}
