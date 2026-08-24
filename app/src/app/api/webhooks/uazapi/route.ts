// Bloco 6B — Webhook de entrada da uazapi: atendimento por IA + escalação.
// Mesma forma do webhook do Asaas: segredo → rate-limit → corpo inteiro num
// try/catch → SEMPRE HTTP 200 (a uazapi pode reenfileirar/reenviar em erro,
// e não queremos loop nem desativação do canal por 5xx).
//
// SEGREDO ANTES do rate-limit (ao contrário do esqueleto original do plano):
// `limitar` é chaveado por `entrada.from`, campo do corpo — não autenticado.
// Rate-limitar antes do segredo deixaria qualquer um estourar o orçamento do
// NÚMERO DE UM CLIENTE REAL sem precisar conhecer o segredo nenhum.
//
// ⚠️ ENVIO confirmado em 12/08/2026 (ver lib/uazapi/cliente.ts), mas o formato
// do payload de ENTRADA continua sendo hipótese: `messageId`/`from`/`text`.
// Só uma mensagem recebida de verdade confirma — e isso exige alguém escrever
// para o número conectado. Até lá, o aviso fica.
//
// ═══ TASK 6 STEP 1 — SONDAGEM: quem é "o contador" de uma empresa ═══
//
// Não existe uma coluna/tabela única "o contador desta empresa". O caminho
// real, lido em `lib/billing/titular.ts` e `contador/equipe/EquipeClient.tsx`
// mais o schema de `contabilidade_membros`:
//
//   companies.contabilidade_id (nullable)
//     -> NULL:       empresa self-service, sem escritório — não há a quem
//                    escalar (estado legítimo, não um erro).
//     -> não-nulo:   empresa "coberta" por um escritório. O TIME desse
//                    escritório é `contabilidade_membros(contabilidade_id,
//                    user_id, created_at)` — SEM qualquer coluna de
//                    dono/role/"primary". A tela `contador/equipe` (ver
//                    `equipe/page.tsx:19-22`) lista todos os membros como
//                    pares, ordenados por `created_at` ascendente, sem
//                    tratamento especial para o primeiro.
//
// Decisão: notificar o MEMBRO MAIS ANTIGO (`ORDER BY created_at ASC LIMIT 1`),
// não a lista inteira. Esta não é uma escolha nova — é o MESMO padrão que já
// existe em `lib/billing/cron.ts` (`donoDaAssinatura`), usado para decidir
// quem recebe a notificação de trial acabando / cobrança vencida quando a
// assinatura é de um escritório. Seguir o precedente já estabelecido é mais
// simples e mais consistente do que inventar "notificar todos os membros"
// para este caso específico — e evita N notificações (uma por membro) para
// o mesmo evento, que o resto do app não faz em lugar nenhum.
//
// Se o escritório não tiver NENHUM membro (carteira vazia, estado incomum
// mas possível), a escalação é pulada com log — nunca inventamos um
// destinatário. O registro em `whatsapp_atendimentos` acontece de qualquer
// forma, então a auditoria não se perde mesmo sem notificação.
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { segredoDaQuery } from '../segredo';
import { limitar } from '@/lib/security/rate-limit';
import { buscarSituacaoAtualMei } from '@/lib/explicacoes/situacao-atual-mei';
import { montarPromptAtendimento, comSaudacao } from '@/lib/atendimento/prompt';
import { gerarTexto } from '@/lib/ai/cliente';
import { lerChaveIa } from '@/lib/ai/config-ia';
import { enviarMensagem, type ConfigUazapi } from '@/lib/uazapi/cliente';
import {
  escritorioPorWebhookToken, escritorioPorId, configDaPlataforma, type EscritorioDoCanal,
} from '@/lib/uazapi/instancia';
import { resumoDaCarteira, textoDaCarteira } from '@/lib/atendimento/carteira';
import { getLimitesFiscais } from '@/lib/fiscal/parametros';
import { competenciaReferenciaBrt } from '@/lib/fiscal/guia';
import { variantesDoNumero } from '@/lib/whatsapp/numero';
import { normalizarEntrada, formaDoPayload } from '@/lib/uazapi/payload';
import { buscarContextoPorPergunta } from '@/lib/base-juridica/buscar';
import { lerRespostaAtendimento } from '@/lib/atendimento/resposta';
import {
  classificarPergunta, pareceUmaPergunta, temMarcaPessoal, TERMO_FISCAL, type TipoPergunta,
} from '@/lib/atendimento/classificar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Sem esta linha vale o padrão da plataforma (10s) — e `gerarTexto` esperava
// até 60s. Um modelo lento era MORTO no meio pela Vercel: a função nunca
// chegava a `enviarMensagem`, o cliente ficava sem nada e não sobrava nem log
// do motivo. Agora o teto da função é maior que o da chamada de IA, que é de
// 15s por tentativa (ver `responderComIa`).
export const maxDuration = 60;

// ⚠️ FORMATO REAL NÃO CONFIRMADO — ver aviso de topo do arquivo.
type PayloadUazapi = { messageId: string; from: string; text: string };

type TrocaAnterior = { pergunta: string; resposta: string | null };

/** A recusa neutra. Mesma frase para "não tem cadastro" e para "é cliente de
 *  outro escritório": distinguir as duas já revelaria o vínculo. */
const TEXTO_NAO_IDENTIFICADO =
  'Não conseguimos identificar sua conta. Confirme seu número em Conta > Notificações no app.';

/**
 * "Não precisa de humano" — o carimbo que tira a conversa da fila do escritório.
 *
 * ⚠️ ACHADO DO CODE-REVIEW (19/08/2026). Ao carimbar `contabilidade_id` em TODA
 * linha (necessário para o escopo do histórico), eu quebrei uma invariante que
 * existia antes: até então só a ESCALAÇÃO gravava o escritório, e escalação é
 * justamente o caso que deve esperar um humano.
 *
 * `materializar_sla_estourado` (0070) pega toda linha com `atendido_em IS NULL`
 * unida por `contabilidade_id` e avisa TODOS os membros. Sem este carimbo, um
 * "bom dia" que o bot ignorou de propósito, uma recusa, ou a pergunta do próprio
 * contador virariam "um cliente aguarda resposta há Nh" para a equipe inteira.
 *
 * Fica NULO só quando a IA não resolveu e o contador foi acionado — que é o
 * único caso em que o relógio do SLA deve correr.
 */
