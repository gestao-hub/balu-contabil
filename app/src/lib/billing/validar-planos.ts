// Bloco 4A — validacao das faixas de plano de escritorio. Puro, sem I/O.
//
// Existe porque o AdminBalu edita as faixas em runtime: e ele quem pode
// criar o buraco ou a sobreposicao. Validar ANTES de salvar e mais barato
// que descobrir no cron de recalculo, um mes depois.

export type FaixaPlano = { id: string; clientes_min: number | null; clientes_max: number | null };
export type ResultadoValidacao = { ok: true } | { ok: false; erro: string };

export function validarFaixas(planos: FaixaPlano[]): ResultadoValidacao {
  if (planos.length === 0) return { ok: true };

  for (const p of planos) {
    const min = p.clientes_min ?? 0;
    if (p.clientes_max !== null && min > p.clientes_max) {
      return { ok: false, erro: `O plano "${p.id}" tem inicio maior que o fim.` };
    }
  }

  const ord = [...planos].sort((a, b) => (a.clientes_min ?? 0) - (b.clientes_min ?? 0));

  for (let i = 1; i < ord.length; i++) {
    const ant = ord[i - 1];
    const cur = ord[i];
    const fimAnt = ant.clientes_max;          // null = aberta no topo
    const iniCur = cur.clientes_min ?? 0;

    // Faixa aberta no topo so pode ser a ULTIMA: se houver outra depois
    // dela, as duas cobrem o mesmo intervalo infinito.
    if (fimAnt === null || iniCur <= fimAnt) {
      return { ok: false, erro: `As faixas de "${ant.id}" e "${cur.id}" se sobrepoem.` };
    }
    if (iniCur > fimAnt + 1) {
      return {
        ok: false,
        erro: `Ha um buraco entre "${ant.id}" e "${cur.id}": ninguem cobre ${fimAnt + 1} a ${iniCur - 1}.`,
      };
    }
  }

  // As PONTAS. Comparar so pares adjacentes deixava passar os dois buracos
  // que mais doem, porque eles nao ficam ENTRE faixas:
  //  - a primeira faixa comecando em 10 deixa 0-9 sem plano;
  //  - a ultima fechada em 1000 deixa 1001+ sem plano, e o cron so
  //    descobriria no mes seguinte, num console.warn.
  const primeira = ord[0];
  if ((primeira.clientes_min ?? 0) > 0) {
    return {
      ok: false,
      erro: `A primeira faixa ("${primeira.id}") comeca em ${primeira.clientes_min}: ninguem cobre 0 a ${(primeira.clientes_min ?? 0) - 1}.`,
    };
  }

  const ultima = ord[ord.length - 1];
  if (ultima.clientes_max !== null) {
    return {
      ok: false,
      erro: `A ultima faixa ("${ultima.id}") termina em ${ultima.clientes_max}: ninguem cobre ${ultima.clientes_max + 1} ou mais. Deixe o "ate" vazio.`,
    };
  }

  return { ok: true };
}
