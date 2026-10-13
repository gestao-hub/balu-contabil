// Caixa Postal do e-CAC → `mensagens_receita` (0110) + avisos.
//
// Duas portas:
//   * `sincronizarCaixaPostalEmpresa` — uma empresa, sob demanda (botão
//     "Atualizar" da tela) ou chamada pela varredura;
//   * `rodarCaixaPostal` — a varredura diária do cron `/api/cron/receita`.
//
// NENHUMA DAS DUAS ABRE MENSAGEM. Só listam (assunto, origem, data). Abrir dá
// ciência da intimação e é decisão de uma pessoa — ver `serpro-caixa-postal.ts`.
//
// AVISO SÓ DO QUE É NOVO NA BALU E NÃO LIDO NO e-CAC. O indicador da Receita
// diz "há mensagem não aberta" e continua dizendo isso todo dia até alguém
// abrir; avisar por ele repetiria o mesmo aviso diariamente. O aviso sai
// quando um `isn` ainda não lido entra na tabela pela primeira vez, com chave
// única por mensagem.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { indicadorMensagensNovas, listarMensagens } from '@/lib/fiscal/serpro-caixa-postal';
import type { MensagemResumo } from '@/lib/fiscal/serpro-caixa-postal-parse';
import { destinatariosReceita as destinatarios } from '@/lib/fiscal/destinatarios-receita';

export type ResultadoSyncEmpresa =
  | { ok: true; novas: number; total: number; pulada?: 'sem_novidade' }
  | { ok: false; error: string };

/** Grava o que veio da lista; devolve só as mensagens que NÃO existiam. */
async function gravarMensagens(
  admin: SupabaseClient, companyId: string, mensagens: MensagemResumo[],
): Promise<{ novas: MensagemResumo[] } | { erro: string }> {
  if (mensagens.length === 0) return { novas: [] };

  // Em lotes: o `.in()` vai na URL do GET, e uma caixa grande (5 páginas na
  // primeira carga) passaria do limite de tamanho da URL.
  const existentes: { isn: string; lida_na_receita: boolean | null; data_ciencia: string | null }[] = [];
  for (let i = 0; i < mensagens.length; i += LOTE_ISN) {
    const { data, error: eLer } = await admin.from('mensagens_receita')
      .select('isn, lida_na_receita, data_ciencia')
      .eq('company_id', companyId)
      .in('isn', mensagens.slice(i, i + LOTE_ISN).map((m) => m.isn));
    if (eLer) return { erro: eLer.message };
    existentes.push(...((data ?? []) as typeof existentes));
  }
  const porIsn = new Map(existentes.map((e) => [e.isn, e]));

  const novas = mensagens.filter((m) => !porIsn.has(m.isn));
  if (novas.length) {
    const { error } = await admin.from('mensagens_receita').upsert(
      novas.map((m) => ({
        company_id: companyId, isn: m.isn, numero_controle: m.numeroControle, assunto: m.assunto,
        origem: m.origem, relevante: m.relevante, data_envio: m.dataEnvio,
        lida_na_receita: m.lidaNaReceita, data_ciencia: m.dataCiencia,
      })),
      // Corrida com outra sincronização da mesma empresa: quem chegar depois
      // não duplica nem sobrescreve.
      { onConflict: 'company_id,isn', ignoreDuplicates: true },
    );
    if (error) return { erro: error.message };
  }

  // Estado NA RECEITA mudou (alguém abriu pelo e-CAC, ciência por decurso)?
  for (const m of mensagens) {
    const e = porIsn.get(m.isn);
    if (!e) continue;
    const { lida, dataCiencia } = estadoAtualizado(e, m);
    if (lida !== Boolean(e.lida_na_receita) || dataCiencia !== (e.data_ciencia ?? null)) {
      const { error } = await admin.from('mensagens_receita')
        .update({ lida_na_receita: lida, data_ciencia: dataCiencia, updated_at: new Date().toISOString() })
        .eq('company_id', companyId).eq('isn', m.isn);
      if (error) console.error('[caixa postal] atualização do estado de leitura falhou', m.isn, error.message);
    }
  }
  return { novas };
}

const LOTE_ISN = 100;

/**
 * Leitura e ciência SÓ AVANÇAM. Lida não volta a "não lida", e a data de
 * ciência guardada (a que a Balu gravou ao abrir — é dela que o prazo conta)
 * não some porque a lista veio sem o campo. A data da Receita, quando vem,
 * prevalece. Exportado para teste.
 */
export function estadoAtualizado(
  guardado: { lida_na_receita: boolean | null; data_ciencia: string | null },
  daReceita: Pick<MensagemResumo, 'lidaNaReceita' | 'dataCiencia'>,
): { lida: boolean; dataCiencia: string | null } {
  return {
    lida: Boolean(guardado.lida_na_receita) || daReceita.lidaNaReceita,
    dataCiencia: daReceita.dataCiencia ?? guardado.data_ciencia ?? null,
  };
}

