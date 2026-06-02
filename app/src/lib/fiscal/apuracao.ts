import type { AnexoSimples } from './regime';
import type { ReceitaApuracao, ResultadoApuracao } from './apuracao-types';
import { identificarFaixa, aliquotaEfetiva } from './simples';
import { calcularRbt12 } from './rbt12';
import { valorDasMei } from './das-mei';

export class RegimeNaoSuportadoError extends Error {
  constructor(public readonly code: string) {
    super('Regime Normal (Lucro Real/Presumido) não é apurado na v1. Fale com o contador.');
    this.name = 'RegimeNaoSuportadoError';
  }
}

export function calcularApuracao(input: {
  regimeCode: string;
  anexo: AnexoSimples | null;
  receitas: ReceitaApuracao[];
  competencia: string;
  atividadeMei?: string | null;
  dataInicioAtividade?: string;
}): ResultadoApuracao {
  const { regimeCode, anexo, receitas, competencia } = input;
  const receitaMes = Number(
    receitas
      .filter((r) => r.competencia === competencia)
      .reduce((acc, r) => acc + r.valor, 0)
      .toFixed(2),
  );

  if (regimeCode === '4') {
    const valorImposto = valorDasMei(input.atividadeMei);
    return {
      tipoApuracao: 'DAS-MEI',
      competencia,
      receitaMes,
      rbt12: null,
      aliquotaEfetiva: null,
      valorImposto,
      breakdown: { tipo: 'DAS-MEI', atividade: input.atividadeMei ?? null, valorFixo: valorImposto },
    };
  }

  if (regimeCode === '1' || regimeCode === '2') {
    if (!anexo) throw new Error('Anexo do Simples não informado para apuração.');
    const { rbt12, mesesConsiderados, anualizado } = calcularRbt12(
      receitas, competencia, input.dataInicioAtividade,
    );
    const faixa = identificarFaixa(rbt12, anexo, competencia);
    const aliquota = aliquotaEfetiva(rbt12, faixa);
    const valorImposto = Number((receitaMes * aliquota).toFixed(2));
    return {
      tipoApuracao: 'Simples Nacional',
      competencia,
      receitaMes,
      rbt12,
      aliquotaEfetiva: Number(aliquota.toFixed(4)),
      valorImposto,
      breakdown: {
        tipo: 'Simples Nacional', anexo, rbt12, mesesConsiderados, anualizado,
        faixa: faixa.faixa, aliquotaNominal: faixa.nominal, parcelaDeduzir: faixa.deduzir,
        aliquotaEfetiva: Number(aliquota.toFixed(4)), receitaMes, valorImposto,
      },
    };
  }

  throw new RegimeNaoSuportadoError(regimeCode);
}
