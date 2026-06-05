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

    // Agrupa a receita da própria competência por anexo (r.anexo ?? fallback `anexo`).
    const doMes = receitas.filter((r) => r.competencia === competencia);
    const buckets = new Map<AnexoSimples, number>();
    for (const r of doMes) {
      const a = (r.anexo ?? anexo) as AnexoSimples;
      buckets.set(a, (buckets.get(a) ?? 0) + r.valor);
    }

    const porAnexo: Array<{ anexo: AnexoSimples; receita: number; aliquotaEfetiva: number; valor: number; faixa: number }> = [];
    let valorImposto = 0;
    for (const [a, receitaBruta] of buckets) {
      const receita = Number(receitaBruta.toFixed(2));
      const faixa = identificarFaixa(rbt12, a, competencia);
      const aliq = aliquotaEfetiva(rbt12, faixa);
      const valor = Number((receita * aliq).toFixed(2));
      valorImposto += valor;
      porAnexo.push({ anexo: a, receita, aliquotaEfetiva: Number(aliq.toFixed(4)), valor, faixa: faixa.faixa });
    }
    valorImposto = Number(valorImposto.toFixed(2));

    // Alíquota "manchete": ponderada quando há receita; senão a marginal do anexo fallback
    // (preserva a prévia útil mesmo com mês ainda sem notas).
    const faixaFallback = identificarFaixa(rbt12, anexo, competencia);
    const aliquotaFallback = aliquotaEfetiva(rbt12, faixaFallback);
    const aliquotaGeral = receitaMes > 0 ? valorImposto / receitaMes : aliquotaFallback;
    const segregado = buckets.size > 1;

    return {
      tipoApuracao: 'Simples Nacional',
      competencia,
      receitaMes,
      rbt12,
      aliquotaEfetiva: Number(aliquotaGeral.toFixed(4)),
      valorImposto,
      breakdown: {
        tipo: 'Simples Nacional', anexo, rbt12, mesesConsiderados, anualizado,
        // faixa/nominal/dedução só fazem sentido com 1 anexo; segregado → ver porAnexo.
        ...(segregado ? {} : { faixa: faixaFallback.faixa, aliquotaNominal: faixaFallback.nominal, parcelaDeduzir: faixaFallback.deduzir }),
        segregado, porAnexo,
        aliquotaEfetiva: Number(aliquotaGeral.toFixed(4)), receitaMes, valorImposto,
      },
    };
  }

  throw new RegimeNaoSuportadoError(regimeCode);
}