const agoraIso = () => new Date().toISOString();

/** Recusa por cadastro duplicado. Constante para o que foi ENVIADO e o que é
 *  GRAVADO não poderem divergir. */
const TEXTO_AMBIGUO =
  'Encontramos mais de um cadastro com este número e, por segurança, não vamos '
  + 'responder com dados de nenhum deles. Fale com seu contador para corrigir o cadastro.';

type PerfilCasado = { user_id: string; current_company: string | null; whatsapp_numero: string | null };

/**
 * Quem escreveu é MEMBRO do escritório dono do canal? (modo ESCRITÓRIO)
 *
 * Consultado por `contabilidade_id` + os user_ids que casaram com o telefone —
 * nunca "todos os membros", que traria a equipe inteira para a memória por uma
 * mensagem só.
 */
async function membroDoEscritorio(
  admin: SupabaseClient, contabilidadeId: string, perfis: PerfilCasado[],
): Promise<PerfilCasado | null> {
  if (!perfis.length) return null;
  const { data } = await admin
    .from('contabilidade_membros').select('user_id')
    .eq('contabilidade_id', contabilidadeId)
    .in('user_id', perfis.map((p) => p.user_id));

  const ids = new Set(((data ?? []) as { user_id: string }[]).map((m) => m.user_id));
  return perfis.find((p) => ids.has(p.user_id)) ?? null;
}

/**
 * A TRAVA: dos perfis que casaram com o telefone, quais podem ser atendidos
 * NESTE canal.
 *
 * Canal de escritório → só empresa daquele escritório. Perfil de outro
 * escritório some daqui e cai no ramo "sem cadastro", que é a recusa neutra:
 * confirmar que a pessoa é cliente de outra contabilidade já seria vazamento.
 *
 * Canal da plataforma → empresa SEM escritório (decisão D8) **e**, durante a
 * virada, empresa cujo escritório ainda não conectou canal próprio. Sem essa
 * segunda metade existiria uma janela em que o cliente não é atendido em lugar
 * nenhum: o escritório dele ainda não tem número, e a plataforma já o recusa.
 * Quando o escritório conecta, o cliente migra sozinho — sem script de
 * migração e sem data marcada.
 */
async function clientesDoCanal(
  admin: SupabaseClient, perfis: PerfilCasado[], escritorio: EscritorioDoCanal | null,
): Promise<PerfilCasado[]> {
  const ids = perfis.map((p) => p.current_company).filter(Boolean) as string[];
  if (!ids.length) return [];

  const { data } = await admin.from('companies').select('id, contabilidade_id').in('id', ids);
  const empresas = (data ?? []) as { id: string; contabilidade_id: string | null }[];
  const contabDe = new Map(empresas.map((c) => [c.id, c.contabilidade_id]));

  if (escritorio) {
    return perfis.filter((p) => p.current_company && contabDe.get(p.current_company) === escritorio.id);
  }

  const comEscritorio = [...new Set(empresas.map((c) => c.contabilidade_id).filter(Boolean))] as string[];
  const jaTemCanalProprio = new Set<string>();
  if (comEscritorio.length) {
    const { data: cs } = await admin
      .from('contabilidades').select('id').in('id', comEscritorio).eq('uazapi_status', 'conectado');
    for (const c of (cs ?? []) as { id: string }[]) jaTemCanalProprio.add(c.id);
  }

  return perfis.filter((p) => {
    if (!p.current_company) return false;
    const cid = contabDe.get(p.current_company) ?? null;
    return !cid || !jaTemCanalProprio.has(cid);
  });
}

/**
 * Últimas trocas do MESMO telefone, do mais antigo para o mais recente — é
 * assim que se lê uma conversa.
 *
 * A própria linha desta mensagem (o claim) é excluída: sem isso toda mensagem
 * se veria como "não é a primeira", porque ela mesma conta.
 */
async function lerHistorico(
  admin: SupabaseClient, telefone: string, atendimentoId: string,
  escopo?: { contabilidadeId?: string | null },
): Promise<TrocaAnterior[]> {
  // ESCOPO, não só telefone (furo B, corrigido em 19/08/2026). Antes daqui a
  // busca era só por `telefone`: um número que trocasse de empresa levaria a
  // conversa antiga para dentro do prompt da nova — vazamento de conteúdo
  // entre carteiras, invisível para todo mundo.
  let q = admin
    .from('whatsapp_atendimentos')
    .select('mensagem_recebida, resposta_enviada, created_at')
    .eq('telefone', telefone)
    .neq('id', atendimentoId);

  // Canal de ESCRITÓRIO filtra pelo escritório. Canal da PLATAFORMA não filtra
  // — e isso é uma correção do code-review de 19/08/2026, não descuido.
  //
  // O `is('contabilidade_id', null)` que estava aqui discordava do resto do
  // fluxo: a escalação carimba o escritório na linha, então a mensagem
  // seguinte do MESMO cliente não encontrava a anterior, `primeiraInteracao`
  // voltava a ser true, a saudação era reenviada e o histórico se perdia —
  // pior a cada mensagem escalada.
  //
  // Não filtrar na plataforma não vaza nada: são conversas do mesmo telefone,
  // e o canal da plataforma só atende quem não tem canal de escritório próprio.
  if (escopo?.contabilidadeId) q = q.eq('contabilidade_id', escopo.contabilidadeId);

  const { data } = await q
    .order('created_at', { ascending: false })
    .limit(4);

  return [...(data ?? [])].reverse().map((a) => ({
    pergunta: (a.mensagem_recebida as string) ?? '',
    resposta: (a.resposta_enviada as string | null) ?? null,
  }));
}

