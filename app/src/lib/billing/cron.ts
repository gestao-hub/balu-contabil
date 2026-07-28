// Bloco 4A — rotina diaria de billing.
//
// NADA AQUI E REQUISITO DE CORRECAO: o status efetivo e derivado na leitura
// (lib/billing/status.ts), entao o trial vence sozinho e o gate decide certo
// mesmo que este cron nunca rode. Isto e conveniencia e rede de seguranca —
// fecha em ate 24h a janela de um webhook perdido.
//
// MORA EM lib/ E NAO NA ROUTE de proposito: um `route.ts` do App Router so
// pode exportar os handlers HTTP (GET/POST/...). Exportar `rodarBilling` de
// la quebra o `next build` com "Property 'rodarBilling' is incompatible with
// index signature" — e `tsc --noEmit` NAO pega, porque a validacao vive nos
// tipos gerados em .next/types. Mesma licao que o Bloco 3 registrou para
// arquivos 'use server'.
//
// Estar aqui tambem deixa a rotina chamavel de dentro de
// /api/cron/obrigacoes, caso o projeto esteja no plano Hobby da Vercel
// (limite de 2 crons, e o vercel.json ja tem 2).
import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { asaas } from '@/lib/clients';
import { asaasSub } from '@/lib/clients/asaas';
import { planoPorQtdClientes, type PlanoFaixa } from '@/lib/billing/faixa';
import {
  reconciliarAssinatura, type AssinaturaReconciliavel,
} from '@/lib/billing/reconciliar';
import { lerCredencial, mascarar } from '@/lib/billing/credencial-subconta';
import {
  aplicarPagamentoNaCobranca, type CobrancaDoEscritorio,
} from '@/lib/billing/aplicar-cobranca-escritorio';
import { ymdBrt } from '@/lib/fiscal/tempo-brt';

export type ResumoBilling = {
  reconciliadas: number;
  faixasAtualizadas: number;
  avisos: number;
  erros: number;
  hoje: string;
  /** Bloco 4B — a varredura das cobrancas das subcontas. */
  escritorio: ResumoSincronizacaoEscritorio;
};

/** Dono a notificar: o titular da empresa, ou o membro mais antigo do
 *  escritorio. Sem dono nao ha a quem avisar — o chamador pula. */
async function donoDaAssinatura(
  sb: ReturnType<typeof createAdminClient>,
  a: { company_id: string | null; contabilidade_id: string | null },
): Promise<string | null> {
  if (a.company_id) {
    const { data } = await sb.from('companies').select('user_id').eq('id', a.company_id).maybeSingle();
    return (data?.user_id as string | null) ?? null;
  }
  if (a.contabilidade_id) {
    const { data } = await sb.from('contabilidade_membros')
      .select('user_id').eq('contabilidade_id', a.contabilidade_id)
      .order('created_at').limit(1).maybeSingle();
    return (data?.user_id as string | null) ?? null;
  }
  return null;
}

export type ResumoSincronizacaoEscritorio = {
  /** Escritorios com credencial de subconta guardada — os que a varredura viu. */
  escritorios: number;
  /** Linhas de `cobrancas_escritorio` que mudaram de estado. */
  atualizadas: number;
  /** Escritorios cuja varredura falhou por inteiro (credencial ilegivel, Asaas
   *  fora do ar, leitura recusada). Um nao derruba os outros. */
  erros: number;
  /** Escritorios cuja lista bateu no teto de paginas — ver `MAX_PAGINAS`. */
  truncados: number;
  /** BOLETOS ORFAOS: existem no Asaas com o nosso `externalReference` e NAO tem
   *  linha no banco. Cada um e um cliente com boleto na mao que o painel do
   *  escritorio nunca mostrou. Ver `ehOrfaNossa` abaixo. */
  orfaos: number;
};

