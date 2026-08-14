// Frente 3, Task 3 — varredura diária de DAS pagos na Receita.
//
// O QUE ELA FAZ
// Para cada empresa do Simples com guia em aberto, pergunta ao PAGTOWEB /
// PAGAMENTOS71 quais DAS foram pagos e registra a baixa por
// `registrar_pagamento_guia` (origem 'serpro'). A RPC é quem marca a guia,
// resolve os avisos de "DAS a vencer", cria o `pagamento_confirmado` e grava a
// auditoria — aqui não há nenhuma escrita direta em `guias_fiscais`.
//
// O QUE ELA NÃO FAZ
// Não CRIA guia. Quem descobre competências novas é a sincronização pela tela
// (CONSDECLARACAO13); esta varredura só concilia o que já está gravado em
// aberto. E não cobre MEI — ver `REGIMES_COM_DAS_SIMPLES`.
//
// É POLLING, e isso tem consequência declarada: o aviso chega no ritmo do cron,
// e a compensação na Receita não é instantânea. "Pagou agora, avisou agora" não
// existe por este caminho.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { consultarPagamentosDas } from '@/lib/fiscal/serpro-pagamentos';
import { planejarBaixas } from '@/lib/fiscal/pagamentos-das-match';
import {
  ordenarFilaConsulta, dentroDoOrcamento, type EmpresaParaConsultar,
} from '@/lib/fiscal/pagamentos-serpro-cron-plano';

/**
 * Orçamento de tempo da varredura dentro do cron.
 *
 * O `maxDuration` da rota é 60s e é COMPARTILHADO com a materialização das
 * obrigações, os e-mails, o WhatsApp, a conciliação, o billing e a apuração.
 * Cada empresa aqui custa uma ida à SERPRO (autenticação do contratante + token
 * de procurador + consulta), que é a chamada mais cara do cron inteiro.
 *
 * 12s é o teto assumido: com ~30-60 empresas a varredura NÃO cabe numa rodada,
 * e é por isso que a fila é ordenada por quem esperou mais. Subir este número
 * sem medir o custo real por empresa é trocar o aviso de pagamento pela
 * materialização das obrigações, que é a única coisa aqui com prazo legal.
 */
const ORCAMENTO_MS_PADRAO = 12_000;

/** Estimativa de custo de uma empresa, usada para decidir se cabe mais uma. */
const CUSTO_EMPRESA_MS = 2_500;

export type ResultadoPagamentosSerpro = {
  /** Empresas elegíveis (Simples, com guia em aberto). */
  elegiveis: number;
  consultadas: number;
  /** Baixas NOVAS. Guia que já estava paga não conta. */
  baixadas: number;
  /** DAS pago que a Receita devolveu sem data de arrecadação. */
  sem_data: number;
  erros: number;
  /** true quando o orçamento acabou antes da fila — o resto entra amanhã. */
  cortada_por_orcamento: boolean;
};

