// Bloco 4B — O CORACAO DO BLOCO: a cobranca do escritorio nascendo NA SUBCONTA
// dele.
//
// ┌─ O PRINCIPIO, QUE NAO SE NEGOCIA (spec §1) ────────────────────────────┐
// │ A Balu NAO intermedia dinheiro de terceiro. A cobranca tem de nascer   │
// │ na subconta do escritorio: o credor e ele, e o dinheiro liquida na     │
// │ conta dele. Se sair pela chave da conta-mae, ela nasce pertencendo a   │
// │ Balu — e o bloco inteiro perde o sentido. A prova disso e consultar a  │
// │ cobranca PELA CONTA-MAE e receber 404.                                 │
// └────────────────────────────────────────────────────────────────────────┘
//
// POR QUE UM MODULO SO, E NAO O CODIGO DENTRO DE CADA ACTION: ha dois caminhos
// de emissao (servico avulso e honorario) e havera mais. Cada copia e uma
// chance de alguem escrever `asaas` no lugar de `asaasSub`, de esquecer o gate,
// ou de deixar a chave escapar num log. Aqui existe UMA porta: quem emite passa
// por ela ou nao emite.
//
// Mora em lib/ e nao no arquivo 'use server' porque nao e Server Action: e
// chamada por duas, e arquivo 'use server' so pode exportar funcao async
// serializavel (tipo/constante exportado de la quebra no `next build` sem o
// `tsc --noEmit` reclamar).
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { asaasSub } from '@/lib/clients/asaas';
import { registrarAuditoria } from '@/lib/security/audit';
import { lerCredencial } from '@/lib/billing/credencial-subconta';
import { assertAssinaturaEscritorio } from '@/lib/billing/gate';
import { statusDoErroAsaas } from '@/lib/billing/subconta-erros';
import { cobrancaViva } from '@/lib/billing/cobranca-escritorio';
import { soDigitos } from '@/lib/billing/subconta';

export type ClienteCobravel = {
  id: string;
  nome: string;
  /** Documento COMO ESTA NO BANCO — a normalizacao acontece aqui dentro. */
  cpfCnpj: string;
  email: string | null;
};

export type PedidoEmissao = {
  contabilidadeId: string;
  userId: string;
  cliente: ClienteCobravel;
  descricao: string;
  valorCentavos: number;
  /** YYYY-MM-DD. */
  vencimento: string;
  /** Preenchido no caminho do catalogo; `null` no do honorario. */
  servicoAvulsoId: string | null;
  /** Preenchido no caminho do honorario; `null` no do avulso. Ver LIGACAO
   *  CANONICA no cabecalho de `cobrar-actions.ts` dos honorarios. */
  honorarioId: string | null;
  /**
   * UUID gerado PELO NAVEGADOR, uma vez por abertura do formulario de cobranca
   * avulsa, e renovado so apos uma emissao bem-sucedida.
   *
   * Ela nao descreve O QUE se cobra — descreve QUAL SUBMISSAO esta se repetindo.
   * Cobrar duas vezes o mesmo servico do mesmo cliente e legitimo (dois meses de
   * consultoria, duas certidoes para dois socios), entao nao ha chave natural no
   * avulso: dois cliques na MESMA tela colidem, e "cobrar de novo" (tela nova,
   * chave nova) emite.
   *
   * `null` no caminho do honorario, que ja tem chave natural (`honorarioId`), e
   * `null` tambem em qualquer chamador que ainda nao a mande — e AI NAO HA
   * TRAVA NENHUMA contra duplo clique. Ver IDEMPOTENCIA, abaixo.
   */
  idempotencyKey: string | null;
};

export type ResultadoEmissao =
  | { ok: true; cobrancaId: string; chargeId: string; linkFatura: string | null }
  // `linkFatura` na RECUSA nao e enfeite: quando a recusa e "isto ja foi
  // emitido", o contador precisa CHEGAR na cobranca que bloqueou — para
  // conferir o valor, reenviar ao cliente ou estorna-la. Sem o link, a unica
  // saida e cacar no Asaas. Mesma forma de `CobrarHonorarioResult`.
  | { ok: false; error: string; linkFatura?: string | null };