/**
 * CARGA INICIAL (achado do code-review de 06/10): na primeira sincronização
 * TUDO é "novo na Balu", e avisar uma a uma inundava dono e escritório com o
 * histórico inteiro da caixa — e o cron de e-mail mandaria um e-mail por
 * aviso. Aqui sai UM aviso-resumo por destinatário, e só se houver mensagem
 * ainda não lida no e-CAC.
 */
async function avisarCargaInicial(admin: SupabaseClient, companyId: string, naoLidas: MensagemResumo[]): Promise<void> {
  if (naoLidas.length === 0) return;
  const { nomeEmpresa, destinos } = await destinatarios(admin, companyId);
  if (destinos.length === 0) return;
  const relevantes = naoLidas.filter((m) => m.relevante).length;
  const qtd = `${naoLidas.length} mensage${naoLidas.length === 1 ? 'm' : 'ns'} não lida${naoLidas.length === 1 ? '' : 's'}`;
  const { error } = await admin.from('notifications').upsert(destinos.map((d) => ({
    owner_user_id: d.userId,
    company_id: companyId,
    tipo: 'receita_mensagem_nova',
    severidade: relevantes > 0 ? 'danger' : 'warning',
    titulo: 'Caixa Postal do e-CAC conectada',
    corpo: `${nomeEmpresa ? `${nomeEmpresa}: ` : ''}há ${qtd} na Caixa Postal da Receita`
      + (relevantes > 0 ? ` (${relevantes} marcada${relevantes === 1 ? '' : 's'} como importante).` : '.'),
    action_href: d.href,
    chave: `receita_caixa_inicial:${companyId}`,
  })), { onConflict: 'owner_user_id,chave', ignoreDuplicates: true });
  if (error) console.error('[caixa postal] aviso da carga inicial falhou:', error.message);
}

/** Até aqui a carga inicial avisa mensagem a mensagem; acima, um resumo. */
const MAX_AVISOS_INDIVIDUAIS = 3;

/** Avisa o dono da empresa e o escritório que a atende — uma notificação por mensagem. */
async function avisarNovas(admin: SupabaseClient, companyId: string, novas: MensagemResumo[]): Promise<void> {
  if (novas.length === 0) return;
  const { nomeEmpresa, destinos } = await destinatarios(admin, companyId);
  if (destinos.length === 0) return;

  const linhas = destinos.flatMap((d) => novas.map((m) => ({
    owner_user_id: d.userId,
    company_id: companyId,
    tipo: 'receita_mensagem_nova',
    severidade: m.relevante ? 'danger' : 'warning',
    titulo: m.relevante ? 'Mensagem IMPORTANTE da Receita no e-CAC' : 'Mensagem nova da Receita no e-CAC',
    corpo: `${nomeEmpresa ? `${nomeEmpresa}: ` : ''}${m.assunto}`,
    entidade_ref: m.isn,
    action_href: d.href,
    chave: `receita_mensagem:${companyId}:${m.isn}`,
  })));
  const { error } = await admin.from('notifications')
    .upsert(linhas, { onConflict: 'owner_user_id,chave', ignoreDuplicates: true });
  if (error) console.error('[caixa postal] aviso de mensagem nova falhou:', error.message);
}

/**
 * Sincroniza a Caixa Postal de UMA empresa.
 *
 * `completa`: lista TODAS as mensagens (primeira vez e botão "Atualizar").
 * Senão (cron): pergunta o indicador primeiro e só lista as não lidas quando
 * ele diz que há — a lista é a chamada mais cara. A lista vira completa por
 * conta própria em dois casos (code-review de 13/10):
 *   * nada guardado ainda — a primeira sincronização pode ter falhado e
 *     carimbado, e é o carimbo que o cron usa para pedir `completa`;
 *   * há mensagem guardada ainda NÃO LIDA — só a lista completa diz que ela
 *     foi lida no e-CAC ou ganhou ciência por decurso; a de não lidas
 *     simplesmente deixa de trazê-la.
 */