export async function rodarPagamentosSerpro(
  admin: SupabaseClient,
  opts: { agora?: Date; orcamentoMs?: number } = {},
): Promise<ResultadoPagamentosSerpro> {
  const agora = opts.agora ?? new Date();
  const orcamentoMs = opts.orcamentoMs ?? ORCAMENTO_MS_PADRAO;
  const inicio = Date.now();

  const r: ResultadoPagamentosSerpro = {
    elegiveis: 0, consultadas: 0, baixadas: 0, sem_data: 0, erros: 0, cortada_por_orcamento: false,
  };

  // ── 1. candidatas: Simples, não apagadas ──────────────────────────────────
  const { data: fiscais, error: eFiscais } = await admin
    .from('empresas_fiscais')
    .select('empresa_id, Code_regime_tributario, consulta_pagamentos_serpro_em')
    .is('deleted_at', null);
  if (eFiscais || !fiscais) {
    console.error('[pagamentos serpro] leitura de empresas_fiscais falhou', eFiscais?.message);
    r.erros++;
    return r;
  }

  // ── 2. quem tem guia EM ABERTO ────────────────────────────────────────────
  // Uma leitura só para toda a base: consultar a SERPRO por empresa sem nada a
  // conciliar seria queimar cota de contrato para descartar o resultado.
  const { data: abertas, error: eAbertas } = await admin
    .from('guias_fiscais')
    .select('company_id')
    .is('data_pagamento', null)
    .is('deleted_at', null)
    .neq('status', 'erro');
  if (eAbertas) {
    console.error('[pagamentos serpro] leitura de guias em aberto falhou', eAbertas.message);
    r.erros++;
    return r;
  }
  const emAbertoPorEmpresa = new Map<string, number>();
  for (const g of abertas ?? []) {
    const k = g.company_id as string;
    emAbertoPorEmpresa.set(k, (emAbertoPorEmpresa.get(k) ?? 0) + 1);
  }

  const candidatas: EmpresaParaConsultar[] = fiscais.map((f) => ({
    companyId: f.empresa_id as string,
    regimeCode: String(f.Code_regime_tributario ?? ''),
    consultadaEm: (f.consulta_pagamentos_serpro_em as string | null) ?? null,
    guiasEmAberto: emAbertoPorEmpresa.get(f.empresa_id as string) ?? 0,
  }));

  const fila = ordenarFilaConsulta(candidatas);
  r.elegiveis = fila.length;

  const ano = Number(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric' }).format(agora),
  );

  // ── 3. a fila, até o orçamento acabar ─────────────────────────────────────
  for (const empresa of fila) {
    if (!dentroDoOrcamento(inicio, Date.now(), orcamentoMs, CUSTO_EMPRESA_MS)) {
      r.cortada_por_orcamento = true;
      break;
    }

    try {
      const pagtos = await consultarPagamentosDas(admin, empresa.companyId, ano);

      // O carimbo vale para sucesso E para falha: ele registra "esta empresa já
      // teve a vez dela", não "deu certo". Sem isso, uma empresa cuja consulta
      // falha sempre (Termo vencido, por exemplo) voltaria eternamente para a
      // frente da fila e consumiria o orçamento das outras todo dia.
      await admin
        .from('empresas_fiscais')
        .update({ consulta_pagamentos_serpro_em: new Date().toISOString() })
        .eq('empresa_id', empresa.companyId);
      r.consultadas++;

      if (!pagtos.ok) {
        console.warn(`[pagamentos serpro] ${empresa.companyId}: ${pagtos.error}`);
        r.erros++;
        continue;
      }
      if (pagtos.pagamentos.length === 0) continue;

      // As guias em aberto DESTA empresa, com o número do documento — a chave
      // do casamento. Por número, não por valor: é identificador de verdade.
      const { data: guias, error: eGuias } = await admin
        .from('guias_fiscais')
        .select('id, competencia_referencia, numero_das')
        .eq('company_id', empresa.companyId)
        .is('data_pagamento', null)
        .is('deleted_at', null)
        .neq('status', 'erro');
      if (eGuias) { r.erros++; continue; }

      const plano = planejarBaixas(
        (guias ?? []).map((g) => ({
          competencia: g.competencia_referencia as string,
          numeroDas: (g.numero_das as string | null) ?? null,
        })),
        pagtos.pagamentos,
      );
      r.sem_data += plano.semDataDePagamento;

      for (const b of plano.baixas) {
        const guia = (guias ?? []).find((g) => g.competencia_referencia === b.competencia);
        if (!guia) continue;

        const { data: res, error: eBaixa } = await admin.rpc('registrar_pagamento_guia', {
          p_guia_id: guia.id,
          p_data_pagamento: b.dataPagamento,
          p_origem: 'serpro',
          p_transacao_id: null,
        });
        if (eBaixa) {
          console.error(`[pagamentos serpro] baixa ${guia.id}: ${eBaixa.message}`);
          r.erros++;
          continue;
        }
        // `ja_estava_paga` NÃO conta: a RPC é idempotente e devolve ok=true para
        // guia já quitada. Somar isso faria o relatório reportar baixa nova
        // todo dia sobre a mesma guia, e o número deixaria de servir para o que
        // existe — saber se algo aconteceu.
        const baixa = res as { ok?: boolean; ja_estava_paga?: boolean } | null;
        if (baixa?.ok && !baixa.ja_estava_paga) r.baixadas++;
      }
    } catch (e) {
      // Uma empresa fora do ar não pode custar as outras.
      console.error(`[pagamentos serpro] ${empresa.companyId}`, e instanceof Error ? e.message : e);
      r.erros++;
    }
  }

  return r;
}
