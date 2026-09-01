import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AnexoSimples } from './regime';
import { competenciaReferenciaBrt } from './guia';
import { calcularApuracao, RegimeNaoSuportadoError, ConfiguracaoIncompletaError } from './apuracao';
import { lerReceitasParaApuracao } from './receitas-source';
import { anexarAnexosDasReceitas } from './segregacao';
import { resolverAnexoEmpresa } from './cnae-sync';
import { getParametrosDaCompetencia } from './parametros';
import {
  ordenarFila, dentroDoOrcamento, competenciaAlvo,
  type EmpresaParaApurar, type ApuracaoExistente,
} from './apuracao-cron-plano';

// Apuração mensal automática (card "Impostos P2.1"), de carona no cron diário.
//
// ── POR QUE DE CARONA ────────────────────────────────────────────────────────
// O plano Hobby da Vercel permite exatamente 2 crons e as duas vagas estão
// ocupadas (obrigações e honorários recorrentes). Foi assim que o billing do
// Bloco 4A entrou, e a disciplina é a mesma.
//
// ── POR QUE ISSO NÃO DERRUBA O CRON ──────────────────────────────────────────
// Três travas, nesta ordem de importância:
//
// 1. RODA POR ÚLTIMO, depois até do billing. Tudo que tem prazo legal já
//    gravou antes de a primeira linha daqui executar. Se esta função morrer de
//    timeout, nada do que veio antes é desfeito — são commits separados.
//
// 2. TEM ORÇAMENTO PRÓPRIO e se corta sozinha. Timeout de wall-clock não é
//    capturável: a única defesa é parar antes. O laço checa o relógio a cada
//    empresa e desiste enquanto ainda há folga.
//
// 3. É INTERROMPÍVEL SEM PREJUÍZO. A apuração é mensal e o cron é diário: se
//    hoje só couberam dez empresas, as outras entram amanhã — e entram
//    primeiro, porque a fila ordena por quem está sem apurar há mais tempo.
//    Um mês tem ~30 passadas para dar conta.
//
// Custo medido no banco real em 12/08/2026: round-trip de 15,7 ms e ~5
// consultas por empresa, ou seja ~80 ms cada. As 3 empresas de hoje custam
// ~0,24 s de um `maxDuration` de 60 s.
//
// ── O QUE ELA NÃO FAZ ────────────────────────────────────────────────────────
// Não emite guia, não transmite declaração e não fala com SERPRO nem com a
// Focus. Só calcula e grava `status = 'calculada'`. Emitir é ato do
// contribuinte; calcular é conta.
//
// E não encosta em competência já declarada — ver `podeApurar`.

const ORCAMENTO_MS_PADRAO = 8000;

/** Estimativa de custo de uma empresa, usada para decidir se cabe mais uma. */
const CUSTO_EMPRESA_MS = 400;

export type ResultadoApuracaoAutomatica = {
  competencia: string;
  elegiveis: number;
  apuradas: number;
  puladas: number;
  erros: number;
  /** Empresas que NÃO dá para apurar por falta de configuração (ex.: Simples
   *  sem anexo definido e com o CNAE sem anexo no catálogo). Separado de
   *  `erros` de propósito: retentar amanhã não resolve, e misturar as duas
   *  coisas fazia um erro real novo passar despercebido dentro de um número
   *  que nunca zerava. */
  semConfiguracao: number;
  /** true quando o orçamento acabou antes da fila — o resto entra amanhã. */
  interrompida: boolean;
};

/**
 * Avisa quem pode preencher o que falta.
 *
 * Vai para o DONO da empresa, não para o contador: o painel do contador é
 * somente leitura por construção (RLS sem política de escrita), então ele não
 * teria como resolver — quem edita o regime tributário é o empresário, em
 * Configurações.
 *
 * Idempotente por COMPETÊNCIA, não por dia: um aviso por mês enquanto a
 * configuração faltar. Diário viraria ruído e o cliente pararia de ler; uma vez
 * só e para sempre sumiria depois de lido.
 */
