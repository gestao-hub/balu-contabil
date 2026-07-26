// src/lib/fiscal/defis/grupos.ts
// Os blocos do DEFIS declarados como DADOS, não como JSX: a UI se desenha a
// partir daqui e o schema Zod (campos.ts) é derivado daqui. Confirmar a lista
// com o Michel — é a PREMISSA 1 da spec (Res. CGSN 140/2018, art. 72).
//
// Realidade que precisa estar dita: quase tudo aqui é digitação manual. O app
// não tem folha, contas a pagar nem estoque. Só receitaBrutaTotal e
// receitaMercadoInterno saem pré-preenchidos das notas.

export type TipoCampoDefis = 'moeda' | 'inteiro' | 'booleano' | 'data' | 'texto' | 'percentual' | 'cpf';

export type CampoDefis = {
  chave: string;
  label: string;
  tipo: TipoCampoDefis;
  obrigatorio: boolean;
  ajuda?: string;
};

export type GrupoDefis = {
  id: 'identificacao' | 'empregados' | 'receitas' | 'despesas' | 'aquisicoes' | 'socios';
  titulo: string;
  norma: string;
  repetivel?: boolean;
  campos: CampoDefis[];
};

export const GRUPOS_DEFIS: GrupoDefis[] = [
  {
    id: 'identificacao',
    titulo: 'Identificação e evento',
    norma: 'Res. CGSN 140/2018, art. 72',
    campos: [
      { chave: 'houveEvento', label: 'Houve cisão, fusão, incorporação ou extinção?', tipo: 'booleano', obrigatorio: true },
      { chave: 'eventoTipo', label: 'Tipo do evento', tipo: 'texto', obrigatorio: false, ajuda: 'Preencher só se houve evento.' },
      { chave: 'eventoData', label: 'Data do evento', tipo: 'data', obrigatorio: false },
      { chave: 'ganhosCapital', label: 'Ganhos de capital no ano', tipo: 'moeda', obrigatorio: true },
      { chave: 'doacoesCampanhaEleitoral', label: 'Doações a campanha eleitoral', tipo: 'moeda', obrigatorio: true },
    ],
  },
  {
    id: 'empregados',
    titulo: 'Empregados',
    norma: 'Res. CGSN 140/2018, art. 72',
    campos: [
      { chave: 'empregadosInicio', label: 'Empregados no início do ano', tipo: 'inteiro', obrigatorio: true },
      { chave: 'empregadosFim', label: 'Empregados no fim do ano', tipo: 'inteiro', obrigatorio: true },
    ],
  },
  {
    id: 'receitas',
    titulo: 'Receitas',
    norma: 'Res. CGSN 140/2018, art. 72',
    campos: [
      { chave: 'receitaMercadoInterno', label: 'Receita do mercado interno', tipo: 'moeda', obrigatorio: true },
      { chave: 'receitaMercadoExterno', label: 'Receita do mercado externo', tipo: 'moeda', obrigatorio: true },
      { chave: 'receitaBrutaTotal', label: 'Receita bruta total do ano', tipo: 'moeda', obrigatorio: true, ajuda: 'Sugerido a partir das suas notas.' },
    ],
  },
  {
    id: 'despesas',
    titulo: 'Despesas e resultado',
    norma: 'Res. CGSN 140/2018, art. 72',
    campos: [
      { chave: 'totalDespesas', label: 'Total de despesas no ano', tipo: 'moeda', obrigatorio: true },
      { chave: 'estoqueInicial', label: 'Estoque no início do ano', tipo: 'moeda', obrigatorio: true },
      { chave: 'estoqueFinal', label: 'Estoque no fim do ano', tipo: 'moeda', obrigatorio: true },
      { chave: 'saldoCaixaInicio', label: 'Saldo em caixa/banco no início', tipo: 'moeda', obrigatorio: true },
      { chave: 'saldoCaixaFim', label: 'Saldo em caixa/banco no fim', tipo: 'moeda', obrigatorio: true },
    ],
  },
  {
    id: 'aquisicoes',
    titulo: 'Aquisições e créditos',
    norma: 'Res. CGSN 140/2018, art. 72',
    campos: [
      { chave: 'aquisicoesMercadoInterno', label: 'Aquisições no mercado interno', tipo: 'moeda', obrigatorio: true },
      { chave: 'aquisicoesMercadoExterno', label: 'Aquisições no mercado externo', tipo: 'moeda', obrigatorio: true },
      { chave: 'creditosIcmsIssRetido', label: 'Créditos de ICMS/ISS retido', tipo: 'moeda', obrigatorio: true },
    ],
  },
  {
    id: 'socios',
    titulo: 'Sócios',
    norma: 'Res. CGSN 140/2018, art. 72',
    repetivel: true,
    campos: [
      { chave: 'cpf', label: 'CPF', tipo: 'cpf', obrigatorio: true },
      { chave: 'nome', label: 'Nome', tipo: 'texto', obrigatorio: true },
      { chave: 'participacaoPct', label: 'Participação (%)', tipo: 'percentual', obrigatorio: true },
      { chave: 'proLabore', label: 'Pró-labore no ano', tipo: 'moeda', obrigatorio: true },
      { chave: 'lucroDistribuido', label: 'Lucro distribuído no ano', tipo: 'moeda', obrigatorio: true },
      { chave: 'impostoRetido', label: 'Imposto retido na fonte', tipo: 'moeda', obrigatorio: true },
    ],
  },
];

/** Campos de valor único (tudo menos o grupo repetível de sócios). */
export function camposPlanos(): CampoDefis[] {
  return GRUPOS_DEFIS.filter((g) => !g.repetivel).flatMap((g) => g.campos);
}

/** Progresso do formulário. Zero e false CONTAM como preenchidos; '' e null não. */
export function contarPreenchidos(valores: Record<string, unknown>): { preenchidos: number; total: number } {
  const campos = camposPlanos();
  const preenchidos = campos.filter((c) => {
    const v = valores[c.chave];
    return v !== undefined && v !== null && v !== '';
  }).length;
  return { preenchidos, total: campos.length };
}
