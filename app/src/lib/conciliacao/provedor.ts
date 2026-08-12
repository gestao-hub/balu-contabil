// Bloco 7, Task 11 — provedor de Open Finance, atrás de adapter.
//
// O provedor real não existe: nenhum contrato com Pluggy/Belvo/outro foi
// fechado. Em vez de esperar, a conciliação inteira roda contra um MOCK
// explícito, e o dia em que a credencial chegar é uma env var — não um
// refactor (princípio 3.7 do PRD).
//
// O mock lê `conciliacao_extrato_mock`, uma tabela que alguém popula de
// propósito. Ele NÃO deriva transações das guias em aberto: um mock assim
// daria baixa em tudo e "passaria" justamente porque a resposta foi fabricada
// a partir da pergunta.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Transação como o provedor entrega, antes de virar linha nossa. */
export type TransacaoExterna = {
  idExterno: string;
  data: string;            // YYYY-MM-DD
  valorCentavos: number;
  tipo: 'credito' | 'debito';
  descricao: string | null;
};

export type Conexao = {
  id: string;
  companyId: string;
  provedor: string;
};

export type Provedor = {
  nome: string;
  /** Extrato a partir de uma data (inclusive). */
  listarTransacoes(
    admin: SupabaseClient, conexao: Conexao, desde: string,
  ): Promise<TransacaoExterna[]>;
};

const provedorMock: Provedor = {
  nome: 'mock',
  async listarTransacoes(admin, conexao, desde) {
    const { data, error } = await admin
      .from('conciliacao_extrato_mock')
      .select('id_externo,data,valor_centavos,tipo,descricao')
      .eq('company_id', conexao.companyId)
      .gte('data', desde)
      .order('data', { ascending: true })
      .limit(500);

    if (error) {
      console.error('[conciliacao/mock] leitura do extrato mock:', error.message);
      return [];
    }

    return (data ?? []).map((t) => ({
      idExterno: t.id_externo as string,
      data: t.data as string,
      valorCentavos: Number(t.valor_centavos),
      tipo: (t.tipo as 'credito' | 'debito') ?? 'credito',
      descricao: (t.descricao as string | null) ?? null,
    }));
  },
};

/**
 * Existe provedor de Open Finance DE VERDADE configurado?
 *
 * Enquanto a resposta for `false`, a conciliação não pode ser oferecida ao
 * cliente final: o botão "conectar sua conta" prometeria leitura do extrato
 * bancário, e o único provedor existente é um mock que lê uma tabela nossa.
 * Prometer vigilância bancária sem olhar conta nenhuma é o mesmo defeito que o
 * alerta de "pagamento não detectado" evita — só que na porta de entrada.
 *
 * O cron continua rodando normalmente com o mock: ele não promete nada a
 * ninguém, e é assim que a feature fica testável até a credencial chegar.
 */
export function conciliacaoDisponivel(): boolean {
  const nome = process.env.OPEN_FINANCE_PROVEDOR;
  return Boolean(nome) && nome !== 'mock';
}

/**
 * Sem `OPEN_FINANCE_PROVEDOR` configurado, devolve o mock — e isso é o estado
 * normal hoje, não um erro. Quando existir provedor de verdade, ele entra aqui
 * como outro objeto que cumpre a mesma interface; nada mais no fluxo muda.
 */
export function provedorDeEnv(): Provedor {
  const nome = process.env.OPEN_FINANCE_PROVEDOR;
  if (!nome || nome === 'mock') return provedorMock;

  // Explícito de propósito: um nome desconhecido não pode cair no mock em
  // silêncio e fazer parecer que a integração real está rodando.
  throw new Error(`OPEN_FINANCE_PROVEDOR desconhecido: ${nome}`);
}