/** Mensagem unica para "o Asaas nao respondeu como devia". Nunca repassa o
 *  texto do Asaas: o corpo de erro dele carrega dado do cliente e, no caminho
 *  da subconta, a mensagem passa perto da chave. */
const ERRO_ASAAS = 'Não foi possível emitir a cobrança agora. Tente de novo em instantes.';

/**
 * Cliente do Asaas correspondente a empresa, reusando o cadastro anterior.
 *
 * `POST /v3/customers` nao deduplica: sem esta busca, cada emissao criaria um
 * cadastro novo e a agenda de clientes DO ESCRITORIO viraria lixo em poucos
 * meses. Best-effort de proposito — se a busca falhar por qualquer motivo,
 * cai-se no comportamento antigo (criar) em vez de recusar a emissao.
 *
 * A conferencia do documento no resultado nao e paranoia: e o que garante que,
 * se um dia o filtro do Asaas mudar de nome e a rota devolver "os 10 primeiros
 * clientes", nao se cobre a pessoa errada.
 */
async function clienteNaSubconta(
  sub: ReturnType<typeof asaasSub>, nome: string, doc: string, email: string | null,
): Promise<string> {
  try {
    const { data } = await sub.buscarClientesPorDocumento(doc);
    const achado = (data ?? []).find((c) => soDigitos(c.cpfCnpj ?? '') === doc);
    if (achado?.id) return achado.id;
  } catch (e) {
    console.error('[4b] busca de cliente na subconta falhou, criando novo:', mensagemCurta(e));
  }
  const criado = await sub.criarCliente({ name: nome, cpfCnpj: doc, email: email ?? undefined });
  return criado.id;
}

/**
 * Trechos que so podem ser credencial, redigidos ANTES do corte.
 *
 * TRUNCAR NAO E SANITIZAR: a chave costuma vir no COMECO da mensagem (`fetch
 * failed: access_token=...`), dentro dos 200 caracteres que sobrevivem ao
 * `.slice`. Cortar o fim so garante que a mensagem e curta, nao que ela e
 * segura.
 */
const PADROES_CREDENCIAL: RegExp[] = [
  // `access_token=...`, `apiKey: ...`, `authorization=...` — o nome do header
  // JUNTO com o valor: sem isto sobraria `access_token=` seguido do segredo.
  /\b(access[_-]?token|api[_-]?key|authorization|token)\b\s*[:=]\s*\S+/gi,
  // A chave do Asaas tem prefixo proprio e nao aparece em texto legitimo. Pega
  // tambem a chave SOLTA, sem nome de header na frente — que e como ela sai de
  // um erro que so ecoa o valor.
  /\$aact[\w-]*/gi,
  // Esquemas de Authorization que chegam a aparecer em erro de proxy.
  /\b(bearer|basic)\s+[\w.\-+/=]+/gi,
];

/** Texto de erro seguro para log: REDIGIDO primeiro, truncado depois, e nunca
 *  o objeto inteiro. */
function mensagemCurta(e: unknown): string {
  const bruto = e instanceof Error ? e.message : String(e);
  const limpo = PADROES_CREDENCIAL.reduce((t, re) => t.replace(re, '[REDIGIDO]'), bruto);
  return limpo.slice(0, 200);
}

