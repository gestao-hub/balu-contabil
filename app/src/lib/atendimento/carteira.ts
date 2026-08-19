// Modo ESCRITÓRIO — a carteira do contador, em texto, para o prompt.
//
// Decisão D3/D4 (19/08/2026): quando quem escreve é MEMBRO do escritório dono
// do canal, o assistente responde sobre a carteira — agregados, nomes e a
// situação de um cliente específico.
//
// ⚠️ ESTA É A MAIOR SUPERFÍCIE DE VAZAMENTO DA FRENTE. Duas defesas, e as duas
// são estruturais, não de instrução ao modelo:
//
//   1. Os fatos vêm de `painel_contador_por_id`, que filtra por
//      `contabilidade_id` DENTRO do SQL. Não existe caminho aqui que devolva
//      empresa de outro escritório — nem por bug de parâmetro, porque o único
//      parâmetro É o escritório.
//   2. O texto montado NÃO carrega CNPJ, e-mail, telefone nem valor de
//      honorário por cliente. O que o modelo não recebe, ele não vaza.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { classificarSemaforo, type FatosCliente } from '@/lib/fiscal/semaforo';

export type ResumoCarteira = {
  total: number;
  irregulares: number;
  atencao: number;
  emDia: number;
  dasVencidos: number;
  /** Nomes dos clientes com pendência, para o contador saber DE QUEM se trata.
   *  Cortado em 15: uma mensagem de WhatsApp com 80 nomes não é resposta. */
  nomesIrregulares: string[];
  truncado: boolean;
};

type LinhaPainel = Record<string, unknown>;

function fatosDaLinha(l: LinhaPainel): FatosCliente {
  return {
    regimeCode: (l.regime_code as FatosCliente['regimeCode']) ?? null,
    dasVencidos: Number(l.das_vencidos ?? 0),
    pgdasMesAnteriorTransmitida: Boolean(l.pgdas_mes_anterior_transmitida),
    dasnAnoAnteriorTransmitida: Boolean(l.dasn_ano_anterior_transmitida),
    faturamentoAno: Number(l.faturamento_ano ?? 0),
    certNotAfter: (l.cert_not_after as string) ?? null,
  };
}

const LIMITE_NOMES = 15;

/**
 * Resumo da carteira de UM escritório.
 *
 * `limites` são os tetos fiscais vigentes (`parametros_fiscais`), os mesmos que
 * a tela usa — teto hard-coded aqui produziria um semáforo diferente do que o
 * contador vê no painel, e ele não teria como saber qual dos dois está certo.
 */
export async function resumoDaCarteira(
  admin: SupabaseClient,
  contabilidadeId: string,
  limites: { mei: number; simples: number },
  hoje: Date = new Date(),
): Promise<ResumoCarteira | null> {
  const { data, error } = await admin.rpc('painel_contador_por_id', {
    p_contabilidade_id: contabilidadeId,
  });
  if (error) {
    console.error('[carteira] painel_contador_por_id falhou:', error.message);
    return null;
  }

  const linhas = (data ?? []) as LinhaPainel[];
  const nomes: string[] = [];
  let irregulares = 0, atencao = 0, emDia = 0, dasVencidos = 0;

  for (const l of linhas) {
    dasVencidos += Number(l.das_vencidos ?? 0);
    const cor = classificarSemaforo(fatosDaLinha(l), limites, hoje).cor;
    if (cor === 'vermelho') {
      irregulares++;
      const nome = (l.nome as string) || (l.razao_social as string) || null;
      if (nome && nomes.length < LIMITE_NOMES) nomes.push(nome);
    } else if (cor === 'amarelo') atencao++;
    else emDia++;
  }

  return {
    total: linhas.length,
    irregulares, atencao, emDia, dasVencidos,
    nomesIrregulares: nomes,
    truncado: irregulares > nomes.length,
  };
}

/** O resumo em texto, do jeito que entra no prompt. Sem dado sensível. */
export function textoDaCarteira(r: ResumoCarteira): string {
  if (r.total === 0) return 'Este escritório ainda não tem clientes cadastrados.';

  const partes = [
    `${r.total} cliente(s) na carteira: ${r.emDia} em dia, ${r.atencao} em atenção, ${r.irregulares} irregular(es).`,
    `${r.dasVencidos} guia(s) de DAS vencida(s) sem pagamento registrado no total.`,
  ];
  if (r.nomesIrregulares.length) {
    partes.push(
      `Clientes irregulares: ${r.nomesIrregulares.join(', ')}`
      + (r.truncado ? ` e mais ${r.irregulares - r.nomesIrregulares.length}.` : '.'),
    );
  }
  return partes.join(' ');
}
