export type PgdasdAtividade = { idAtividade: number; valor: number };

export type PgdasdDados = {
  cnpjCompleto: string;
  pa: number;
  indicadorTransmissao: boolean;
  indicadorComparacao: boolean;
  declaracao: {
    tipoDeclaracao: number;
    receitaPaCompetenciaInterno: number;
    receitaPaCompetenciaExterno: number;
    receitaPaCaixaInterno: number | null;
    receitaPaCaixaExterno: number | null;
    valorFixoIcms: number | null;
    valorFixoIss: number | null;
    receitasBrutasAnteriores: Array<{ pa: number; valorInterno: number; valorExterno: number }>;
    folhasSalario: Array<{ pa: number; valor: number }>;
    naoOptante: null;
    estabelecimentos: Array<{
      cnpjCompleto: string;
      atividades: Array<{
        idAtividade: number;
        valorAtividade: number;
        receitasAtividade: Array<{
          valor: number;
          codigoOutroMunicipio: number | null;
          outraUf: string | null;
          isencoes: null;
          reducoes: null;
          qualificacoesTributarias: null;
          exigibilidadesSuspensas: null;
        }>;
      }>;
    }>;
  };
  valoresParaComparacao: never[];
};

/**
 * Monta o `dados` do TRANSDECLARACAO11 a partir da apuração. MVP: 1 estabelecimento (matriz),
 * mercado interno, sem ISS/ICMS fixo, sem isenções/reduções/ST. indicadorComparacao=false (a SERPRO
 * calcula os tributos). Ver docs/investigations/PGDAS-D-TRANSDECLARACAO11.md.
 */
export function montarDeclaracaoPgdasd(input: {
  cnpj: string;
  competencia: string; // YYYYMM
  atividadesMes: PgdasdAtividade[];
  receitasBrutasAnteriores: Array<{ pa: number; valorInterno: number; valorExterno: number }>;
  folhasSalario: Array<{ pa: number; valor: number }>;
  indicadorTransmissao: boolean;
}): PgdasdDados {
  const cnpj = input.cnpj.replace(/\D+/g, '');
  const receitaInterno = Number(
    input.atividadesMes.reduce((acc, a) => acc + a.valor, 0).toFixed(2),
  );
  return {
    cnpjCompleto: cnpj,
    pa: Number(input.competencia),
    indicadorTransmissao: input.indicadorTransmissao,
    indicadorComparacao: false,
    declaracao: {
      tipoDeclaracao: 1,
      receitaPaCompetenciaInterno: receitaInterno,
      receitaPaCompetenciaExterno: 0,
      receitaPaCaixaInterno: null,
      receitaPaCaixaExterno: null,
      valorFixoIcms: null,
      valorFixoIss: null,
      receitasBrutasAnteriores: input.receitasBrutasAnteriores,
      folhasSalario: input.folhasSalario,
      naoOptante: null,
      estabelecimentos: [
        {
          cnpjCompleto: cnpj,
          atividades: input.atividadesMes.map((a) => ({
            idAtividade: a.idAtividade,
            valorAtividade: Number(a.valor.toFixed(2)),
            receitasAtividade: [
              {
                valor: Number(a.valor.toFixed(2)),
                codigoOutroMunicipio: null,
                outraUf: null,
                isencoes: null,
                reducoes: null,
                qualificacoesTributarias: null,
                exigibilidadesSuspensas: null,
              },
            ],
          })),
        },
      ],
    },
    valoresParaComparacao: [],
  };
}