// ═══════════════════════════════════════════════════════════════════════════
// IDEMPOTENCIA — POR QUE A ARBITRAGEM ACONTECE ANTES DO ASAAS
// ═══════════════════════════════════════════════════════════════════════════
//
// ┌─ O ACHADO QUE DESENHOU ISTO ────────────────────────────────────────────┐
// │ Botao desabilitado nao alcanca duas abas nem POST direto: o banco e o   │
// │ unico lugar onde duas requisicoes simultaneas se encontram. Mas os      │
// │ INDICES UNICOS da 0055 arbitram tarde demais — eles recusam a segunda   │
// │ LINHA, e a essa altura os dois boletos JA NASCERAM no Asaas. O segundo  │
// │ ficaria ORFAO: sem linha, o webhook o trata como 'cobranca_desconhecida'│
// │ e ele some do painel, mas continua na mao do cliente do escritorio.     │
// │ Isso e PIOR que o estado anterior (duplicado, porem rastreado).         │
// │                                                                         │
// │ Entao a arbitragem tem de acontecer ANTES da chamada ao Asaas:          │
// │                                                                         │
// │   1. RESERVA  — `reservar_emissao_cobranca` (0055) toma um trinco na    │
// │      chave desta emissao. Quem perde a corrida NAO FALA COM O ASAAS.    │
// │   2. PRE-CHECAGEM — so DEPOIS de ter o trinco se pergunta ao banco se   │
// │      ja existe cobranca. A ordem importa: perguntar antes de reservar    │
// │      deixa a janela em que o vencedor commita entre a pergunta e a       │
// │      reserva do perdedor — e o segundo boleto nasce.                     │
// │   3. INDICES  — rede de baixo. Se algo escapar dos dois passos acima, a  │
// │      LINHA duplicada ainda e recusada, e o 23505 vira mensagem em        │
// │      portugues (nunca erro cru de Postgres na tela) mais auditoria do    │
// │      boleto orfao.                                                       │
// └─────────────────────────────────────────────────────────────────────────┘
//
// ┌─ A RESERVA NAO PODE VIRAR LAPIDE ───────────────────────────────────────┐
// │ Se o Asaas falhar (ou o processo morrer) depois da reserva, o contador  │
// │ nao pode ficar trancado. Duas defesas, nesta ordem:                     │
// │                                                                         │
// │  * TTL. Toda reserva expira em `TTL_RESERVA_SEGS` e e ROUBADA pelo      │
// │    pedido seguinte (ON CONFLICT ... WHERE expira_em < now(), na 0055).  │
// │    Vale mesmo se este processo for morto no meio — deploy, timeout da   │
// │    Vercel, queda de rede. O pior caso e "trancado por 2 minutos", nunca │
// │    "trancado para sempre".                                              │
// │  * LIBERACAO EXPLICITA, e SO QUANDO SE SABE QUE NADA NASCEU:            │
// │      - sucesso (a linha ja esta gravada, e o indice assume a guarda);   │
// │      - recusa 4xx do Asaas (ele respondeu "nao" — nada foi criado);     │
// │      - falha ao cadastrar o cliente (acontece antes da cobranca);       │
// │      - pre-checagem que bloqueou (nem chegamos ao Asaas);               │
// │      - 23505 (a cobranca que bloqueia ja esta no banco, guardando).     │
// │    NAO se libera depois de erro AMBIGUO — 5xx, timeout, resposta 200    │
// │    sem id — porque ali a cobranca PODE ter nascido, e devolver o trinco │
// │    na hora transformaria o proximo clique num segundo boleto certo. Ali │
// │    o TTL decide, e o contador espera dois minutos em vez de mandar dois │
// │    boletos.                                                             │
// └─────────────────────────────────────────────────────────────────────────┘

/** Vive mais que qualquer chamada ao Asaas (o cliente tenta 3x com backoff) e
 *  menos que a paciencia de quem clicou. Curto demais e a reserva vence com a
 *  emissao ainda em voo, e o segundo clique a rouba: volta o duplo boleto. */
const TTL_RESERVA_SEGS = 120;

type Reserva = { chave: string; dono: string };

const EMISSAO_EM_ANDAMENTO =
  'Esta cobrança já está sendo emitida agora mesmo. Espere alguns segundos e confira a fatura antes de tentar de novo.';
const NAO_DA_PARA_CONFERIR =
  'Não foi possível confirmar se esta cobrança já foi emitida. Tente de novo em instantes.';
const JA_EMITIDA_EM_ABERTO =
  'Este honorário já tem uma cobrança em aberto. Estorne-a antes de emitir outra.';
const JA_EMITIDA_PAGA =
  'Este honorário já tem uma cobrança PAGA. Estorne-a antes de emitir outra.';
const JA_EMITIDA_SUBMISSAO =
  'Esta cobrança já foi emitida — confira a fatura. Para cobrar de novo, abra o formulário outra vez.';
/** O 23505 e a rede de baixo: se ele mordeu, a cobranca ja nasceu no Asaas e
 *  NAO foi gravada. O contador precisa saber disso antes de mandar o boleto. */