/**
 * A cobranca e NOSSA e sumiu do banco?
 *
 * `emitir-cobranca.ts` ja sabe que este estado pode nascer: a cobranca e criada
 * no Asaas e o INSERT falha (registro `cobranca_escritorio.nao_gravada`, trinco
 * mantido, mensagem mandando conferir). Mas dali em diante NINGUEM voltava a
 * procurar por ela — o webhook a descarta como 'cobranca_desconhecida' e as
 * telas so leem a nossa tabela. O cliente fica com um boleto na mao que o painel
 * do escritorio nunca mostra.
 *
 * A varredura e o unico componente que enxerga OS DOIS LADOS. E o
 * `externalReference` que a emissao escreve torna o reconhecimento EXATO, nao
 * heuristico: cobranca com o id DESTE escritorio no campo, sem linha aqui, so
 * pode ser orfa nossa. Sem o campo, foi o escritorio que emitiu pelo painel do
 * Asaas — direito dele, e logar isso encheria o log de linhas normais e
 * esconderia o orfao de verdade.
 *
 * NAO INSERE. Uma linha inventada a partir do payload nasceria sem cliente e sem
 * valor conferido — mesma regra do webhook. O conserto e humano, e o que falta
 * para ele acontecer e alguem SABER.
 */
function ehOrfaNossa(externalReference: string | null | undefined, contabilidadeId: string): boolean {
  return typeof externalReference === 'string' && externalReference.startsWith(`${contabilidadeId}:`);
}

/**
 * Teto de paginas por escritorio. 100 cobrancas por pagina ⇒ 5.000 por dia.
 *
 * Existe como freio de emergencia contra `hasMore` que nunca desce (bug do
 * Asaas, ou paginacao que ignora o `offset`), nao como limite de projeto: hoje
 * nenhum escritorio chega perto. Bater no teto e CONTADO e LOGADO — varredura
 * que trunca em silencio e pior que varredura nenhuma, porque parece completa.
 */
const MAX_PAGINAS = 50;

/**
 * Reconcilia as cobrancas de TODAS as subcontas com o Asaas.
 *
 * POR QUE EXISTE: o webhook e o caminho rapido, nao o unico. Ele nao alcanca
 * `localhost`, nao atravessa firewall, para de vez quando o `ASAAS_WEBHOOK_SECRET`
 * muda sem reconfigurar cada escritorio, e pode simplesmente nao ter sido
 * cadastrado. Sem esta varredura, uma cobranca paga fica "em aberto" para sempre
 * e o cliente do escritorio e cobrado de novo por algo que ja pagou. O 4A ja
 * aprendeu isso da pior forma (bug 5 da sessao 12).
 *
 * NAO FILTRA POR `asaas_subconta_status = 'aprovada'`, ao contrario da EMISSAO.
 * Sao perguntas diferentes: emitir cobranca nova exige KYC aprovado; reconhecer
 * o pagamento de uma cobranca JA EMITIDA nao pode exigir nada. Um KYC que
 * regride (documento vencido, `commercialInfo` expirado) nao apaga os boletos
 * que ja estao na mao dos clientes — e filtrar por 'aprovada' faria esses
 * pagamentos nunca mais baixarem, justamente no escritorio que ja esta com
 * problema. E a mesma forma das duas fronteiras do 4A: o gate alcanca CRIAR,
 * nunca ver nem receber.
 */