/**
 * A chamada ao provedor de IA, usada pelos DOIS ramos (número cadastrado e
 * dúvida geral de número desconhecido).
 *
 * Está numa função só porque a alternativa — copiar o bloco — deixaria os dois
 * caminhos divergirem em silêncio: a leitura tolerante da resposta, o texto de
 * fallback e o tratamento de chave ausente têm de ser os mesmos nos dois.
 *
 * Nunca lança: qualquer falha vira o fallback com `resolvido:false`, que é o
 * lado seguro (o cliente recebe uma resposta e, quando há escritório, um
 * humano é acionado).
 */
async function responderComIa(
  admin: SupabaseClient,
  e: {
    pergunta: string;
    situacaoFiscalTexto: string | null;
    primeiraInteracao: boolean;
    historico: TrocaAnterior[];
    contextoJuridico: Parameters<typeof montarPromptAtendimento>[0]['contextoJuridico'];
    tipoPergunta: TipoPergunta;
    escritorio?: Parameters<typeof montarPromptAtendimento>[0]['escritorio'];
    carteiraTexto?: string | null;
    /** O que dizer se a IA falhar. Difere por ramo: prometer que "o contador
     *  vai retornar" a um número que não é cliente de escritório nenhum é
     *  mentir para quem escreveu — ninguém vai retornar. */
    textoDeFalha: string;
  },
): Promise<{ resposta: string; resolvido: boolean }> {
  const fallback = { resposta: e.textoDeFalha, resolvido: false };

  const { data: cfgRow } = await admin.from('config_ia').select('*').eq('id', 1).maybeSingle();
  if (!cfgRow) return fallback;

  try {
    const chave = lerChaveIa(cfgRow.chave_cifrada as string | null);
    if (!chave) return fallback;

    const bruto = await gerarTexto(
      { provedor: cfgRow.provedor, modelo: cfgRow.modelo, base_url: cfgRow.base_url, chave },
      montarPromptAtendimento({
        pergunta: e.pergunta,
        situacaoFiscalTexto: e.situacaoFiscalTexto,
        primeiraInteracao: e.primeiraInteracao,
        historico: e.historico,
        contextoJuridico: e.contextoJuridico,
        tipoPergunta: e.tipoPergunta,
        escritorio: e.escritorio ?? null,
        carteiraTexto: e.carteiraTexto ?? null,
      }),
      // Tem gente esperando no WhatsApp: 3 tentativas de 15s, e não uma só de
      // 60s. Um 429 transitório do provedor deixou de virar não-atendimento.
      { tentativas: 3, timeoutMs: 15_000 },
    );

    // Leitura TOLERANTE (lib/atendimento/resposta): o modelo já devolveu a
    // resposta certa com a chave escrita `"resovido"`, e a validação estrita
    // jogou fora um atendimento bom. Falta de conteúdo continua sendo recusada;
    // o que se tolera é grafia de chave.
    const j = lerRespostaAtendimento(bruto);
    if (!j) {
      console.error('[webhook uazapi] resposta da IA em formato inesperado, usando fallback');
      return fallback;
    }
    return { resposta: j.resposta, resolvido: j.resolvido };
  } catch (err) {
    console.error('[webhook uazapi] falha ao gerar resposta:', err instanceof Error ? err.message : String(err));
    return fallback;
  }
}



/**
 * Modo ESCRITÓRIO — quem escreveu é o contador, e a conversa é sobre a carteira
 * dele (decisões D3/D4 de 19/08/2026).
 *
 * NÃO escala: escalar para o contador uma pergunta feita PELO contador seria
 * mandá-lo notificar a si mesmo.
 *
 * O isolamento aqui não depende de instrução no prompt: `resumoDaCarteira` só
 * enxerga o escritório passado por parâmetro, porque o filtro está dentro do
 * SQL de `painel_contador_por_id`.
 */
async function atenderContador(
  admin: SupabaseClient,
  ctx: {
    entrada: { messageId: string; from: string; text: string };
    atendimentoId: string;
    escritorio: EscritorioDoCanal;
    membro: PerfilCasado;
    canal: ConfigUazapi | null;
  },
): Promise<NextResponse> {
  const limites = await getLimitesFiscais(admin);
  const resumo = await resumoDaCarteira(admin, ctx.escritorio.id, limites);
  const historico = await lerHistorico(admin, ctx.entrada.from, ctx.atendimentoId, {
    contabilidadeId: ctx.escritorio.id,
  });

  const gerada = await responderComIa(admin, {
    pergunta: ctx.entrada.text,
    // O contador não tem "situação fiscal própria" — o que ele tem é carteira.
    situacaoFiscalTexto: null,
    primeiraInteracao: historico.length === 0,
    historico,
    contextoJuridico: await buscarContextoPorPergunta(admin, ctx.entrada.text),
    tipoPergunta: 'especifica',
    escritorio: {
      nome: ctx.escritorio.nome,
      slaHoras: ctx.escritorio.slaHoras,
      whatsappSuporte: ctx.escritorio.whatsappSuporte,
    },
    carteiraTexto: resumo ? textoDaCarteira(resumo) : null,
    textoDeFalha: 'Não consegui consultar a carteira agora. Tente de novo em instantes '
      + 'ou abra o painel do escritório.',
  });

  const texto = comSaudacao(gerada.resposta, historico.length === 0);
  const envio = await enviarMensagem(ctx.canal, { telefone: ctx.entrada.from, texto });
  if (!envio.ok) console.error('[webhook uazapi] falha ao enviar resposta:', envio.erro ?? 'desconhecido');

  const { error } = await admin.from('whatsapp_atendimentos')
    .update({
      profile_user_id: ctx.membro.user_id,
      contabilidade_id: ctx.escritorio.id,
      resposta_enviada: texto,
      // Conversa com o próprio contador nasce resolvida: não há terceiro a
      // acionar, e deixar `false` encheria a fila de SLA dele com as próprias
      // perguntas. O `atendido_em` fecha isso no banco, que é onde a RPC do
      // SLA olha — `resolvido` sozinho ela não consulta.
      resolvido: envio.ok,
      atendido_em: agoraIso(),
    })
    .eq('id', ctx.atendimentoId);
  if (error) console.error('[webhook uazapi] falha ao gravar atendimento do contador:', error.message);

  return NextResponse.json({ ok: true, reason: 'modo_escritorio' }, { status: 200 });
}