const DUPLICADA_APOS_ASAAS =
  'Esta cobrança já estava emitida. Pode ter nascido uma segunda cobrança no Asaas sem ficar registrada aqui — confira no Asaas antes de enviar ao cliente e avise o suporte da Balu.';

/**
 * A chave que identifica ESTA emissão para o trinco, ou `null` quando não há
 * nenhuma — e aí não existe trava alguma contra duplo clique.
 *
 * O honorário tem chave NATURAL e por isso vem primeiro: ele descreve a dívida,
 * e vale mesmo entre telas diferentes. A do avulso descreve a submissão.
 *
 * Minúsculas de propósito: `z.string().uuid()` aceita hexadecimal MAIÚSCULO, e o
 * CHECK de formato da 0055 (`[0-9a-f]`) não — sem isto, uma chave em maiúsculas
 * vinda do navegador viraria erro cru de Postgres na tela do contador.
 */
function chaveDeReserva(p: PedidoEmissao): string | null {
  if (p.honorarioId) return `hon:${p.honorarioId.toLowerCase()}`;
  const k = p.idempotencyKey?.trim().toLowerCase();
  return k ? `idem:${k}` : null;
}

/**
 * Toma o trinco. `'perdeu'` = outro pedido está emitindo isto agora.
 *
 * FALHA FECHADA, ao contrário de `limitar()` (rate-limit), que falha aberta: lá
 * o pior caso é um request a mais; aqui é um BOLETO REAL a mais na mão do
 * cliente do escritório. Sem conseguir falar com o trinco, não se emite.
 */
async function reservarEmissao(
  sb: SupabaseClient, contabilidadeId: string, chave: string,
): Promise<{ ok: true; reserva: Reserva } | { ok: false; motivo: 'perdeu' | 'indisponivel' }> {
  const { data, error } = await sb.rpc('reservar_emissao_cobranca', {
    p_contabilidade: contabilidadeId, p_chave: chave, p_ttl_segs: TTL_RESERVA_SEGS,
  });
  if (error) {
    console.error('[4b] reserva de emissao indisponivel', contabilidadeId, error.message);
    return { ok: false, motivo: 'indisponivel' };
  }
  if (!data) return { ok: false, motivo: 'perdeu' };
  return { ok: true, reserva: { chave, dono: String(data) } };
}

/**
 * Devolve o trinco. Só é chamada onde se sabe que nenhuma cobrança nasceu —
 * ver a nota LÁPIDE acima.
 *
 * Best-effort: falhar aqui não é erro para o contador, porque a reserva expira
 * sozinha. Silenciar seria pior, então fica no log.
 */
async function liberarReserva(
  sb: SupabaseClient, contabilidadeId: string, r: Reserva | null,
): Promise<void> {
  if (!r) return;
  const { error } = await sb.rpc('liberar_reserva_cobranca', {
    p_contabilidade: contabilidadeId, p_chave: r.chave, p_dono: r.dono,
  });
  if (error) {
    console.error(`[4b] reserva nao liberada (expira em ate ${TTL_RESERVA_SEGS}s)`, r.chave, error.message);
  }
}

type Bloqueio = { motivo: 'honorario'; status: string; linkFatura: string | null }
              | { motivo: 'submissao'; status: string; linkFatura: string | null };

/**
 * A cobrança já gravada que impede esta emissão — ou `null` quando não há.
 *
 * É a pergunta que os índices únicos da 0055 respondem tarde demais, feita
 * ANTES de gastar uma chamada no Asaas. Os dois predicados espelham os dois
 * índices, e divergir deles é o que faz a tela deixar passar o que o banco
 * recusa:
 *  * honorário → só cobrança VIVA bloqueia (`cobrancaViva`), porque estorno
 *    libera a recobrança;
 *  * submissão → QUALQUER linha com a mesma chave bloqueia, sem olhar status:
 *    a chave descreve um POST que se repetiu, não uma dívida.
 *
 * `'indisponivel'` (erro de leitura) NÃO vira "pode emitir": no escuro, emitir
 * pode significar o segundo boleto real; recusar custa um clique.
 *
 * `.eq('contabilidade_id')` em toda consulta porque o admin client ignora RLS —
 * sem ele, a cobrança viva de outro escritório decidiria esta emissão.
 */