export async function sincronizarCobrancasEscritorio(): Promise<ResumoSincronizacaoEscritorio> {
  const sb = createAdminClient();
  const r: ResumoSincronizacaoEscritorio = {
    escritorios: 0, atualizadas: 0, erros: 0, truncados: 0, orfaos: 0,
  };

  const { data: escritorios, error } = await sb
    .from('contabilidades')
    .select('id, asaas_api_key_cifrada')
    .not('asaas_api_key_cifrada', 'is', null);
  if (error) {
    console.error('[cron 4b] leitura dos escritorios falhou', error.message);
    r.erros++;
    return r;
  }

  for (const e of escritorios ?? []) {
    r.escritorios++;
    // UM ESCRITORIO NAO DERRUBA OS OUTROS. Tudo o que pode lancar mora dentro
    // deste `try` — INCLUSIVE `lerCredencial`, que LANCA quando o valor gravado
    // nao tem o prefixo da cifra. O plano do 4B a chamava FORA do try, com
    // `if (!token) continue` supondo retorno nulavel: uma unica contabilidade
    // com credencial corrompida derrubaria a reconciliacao de TODAS — e esta
    // varredura e justamente a rede de seguranca para o webhook que nao chega.
    let token: string | null = null;
    try {
      token = lerCredencial(e.asaas_api_key_cifrada as string | null);
      if (!token) continue;
      const s = await sincronizarUmEscritorio(sb, e.id as string, token);
      r.atualizadas += s.atualizadas;
      r.orfaos += s.orfaos;
      if (s.truncado) r.truncados++;
    } catch (err) {
      r.erros++;
      // A CHAVE NAO VAZA PARA O LOG, nem por acidente de terceiro. A mensagem de
      // erro do cliente Asaas hoje nao carrega o token — mas ela e montada
      // longe daqui, e a regra do modulo da credencial e "nunca entra em log,
      // INCLUSIVE log de erro". Fazer disso uma invariante custa uma linha;
      // depender de a mensagem alheia continuar limpa custa o segredo mais
      // sensivel do sistema no dia em que ela mudar.
      const bruto = err instanceof Error ? err.message : String(err);
      const limpo = token ? bruto.split(token).join(mascarar(token)) : bruto;
      console.error('[cron 4b] sincronizar subconta falhou', e.id, limpo.slice(0, 200));
    }
  }

  return r;
}

/** A varredura de UM escritorio. Separada para que o `try` de cima tenha um
 *  corpo pequeno e nenhuma falha escape sem ser contada. */
async function sincronizarUmEscritorio(
  sb: ReturnType<typeof createAdminClient>,
  contabilidadeId: string,
  token: string,
): Promise<{ atualizadas: number; truncado: boolean; orfaos: number }> {
  const cliente = asaasSub(token);
  let atualizadas = 0;
  let orfaos = 0;
  let offset = 0;

  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const lista = await cliente.listarCobrancas(offset);
    const pagamentos = lista.data ?? [];
    if (pagamentos.length === 0) return { atualizadas, truncado: false, orfaos };

    // UMA leitura por pagina, nao uma por pagamento. O `.eq('contabilidade_id')`
    // e o mesmo anti-IDOR do webhook: o admin client ignora RLS, e uma cobranca
    // que a subconta DESTE escritorio lista mas cuja linha pertence a outro so
    // pode ser dado corrompido — deixar de fora e o lado certo do erro.
    const ids = pagamentos.map((p) => p.id).filter(Boolean);
    const { data: linhas, error } = await sb
      .from('cobrancas_escritorio')
      .select('id, status, pago_em, honorario_id, contabilidade_id, asaas_charge_id')
      .eq('contabilidade_id', contabilidadeId)
      .in('asaas_charge_id', ids);
    // Erro de LEITURA nao pode virar "nenhuma cobranca conhecida" e seguir em
    // frente calado: seria uma varredura que reporta sucesso sem ter olhado.
    if (error) throw new Error(`leitura das cobrancas falhou: ${error.message}`);

    const porCharge = new Map<string, CobrancaDoEscritorio>();
    for (const l of linhas ?? []) {
      porCharge.set(l.asaas_charge_id as string, l as unknown as CobrancaDoEscritorio);
    }

    for (const p of pagamentos) {
      const cob = porCharge.get(p.id);
      if (!cob) {
        // Nao esta na nossa tabela. Duas causas MUITO diferentes, e so o
        // `externalReference` as separa — ver `ehOrfaNossa`.
        if (ehOrfaNossa(p.externalReference, contabilidadeId)) {
          orfaos++;
          console.error(
            '[cron 4b] BOLETO ORFAO — existe no Asaas e nao existe no banco:',
            p.id, `(${p.externalReference})`,
            'o cliente tem o boleto na mao e o painel do escritorio nao o mostra',
          );
        }
        // Sem `externalReference` foi o escritorio que emitiu pelo painel do
        // Asaas: normal, e nao vira log. E NUNCA vira INSERT nos dois casos —
        // linha inventada a partir do payload nasceria sem cliente e sem valor
        // conferido. Mesma regra do webhook.
        continue;
      }

      // A MESMA escrita do webhook, byte a byte — inclusive o desfazer do
      // semaforo do honorario no estorno. Ver o cabecalho de
      // `aplicar-cobranca-escritorio.ts`.
      const res = await aplicarPagamentoNaCobranca(sb, cob, p, 'reconciliacao');
      if (res.ok && res.mudou) atualizadas++;
    }

    if (!lista.hasMore) return { atualizadas, truncado: false, orfaos };
    offset += pagamentos.length;
  }

  console.error('[cron 4b] varredura truncada no teto de paginas', contabilidadeId, MAX_PAGINAS);
  return { atualizadas, truncado: true, orfaos };
}

