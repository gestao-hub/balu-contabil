// Bloco 7, Task 11 — a rodada diária da conciliação.
//
// Três passos por empresa conectada: importar o extrato (idempotente), casar
// com as guias em aberto (matcher puro), e dar baixa apenas no que for
// inequívoco. O ambíguo NÃO é gravado — a tela de sugestões recalcula com a
// mesma função pura e pede confirmação humana.
//
// Roda dentro de `/api/cron/obrigacoes` porque o plano Hobby da Vercel permite
// exatamente 2 crons e as duas vagas já estão ocupadas — mesma carona que o
// billing do 4A pegou.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { casar, type GuiaCandidata, type TransacaoCandidata } from './matcher';
import { provedorDeEnv, type Conexao } from './provedor';

export type ResultadoConciliacao = {
  conexoes: number;
  importadas: number;
  conciliadas: number;
  sugestoes: number;
  alertas: number;
  erros: string[];
};

/** Janela de importação: reimporta os últimos N dias de propósito. */
const DIAS_JANELA = 45;
/** Só alerta "não detectado" depois de N dias do vencimento. */
const DIAS_PARA_ALERTAR = 3;

function isoData(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Hoje em BRT — os prazos do app são todos em Brasília (princípio 3.5). */
function hojeBrt(): Date {
  return new Date(Date.now() - 3 * 60 * 60 * 1000);
}

export async function rodarConciliacao(admin: SupabaseClient): Promise<ResultadoConciliacao> {
  const r: ResultadoConciliacao = {
    conexoes: 0, importadas: 0, conciliadas: 0, sugestoes: 0, alertas: 0, erros: [],
  };

  const { data: conexoes, error: eConex } = await admin
    .from('conciliacao_conexoes')
    .select('id,company_id,provedor')
    .eq('status', 'ativa');

  if (eConex) {
    r.erros.push(`conexoes: ${eConex.message}`);
    return r;
  }
  if (!conexoes || conexoes.length === 0) return r;

  const provedor = provedorDeEnv();
  const hoje = hojeBrt();
  const desde = isoData(new Date(hoje.getTime() - DIAS_JANELA * 86_400_000));

  for (const linha of conexoes) {
    const conexao: Conexao = {
      id: linha.id as string,
      companyId: linha.company_id as string,
      provedor: linha.provedor as string,
    };
    r.conexoes++;

    try {
      // ── 1. importar (idempotente pelo unique (conexao_id, id_externo)) ──
      const externas = await provedor.listarTransacoes(admin, conexao, desde);
      if (externas.length > 0) {
        const { data: inseridas, error: eIns } = await admin
          .from('conciliacao_transacoes')
          .upsert(
            externas.map((t) => ({
              company_id: conexao.companyId,
              conexao_id: conexao.id,
              id_externo: t.idExterno,
              data: t.data,
              valor_centavos: t.valorCentavos,
              tipo: t.tipo,
              descricao: t.descricao,
            })),
            { onConflict: 'conexao_id,id_externo', ignoreDuplicates: true },
          )
          .select('id');
        if (eIns) r.erros.push(`importar ${conexao.companyId}: ${eIns.message}`);
        else r.importadas += (inseridas ?? []).length;
      }

      // ── 2. candidatos dos dois lados ──
      const [{ data: txs, error: eTx }, { data: guias, error: eGuias }] = await Promise.all([
        admin
          .from('conciliacao_transacoes')
          .select('id,valor_centavos,data,tipo')
          .eq('company_id', conexao.companyId)
          .is('guia_id', null)
          .eq('tipo', 'credito')
          .gte('data', desde),
        admin
          .from('guias_fiscais')
          .select('id,valor_total,data_vencimento')
          .eq('company_id', conexao.companyId)
          .is('data_pagamento', null)
          .is('deleted_at', null),
      ]);
      if (eTx || eGuias) {
        r.erros.push(`candidatos ${conexao.companyId}: ${(eTx ?? eGuias)?.message}`);
        continue;
      }

      const transacoes: TransacaoCandidata[] = (txs ?? []).map((t) => ({
        id: t.id as string,
        valorCentavos: Number(t.valor_centavos),
        data: t.data as string,
        tipo: t.tipo as 'credito' | 'debito',
      }));
      const candidatas: GuiaCandidata[] = (guias ?? []).map((g) => ({
        id: g.id as string,
        valorTotal: g.valor_total as number | string | null,
        dataVencimento: g.data_vencimento as string | null,
      }));

      // ── 3. baixa só no inequívoco ──
      const casamentos = casar(transacoes, candidatas);
      for (const c of casamentos) {
        if (c.decisao === 'sugestao') { r.sugestoes++; continue; }

        const { data: res, error: eBaixa } = await admin.rpc('registrar_pagamento_guia', {
          p_guia_id: c.guiaId,
          p_data_pagamento: transacoes.find((t) => t.id === c.transacaoId)?.data ?? isoData(hoje),
          p_origem: 'conciliacao',
          p_transacao_id: c.transacaoId,
        });
        if (eBaixa) { r.erros.push(`baixa ${c.guiaId}: ${eBaixa.message}`); continue; }
        // `ja_estava_paga` NÃO conta: a RPC é idempotente e devolve ok=true
        // para guia que já estava quitada. Somar isso faria o relatório do
        // cron reportar baixa nova todo dia sobre a mesma guia, e o número
        // deixaria de servir para o que existe — saber se algo aconteceu.
        const baixa = res as { ok?: boolean; ja_estava_paga?: boolean } | null;
        if (baixa?.ok && !baixa.ja_estava_paga) r.conciliadas++;
      }

      // ── 4. vencida, conectada e sem pagamento detectado ──
      r.alertas += await alertarNaoDetectado(admin, conexao.companyId, hoje);
    } catch (e) {
      r.erros.push(`${conexao.companyId}: ${e instanceof Error ? e.message : 'falha desconhecida'}`);
    }
  }

  return r;
}

/**
 * Aviso de "passou do vencimento e não vimos o pagamento entrar".
 *
 * Só dispara para empresa COM conexão ativa. Sem conexão, este aviso seria
 * ruído duplicado do `das_vencido` que o Bloco 1 já manda — a diferença é que
 * aqui a frase promete vigilância bancária, e prometer isso sem estar olhando
 * a conta seria mentira.
 */
async function alertarNaoDetectado(
  admin: SupabaseClient, companyId: string, hoje: Date,
): Promise<number> {
  const limite = isoData(new Date(hoje.getTime() - DIAS_PARA_ALERTAR * 86_400_000));

  const { data: vencidas } = await admin
    .from('guias_fiscais')
    .select('id,data_vencimento,company_id,companies(user_id)')
    .eq('company_id', companyId)
    .is('data_pagamento', null)
    .is('deleted_at', null)
    .lt('data_vencimento', limite)
    .limit(20);

  if (!vencidas || vencidas.length === 0) return 0;

  const linhas = vencidas
    .map((g) => {
      // O join embutido do PostgREST vem como objeto para relação "para um",
      // mas o tipo gerado diz array. Tratamos as duas formas: confiar só numa
      // delas quebraria em runtime ou no typecheck, dependendo do dia.
      const rel = g.companies as unknown as { user_id: string | null } | { user_id: string | null }[] | null;
      const owner = (Array.isArray(rel) ? rel[0]?.user_id : rel?.user_id) ?? null;
      if (!owner) return null;
      return {
        owner_user_id: owner,
        company_id: companyId,
        tipo: 'pagamento_nao_detectado',
        severidade: 'warning',
        titulo: 'Não identificamos o pagamento desta guia',
        corpo: 'A guia venceu e nenhuma entrada correspondente apareceu no extrato conectado. Se você pagou por outro meio, marque como paga no app.',
        entidade_ref: g.id as string,
        action_href: '/impostos',
        chave: `pagamento_nao_detectado:${g.id}`,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (linhas.length === 0) return 0;

  // Idempotência pelo índice único (owner_user_id, chave) — mesmo idioma do
  // motor do Bloco 1 e da escalação do 6B.
  const { data, error } = await admin
    .from('notifications')
    .upsert(linhas, { onConflict: 'owner_user_id,chave', ignoreDuplicates: true })
    .select('id');

  if (error) {
    console.error('[conciliacao] alerta nao detectado:', error.message);
    return 0;
  }
  return (data ?? []).length;
}
