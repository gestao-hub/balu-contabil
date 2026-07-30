// Bloco 6B — Webhook de entrada da uazapi: atendimento por IA + escalação.
// Mesma forma do webhook do Asaas: rate-limit → segredo → SEMPRE HTTP 200
// (a uazapi pode reenfileirar/reenviar em erro, e não queremos loop).
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
  // (defesa em profundidade, não a primeira linha).
  const { error } = await admin.from('notifications').insert({
    owner_user_id: ownerUserId,
    company_id: info.companyId,
    tipo: 'whatsapp_escalado',
    severidade: 'warning',
    titulo: 'Cliente perguntou pelo WhatsApp e a resposta automática não foi suficiente',
    corpo: `Pergunta recebida: "${info.pergunta}"`,
    chave: `whatsapp_escalado:${info.messageId}`,
  });
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

  if (!(await limitar(`uazapi-webhook:${corpo.from ?? 'sem-telefone'}`, 30, 60))) {
    return NextResponse.json({ ok: false, reason: 'rate_limited' }, { status: 200 });
  }
  if (!segredoDaQuery(req, 's', process.env.UAZAPI_WEBHOOK_SECRET ?? '')) {
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 200 });
  }

  const admin = createAdminClient();

  // Idempotência primeiro — a uazapi pode reenviar.
  const { data: jaVisto } = await admin
    .from('whatsapp_atendimentos').select('id').eq('message_id_externo', corpo.messageId).maybeSingle();
  if (jaVisto) return NextResponse.json({ ok: true, reason: 'duplicado' }, { status: 200 });

  const { data: profile } = await admin
    .from('profiles').select('user_id, current_company')
    .eq('whatsapp_numero', corpo.from).maybeSingle();

  if (!profile?.current_company) {
    await enviarMensagem(configDeEnv(), {
      telefone: corpo.from,
      texto: 'Não conseguimos identificar sua conta. Confirme seu número em Conta > Notificações no app.',
    });
    await admin.from('whatsapp_atendimentos').insert({
      message_id_externo: corpo.messageId, telefone: corpo.from,
      mensagem_recebida: corpo.text, resolvido: false,
    });
    return NextResponse.json({ ok: true, reason: 'telefone_desconhecido' }, { status: 200 });
  }

  const companyId = profile.current_company as string;

  const situacao = await buscarSituacaoAtualMei(
    admin, companyId, competenciaReferenciaBrt(new Date()));

  const { data: cfgRow } = await admin.from('config_ia').select('*').eq('id', 1).maybeSingle();
  let resposta = 'Não consegui responder agora — o contador vai retornar em breve.';
  let resolvido = false;

  if (cfgRow) {
    try {
      const chave = lerChaveIa(cfgRow.chave_cifrada as string | null);
      if (chave) {
        const prompt = montarPromptAtendimento({ pergunta: corpo.text, situacaoFiscalTexto: situacao?.texto ?? null });
        const bruto = await gerarTexto(
          { provedor: cfgRow.provedor, modelo: cfgRow.modelo, base_url: cfgRow.base_url, chave },
          prompt);
        const j = JSON.parse(bruto) as { resposta: string; resolvido: boolean };
        resposta = j.resposta;
        resolvido = j.resolvido;
      }
    } catch (e) {
      console.error('[webhook uazapi] falha ao gerar resposta:', e instanceof Error ? e.message : String(e));
    }
  }

  await enviarMensagem(configDeEnv(), { telefone: corpo.from, texto: resposta });

  if (!resolvido) {
    await escalarParaContador(admin, { companyId, pergunta: corpo.text, messageId: corpo.messageId });
  }

  await admin.from('whatsapp_atendimentos').insert({
    message_id_externo: corpo.messageId, telefone: corpo.from, profile_user_id: profile.user_id,
    mensagem_recebida: corpo.text, resposta_enviada: resposta, resolvido,
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}
