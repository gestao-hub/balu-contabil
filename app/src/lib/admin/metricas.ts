// Métricas de operação da plataforma (painel do AdminBalu).
//
// Funções puras: recebem as linhas cruas e devolvem números. O motivo de não
// fazer isso em SQL é o de sempre neste projeto — regra de negócio em função
// testável, banco só entrega dado. E aqui há decisões de negócio de verdade
// (o que conta como inadimplente, o que é MRR), que não podem ficar escondidas
// dentro de uma view.
//
// ⚠️ Dinheiro em CENTAVOS inteiros o tempo todo. `cobrancas.valor_centavos` e
// `cobrancas_escritorio.valor_centavos` já são centavos; `honorarios.valor` é
// numeric em reais e por isso NÃO entra aqui.

export type CobrancaPlataforma = {
  valor_centavos: number | string;
  status: string;
  vencimento: string | null;   // YYYY-MM-DD
  pago_em: string | null;      // YYYY-MM-DD
};

export type AssinaturaLinha = {
  contabilidade_id: string | null;
  company_id: string | null;
  plano_id: string | null;
  status: string;
};

export type PlanoLinha = { id: string; valor_centavos: number | string; ciclo: string | null };

export type ResumoPlataforma = {
  /** Assinaturas que hoje geram receita recorrente (ativas, fora de trial). */
  mrrCentavos: number;
  recebidoNoMesCentavos: number;
  aVencerNoMesCentavos: number;
  inadimplenteCentavos: number;
  inadimplenteQtd: number;
  /** Inadimplência sobre o que já venceu — 0 quando nada venceu ainda. */
  taxaInadimplencia: number;
  assinaturasPorStatus: Record<string, number>;
};