async function cobrancaQueBloqueia(
  sb: SupabaseClient, p: PedidoEmissao,
): Promise<Bloqueio | 'indisponivel' | null> {
  const alvo = sb.from('cobrancas_escritorio')
    .select('status, link_fatura')
    .eq('contabilidade_id', p.contabilidadeId);

  if (p.honorarioId) {
    const { data, error } = await alvo.eq('honorario_id', p.honorarioId);
    if (error) {
      console.error('[4b] leitura das cobrancas do honorario falhou', p.honorarioId, error.message);
      return 'indisponivel';
    }
    const linhas = (data ?? []) as Array<{ status: string; link_fatura: string | null }>;
    const viva = linhas.find((l) => cobrancaViva(String(l.status)));
    return viva ? { motivo: 'honorario', status: String(viva.status), linkFatura: viva.link_fatura ?? null } : null;
  }

  const k = p.idempotencyKey?.trim().toLowerCase();
  if (!k) return null;
  const { data, error } = await alvo.eq('idempotency_key', k);
  if (error) {
    console.error('[4b] leitura da chave de idempotencia falhou', p.contabilidadeId, error.message);
    return 'indisponivel';
  }
  const linhas = (data ?? []) as Array<{ status: string; link_fatura: string | null }>;
  return linhas[0]
    ? { motivo: 'submissao', status: String(linhas[0].status), linkFatura: linhas[0].link_fatura ?? null }
    : null;
}

/** A frase para o contador quando algo já emitido bloqueia esta emissão. */
function mensagemDoBloqueio(b: Bloqueio): string {
  if (b.motivo === 'submissao') return JA_EMITIDA_SUBMISSAO;
  return b.status === 'paga' ? JA_EMITIDA_PAGA : JA_EMITIDA_EM_ABERTO;
}

/**
 * Emite a cobrança e grava a linha em `cobrancas_escritorio`.
 *
 * Pressupõe que quem chama JÁ provou duas coisas, porque só quem chama sabe
 * como prová-las: que a sessão é de um escritório aprovado, e que o cliente
 * está na carteira DELE. Tudo o mais — gate, KYC da subconta, credencial,
 * Asaas, persistência e auditoria — é responsabilidade daqui.
 */
