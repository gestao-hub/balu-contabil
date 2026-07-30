// Bloco 6B — Webhook de entrada da uazapi: atendimento por IA + escalação.
// Mesma forma do webhook do Asaas: segredo → rate-limit → corpo inteiro num
// try/catch → SEMPRE HTTP 200 (a uazapi pode reenfileirar/reenviar em erro,
// e não queremos loop nem desativação do canal por 5xx).
//
// SEGREDO ANTES do rate-limit (ao contrário do esqueleto original do plano):
// `limitar` é chaveado por `corpo.from`, campo do corpo — não autenticado.
// Rate-limitar antes do segredo deixaria qualquer um estourar o orçamento do
// NÚMERO DE UM CLIENTE REAL sem precisar conhecer o segredo nenhum.
//
// ⚠️ FORMATO DO PAYLOAD DA UAZAPI NÃO CONFIRMADO — ver Task 5/6, Step 1 do
// plano. `messageId`/`from`/`text` são a MELHOR hipótese; ajuste os nomes de
// campo assim que uma instância real confirmar o contrato (o cliente em
// lib/uazapi/cliente.ts tem o mesmo aviso para o envio).
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
import { montarPromptAtendimento } from '@/lib/atendimento/prompt';
import { gerarTexto } from '@/lib/ai/cliente';
import { lerChaveIa } from '@/lib/ai/config-ia';
import { enviarMensagem, configDeEnv } from '@/lib/uazapi/cliente';
import { competenciaReferenciaBrt } from '@/lib/fiscal/guia';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ⚠️ FORMATO REAL NÃO CONFIRMADO — ver aviso de topo do arquivo.
type PayloadUazapi = { messageId: string; from: string; text: string };

/**
 * O modelo pode devolver JSON sintaticamente válido mas fora da forma
 * esperada (`{}`, `resposta` ausente/número, `resolvido` ausente) — isso NÃO
 * lança em `JSON.parse`, e um `as` sozinho deixaria `resposta: undefined`
 * seguir até `enviarMensagem`, onde `JSON.stringify` apaga a chave e a uazapi
 * recebe uma mensagem sem texto. Checagem em runtime, não só de tipo.
 */
function respostaIaValida(j: unknown): j is { resposta: string; resolvido: boolean } {
  if (!j || typeof j !== 'object') return false;
  const r = (j as Record<string, unknown>).resposta;
  const resolvido = (j as Record<string, unknown>).resolvido;
  return typeof r === 'string' && r.trim().length > 0 && typeof resolvido === 'boolean';
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
): Promise<void> {
  const { data: empresa } = await admin
    .from('companies').select('id, contabilidade_id').eq('id', info.companyId).maybeSingle();
  const contabilidadeId = (empresa as { contabilidade_id: string | null } | null)?.contabilidade_id ?? null;

  if (!contabilidadeId) {
    // Self-service: sem escritório, sem time a notificar. Estado legítimo.
    console.warn('[webhook uazapi] empresa sem escritório vinculado, escalação pulada:', info.companyId);
    return;
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
    return;
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
  }, { onConflict: 'owner_user_id,chave', ignoreDuplicates: true });
  if (error) {
    console.error('[webhook uazapi] falha ao gravar escalação:', error.message);
  }
}

