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
// (CONSDECLARACAO13, Simples) e `gerarDasMeiAction` (PGMEI, MEI); esta varredura
// só concilia o que já está gravado em aberto. Cobre Simples e MEI; Regime
// Normal fica de fora porque não recolhe DAS — ver `REGIMES_COM_DAS`.
//
// É POLLING, e isso tem consequência declarada: o aviso chega no ritmo do cron,
// e a compensação na Receita não é instantânea. "Pagou agora, avisou agora" não
// existe por este caminho.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { consultarPagamentosDas } from '@/lib/fiscal/serpro-pagamentos';
import { planejarBaixas } from '@/lib/fiscal/pagamentos-das-match';
import {
  ordenarFilaConsulta, dentroDoOrcamento, REGIMES_COM_DAS,
  type EmpresaParaConsultar,
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

/**
 * Tetos EXPLÍCITOS das duas leituras de base.
 *
 * Não existem para economizar memória: existem para tornar o truncamento
 * VISÍVEL. O PostgREST corta em `max-rows` (1000 no padrão do Supabase) e
 * devolve `error: null` — uma página curta é indistinguível da base inteira.
 * Pedindo um teto conhecido, `length >= teto` vira o sinal de que faltou gente.
 *
 * Ficam acima do teto do servidor de propósito: se o `max-rows` for menor, é
 * ele que corta primeiro e a detecção não dispara — por isso o número aqui é
 * um piso de segurança, não uma promessa.
 */
const TETO_EMPRESAS = 5_000;
const TETO_GUIAS_ABERTAS = 5_000;

export type ResultadoPagamentosSerpro = {
  /** Empresas elegíveis (Simples, com guia em aberto). */
  elegiveis: number;
  consultadas: number;
  /** Baixas NOVAS. Guia que já estava paga não conta. */
  baixadas: number;
  /** DAS pago que a Receita devolveu sem data de arrecadação. */
  sem_data: number;
  erros: number;
  /**
   * Empresas cujo carimbo da vez (0088) não pôde ser gravado. Merece número
   * próprio: enquanto ele não cai, a empresa volta à frente da fila todo dia e
   * come o orçamento das outras — a falha não é da consulta, é da rotatividade.
   */
  carimbos_falhos: number;
  /**
   * Uma das leituras de base bateu o teto. Enquanto for `true`, há empresa que
   * NÃO entrou na fila — e ela não aparece em `elegiveis` nem em `erros`.
   */
  leitura_truncada: boolean;
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
    elegiveis: 0, consultadas: 0, baixadas: 0, sem_data: 0, erros: 0,
    carimbos_falhos: 0, leitura_truncada: false, cortada_por_orcamento: false,
  };

  // ── 1. candidatas: Simples, não apagadas ──────────────────────────────────
  //
  // O `.in()` no regime empurra o corte para o banco em vez de trazer a base
  // inteira e filtrar em memória (mesmo desenho de `apuracao-cron.ts`). Não é
  // economia de bytes: é o que faz a leitura caber com folga no teto de linhas.
  const { data: fiscais, error: eFiscais } = await admin
    .from('empresas_fiscais')
    .select('empresa_id, Code_regime_tributario, consulta_pagamentos_serpro_em')
    .in('Code_regime_tributario', [...REGIMES_COM_DAS])
    .is('deleted_at', null)
    .limit(TETO_EMPRESAS);
  if (eFiscais || !fiscais) {
    console.error('[pagamentos serpro] leitura de empresas_fiscais falhou', eFiscais?.message);
    r.erros++;
    return r;
  }
  if (fiscais.length >= TETO_EMPRESAS) {
    r.leitura_truncada = true;
    console.error(
      `[pagamentos serpro] leitura de empresas_fiscais bateu o teto (${TETO_EMPRESAS}) — há empresa fora da fila`,
    );
  }

  // ── 2. quem tem guia EM ABERTO ────────────────────────────────────────────
  // Uma leitura só para toda a base: consultar a SERPRO por empresa sem nada a
  // conciliar seria queimar cota de contrato para descartar o resultado.
  //
  // ⚠️ `.limit()` EXPLÍCITO, e a comparação com o teto logo abaixo. O PostgREST
  // aplica um limite próprio (`max-rows`, 1000 por padrão no Supabase) e
  // TRUNCA SEM ERRO: `error` volta null e a página curta parece a base inteira.
  // Aqui isso não daria um número errado — daria empresa SUMIDA. Quem ficasse
  // fora da página teria `guiasEmAberto: 0`, `podeConsultar` devolveria false, e
  // ela nunca mais entraria na fila, com o resumo do cron reportando saúde.
  // Sem o `.limit()` o teto é invisível; com ele, o estouro é detectável.
  const { data: abertas, error: eAbertas } = await admin
    .from('guias_fiscais')
    .select('company_id')
    .is('data_pagamento', null)
    .is('deleted_at', null)
    .neq('status', 'erro')
    .limit(TETO_GUIAS_ABERTAS);
  if (eAbertas) {
    console.error('[pagamentos serpro] leitura de guias em aberto falhou', eAbertas.message);
    r.erros++;
    return r;
  }
  if ((abertas ?? []).length >= TETO_GUIAS_ABERTAS) {
    // NÃO aborta: a fila parcial ainda concilia quem está nela, e abortar
    // deixaria todo mundo sem baixa. Mas o sinal precisa sair do silêncio.
    r.leitura_truncada = true;
    console.error(
      `[pagamentos serpro] leitura de guias em aberto bateu o teto (${TETO_GUIAS_ABERTAS}) — há empresa fora da fila`,
    );
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
      // ── A JANELA COBRE O ANO ANTERIOR TAMBÉM ──────────────────────────────
      //
      // O filtro do PAGAMENTOS71 é por DATA DE ARRECADAÇÃO, e o DAS da
      // competência 12/AAAA é pago em janeiro de AAAA+1. Com a janela presa ao
      // ano corrente, um pagamento feito em dezembro que a varredura não
      // alcançou antes da virada (orçamento estourado, Termo vencido naquela
      // semana, compensação lenta da Receita) ficava INALCANÇÁVEL PARA SEMPRE:
      // a partir de 1º de janeiro a janela nunca mais o contém. A guia seguia
      // em aberto, a empresa seguia elegível — queimando uma chamada SERPRO por
      // dia numa janela que estruturalmente não pode ter a resposta — e o
      // cliente seguia recebendo cobrança de um DAS que ele já pagou.
      //
      // Dois anos numa chamada só: o intervalo é livre, então isto não custa
      // cota a mais. Não vai além de dois porque `tamanhoDaPagina` é 100 e não
      // há laço de paginação.
      const pagtos = await consultarPagamentosDas(admin, empresa.companyId, ano, {
        desdeAno: ano - 1,
      });
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
          // O id vai no plano e VOLTA nele. Antes, a baixa reencontrava a guia
          // por `competencia_referencia` — coluna NULLABLE, e no Postgres NULL
          // não colide com NULL num índice único, então
          // `uniq_guias_company_competencia` NÃO impede duas guias de
          // competência nula na mesma empresa (importação legada, origem
          // 'n8n'). Com duas delas pagas, o `find` devolvia a mesma primeira
          // linha nas duas voltas: uma guia recebia a data de pagamento da
          // outra e ganhava aviso de "pagamento confirmado", enquanto a que
          // foi realmente paga continuava em aberto, cobrando o cliente.
          id: g.id as string,
          competencia: g.competencia_referencia as string,
          numeroDas: (g.numero_das as string | null) ?? null,
        })),
        pagtos.pagamentos,
      );
      r.sem_data += plano.semDataDePagamento;

      for (const b of plano.baixas) {
        if (!b.id) continue;

        const { data: res, error: eBaixa } = await admin.rpc('registrar_pagamento_guia', {
          p_guia_id: b.id,
          p_data_pagamento: b.dataPagamento,
          p_origem: 'serpro',
          p_transacao_id: null,
        });
        if (eBaixa) {
          console.error(`[pagamentos serpro] baixa ${b.id}: ${eBaixa.message}`);
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
    } finally {
      // ── O CARIMBO DA 0088, NO `finally` E COM O ERRO LIDO ──────────────────
      //
      // Ele registra "esta empresa já teve a vez dela", não "deu certo" — e é
      // isso que faz o corte por orçamento ser justo, porque a fila ordena por
      // quem esperou mais.
      //
      // Estava DENTRO do `try`, depois da consulta, e as duas coisas
      // silenciosamente o desligavam:
      //
      //  1. `consultarPagamentosDas` LANÇA antes do próprio try interno dela —
      //     a leitura do CNPJ, o PFX do contratante e o token de procurador
      //     ficam fora. Certificado corrompido ou Termo vencido pulava direto
      //     para o `catch` acima, o carimbo nunca caía, e a empresa voltava à
      //     FRENTE da fila no dia seguinte ('' ordena antes de qualquer ISO) —
      //     todo dia, consumindo o orçamento de quem vinha atrás. Exatamente a
      //     inanição que a 0088 foi escrita para impedir.
      //  2. o erro do UPDATE não era lido. Com a 0088 aplicada mas o cache de
      //     schema do PostgREST velho, o `PGRST204` passava batido e produzia a
      //     mesma inanição, sem uma linha de log.
      const { error: eCarimbo } = await admin
        .from('empresas_fiscais')
        .update({ consulta_pagamentos_serpro_em: new Date().toISOString() })
        .eq('empresa_id', empresa.companyId);
      if (eCarimbo) {
        // Não incrementa `r.erros` — a consulta pode ter dado certo; o que
        // falhou foi só registrar a vez. Mas precisa aparecer: sem o carimbo, a
        // fila para de girar.
        r.carimbos_falhos++;
        console.error(
          `[pagamentos serpro] carimbo da vez não gravado para ${empresa.companyId} — a fila vai repetir esta empresa: ${eCarimbo.message}`,
        );
      }
    }
  }

  return r;
}