async function avisarConfiguracaoIncompleta(
  admin: SupabaseClient,
  e: EmpresaParaApurar,
  err: ConfiguracaoIncompletaError,
  competencia: string,
): Promise<void> {
  if (!e.ownerUserId) {
    // Empresa cadastrada pelo contador e ainda sem dono (convite não aceito).
    // Não há a quem avisar — e inventar destinatário é pior que não avisar.
    console.warn('[apuracao-cron] sem dono para avisar sobre configuracao:', e.companyId);
    return;
  }

  const { error } = await admin.from('notifications').upsert({
    owner_user_id: e.ownerUserId,
    company_id: e.companyId,
    tipo: 'apuracao_bloqueada',
    severidade: 'warning',
    titulo: 'Não conseguimos calcular seu imposto',
    corpo: 'Falta definir o Anexo do Simples Nacional da sua empresa. Enquanto isso, '
      + 'o cálculo do mês não é atualizado. Ajuste em Configurações → Regime tributário.',
    action_href: '/configuracoes',
    chave: `apuracao_bloqueada:${e.companyId}:${competencia}:${err.campo}`,
  }, { onConflict: 'owner_user_id,chave', ignoreDuplicates: true });

  if (error) {
    console.error('[apuracao-cron] aviso de configuracao falhou:', error.message);
  }
}