/**
 * Escalação de atendimento não resolvido: notifica o membro mais antigo do
 * escritório responsável pela empresa (ver sondagem no topo do arquivo).
 *
 * Não é `export` de propósito — `route.ts` só pode exportar handler HTTP
 * (mesma regra documentada em `webhooks/asaas/route.ts`).
 */
async function escalarParaContador(
  admin: SupabaseClient,
  info: { companyId: string; pergunta: string; messageId: string },
): Promise<string | null> {
  const { data: empresa } = await admin
    .from('companies').select('id, contabilidade_id').eq('id', info.companyId).maybeSingle();
  const contabilidadeId = (empresa as { contabilidade_id: string | null } | null)?.contabilidade_id ?? null;

  if (!contabilidadeId) {
    // Self-service: sem escritório, sem time a notificar. Estado legítimo.
    console.warn('[webhook uazapi] empresa sem escritório vinculado, escalação pulada:', info.companyId);
    return null;
  }

  const { data: membro } = await admin
    .from('contabilidade_membros').select('user_id')
    .eq('contabilidade_id', contabilidadeId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  const ownerUserId = (membro as { user_id: string } | null)?.user_id ?? null;
  if (!ownerUserId) {
    console.warn('[webhook uazapi] escritório sem membros, escalação pulada:', contabilidadeId);
    // Devolve mesmo assim: a fila é do escritório, e a linha tem de ficar
    // visível para ele mesmo que hoje não haja a quem notificar.
    return contabilidadeId;
  }

  // `chave` única por (owner_user_id, chave) — ver 0045_notificacoes.sql.
  // Estável por mensagem: uma reentrega da uazapi que escapasse da
  // idempotência de `whatsapp_atendimentos` ainda cairia em conflito aqui
  // (defesa em profundidade, não a primeira linha). `upsert` com
  // `ignoreDuplicates` (mesmo idioma de `lib/billing/cron.ts`) faz essa
  // colisão legítima não aparecer no log como se fosse uma falha de verdade.
  const { error } = await admin.from('notifications').upsert({
    owner_user_id: ownerUserId,
    company_id: info.companyId,
    tipo: 'whatsapp_escalado',
    severidade: 'warning',
    titulo: 'Cliente perguntou pelo WhatsApp e a resposta automática não foi suficiente',
    corpo: `Pergunta recebida: "${info.pergunta}"`,
    chave: `whatsapp_escalado:${info.messageId}`,
    // Bloco 7: o aviso passa a levar para a fila, que é onde a escalada se
    // fecha (e onde o relógio do SLA para).
    action_href: '/contador/atendimentos',
  }, { onConflict: 'owner_user_id,chave', ignoreDuplicates: true });
  if (error) {
    console.error('[webhook uazapi] falha ao gravar escalação:', error.message);
  }

  return contabilidadeId;
}

export async function POST(req: Request) {
  let corpo: PayloadUazapi;
  try {
    corpo = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: 'payload_invalido' }, { status: 200 });
  }

  // SEGREDO ANTES do rate-limit. `limitar` é chaveado por `entrada.from` — um
  // campo do CORPO, não autenticado. Se o rate-limit rodasse primeiro,
  // qualquer um poderia estourar o orçamento do NÚMERO DE UM CLIENTE REAL sem
  // conhecer o segredo, e a próxima mensagem legítima dele cairia em
  // `rate_limited` (200, sem retry da uazapi) — um atendimento perdido sem
  // custar nada ao atacante. A checagem de segredo é comparação em tempo
  // constante, sem round-trip a banco: cabe vir antes.
  //
  // DOIS CANAIS, DOIS SEGREDOS (migration 0091):
  //
  //   ?t=<token do escritório>  → canal de um escritório. O token identifica o
  //                               TENANT e autentica ao mesmo tempo: ele é
  //                               único, tem 256 bits e só nós o colocamos na
  //                               URL, no provisionamento.
  //   ?s=<UAZAPI_WEBHOOK_SECRET> → canal da plataforma, que atende as empresas
  //                               SEM escritório (decisão D8).
  //
  // O `t` é conferido contra o banco mais abaixo (precisa do admin client);
  // aqui só barramos quem não trouxe credencial NENHUMA, para o rate-limit
  // continuar protegido como o parágrafo acima descreve.
  //
  // ⚠️ O FORMATO É CONFERIDO AQUI, não só no banco (code-review, 19/08/2026).
  // Antes bastava EXISTIR um `t` qualquer para passar deste portão: `?t=1`
  // dispensava o segredo e dava a qualquer anônimo uma escrita em `audit_log`
  // por requisição — e, como a chave do rate-limit inclui o token, variar o
  // valor renovava o balde a cada chamada. Exigir os 64 hex fecha isso sem
  // custo: adivinhar 256 bits não é atalho.
  const tParam = new URL(req.url).searchParams.get('t');
  const tokenDoCanal = tParam && /^[0-9a-f]{64}$/.test(tParam) ? tParam : null;
  if (!tokenDoCanal && !segredoDaQuery(req, 's', process.env.UAZAPI_WEBHOOK_SECRET ?? '')) {
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 200 });
  }
  // O payload da uazapi NÃO tem a forma que este arquivo supôs até 12/08/2026
  // (`{messageId, from, text}`): a mensagem real chega com `chatid`,
  // `content.text`, `messageid`, possivelmente dentro de um envelope. Com os
  // campos vindo `undefined`, o claim morria por NOT NULL e o endpoint
  // respondia 200 — a uazapi via sucesso, o cliente via silêncio, e não
  // sobrava nem linha de auditoria. `normalizarEntrada` aceita as formas
  // conhecidas e recusa o resto.
  const entrada = normalizarEntrada(corpo);
  if (!entrada) {
    // Registra a FORMA (chaves e tipos, nunca o conteúdo) para o formato
    // desconhecido virar código em vez de virar mais uma rodada de adivinhação.
    try {
      await createAdminClient().from('audit_log').insert({
        acao: 'uazapi.payload_nao_reconhecido',
        alvo_tipo: 'webhook',
        meta: { forma: formaDoPayload(corpo) },
      });
    } catch (e) {
      console.error('[webhook uazapi] payload desconhecido e falha ao registrar forma:', e);
    }
    return NextResponse.json({ ok: false, reason: 'payload_nao_reconhecido' }, { status: 200 });
  }

  // Eco da própria instância: sem isto o assistente responderia às respostas
  // que ele mesmo acabou de enviar.
  if (entrada.fromMe) {
    return NextResponse.json({ ok: true, reason: 'mensagem_propria' }, { status: 200 });
  }

  // Orçamento por (CANAL, telefone), não só por telefone (0091).
  //
  // Com um canal só, a chave antiga bastava. Com um canal por escritório, o
  // mesmo número pode ser cliente de um escritório e fornecedor de outro — e a
  // cota gasta conversando com um calaria o outro. O token do canal está na
  // query string, então isto não custa leitura de banco.
  const chaveCanal = tokenDoCanal ? tokenDoCanal.slice(0, 12) : 'plataforma';
  if (!(await limitar(`uazapi-webhook:${chaveCanal}:${entrada.from}`, 30, 60))) {
    return NextResponse.json({ ok: false, reason: 'rate_limited' }, { status: 200 });
  }

  // `admin` e `atendimentoId` precisam ser visíveis também no `catch` de
  // baixo: se o claim já reivindicou a linha e algo lançar DEPOIS disso (uma
  // leitura de `buscarSituacaoAtualMei`, a escalação, etc.), o catch precisa
  // conseguir voltar e fechar essa linha em vez de deixá-la para sempre presa
  // no estado inicial do claim (ver comentário no catch).
  let admin: SupabaseClient | undefined;
  let atendimentoId: string | undefined;

  // TUDO daqui pra baixo num único try/catch — mesma forma de
  // `webhooks/asaas/route.ts`: qualquer coisa que vier a lançar (uma leitura
  // que falha, uma chamada de rede que aborta) não pode virar 500 e fazer a
  // uazapi desativar ou martelar o webhook inteiro.
  try {
    admin = createAdminClient();

    // ═══ TENANT DO CANAL (migration 0091) ═══
    //
    // Resolvido ANTES do claim: token desconhecido não pode gerar linha em
    // `whatsapp_atendimentos`. Gravar mensagem vinda de um canal que não é
    // nosso encheria a auditoria de origem não identificável.
    const escritorioDoCanal = tokenDoCanal
      ? await escritorioPorWebhookToken(admin, tokenDoCanal)
      : null;

    if (tokenDoCanal && !escritorioDoCanal) {
      try {
        await admin.from('audit_log').insert({
          acao: 'uazapi.canal_desconhecido',
          alvo_tipo: 'webhook',
          // Nunca o token nem o conteúdo: só o bastante para saber que
          // aconteceu e com que forma.
          meta: { tamanho_token: tokenDoCanal.length },
        });
      } catch (e) {
        console.error('[webhook uazapi] canal desconhecido e falha ao auditar:', e);
      }
      return NextResponse.json({ ok: false, reason: 'canal_desconhecido' }, { status: 200 });
    }

    // Por onde a RESPOSTA sai: sempre a mesma instância que recebeu. Responder
    // por outro número faria o cliente ver a pergunta num chat e a resposta em
    // outro — e, num canal de escritório, com a marca errada.
    //
    // ⚠️ CANAL DE ESCRITÓRIO NUNCA CAI PARA A PLATAFORMA (code-review, 19/08).
    // O `?? configDaPlataforma()` valia para os dois casos e fazia a resposta de
    // um cliente do escritório A sair pelo NÚMERO DO BALU sempre que o status
    // gravado estivesse defasado (`conectando`, ou marcado `desconectado` por
    // uma leitura ruim) — com o prompt assinando como o escritório A. Se a
    // mensagem chegou pelo canal dele, é por ele que a resposta volta; sem
    // token, ninguém responde.
    // `await` obrigatório desde a 0101: `configDaPlataforma` passou a ler o
    // token do banco. Sem ele, a expressão devolveria uma Promise — que é
    // truthy — e o canal de saída seria um objeto sem `baseUrl` nem `token`:
    // nenhuma resposta sairia, e nada acusaria.
    const canalDeSaida = escritorioDoCanal
      ? escritorioDoCanal.configDeResposta
      : await configDaPlataforma();

    // Idempotência via CLAIM atômico: o INSERT abaixo é a própria linha de
    // auditoria (usada pelo resto do fluxo e, no caminho de telefone
    // desconhecido, a ÚNICA gravação necessária). Confiar na UNIQUE
    // constraint do banco (`message_id_externo`) em vez de um SELECT prévio
    // fecha a janela de corrida: um SELECT-then-INSERT-depois deixa duas
    // requisições concorrentes (mesmo `messageId` reentregue pela uazapi
    // enquanto a primeira ainda está em voo) verem "não visto" e as DUAS
    // chamarem IA + `enviarMensagem` — dois envios cobrados e reais ao
    // cliente. Com o INSERT logo aqui, a segunda requisição colide na
    // constraint (23505) e sai sem tocar IA nem envio.
    const { data: claim, error: erroClaim } = await admin
      .from('whatsapp_atendimentos')
      .insert({
        message_id_externo: entrada.messageId, telefone: entrada.from,
        mensagem_recebida: entrada.text, resolvido: false,
        // Carimbado JÁ no claim, não só na escalação. Duas razões: o escopo do
        // histórico depende dele (ver `lerHistorico`), e a fila de SLA do
        // escritório passa a enxergar a conversa desde a primeira mensagem, e
        // não só quando alguém escala.
        contabilidade_id: escritorioDoCanal?.id ?? null,
      })
      .select('id')
      .single();

    if (erroClaim) {
      if (erroClaim.code === '23505') {
        // Outra requisição (mesmo messageId, em voo) já reivindicou a linha.
        return NextResponse.json({ ok: true, reason: 'duplicado' }, { status: 200 });
      }
      // Qualquer outro erro de banco aqui é inesperado — sobe pro catch
      // externo, que já responde 200/erro_inesperado (contrato do arquivo).
      throw new Error(erroClaim.message);
    }
    atendimentoId = (claim as { id: string }).id;

    // Casamento TOLERANTE a formato, e não `.eq()` cru. O `.eq()` que morava
    // aqui não casava nunca em produção: o opt-in grava E.164 com `+`
    // (`+5532987006789`), a uazapi entrega dígitos crus, e celular brasileiro
    // ainda aparece ora com o nono dígito, ora sem — a própria instância do
    // Balu, (32) 99151-1415, é identificada como `553291511415`.
    //
    // O modo de falhar era silencioso e cruel: o cliente cadastrado recebia
    // "não conseguimos identificar sua conta".
    //
    // `maybeSingle()` não serve com `in`: dois perfis poderiam casar (um com
    // o 9, outro sem). Pegamos o primeiro e avisamos — cadastro duplicado é
    // problema de dado, não motivo para não atender ninguém.
    const candidatos = variantesDoNumero(entrada.from);
    const { data: perfisBrutos } = await admin
      .from('profiles').select('user_id, current_company, whatsapp_numero')
      .in('whatsapp_numero', candidatos)
      .limit(10);
    const perfis = (perfisBrutos ?? []) as PerfilCasado[];

    // ═══ MODO ESCRITÓRIO (decisões D3/D4) ═══
    // O número é de um MEMBRO do escritório dono do canal? Então quem escreve
    // é o contador, não um cliente — e a conversa é sobre a carteira dele.
    const membro = escritorioDoCanal
      ? await membroDoEscritorio(admin, escritorioDoCanal.id, perfis)
      : null;

    // ═══ A TRAVA DE ISOLAMENTO (§3.3 da spec) ═══
    // Só continua como CLIENTE quem pertence ao escritório DESTE canal. Perfil
    // de outro escritório cai no mesmo lugar que "número não cadastrado" — a
    // recusa não pode revelar que a pessoa é cliente de outra contabilidade.
    const clientes = membro ? [] : await clientesDoCanal(admin, perfis, escritorioDoCanal);

    // Mais de um perfil sobrando DEPOIS do filtro por escritório: não se
    // adivinha. Antes daqui o código pegava `perfis[0]` com um console.warn —
    // e uma das duas respostas levaria dado da empresa errada.
    if (clientes.length > 1) {
      try {
        await admin.from('audit_log').insert({
          acao: 'uazapi.numero_ambiguo', alvo_tipo: 'webhook',
          meta: {
            perfis: clientes.length,
            // Telefone mascarado; conteúdo da mensagem NUNCA vai para auditoria.
            telefone: entrada.from.slice(0, 4) + '…' + entrada.from.slice(-2),
            contabilidade_id: escritorioDoCanal?.id ?? null,
          },
        });
      } catch (e) {
        console.error('[webhook uazapi] numero ambiguo e falha ao auditar:', e);
      }
      const envio = await enviarMensagem(canalDeSaida, {
        telefone: entrada.from,
        texto: TEXTO_AMBIGUO,
      });
      if (!envio.ok) console.error('[webhook uazapi] falha ao enviar resposta:', envio.erro ?? 'desconhecido');

      // Grava o que foi respondido e fecha para o SLA: não há nada que um
      // humano possa fazer aqui além de arrumar o cadastro duplicado.
      await admin.from('whatsapp_atendimentos')
        .update({ resposta_enviada: TEXTO_AMBIGUO, resolvido: envio.ok, atendido_em: agoraIso() })
        .eq('id', atendimentoId);

      return NextResponse.json({ ok: true, reason: 'numero_ambiguo' }, { status: 200 });
    }

    const profile = clientes[0] ?? null;

    if (membro) {
      return await atenderContador(admin, {
        entrada, atendimentoId, escritorio: escritorioDoCanal!, membro, canal: canalDeSaida,
      });
    }

    if (!profile?.current_company) {
      // NÃO responder a qualquer desconhecido. Achado em 12/08/2026: a
      // instância estava num aparelho com conversas pessoais, e o assistente
      // respondeu para gente que só estava conversando com o dono do número —
      // mensagem automática não solicitada, para quem nunca pediu nada ao Balu.
      // "Ta bom", "👍" e "to no ponto" passam em silêncio.
      // A régua é PERGUNTA, não vocabulário — corrigido em 19/08/2026, depois
      // que "quais os impostos que o governo cobra quando abro uma empresa"
      // ficou sem resposta nenhuma: `imposto` estava só no singular na lista, e
      // a frase passava dos 40 caracteres do reconhecimento de termo solto.
      // Lista de palavras sempre vai perder para um jeito novo de perguntar; o
      // ponto de interrogação, não.
      // Pergunta sempre merece resposta (decisão do usuário: "ela nunca deve
      // ficar sem responder"). Fora disso, só TERMO FISCAL EM MENSAGEM CURTA —
      // o padrão "IPI", "regime tributário", "simples nacional".
      //
      // Achado do code-review: `TERMO_FISCAL` sozinho casa com palavra do dia a
      // dia ("simples", "nacional", "contador"), então "é simples assim" de um
      // conhecido do dono do número virava atendimento automático — o incidente
      // de 12/08 de volta. O corte por tamanho é o mesmo do `termoSolto` do
      // classificador, e vale só para quem NÃO é cliente deste canal.
      const textoCurto = entrada.text.trim().length <= 40;
      const mereceResposta = pareceUmaPergunta(entrada.text)
        || (textoCurto && TERMO_FISCAL.test(entrada.text));

      if (!mereceResposta) {
        // Sem insert aqui: o claim acima já é a linha de auditoria completa
        // para este ramo (message_id_externo, telefone, mensagem_recebida,
        // resolvido:false) — inserir de novo duplicaria a linha e colidiria
        // na mesma UNIQUE constraint que acabou de nos deixar passar.
        //
        // Mas PRECISA fechar para o SLA: silêncio deliberado não é atendimento
        // pendente, e sem isto o "bom dia" de um estranho viraria alerta de
        // prazo estourado para a equipe do escritório.
        await admin.from('whatsapp_atendimentos')
          .update({ atendido_em: agoraIso() }).eq('id', atendimentoId);
        return NextResponse.json({ ok: true, reason: 'telefone_desconhecido' }, { status: 200 });
      }

      // ═══ DEFEITO CORRIGIDO EM 19/08/2026 ═══
      //
      // Até aqui, TODA mensagem com cara de dúvida fiscal vinda de número não
      // cadastrado recebia a mesma frase: "não conseguimos identificar sua
      // conta". Inclusive "o que é MEI?", "IPI", "regime tributário" — dúvidas
      // de conhecimento geral que a base jurídica (415 documentos da legislação
      // vigente) responde sozinha, sem depender de cadastro nenhum.
      //
      // A separação é por MARCA PESSOAL, e não pelo default de
      // `classificarPergunta`. Lá o padrão é "na dúvida, específica", que
      // protege quem TEM conta de receber resposta genérica sobre a própria
      // empresa. Aqui esse default é o lado errado: sem conta não existe
      // resposta específica possível, então cair no default significaria negar
      // conhecimento geral — que é justamente o defeito relatado.
      //
      //   • fala da própria empresa ("quanto é o MEU DAS?") → sem conta não há
      //     o que responder, e a orientação de cadastrar o número é a resposta
      //     certa.
      //   • qualquer outra pergunta → a base jurídica (415 documentos da
      //     legislação vigente) responde sozinha, sem depender de cadastro.
      if (temMarcaPessoal(entrada.text)) {
        const envio = await enviarMensagem(canalDeSaida, {
          telefone: entrada.from,
          texto: TEXTO_NAO_IDENTIFICADO,
        });
        if (!envio.ok) console.error('[webhook uazapi] falha ao enviar resposta:', envio.erro ?? 'desconhecido');

        // Grava o que foi respondido. Lacuna encontrada no smoke de 19/08/2026:
        // este ramo ENVIA mensagem e deixava `resposta_enviada` nula, então a
        // conversa aparecia como não atendida na fila do escritório — e o SLA
        // corria contra alguém por uma mensagem que já tinha sido respondida.
        const { error: eGrav } = await admin.from('whatsapp_atendimentos')
          .update({ resposta_enviada: TEXTO_NAO_IDENTIFICADO, resolvido: envio.ok, atendido_em: agoraIso() })
          .eq('id', atendimentoId);
        if (eGrav) console.error('[webhook uazapi] falha ao gravar recusa:', eGrav.message);

        return NextResponse.json({ ok: true, reason: 'telefone_desconhecido' }, { status: 200 });
      }

      const historicoSemConta = await lerHistorico(admin, entrada.from, atendimentoId,
        { contabilidadeId: escritorioDoCanal?.id ?? null });
      const respostaGeral = await responderComIa(admin, {
        pergunta: entrada.text,
        // Sem empresa não há situação fiscal — e o prompt já trata essa ausência
        // como irrelevante numa dúvida geral, em vez de empurrar o modelo a
        // escalar por falta de dado que a pergunta não pedia.
        situacaoFiscalTexto: null,
        primeiraInteracao: historicoSemConta.length === 0,
        historico: historicoSemConta,
        contextoJuridico: await buscarContextoPorPergunta(admin, entrada.text),
        tipoPergunta: 'geral',
        // O nome do escritório dono do canal não é vazamento: quem escreveu já
        // conhece o número para o qual escreveu.
        escritorio: escritorioDoCanal ? {
          nome: escritorioDoCanal.nome, slaHoras: escritorioDoCanal.slaHoras,
          whatsappSuporte: escritorioDoCanal.whatsappSuporte,
        } : null,
        // Quem escreve aqui não é cliente de escritório nenhum: não há contador
        // para "retornar em breve". O convite a repetir é o que resta de
        // honesto — e mantém a porta aberta.
        textoDeFalha: 'Tive um problema técnico agora e não consegui responder. '
          + 'Pode mandar sua pergunta de novo em instantes?',
      });

      // A saudação entra aqui, no ponto de saída — o mesmo texto para todo
      // mundo, e só na primeira mensagem da conversa.
      const textoGeral = comSaudacao(respostaGeral.resposta, historicoSemConta.length === 0);

      const envioGeral = await enviarMensagem(canalDeSaida, {
        telefone: entrada.from, texto: textoGeral,
      });
      if (!envioGeral.ok) {
        console.error('[webhook uazapi] falha ao enviar resposta:', envioGeral.erro ?? 'desconhecido');
      }

      // O claim é a auditoria deste ramo; sem este UPDATE a linha ficaria com
      // `resposta_enviada` nula para sempre, como se ninguém tivesse sido
      // atendido. NÃO há escalação: não existe contador a quem escalar a dúvida
      // de um número que não é cliente de ninguém.
      await admin.from('whatsapp_atendimentos')
        .update({ resposta_enviada: textoGeral, resolvido: envioGeral.ok, atendido_em: agoraIso() })
        .eq('id', atendimentoId);

      return NextResponse.json({ ok: true, reason: 'duvida_geral_sem_conta' }, { status: 200 });
    }

    const companyId = profile.current_company as string;

    const situacao = await buscarSituacaoAtualMei(
      admin, companyId, competenciaReferenciaBrt(new Date()));

    // Persona "Assistente Balu" (pedido do usuário): a saudação só aparece na PRIMEIRA
    // mensagem de uma conversa, nunca se repete. `atendimentoId` já é a linha
    // desta própria mensagem (claim acima) — precisa ser excluída da busca,
    // senão toda mensagem se veria como "não é a primeira" (ela mesma conta).
    // MEMÓRIA DA CONVERSA. Antes daqui o assistente lia só a mensagem atual —
    // cada pergunta era tratada como se fosse a primeira, e o cliente tinha de
    // repetir o contexto a cada frase. Agora as últimas trocas do MESMO
    // telefone entram no prompt.
    const historico = await lerHistorico(admin, entrada.from, atendimentoId,
      { contabilidadeId: escritorioDoCanal?.id ?? null });
    const primeiraInteracao = historico.length === 0;

    // BASE JURÍDICA como apoio (415 documentos da legislação vigente, mantidos
    // pelo cron do RAG). Era consumida só pelo catálogo do 6A; o atendimento
    // respondia sem ela e escalava para o contador em qualquer dúvida que
    // fugisse da situação fiscal calculada.
    //
    // GROUNDING, NUNCA VOZ: entra como material interno, e o prompt proíbe
    // citar lei ou artigo na resposta — a fronteira do DL 9.295/46 continua
    // de pé. Falha aqui devolve lista vazia e o fluxo segue como antes.
    const contextoJuridico = await buscarContextoPorPergunta(admin, entrada.text);

    // Dúvida geral ("o que é IOF?", "como funciona o DAS?") não depende dos
    // números da empresa: a base jurídica responde sozinha, e escalar isso
    // para o contador é jogar trabalho humano num problema que o app resolve.
    // Pergunta sobre a empresa dele, sem dado disponível, continua indo para
    // o contador. Quem classifica é código, não o modelo — é essa decisão que
    // determina quando um humano é acionado.
    const tipoPergunta = classificarPergunta(entrada.text);

    // O escritório que o cliente pode conhecer: o dono do canal quando há um;
    // no canal da plataforma, o escritório da empresa dele (que pode existir
    // mesmo sem canal próprio ainda). É o que responde "a qual escritório eu
    // estou vinculado?" sem escalar.
    const escritorioDoCliente = escritorioDoCanal ?? await escritorioPorId(
      admin,
      (await admin.from('companies').select('contabilidade_id').eq('id', companyId).maybeSingle())
        .data?.contabilidade_id ?? null,
    );

    const gerada = await responderComIa(admin, {
      pergunta: entrada.text,
      situacaoFiscalTexto: situacao?.texto ?? null,
      primeiraInteracao,
      historico,
      contextoJuridico,
      tipoPergunta,
      escritorio: escritorioDoCliente ? {
        nome: escritorioDoCliente.nome, slaHoras: escritorioDoCliente.slaHoras,
        whatsappSuporte: escritorioDoCliente.whatsappSuporte,
      } : null,
      // Aqui a promessa é verdadeira: `resolvido:false` aciona a escalação
      // logo abaixo, e o escritório vê a conversa em /contador/atendimentos.
      textoDeFalha: 'Não consegui responder agora — o contador vai retornar em breve.',
    });
    // Saudação no ponto de saída, igual ao ramo sem cadastro: `resposta` já é o
    // que vai ao cliente E o que é gravado em `resposta_enviada`, então os dois
    // não podem divergir.
    const resposta = comSaudacao(gerada.resposta, primeiraInteracao);
    let resolvido = gerada.resolvido;

    const envio = await enviarMensagem(canalDeSaida, { telefone: entrada.from, texto: resposta });
    if (!envio.ok) {
      console.error('[webhook uazapi] falha ao enviar resposta:', envio.erro ?? 'desconhecido');
      // "Resolvido" só pode significar que a necessidade do cliente foi
      // atendida DE VERDADE — o que exige a mensagem ter sido entregue. Um
      // cliente que não recebeu nada não pode contar como "resolvido", e
      // forçar isto aqui garante que `escalarParaContador` ainda dispare
      // abaixo mesmo quando a IA achou que o assunto estava encerrado.
      resolvido = false;
    }

    // Bloco 7: a escalada devolve o escritório dono, que é gravado na linha —
    // é ele que faz a conversa aparecer na fila `/contador/atendimentos` e no
    // relógio do SLA. Sem isso, `contabilidade_id` fica NULL e a escalada não
    // casa com policy nenhuma: some da tela em vez de virar trabalho de alguém.
    let contabilidadeId: string | null = null;
    if (!resolvido) {
      contabilidadeId = await escalarParaContador(admin, { companyId, pergunta: entrada.text, messageId: entrada.messageId });
    }

    const { error: erroUpdate } = await admin
      .from('whatsapp_atendimentos')
      .update({
        profile_user_id: profile.user_id, resposta_enviada: resposta, resolvido,
        ...(contabilidadeId ? { contabilidade_id: contabilidadeId } : {}),
        // Fila do escritório = o que espera humano. Escalou (`!resolvido`) →
        // fica aberta e o relógio do SLA corre; resolvida pela IA → fecha aqui.
        ...(resolvido ? { atendido_em: agoraIso() } : {}),
      })
      .eq('id', atendimentoId);
    if (erroUpdate) {
      console.error('[webhook uazapi] falha ao atualizar atendimento:', atendimentoId, erroUpdate.message);
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error('[webhook uazapi] erro inesperado:', err instanceof Error ? err.message : String(err));

    // Se o claim já tinha reivindicado a linha (`atendimentoId` setado) e o
    // erro veio DEPOIS disso — uma leitura que falhou, a escalação, etc. —
    // a linha ficaria presa para sempre no estado inicial do claim
    // (resolvido:false, sem resposta_enviada, sem profile_user_id). Antes do
    // claim-then-update, esse mesmo erro deixava NENHUMA linha existir, e uma
    // reentrega futura da uazapi com o mesmo messageId ainda podia ter
    // sucesso. Agora essa reentrega bateria na UNIQUE constraint e sempre
    // voltaria "duplicado" — o cliente nunca receberia resposta nenhuma, e
    // ninguém escalaria. Recuperação best-effort: fecha a linha com uma
    // resposta de fallback (mesmo texto do fallback estático de IA) para o
    // cliente não ficar em silêncio total e a auditoria mostrar um desfecho
    // (ainda que degradado) em vez de um claim pendurado.
    if (admin && atendimentoId) {
      const { error: erroFallback } = await admin
        .from('whatsapp_atendimentos')
        .update({
          resposta_enviada: 'Não consegui responder agora — o contador vai retornar em breve.',
          resolvido: false,
        })
        .eq('id', atendimentoId);
      if (erroFallback) {
        console.error('[webhook uazapi] falha ao finalizar atendimento após erro:', erroFallback.message);
      }
    }

    return NextResponse.json({ ok: false, reason: 'erro_inesperado' }, { status: 200 });
  }
}