export async function sincronizarCaixaPostalEmpresa(
  admin: SupabaseClient, companyId: string, opts: { completa: boolean },
): Promise<ResultadoSyncEmpresa> {
  // Lido ANTES de gravar. Erro de leitura conta como carga inicial: errar
  // para o resumo custa um aviso; errar para o outro lado é a enxurrada.
  const [{ data: jaTem, error: eJaTem }, { data: pendentes }] = await Promise.all([
    admin.from('mensagens_receita').select('id').eq('company_id', companyId).limit(1),
    admin.from('mensagens_receita').select('id').eq('company_id', companyId).eq('lida_na_receita', false).limit(1),
  ]);
  const cargaInicial = Boolean(eJaTem) || (jaTem ?? []).length === 0;
  const completa = opts.completa || cargaInicial || (pendentes ?? []).length > 0;

  if (!completa) {
    const ind = await indicadorMensagensNovas(admin, companyId);
    if (!ind.ok) return ind;
    // `null` (resposta sem o campo) NÃO é "nada novo": lista para conferir.
    if (ind.indicador === 0) {
      await carimbar(admin, companyId);
      return { ok: true, novas: 0, total: 0, pulada: 'sem_novidade' };
    }
  }

  const lista = await listarMensagens(admin, companyId, { somenteNaoLidas: !completa });
  if (!lista.ok) return lista;

  const gravado = await gravarMensagens(admin, companyId, lista.lista.mensagens);
  if ('erro' in gravado) return { ok: false, error: `Não foi possível gravar as mensagens: ${gravado.erro}` };

  // Só o que ainda NÃO foi lido no e-CAC é notícia: mensagem aberta por lá
  // (pelo contador, pelo próprio cliente) já foi vista por alguém. O resumo
  // é para o HISTÓRICO de uma caixa cheia; caixa que nasceu vazia e recebe a
  // primeira intimação avisa a intimação, com o assunto dela.
  const naoLidas = gravado.novas.filter((m) => !m.lidaNaReceita);
  if (cargaInicial && naoLidas.length > MAX_AVISOS_INDIVIDUAIS) await avisarCargaInicial(admin, companyId, naoLidas);
  else await avisarNovas(admin, companyId, naoLidas);
  await carimbar(admin, companyId);
  return { ok: true, novas: gravado.novas.length, total: lista.lista.mensagens.length };
}

async function carimbar(admin: SupabaseClient, companyId: string): Promise<void> {
  const { error } = await admin.from('empresas_fiscais')
    .update({ caixa_postal_consultada_em: new Date().toISOString() })
    .eq('empresa_id', companyId);
  if (error) console.error('[caixa postal] carimbo da consulta falhou', companyId, error.message);
}

// ─── VARREDURA DIÁRIA ────────────────────────────────────────────────────────

/** Padrão conservador; a rota `/api/cron/receita` passa o orçamento dela. */
const ORCAMENTO_MS_PADRAO = 8_000;
/** Indicador (uma chamada) + às vezes a lista. */
const CUSTO_EMPRESA_MS = 2_500;
const TETO_EMPRESAS = 5_000;

export type ResultadoCaixaPostal = {
  elegiveis: number;
  consultadas: number;
  mensagens_novas: number;
  erros: number;
  cortada_por_orcamento: boolean;
};

/**
 * Elegível = empresa com certificado A1 guardado (sem ele não há token de
 * procurador e a chamada nem sai). Fila por quem esperou mais.
 */
export async function rodarCaixaPostal(
  admin: SupabaseClient, opts: { orcamentoMs?: number } = {},
): Promise<ResultadoCaixaPostal> {
  const orcamentoMs = opts.orcamentoMs ?? ORCAMENTO_MS_PADRAO;
  const inicio = Date.now();
  const r: ResultadoCaixaPostal = { elegiveis: 0, consultadas: 0, mensagens_novas: 0, erros: 0, cortada_por_orcamento: false };

  const { data: certs, error: eCerts } = await admin.from('arquivos_auxiliares')
    .select('company_id').not('storage_key', 'is', null).is('deleted_at', null).limit(TETO_EMPRESAS);
  if (eCerts) { console.error('[caixa postal] leitura dos certificados falhou', eCerts.message); r.erros++; return r; }
  const comCert = new Set((certs ?? []).map((c) => c.company_id as string));
  if (comCert.size === 0) return r;

  const { data: fiscais, error: eFiscais } = await admin.from('empresas_fiscais')
    .select('empresa_id, caixa_postal_consultada_em').is('deleted_at', null).limit(TETO_EMPRESAS);
  if (eFiscais) { console.error('[caixa postal] leitura de empresas_fiscais falhou', eFiscais.message); r.erros++; return r; }

  const fila = (fiscais ?? [])
    .filter((f) => comCert.has(f.empresa_id as string))
    .sort((a, b) => String(a.caixa_postal_consultada_em ?? '').localeCompare(String(b.caixa_postal_consultada_em ?? '')));
  r.elegiveis = fila.length;

  for (const f of fila) {
    if (Date.now() - inicio + CUSTO_EMPRESA_MS > orcamentoMs) { r.cortada_por_orcamento = true; break; }
    const companyId = f.empresa_id as string;
    // Primeira vez desta empresa: lista tudo, para a tela não nascer vazia.
    const res = await sincronizarCaixaPostalEmpresa(admin, companyId, { completa: !f.caixa_postal_consultada_em });
    r.consultadas++;
    if (!res.ok) {
      console.warn(`[caixa postal] ${companyId}: ${res.error}`);
      r.erros++;
      // Carimba mesmo assim: sem isso a empresa com problema (Termo vencido)
      // fica na frente da fila todo dia e come o orçamento das outras.
      await carimbar(admin, companyId);
      continue;
    }
    r.mensagens_novas += res.novas;
  }
  return r;
}