export async function rodarApuracaoAutomatica(
  admin: SupabaseClient,
  opts: { agora?: Date; orcamentoMs?: number } = {},
): Promise<ResultadoApuracaoAutomatica> {
  const agora = opts.agora ?? new Date();
  const orcamentoMs = opts.orcamentoMs ?? ORCAMENTO_MS_PADRAO;
  const competencia = competenciaAlvo(competenciaReferenciaBrt(agora));
  const inicio = Date.now();

  const vazio: ResultadoApuracaoAutomatica = {
    competencia, elegiveis: 0, apuradas: 0, puladas: 0, erros: 0, semConfiguracao: 0, interrompida: false,
  };

  // Regimes 1 e 2 (Simples) e 4 (MEI). O 3 (Regime Normal) não é apurado na
  // v1 e lançaria RegimeNaoSuportadoError uma vez por empresa, por dia.
  const { data: fichas, error: eFichas } = await admin
    .from('empresas_fiscais')
    .select('empresa_id, "Code_regime_tributario", anexo_simples, atividade_mei, data_inicio_atividade')
    .in('Code_regime_tributario', ['1', '2', '4'])
    .is('deleted_at', null);
  if (eFichas) {
    console.error('[apuracao-cron] leitura de empresas_fiscais falhou', eFichas.message);
    return { ...vazio, erros: 1 };
  }
  if (!fichas?.length) return vazio;

  const ids = fichas.map((f) => f.empresa_id as string);
  const [rCompanies, rExistentes] = await Promise.all([
    admin.from('companies').select('id, user_id').in('id', ids).is('deleted_at', null),
    admin.from('apuracoes_fiscais')
      .select('company_id, status, updated_at')
      .in('company_id', ids)
      .eq('competencia_referencia', competencia)
      .is('deleted_at', null),
  ]);

  // ─── OS DOIS ERROS SÃO CONFERIDOS, E O SEGUNDO É O QUE IMPORTA ───────────
  //
  // A leitura de `empresas_fiscais` logo acima já abortava no erro dela; estas
  // duas descartavam o `error` e ficavam com `data: null`. Para `companies` isso
  // é ruim; para `apuracoes_fiscais` é destrutivo.
  //
  // O motivo é `podeApurar(undefined) === true`: com o mapa vazio, TODA empresa
  // parece nunca apurada, e o upsert seguinte reescreve `status: 'calculada'`
  // por cima de competências já `transmitida`/`declarada` — exatamente o que
  // `STATUS_INTOCAVEIS` existe para impedir, porque recalcular uma competência
  // já declarada apaga a base do que foi transmitido à Receita.
  //
  // Uma falha de leitura tem de PARAR o cron, não fazê-lo trabalhar sobre um
  // mundo vazio. Ele roda de novo na próxima janela.
  if (rCompanies.error) {
    console.error('[apuracao-cron] leitura de companies falhou', rCompanies.error.message);
    return { ...vazio, erros: 1 };
  }
  if (rExistentes.error) {
    console.error(
      '[apuracao-cron] leitura de apuracoes_fiscais falhou — ABORTANDO para não reescrever ' +
      'competência já declarada', rExistentes.error.message,
    );
    return { ...vazio, erros: 1 };
  }
  const companies = rCompanies.data;
  const existentesRaw = rExistentes.data;

  const donoDe = new Map((companies ?? []).map((c) => [c.id as string, (c.user_id ?? null) as string | null]));
  const existentes = new Map<string, ApuracaoExistente>(
    (existentesRaw ?? []).map((a) => [
      a.company_id as string,
      {
        companyId: a.company_id as string,
        status: (a.status ?? null) as string | null,
        atualizadaEm: (a.updated_at ?? null) as string | null,
      },
    ]),
  );

  // Empresa apagada some da fila mesmo tendo ficha fiscal — o `.in()` acima já
  // filtrou `deleted_at`, e sem este `has` a apuração seria gravada para uma
  // company que não existe mais.
  const empresas: EmpresaParaApurar[] = fichas
    .filter((f) => donoDe.has(f.empresa_id as string))
    .map((f) => ({
      companyId: f.empresa_id as string,
      ownerUserId: donoDe.get(f.empresa_id as string) ?? null,
      regimeCode: String(f.Code_regime_tributario ?? ''),
      anexoSimples: (f.anexo_simples ?? null) as string | null,
      atividadeMei: (f.atividade_mei ?? null) as string | null,
      dataInicioAtividade: (f.data_inicio_atividade ?? null) as string | null,
    }));

  const fila = ordenarFila(empresas, existentes);
  const puladas = empresas.length - fila.length;

  // Uma leitura só de parâmetros para a competência inteira: eles não variam
  // por empresa, e ler por empresa multiplicaria a consulta por N sem mudar
  // uma vírgula do resultado.
  const parametros = await getParametrosDaCompetencia(admin, competencia);

  let apuradas = 0;
  let erros = 0;
  let semConfiguracao = 0;
  let interrompida = false;

  for (const e of fila) {
    if (!dentroDoOrcamento(inicio, Date.now(), orcamentoMs, CUSTO_EMPRESA_MS)) {
      interrompida = true;
      break;
    }
    try {
      const resolvido = await resolverAnexoEmpresa(
        admin, e.companyId, e.anexoSimples as AnexoSimples | null, competencia,
      );
      const receitas = await lerReceitasParaApuracao(admin, e.companyId, competencia);
      const comAnexos = await anexarAnexosDasReceitas(
        admin, e.companyId, competencia, receitas, resolvido.anexo,
      );

      const resultado = calcularApuracao({
        regimeCode: e.regimeCode,
        anexo: resolvido.anexo,
        receitas: comAnexos,
        competencia,
        atividadeMei: e.atividadeMei,
        tabelaSimples: parametros.tabelaSimples,
        salarioMinimo: parametros.salarioMinimo,
        dataInicioAtividade: e.dataInicioAtividade ?? undefined,
      });

      const { error } = await admin.from('apuracoes_fiscais').upsert(
        {
          company_id: e.companyId,
          owner_user_id: e.ownerUserId,
          competencia_referencia: resultado.competencia,
          tipo_apuracao: resultado.tipoApuracao,
          anexo_simples: resolvido.anexo,
          receita_mes: resultado.receitaMes,
          rbt12: resultado.rbt12,
          fator_r: resolvido.fatorR ?? null,
          aliquota_efetiva: resultado.aliquotaEfetiva,
          valor_imposto: resultado.valorImposto,
          status: 'calculada',
          deleted_at: null,
          payload_calculo: resultado.breakdown,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'company_id,competencia_referencia' },
      );
      if (error) throw new Error(error.message);
      apuradas++;
    } catch (err) {
      // UMA empresa com ficha meia-boca não pode custar a apuração das outras.
      // O erro fica no log com o id, e a empresa volta ao topo da fila amanhã
      // (continua sem apuração, então ordena primeiro).
      //
      // ═══ FALTA CONFIGURAÇÃO ≠ ERRO (corrigido em 19/08/2026) ═══
      //
      // Bug real, achado no cron de produção: a `ideapp` falhava TODO DIA com
      // "Anexo do Simples não informado" — Simples sem `anexo_simples` e com o
      // CNAE no catálogo `cnae_anexo`, mas com `anexo_base` NULL. Retentar
      // amanhã não cria uma configuração que ninguém preencheu.
      //
      // O estrago era o silêncio composto: a tela seguia mostrando uma apuração
      // ANTIGA como `calculada`, o resumo do cron dizia "1 erro" sem dizer de
      // quê, e um erro NOVO subiria de 1 para 2 sem ninguém notar. Agora conta
      // separado E avisa quem pode resolver.
      if (err instanceof ConfiguracaoIncompletaError) {
        semConfiguracao++;
        await avisarConfiguracaoIncompleta(admin, e, err, competencia);
      } else {
        erros++;
        if (!(err instanceof RegimeNaoSuportadoError)) {
          console.error(`[apuracao-cron] empresa ${e.companyId} falhou`,
            err instanceof Error ? err.message : String(err));
        }
      }
    }
  }

  return { competencia, elegiveis: fila.length, apuradas, puladas, erros, semConfiguracao, interrompida };
}