export async function emitirCobrancaEscritorio(
  sb: SupabaseClient, p: PedidoEmissao,
): Promise<ResultadoEmissao> {
  // ─── GATE DE INADIMPLENCIA ────────────────────────────────────────────────
  // Decisao do usuario (27/07), na mesma forma das duas fronteiras do 4A:
  // BLOQUEIA CRIAR COBRANCA NOVA, e NUNCA alcanca ver, sincronizar ou receber
  // as ja emitidas. Dinheiro que o cliente ja deve ao escritorio precisa
  // continuar entrando — inclusive porque e com ele que o escritorio paga a
  // Balu. Por isso o gate mora AQUI, na unica porta de criacao, e nao no
  // webhook, no cron nem nas telas de consulta.
  const gate = await assertAssinaturaEscritorio(p.contabilidadeId);
  if (!gate.ok) return { ok: false, error: gate.error };

  if (!(p.valorCentavos > 0)) return { ok: false, error: 'Informe o valor da cobrança.' };
  if (!p.descricao.trim()) return { ok: false, error: 'Descreva o que está sendo cobrado.' };

  const doc = soDigitos(p.cliente.cpfCnpj);
  if (doc.length !== 11 && doc.length !== 14) {
    return { ok: false, error: 'Este cliente está sem CNPJ/CPF válido no cadastro — corrija antes de cobrar.' };
  }

  // ─── CREDENCIAL ───────────────────────────────────────────────────────────
  // `.eq('id', ...)` com o id DO CONTEXTO e a unica coisa que impede um
  // escritorio de emitir com a chave de outro: o admin client ignora RLS.
  const { data: cont, error: erroCont } = await sb
    .from('contabilidades')
    .select('id, asaas_subconta_status, asaas_api_key_cifrada')
    .eq('id', p.contabilidadeId).maybeSingle();
  if (erroCont) {
    console.error('[4b] leitura da subconta falhou:', p.contabilidadeId, erroCont.message);
    return { ok: false, error: 'Não foi possível ler a conta de recebimento do escritório. Tente de novo.' };
  }
  if (cont?.asaas_subconta_status !== 'aprovada') {
    return { ok: false, error: 'A conta de recebimento do escritório ainda não está aprovada.' };
  }

  // LEITURA DENTRO DO `try`. `lerCredencial` LANCA quando o valor gravado nao
  // tem o prefixo `enc:v1:` — para a apiKey da subconta nao ha legado, entao
  // valor sem cifra so pode ser gravacao corrompida. Fora do try, a excecao
  // escaparia da Server Action como erro generico do Next e este ramo, com a
  // mensagem que manda falar com o suporte, ficaria inalcancavel.
  let token: string | null;
  try {
    token = lerCredencial(cont.asaas_api_key_cifrada);
  } catch {
    // Sem a chave no log, nem mascarada: um banco com o segredo em claro nao
    // vira uma segunda copia dele no arquivo de log.
    console.error('[4b] credencial da subconta ilegivel', p.contabilidadeId);
    return { ok: false, error: 'A credencial da conta de recebimento está ilegível. Fale com o suporte da Balu.' };
  }
  if (!token) {
    return { ok: false, error: 'A credencial da conta de recebimento não está guardada. Fale com o suporte da Balu.' };
  }

  // ─── RESERVA: A ARBITRAGEM, ANTES DE QUALQUER COISA NO ASAAS ──────────────
  // Ver o bloco IDEMPOTENCIA acima. Sem chave (chamador que ainda nao a manda)
  // nao ha trinco — e nao ha trava contra duplo clique.
  const chave = chaveDeReserva(p);
  let reserva: Reserva | null = null;
  if (chave) {
    const r = await reservarEmissao(sb, p.contabilidadeId, chave);
    if (!r.ok) {
      return {
        ok: false,
        error: r.motivo === 'perdeu' ? EMISSAO_EM_ANDAMENTO : NAO_DA_PARA_CONFERIR,
      };
    }
    reserva = r.reserva;
  }

  // ─── PRE-CHECAGEM, JA COM O TRINCO NA MAO ─────────────────────────────────
  // DEPOIS da reserva, nunca antes: perguntar primeiro deixaria a janela em que
  // o vencedor da corrida commita a linha entre a pergunta e a reserva do
  // perdedor — e o perdedor emitiria o segundo boleto.
  const bloqueio = await cobrancaQueBloqueia(sb, p);
  if (bloqueio) {
    await liberarReserva(sb, p.contabilidadeId, reserva);
    if (bloqueio === 'indisponivel') return { ok: false, error: NAO_DA_PARA_CONFERIR };
    return { ok: false, error: mensagemDoBloqueio(bloqueio), linkFatura: bloqueio.linkFatura };
  }

  // ─── A COBRANCA NASCE NA SUBCONTA ─────────────────────────────────────────
  // `asaasSub(token)`, JAMAIS `asaas`. Com o cliente da conta-mae a cobranca
  // nasceria pertencendo a Balu, e a Balu estaria intermediando dinheiro de
  // terceiro. O token e usado e descartado aqui dentro: nunca vai para variavel
  // de modulo, log, auditoria ou retorno.
  const sub = asaasSub(token);

  // O cadastro do cliente e um `try` PROPRIO porque falhar aqui e o unico erro
  // do Asaas que nao e ambiguo: ele acontece ANTES de `criarCobranca`, entao
  // nenhuma cobranca nasceu e o trinco volta na hora.
  let customerId: string;
  try {
    customerId = await clienteNaSubconta(sub, p.cliente.nome, doc, p.cliente.email);
  } catch (e) {
    console.error('[4b] cadastro do cliente na subconta falhou:', mensagemCurta(e));
    await liberarReserva(sb, p.contabilidadeId, reserva);
    return { ok: false, error: ERRO_ASAAS };
  }

  let cobranca;
  try {
    cobranca = await sub.criarCobranca({
      customer: customerId,
      billingType: 'UNDEFINED',        // o cliente escolhe boleto/Pix/cartao na fatura
      value: p.valorCentavos / 100,
      dueDate: p.vencimento,
      description: p.descricao.trim(),
      externalReference: `${p.contabilidadeId}:${p.cliente.id}`,
    });
  } catch (e) {
    // A chave pode aparecer numa mensagem de erro de rede; nunca repassar.
    console.error('[4b] emitir cobranca falhou:', mensagemCurta(e));
    // 4xx = o Asaas RESPONDEU e RECUSOU: nada nasceu do outro lado, e segurar o
    // trinco so faria o contador esperar para corrigir o dado e tentar de novo.
    // 5xx, timeout e DNS nao dizem nada sobre o que aconteceu la — ali o trinco
    // FICA e expira sozinho (ver LAPIDE). Mesma leitura de `statusDoErroAsaas`
    // que decide a subconta orfa no 4B.
    const status = statusDoErroAsaas(e);
    if (status !== null && status >= 400 && status < 500) {
      await liberarReserva(sb, p.contabilidadeId, reserva);
    }
    return { ok: false, error: ERRO_ASAAS };
  }
  if (!cobranca?.id) {
    // O Asaas respondeu 2xx sem id: o contrato mudou e a cobranca provavelmente
    // NASCEU. Caso ambiguo — o trinco fica e expira sozinho.
    console.error('[4b] Asaas respondeu sem id de cobranca', p.contabilidadeId);
    return { ok: false, error: ERRO_ASAAS };
  }

  // ─── PERSISTENCIA ─────────────────────────────────────────────────────────
  // A cobranca JA EXISTE no Asaas neste ponto. Falhar aqui nao a desfaz — por
  // isso o erro diz para conferir antes de repetir, e nao "tente de novo".
  // `asaas_charge_id` e UNIQUE (0053) e a 0055 acrescentou mais dois indices
  // unicos: 23505 aqui e a REDE DE BAIXO mordendo, tratada logo abaixo.
  const { data: linha, error } = await sb.from('cobrancas_escritorio').insert({
    contabilidade_id: p.contabilidadeId,
    empresa_cliente_id: p.cliente.id,
    honorario_id: p.honorarioId,
    servico_avulso_id: p.servicoAvulsoId,
    asaas_charge_id: cobranca.id,
    descricao: p.descricao.trim(),
    status: 'pendente',
    valor_centavos: p.valorCentavos,
    vencimento: p.vencimento,
    link_fatura: cobranca.invoiceUrl ?? null,
    // Grava a chave da SUBMISSAO, e nao a do honorario: o `hon:` ja tem indice
    // proprio, e escrever os dois faria a mesma divida ser guardada por duas
    // chaves diferentes. NULL fica fora do indice unico parcial.
    idempotency_key: p.honorarioId ? null : (p.idempotencyKey?.trim().toLowerCase() ?? null),
  }).select('id').maybeSingle();

  // ─── 23505: A REDE DE BAIXO MORDEU ────────────────────────────────────────
  // So se chega aqui se a reserva e a pre-checagem falharam em ver o que o
  // indice viu (escrita fora do app, linha legada, chave de outra origem). A
  // cobranca JA NASCEU no Asaas e nao vai ser gravada: e o boleto orfao. Nunca
  // pode sair como erro cru de Postgres na tela — vira frase em portugues, com
  // o link da cobranca QUE BLOQUEOU para o contador conseguir ver qual e, mais
  // uma auditoria propria para o boleto orfao nao sumir do mundo.
  if (error?.code === '23505') {
    console.error('[4b] COBRANCA EMITIDA E RECUSADA POR UNICIDADE', cobranca.id, error.message);
    const jaExiste = await cobrancaQueBloqueia(sb, p);
    await registrarAuditoria({
      actorUserId: p.userId, acao: 'cobranca_escritorio.duplicada_bloqueada',
      alvoTipo: 'company', alvoId: p.cliente.id, contabilidadeId: p.contabilidadeId,
      meta: {
        charge_id: cobranca.id, valor_centavos: p.valorCentavos,
        honorario_id: p.honorarioId, servico_avulso_id: p.servicoAvulsoId,
        idempotency_key: p.idempotencyKey ?? null, restricao: error.message,
      },
    });
    // A linha que bloqueia ja esta no banco e guarda o alvo daqui em diante: o
    // trinco cumpriu o papel e volta.
    await liberarReserva(sb, p.contabilidadeId, reserva);
    return {
      ok: false,
      error: DUPLICADA_APOS_ASAAS,
      linkFatura: jaExiste && jaExiste !== 'indisponivel' ? jaExiste.linkFatura : null,
    };
  }

  if (error || !linha) {
    console.error('[4b] COBRANCA EMITIDA E NAO GRAVADA', cobranca.id, error?.message ?? 'sem linha');
    // Sem este registro, existe no Asaas uma cobranca que o app nao conhece: o
    // webhook a descartaria como 'cobranca_desconhecida' e o cliente receberia
    // um boleto que o painel do escritorio nunca mostra.
    await registrarAuditoria({
      actorUserId: p.userId, acao: 'cobranca_escritorio.nao_gravada',
      alvoTipo: 'company', alvoId: p.cliente.id, contabilidadeId: p.contabilidadeId,
      meta: {
        charge_id: cobranca.id, valor_centavos: p.valorCentavos,
        honorario_id: p.honorarioId, servico_avulso_id: p.servicoAvulsoId,
        erro: error?.message ?? 'insert sem linha',
      },
    });
    // O TRINCO FICA, de proposito. A cobranca existe no Asaas e NAO existe no
    // banco: nem a linha nem o indice guardam este alvo, e devolver o trinco
    // agora faria o proximo clique emitir o segundo boleto de verdade. O TTL
    // solta em ate `TTL_RESERVA_SEGS` — tempo de o contador ler a frase abaixo
    // e ir conferir no Asaas, que e exatamente o que ela manda fazer.
    return {
      ok: false,
      error: 'A cobrança foi emitida no Asaas mas não pôde ser registrada aqui. Confira no Asaas antes de emitir de novo e avise o suporte da Balu.',
    };
  }

  // Gravado. Daqui em diante quem guarda o alvo sao os indices unicos da 0055 —
  // a linha do honorario, ou a `idempotency_key` da submissao. O trinco ja nao
  // tem o que proteger e volta na hora, para o contador nao esperar o TTL numa
  // recobranca legitima.
  await liberarReserva(sb, p.contabilidadeId, reserva);

  await registrarAuditoria({
    actorUserId: p.userId, acao: 'cobranca_escritorio.emitida',
    alvoTipo: 'company', alvoId: p.cliente.id, contabilidadeId: p.contabilidadeId,
    // Sem a chave, sem o token, sem o corpo do Asaas.
    meta: {
      cobranca_id: linha.id, charge_id: cobranca.id,
      valor_centavos: p.valorCentavos, vencimento: p.vencimento,
      descricao: p.descricao.trim(),
      honorario_id: p.honorarioId, servico_avulso_id: p.servicoAvulsoId,
    },
  });

  return {
    ok: true, cobrancaId: linha.id, chargeId: cobranca.id,
    linkFatura: cobranca.invoiceUrl ?? null,
  };
}