export async function rodarBilling(): Promise<ResumoBilling> {
  const sb = createAdminClient();
  const hoje = ymdBrt();
  const resumo: ResumoBilling = {
    reconciliadas: 0, faixasAtualizadas: 0, avisos: 0, erros: 0, hoje,
    escritorio: { escritorios: 0, atualizadas: 0, erros: 0, truncados: 0, orfaos: 0 },
  };

  // ─────────────────────────────────────────────── 1. reconciliacao
  //
  // Reconcilia pelas COBRANCAS, nao pelo status da assinatura. O status de
  // subscription do Asaas continua ACTIVE enquanto uma cobranca esta
  // vencida — sao coisas diferentes. Uma versao anterior promovia
  // `remota.status === 'ACTIVE'` para 'ativa', o que desfazia todo
  // PAYMENT_OVERDUE na madrugada seguinte e tornava o gate inoperante.
  //
  // `cancelada` fica INTEIRAMENTE de fora: e democao deliberada do titular,
  // e nenhuma cobranca atrasada do passado pode ressuscitar a conta.
  const { data: comAsaas } = await sb
    .from('assinaturas').select('id, status, asaas_subscription_id')
    .not('asaas_subscription_id', 'is', null)
    .in('status', ['trial', 'ativa', 'inadimplente']);

  for (const a of comAsaas ?? []) {
    try {
      // A regra mora em reconciliar.ts — a MESMA que a tela usa ao voltar do
      // pagamento. Duplicada, cron e tela acabariam discordando sobre quem
      // esta em dia.
      const r = await reconciliarAssinatura(sb, a as AssinaturaReconciliavel);
      if (r.mudou) resumo.reconciliadas++;
    } catch (err) {
      resumo.erros++;
      console.error('[cron billing] reconciliacao falhou', a.id, err);
    }
  }

  // ──────────────────────────────────────── 2. faixa do escritorio
  const { data: planosEsc } = await sb
    .from('planos').select('id, clientes_min, clientes_max, ativo')
    .eq('publico', 'escritorio');

  const { data: assEsc } = await sb
    .from('assinaturas').select('id, contabilidade_id, plano_id')
    .not('contabilidade_id', 'is', null).in('status', ['trial', 'ativa', 'inadimplente']);

  /** Piso da faixa de um plano — serve para comparar "quem cobre mais". */
  const pisoDe = (id: string | null) =>
    (planosEsc ?? []).find((p) => p.id === id)?.clientes_min ?? null;

  for (const a of assEsc ?? []) {
    const { count } = await sb
      .from('companies').select('id', { count: 'exact', head: true })
      .eq('contabilidade_id', a.contabilidade_id as string).is('deleted_at', null);

    const r = planoPorQtdClientes(count ?? 0, (planosEsc ?? []) as PlanoFaixa[]);
    if (!r.ok) {
      // Buraco entre faixas criado pelo admin. NAO adivinhar um plano:
      // registrar e seguir, para alguem consertar em /admin/assinaturas.
      console.warn('[cron billing] sem faixa para', a.contabilidade_id, count, r.motivo);
      resumo.erros++;
      continue;
    }

    // SO CORRIGE PARA CIMA. O escritorio escolhe o plano nos cards da tela,
    // e sobrescrever a escolha dele todo mes seria mudar o preco sem pedir:
    // quem assinou o plano maior de proposito acordaria no menor. Mas quem
    // esta ABAIXO da faixa da carteira e corrigido, senao bastaria assinar
    // o plano de 50 clientes e crescer a vontade.
    const pisoAtual = pisoDe(a.plano_id as string | null);
    const pisoDaFaixa = pisoDe(r.planoId);
    const precisaSubir =
      a.plano_id === null ||
      pisoAtual === null ||
      (pisoDaFaixa !== null && pisoAtual < pisoDaFaixa);

    if (precisaSubir && r.planoId !== a.plano_id) {
      await sb.from('assinaturas')
        .update({ plano_id: r.planoId, updated_at: new Date().toISOString() }).eq('id', a.id);
      resumo.faixasAtualizadas++;
    }
  }

  // ───────────────────────────────────────────────────── 3. avisos
  // Trial terminando em ate 2 dias. A chave de idempotencia inclui a
  // data-alvo, entao rodar 2x no mesmo dia nao duplica (casa com o indice
  // notifications_owner_chave_uidx do Bloco 1).
  const limite = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const { data: trials } = await sb
    .from('assinaturas').select('id, company_id, contabilidade_id, trial_termina_em')
    .eq('status', 'trial')
    .not('trial_termina_em', 'is', null)
    .lte('trial_termina_em', limite);

  for (const t of trials ?? []) {
    const ownerId = await donoDaAssinatura(sb, t);
    if (!ownerId) continue;
    const venc = t.trial_termina_em as string;
    const { error } = await sb.from('notifications').upsert({
      owner_user_id: ownerId,
      company_id: t.company_id,
      tipo: 'assinatura_trial_acabando',
      severidade: 'warning',
      titulo: 'Seu período de teste está acabando',
      corpo: `O teste termina em ${venc.split('-').reverse().join('/')}. Assine para continuar usando.`,
      action_href: t.contabilidade_id ? '/contador/assinatura' : '/conta/assinatura',
      chave: `trial_acabando:${t.id}:${venc}`,
    }, { onConflict: 'owner_user_id,chave', ignoreDuplicates: true });
    if (error) {
      resumo.erros++;
      console.error('[cron billing] aviso de trial falhou', t.id, error.message);
    } else {
      resumo.avisos++;
    }
  }

  // ────────────────────────────── 4. cobrancas do escritorio (Bloco 4B)
  //
  // POR ULTIMO, pelo mesmo motivo que `rodarBilling` roda por ultimo dentro de
  // /api/cron/obrigacoes: e a etapa com mais chamadas HTTP (uma pagina por vez,
  // por escritorio) e um Asaas lento nao pode consumir o tempo da invocacao
  // antes das etapas com prazo. E dinheiro DO ESCRITORIO, nao da Balu: nada
  // aqui alimenta o gate de inadimplencia.
  //
  // `try` proprio porque `rodarBilling` tem um chamador que ja captura tudo
  // (obrigacoes/route.ts) e outro que nao (billing/route.ts) — e uma falha na
  // varredura do 4B nao pode apagar o resumo das tres etapas anteriores, que ja
  // aconteceram no banco.
  try {
    resumo.escritorio = await sincronizarCobrancasEscritorio();
  } catch (err) {
    resumo.erros++;
    console.error('[cron billing] varredura do 4B falhou por inteiro', err);
  }

  return resumo;
}
