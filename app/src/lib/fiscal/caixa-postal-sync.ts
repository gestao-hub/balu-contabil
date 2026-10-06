// Caixa Postal do e-CAC → `mensagens_receita` (0110) + avisos.
//
// Duas portas:
//   * `sincronizarCaixaPostalEmpresa` — uma empresa, sob demanda (botão
//     "Atualizar" da tela) ou chamada pela varredura;
//   * `rodarCaixaPostal` — a varredura diária do cron `/api/cron/obrigacoes`.
//
// NENHUMA DAS DUAS ABRE MENSAGEM. Só listam (assunto, origem, data). Abrir dá
// ciência da intimação e é decisão de uma pessoa — ver `serpro-caixa-postal.ts`.
//
// AVISO SÓ DO QUE É NOVO NA BALU. O indicador da Receita diz "há mensagem não
// aberta" e continua dizendo isso todo dia até alguém abrir; avisar por ele
// repetiria o mesmo aviso diariamente. O aviso sai quando um `isn` entra na
// tabela pela primeira vez, com chave única por mensagem.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { indicadorMensagensNovas, listarMensagens } from '@/lib/fiscal/serpro-caixa-postal';
import type { MensagemResumo } from '@/lib/fiscal/serpro-caixa-postal-parse';

export type ResultadoSyncEmpresa =
  | { ok: true; novas: number; total: number; pulada?: 'sem_novidade' }
  | { ok: false; error: string };

/** Grava o que veio da lista; devolve só as mensagens que NÃO existiam. */
async function gravarMensagens(
  admin: SupabaseClient, companyId: string, mensagens: MensagemResumo[],
): Promise<{ novas: MensagemResumo[] } | { erro: string }> {
  if (mensagens.length === 0) return { novas: [] };

  const { data: existentes, error: eLer } = await admin.from('mensagens_receita')
    .select('isn, lida_na_receita, data_ciencia')
    .eq('company_id', companyId)
    .in('isn', mensagens.map((m) => m.isn));
  if (eLer) return { erro: eLer.message };
  const porIsn = new Map((existentes ?? []).map((e) => [e.isn as string, e]));

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
    if (Boolean(e.lida_na_receita) !== m.lidaNaReceita || (e.data_ciencia ?? null) !== m.dataCiencia) {
      await admin.from('mensagens_receita')
        .update({ lida_na_receita: m.lidaNaReceita, data_ciencia: m.dataCiencia, updated_at: new Date().toISOString() })
        .eq('company_id', companyId).eq('isn', m.isn);
    }
  }
  return { novas };
}

/** Avisa o dono da empresa e o escritório que a atende — uma notificação por mensagem. */
async function avisarNovas(admin: SupabaseClient, companyId: string, novas: MensagemResumo[]): Promise<void> {
  if (novas.length === 0) return;
  const { data: empresa } = await admin.from('companies')
    .select('user_id, contabilidade_id, nome, razao_social').eq('id', companyId).maybeSingle();
  const nomeEmpresa = ((empresa?.nome as string | null)?.trim() || (empresa?.razao_social as string | null)?.trim()) ?? '';

  const destinos: { userId: string; href: string }[] = [];
  if (empresa?.user_id) destinos.push({ userId: empresa.user_id as string, href: '/receita/mensagens' });
  if (empresa?.contabilidade_id) {
    const { data: membros } = await admin.from('contabilidade_membros')
      .select('user_id').eq('contabilidade_id', empresa.contabilidade_id as string);
    for (const m of membros ?? []) {
      destinos.push({ userId: m.user_id as string, href: `/contador/clientes/${companyId}/receita` });
    }
  }
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
 * ele diz que há — a lista é a chamada mais cara.
 */
export async function sincronizarCaixaPostalEmpresa(
  admin: SupabaseClient, companyId: string, opts: { completa: boolean },
): Promise<ResultadoSyncEmpresa> {
  if (!opts.completa) {
    const ind = await indicadorMensagensNovas(admin, companyId);
    if (!ind.ok) return ind;
    // `null` (resposta sem o campo) NÃO é "nada novo": lista para conferir.
    if (ind.indicador === 0) {
      await carimbar(admin, companyId);
      return { ok: true, novas: 0, total: 0, pulada: 'sem_novidade' };
    }
  }

  const lista = await listarMensagens(admin, companyId, { somenteNaoLidas: !opts.completa });
  if (!lista.ok) return lista;

  const gravado = await gravarMensagens(admin, companyId, lista.lista.mensagens);
  if ('erro' in gravado) return { ok: false, error: `Não foi possível gravar as mensagens: ${gravado.erro}` };

  await avisarNovas(admin, companyId, gravado.novas);
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

/** Mesmo raciocínio de `pagamentos-serpro-cron.ts`: o `maxDuration` de 60s é
 *  compartilhado, e a varredura não pode comer o tempo das obrigações. */
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