const num = (v: number | string | null | undefined): number => {
  const n = typeof v === 'string' ? Number(v) : (v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const mesDe = (ymd: string | null): string => (ymd ?? '').slice(0, 7);

/**
 * "Paga" é o único status que conta como recebido. Qualquer outro — incluindo
 * `confirmada`, que no Asaas significa "confirmada mas ainda não liquidada" —
 * fica de fora: dinheiro confirmado não é dinheiro na conta, e inflar receita
 * com ele é a forma mais fácil de um painel mentir.
 */
const ehPaga = (c: CobrancaPlataforma): boolean => c.status === 'paga' || !!c.pago_em;

export function resumoPlataforma(
  cobrancas: CobrancaPlataforma[],
  assinaturas: AssinaturaLinha[],
  planos: PlanoLinha[],
  hojeYmd: string,
): ResumoPlataforma {
  const mesAtual = hojeYmd.slice(0, 7);
  // MRR é receita MENSAL: o plano anual (`ciclo = 'YEARLY'`, ver 0050) entra
  // dividido por 12. Somar o valor cheio multiplicaria por doze a receita de
  // quem paga uma vez por ano — o painel diria que a plataforma fatura num mês
  // o que ela fatura no exercício.
  const mensalDoPlano = new Map(planos.map((p) => {
    const v = num(p.valor_centavos);
    return [p.id, (p.ciclo ?? '').toUpperCase() === 'YEARLY' ? Math.round(v / 12) : v];
  }));

  const assinaturasPorStatus: Record<string, number> = {};
  let mrrCentavos = 0;
  for (const a of assinaturas) {
    const s = (a.status ?? 'sem status').toLowerCase();
    assinaturasPorStatus[s] = (assinaturasPorStatus[s] ?? 0) + 1;
    // Trial não é receita: é promessa. Cancelada e inadimplente também não.
    if (s === 'ativa') mrrCentavos += mensalDoPlano.get(a.plano_id ?? '') ?? 0;
  }

  let recebidoNoMesCentavos = 0;
  let aVencerNoMesCentavos = 0;
  let inadimplenteCentavos = 0;
  let inadimplenteQtd = 0;
  let venceuCentavos = 0;

  for (const c of cobrancas) {
    const valor = num(c.valor_centavos);
    const paga = ehPaga(c);

    if (paga && mesDe(c.pago_em) === mesAtual) recebidoNoMesCentavos += valor;

    if (c.vencimento) {
      const venceuAntesDeHoje = c.vencimento < hojeYmd;
      if (venceuAntesDeHoje) venceuCentavos += valor;

      if (!paga && venceuAntesDeHoje) {
        // Inadimplente = venceu e não foi paga. `status` do Asaas não é
        // suficiente: uma cobrança pode estar 'pendente' e já ter vencido.
        inadimplenteCentavos += valor;
        inadimplenteQtd++;
      }
      if (!paga && !venceuAntesDeHoje && mesDe(c.vencimento) === mesAtual) {
        aVencerNoMesCentavos += valor;
      }
    }
  }

  return {
    mrrCentavos,
    recebidoNoMesCentavos,
    aVencerNoMesCentavos,
    inadimplenteCentavos,
    inadimplenteQtd,
    // Sobre o que VENCEU, não sobre o faturamento total: dividir pelo total
    // faria a taxa despencar só porque há muita cobrança futura em aberto.
    taxaInadimplencia: venceuCentavos > 0 ? inadimplenteCentavos / venceuCentavos : 0,
    assinaturasPorStatus,
  };
}

export type EscritorioLinha = { id: string; nome: string; status: string };
export type EmpresaLinha = { id: string; contabilidade_id: string | null; deleted_at: string | null };
export type MembroLinha = { contabilidade_id: string };
export type CobrancaEscritorioLinha = {
  contabilidade_id: string; valor_centavos: number | string; status: string; pago_em: string | null;
};

export type UsoEscritorio = {
  id: string;
  nome: string;
  status: string;
  clientes: number;
  membros: number;
  plano: string | null;
  assinaturaStatus: string | null;
  /** Volume que o escritório já recebeu pela subconta (Bloco 4B). */
  recebidoCentavos: number;
  /** Cobranças do escritório ainda não pagas — inclusive as a vencer.
   *  `cobrancas_escritorio.vencimento` não é lido aqui, então "em aberto" é
   *  literalmente "sem pagamento", não "vencida". */
  emAbertoCentavos: number;
};

/**
 * Uma linha por escritório, ordenada por nº de clientes (quem tem carteira
 * maior aparece primeiro — é a pergunta que o dono da plataforma faz).
 *
 * Escritório sem cliente nenhum **aparece na lista**, com zero. Sumir com ele
 * esconderia exatamente o caso que interessa: quem cadastrou e não usou.
 */
export function usoPorEscritorio(
  escritorios: EscritorioLinha[],
  empresas: EmpresaLinha[],
  membros: MembroLinha[],
  cobrancas: CobrancaEscritorioLinha[],
  assinaturas: AssinaturaLinha[],
): UsoEscritorio[] {
  const porEscritorio = new Map<string, UsoEscritorio>();

  for (const e of escritorios) {
    porEscritorio.set(e.id, {
      id: e.id, nome: e.nome, status: e.status,
      clientes: 0, membros: 0, plano: null, assinaturaStatus: null,
      recebidoCentavos: 0, emAbertoCentavos: 0,
    });
  }

  for (const emp of empresas) {
    if (emp.deleted_at || !emp.contabilidade_id) continue;
    const l = porEscritorio.get(emp.contabilidade_id);
    if (l) l.clientes++;
  }

  for (const m of membros) {
    const l = porEscritorio.get(m.contabilidade_id);
    if (l) l.membros++;
  }

  for (const a of assinaturas) {
    if (!a.contabilidade_id) continue;
    const l = porEscritorio.get(a.contabilidade_id);
    if (!l) continue;
    l.assinaturaStatus = a.status;
    // `planos.id` JÁ É o rótulo exibido ('starter', 'pro') — a tabela não tem
    // coluna de nome. Um Map id→id no meio disto só disfarçava esse fato.
    l.plano = a.plano_id ?? null;
  }

  for (const c of cobrancas) {
    const l = porEscritorio.get(c.contabilidade_id);
    if (!l) continue;
    const valor = num(c.valor_centavos);
    if (c.status === 'paga' || c.pago_em) l.recebidoCentavos += valor;
    else l.emAbertoCentavos += valor;
  }

  return [...porEscritorio.values()].sort(
    (a, b) => b.clientes - a.clientes || a.nome.localeCompare(b.nome, 'pt-BR'),
  );
}