export async function POST(req: Request) {
  let corpo: PayloadUazapi;
  try {
    corpo = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: 'payload_invalido' }, { status: 200 });
  }

  // SEGREDO ANTES do rate-limit. `limitar` é chaveado por `corpo.from` — um
  // campo do CORPO, não autenticado. Se o rate-limit rodasse primeiro,
  // qualquer um poderia estourar o orçamento do NÚMERO DE UM CLIENTE REAL sem
  // conhecer o segredo, e a próxima mensagem legítima dele cairia em
  // `rate_limited` (200, sem retry da uazapi) — um atendimento perdido sem
  // custar nada ao atacante. A checagem de segredo é comparação em tempo
  // constante, sem round-trip a banco: cabe vir antes.
  if (!segredoDaQuery(req, 's', process.env.UAZAPI_WEBHOOK_SECRET ?? '')) {
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 200 });
  }
  if (!(await limitar(`uazapi-webhook:${corpo.from ?? 'sem-telefone'}`, 30, 60))) {
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
        message_id_externo: corpo.messageId, telefone: corpo.from,
        mensagem_recebida: corpo.text, resolvido: false,
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

    const { data: profile } = await admin
      .from('profiles').select('user_id, current_company')
      .eq('whatsapp_numero', corpo.from).maybeSingle();

    if (!profile?.current_company) {
      const envio = await enviarMensagem(configDeEnv(), {
        telefone: corpo.from,
        texto: 'Não conseguimos identificar sua conta. Confirme seu número em Conta > Notificações no app.',
      });
      if (!envio.ok) console.error('[webhook uazapi] falha ao enviar resposta:', envio.erro ?? 'desconhecido');
      // Sem insert aqui: o claim acima já é a linha de auditoria completa
      // para este ramo (message_id_externo, telefone, mensagem_recebida,
      // resolvido:false) — inserir de novo duplicaria a linha e colidiria
      // na mesma UNIQUE constraint que acabou de nos deixar passar.
      return NextResponse.json({ ok: true, reason: 'telefone_desconhecido' }, { status: 200 });
    }

    const companyId = profile.current_company as string;

    const situacao = await buscarSituacaoAtualMei(
      admin, companyId, competenciaReferenciaBrt(new Date()));

    // Persona "Paulo" (pedido do usuário): a saudação só aparece na PRIMEIRA
    // mensagem de uma conversa, nunca se repete. `atendimentoId` já é a linha
    // desta própria mensagem (claim acima) — precisa ser excluída da busca,
    // senão toda mensagem se veria como "não é a primeira" (ela mesma conta).
    const { data: interacaoAnterior } = await admin
      .from('whatsapp_atendimentos')
      .select('id')
      .eq('telefone', corpo.from)
      .neq('id', atendimentoId)
      .limit(1)
      .maybeSingle();
    const primeiraInteracao = !interacaoAnterior;

    const { data: cfgRow } = await admin.from('config_ia').select('*').eq('id', 1).maybeSingle();
    let resposta = 'Não consegui responder agora — o contador vai retornar em breve.';
    let resolvido = false;

    if (cfgRow) {
      try {
        const chave = lerChaveIa(cfgRow.chave_cifrada as string | null);
        if (chave) {
          const prompt = montarPromptAtendimento({
            pergunta: corpo.text,
            situacaoFiscalTexto: situacao?.texto ?? null,
            primeiraInteracao,
          });
          const bruto = await gerarTexto(
            { provedor: cfgRow.provedor, modelo: cfgRow.modelo, base_url: cfgRow.base_url, chave },
            prompt);
          const j: unknown = JSON.parse(bruto);
          if (respostaIaValida(j)) {
            resposta = j.resposta;
            resolvido = j.resolvido;
          } else {
            console.error('[webhook uazapi] resposta da IA em formato inesperado, usando fallback');
          }
        }
      } catch (e) {
        console.error('[webhook uazapi] falha ao gerar resposta:', e instanceof Error ? e.message : String(e));
      }
    }

    const envio = await enviarMensagem(configDeEnv(), { telefone: corpo.from, texto: resposta });
    if (!envio.ok) {
      console.error('[webhook uazapi] falha ao enviar resposta:', envio.erro ?? 'desconhecido');
      // "Resolvido" só pode significar que a necessidade do cliente foi
      // atendida DE VERDADE — o que exige a mensagem ter sido entregue. Um
      // cliente que não recebeu nada não pode contar como "resolvido", e
      // forçar isto aqui garante que `escalarParaContador` ainda dispare
      // abaixo mesmo quando a IA achou que o assunto estava encerrado.
      resolvido = false;
    }

    if (!resolvido) {
      await escalarParaContador(admin, { companyId, pergunta: corpo.text, messageId: corpo.messageId });
    }

    const { error: erroUpdate } = await admin
      .from('whatsapp_atendimentos')
      .update({ profile_user_id: profile.user_id, resposta_enviada: resposta, resolvido })
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
