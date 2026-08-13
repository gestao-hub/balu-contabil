// Validação do salário mínimo digitado no admin. Pura, sem banco e sem React —
// é a mesma regra que a tela usa para avisar antes de enviar e que a action usa
// para decidir se grava.
//
// POR QUE ISTO NÃO É UM `zod` DE TRÊS LINHAS: o campo não é "um número
// positivo". Ele vira o INSS de todo MEI da base no dia da vigência, e um
// engano de digitação aqui não estoura em lugar nenhum — vira guia errada,
// calada, para todo mundo. As faixas abaixo existem para transformar erro de
// dedo em erro de tela.

/** Menor valor que faz sentido como salário mínimo brasileiro hoje (R$). */
const PISO_ACEITAVEL = 1000;

/**
 * Maior valor aceito sem confirmação (R$).
 *
 * Não é uma previsão econômica: é o limite acima do qual "digitou um zero a
 * mais" é mais provável do que "o mínimo subiu mesmo". R$ 1.621 virando
 * R$ 16.210 passaria por qualquer validação de "número positivo".
 */
const TETO_ACEITAVEL = 5000;

/** Primeiro ano com vigência aceita — antes disso é erro de digitação na data. */
const ANO_MINIMO = 2020;

/** Quantos anos à frente dá para agendar. Dois cobrem "cadastrei em dezembro". */
const ANOS_A_FRENTE = 2;

export type EntradaSalarioMinimo = {
  valor: number;
  /** `YYYY-MM-DD`. Salário mínimo vale por ano civil, então na prática é 1º de janeiro. */
  vigenciaInicio: string;
  norma?: string | null;
};

export type ResultadoValidacao =
  | { ok: true; dados: { valor: number; vigenciaInicio: string; norma: string | null } }
  | { ok: false; erro: string };

/** Aceita "1.621,00", "1621.00" e "1621" — o admin digita como lê. */
export function lerValorBR(bruto: string | number): number {
  if (typeof bruto === 'number') return bruto;
  const s = String(bruto ?? '').trim();
  if (!s) return NaN;
  // Com vírgula, ela é o separador decimal e os pontos são de milhar.
  const normalizado = s.includes(',')
    ? s.replace(/\./g, '').replace(',', '.')
    : s;
  return Number(normalizado.replace(/[^0-9.\-]/g, ''));
}

export function validarSalarioMinimo(
  entrada: EntradaSalarioMinimo,
  hoje: Date = new Date(),
): ResultadoValidacao {
  const valor = Number(entrada.valor);
  if (!Number.isFinite(valor)) return { ok: false, erro: 'Informe o valor do salário mínimo.' };

  // Dois decimais: centavo em salário mínimo existe (R$ 1.412,00 não, mas a
  // regra vale), e mais que isso é lixo de colagem.
  if (Math.round(valor * 100) !== valor * 100) {
    return { ok: false, erro: 'O valor pode ter no máximo dois decimais.' };
  }
  if (valor < PISO_ACEITAVEL || valor > TETO_ACEITAVEL) {
    return {
      ok: false,
      erro: `Valor fora do esperado (entre R$ ${PISO_ACEITAVEL} e R$ ${TETO_ACEITAVEL}). Confira se não faltou ou sobrou um dígito.`,
    };
  }

  const data = String(entrada.vigenciaInicio ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    return { ok: false, erro: 'Informe a data de início da vigência.' };
  }
  const ano = Number(data.slice(0, 4));
  const anoHoje = hoje.getFullYear();
  if (ano < ANO_MINIMO) {
    return { ok: false, erro: `Vigência anterior a ${ANO_MINIMO}. Confira o ano.` };
  }
  if (ano > anoHoje + ANOS_A_FRENTE) {
    // Agendar longe demais é quase sempre ano digitado errado — e um valor
    // agendado para 2035 ficaria invisível por uma década.
    return { ok: false, erro: `Vigência muito à frente (máximo ${anoHoje + ANOS_A_FRENTE}). Confira o ano.` };
  }
  // Data real: '2026-02-31' passa no regex e o Postgres recusaria depois.
  const d = new Date(`${data}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== data) {
    return { ok: false, erro: 'Data inválida.' };
  }

  const norma = String(entrada.norma ?? '').trim();
  return {
    ok: true,
    dados: { valor, vigenciaInicio: data, norma: norma || null },
  };
}

/**
 * O parâmetro está em dia?
 *
 * Por ANO CIVIL, e não por "N dias desde a última atualização": em 3 de janeiro
 * o mínimo do ano passado já está velho, e em 20 de dezembro o de janeiro ainda
 * está perfeito. É a mesma regra da RPC `alertar_parametros_desatualizados`
 * (0081) — se as duas divergissem, a tela diria "em dia" enquanto o sino do
 * admin acusaria atraso.
 */
export function estaEmDia(
  vigenciaMaisRecente: string | null | undefined,
  hoje: Date = new Date(),
): boolean {
  if (!vigenciaMaisRecente) return false;
  return Number(vigenciaMaisRecente.slice(0, 4)) >= hoje.getFullYear();
}