/**
 * O cliente, se ele estiver na carteira DESTE escritório.
 *
 * `null` tanto para "não existe" quanto para "existe mas é de outro escritório"
 * — mesma forma de `companyDaCarteira` (lib/contador/carteira.ts), que não serve
 * aqui porque a emissão precisa também de nome, documento e e-mail. O caller
 * responde a mesma frase nos dois casos, sem revelar a diferença.
 */
export async function clienteDaCarteira(
  sb: SupabaseClient, contabilidadeId: string, companyId: string,
): Promise<ClienteCobravel | null> {
  const { data } = await sb
    .from('companies')
    .select('id, nome, razao_social, cnpj, email, contabilidade_id, deleted_at')
    .eq('id', companyId).maybeSingle();
  const c = data as {
    id: string; nome: string | null; razao_social: string | null; cnpj: string | null;
    email: string | null; contabilidade_id: string | null; deleted_at: string | null;
  } | null;
  if (!c || c.contabilidade_id !== contabilidadeId || c.deleted_at) return null;
  return {
    id: c.id,
    // `nome` e o apelido que a carteira usa; `razao_social` e o nome de
    // documento. Cair para o segundo evita mandar string vazia ao Asaas.
    nome: (c.nome?.trim() || c.razao_social?.trim()) ?? '',
    cpfCnpj: c.cnpj ?? '',
    email: c.email,
  };
}
