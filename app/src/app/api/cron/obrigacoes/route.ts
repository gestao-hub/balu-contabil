// src/app/api/cron/obrigacoes/route.ts
// Cron diário: materializa obrigações pendentes (RPC materializar_obrigacoes)
// e envia e-mail para as notificações ainda não enviadas (RPC
// notificacoes_pendentes_email), marcando enviada_email_em apenas quando o
// envio realmente teve sucesso — sem chave/skip ou erro, a notificação
// permanece pendente e é retentada na próxima execução.
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/clients/email';
import { renderNotificacaoEmail } from '@/lib/notifications/email-template';
import { rodarBilling } from '@/lib/billing/cron';
import { rodarConciliacao } from '@/lib/conciliacao/cron';
import { configDeEnv, enviarMensagem } from '@/lib/uazapi/cliente';

// TEMPO DE EXECUCAO — 60s, o teto do plano Hobby da Vercel.
//
// Sem esta linha vale o default (10-15s), e a rotina JA nao cabia: sao chamadas
// HTTP ao Asaas COM RETRY E BACKOFF, uma por assinatura, mais a varredura das
// subcontas do 4B (ate 50 paginas por escritorio). Timeout de wall-clock NAO e
// capturavel por try/catch: o processo morre antes do `NextResponse.json`, o
// resumo nunca chega e NADA retenta. A varredura do 4B roda por ULTIMO de
// proposito (ver `rodarBilling`), o que a torna a primeira coisa a ser
// sacrificada — ou seja, a rede de seguranca do escritorio cujo webhook nunca
// chega seria justamente o que deixaria de existir, em silencio.
export const maxDuration = 60;

// Achado no brainstorming do item "pagamento do DAS no WhatsApp": a SERPRO
// nao devolve Pix para DAS em nenhum servico identificado (GERARDAS12 nem
// GERARDASCOBRANCA17) — ver docs/superpowers/specs/2026-07-31-linha-
// digitavel-whatsapp-design.md §1. O que existe de verdade e a linha
// digitavel do boleto, ja persistida em guias_fiscais desde a geracao da
// guia. Funcao pura para poder testar a montagem da mensagem sem mockar
// rede/banco.
function montarTextoWhatsapp(n: {
  titulo: string;
  corpo: string;
  action_href: string | null;
  linha_digitavel: string | null;
  siteUrl: string;
}): string {
  const linhas = [n.titulo, '', n.corpo];
  const linhaDigitavel = n.linha_digitavel?.trim();
  if (linhaDigitavel) {
    linhas.push('', 'Código para pagar (copie e cole no app do seu banco):', linhaDigitavel);
  }
  if (n.action_href) linhas.push('', `${n.siteUrl}${n.action_href}`);
  return linhas.join('\n');
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET não configurado' }, { status: 500 });
  if ((req.headers.get('authorization') ?? '') !== `Bearer ${secret}`)
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  const admin = createAdminClient();

  // Bloco 7: SLA de atendimento. Roda junto da materialização das obrigações
  // porque é o mesmo tipo de trabalho (varrer estado e criar aviso) e porque
  // o plano Hobby da Vercel permite exatamente 2 crons — as duas vagas já
  // estão ocupadas. Erro aqui não pode derrubar o resto: o que tem prazo
  // legal é a materialização das obrigações, não o alerta de SLA.
  const { data: slaAvisos, error: eSla } = await admin.rpc('materializar_sla_estourado');
  if (eSla) console.error('[cron obrigacoes] materializar_sla_estourado', eSla.message);

  const { data: criadas, error: eRpc } = await admin.rpc('materializar_obrigacoes');
  if (eRpc) {
    console.error('[cron obrigacoes] materializar_obrigacoes', eRpc.message);
    return NextResponse.json({ ok: false, error: eRpc.message }, { status: 500 });
  }

  // Não retorna cedo em falha desta RPC: fazia isso até esta sessão, e como
  // resultado uma falha transitória só no lado de e-mail calava também o
  // loop de WhatsApp (Bloco 6B) e o billing (Bloco 4A) — que não têm nenhuma
  // relação com o e-mail e não deveriam parar por causa dele. `pend ?? []`
  // abaixo já cobre o caso de erro (nenhum e-mail é enviado, mas o resto do
  // cron segue).
  const { data: pend, error: ePend } = await admin.rpc('notificacoes_pendentes_email', { p_limite: 200 });
  if (ePend) {
    console.error('[cron obrigacoes] notificacoes_pendentes_email', ePend.message);
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://balu-contabil.vercel.app';
  let enviados = 0;
  let pulados = 0;
  for (const n of pend ?? []) {
    const html = renderNotificacaoEmail({
      titulo: n.titulo,
      corpo: n.corpo,
      norma: n.norma,
      actionUrl: `${siteUrl}${n.action_href ?? '/'}`,
      escritorioNome: n.escritorio_nome,
    });
    const r = await sendEmail({
      to: n.destinatario_email,
      subject: n.titulo,
      html,
      fromName: n.escritorio_nome ?? undefined,
    });
    if (r.ok) {
      await admin.from('notifications').update({ enviada_email_em: new Date().toISOString() }).eq('id', n.id);
      enviados++;
    } else {
      pulados++;
    }
  }

  // Terceiro loop (Bloco 6B): WhatsApp via uazapi. Mesma idempotência do
  // e-mail (enviada_whatsapp_em fica NULL até o envio ter sucesso). Sem
  // UAZAPI_BASE_URL/UAZAPI_TOKEN configurados, configDeEnv() devolve null e
  // enviarMensagem vira no-op — todo item cai em "pulado", sem quebrar o
  // cron. É o estado de hoje, sem instância provisionada.
  // Antes de ler os pendentes: coalescer por guia (migration 0068). Sem
  // instância provisionada nada é enviado e o backlog D7/D3/D1/vencido da
  // mesma guia se acumula — no dia em que o token existir, o cliente
  // receberia as quatro mensagens quase idênticas de uma vez. Só a mais
  // recente de cada guia sobrevive; as anteriores ficam suprimidas (não
  // "enviadas" — nada saiu).
  const { data: suprimidas, error: eSuprimir } = await admin.rpc('suprimir_whatsapp_superadas');
  if (eSuprimir) console.error('[cron obrigacoes] suprimir_whatsapp_superadas', eSuprimir.message);

  const { data: pendWhats, error: ePendWhats } = await admin.rpc('notificacoes_pendentes_whatsapp', { p_limite: 50 });
  let whatsappEnviados = 0;
  let whatsappPulados = 0;
  if (ePendWhats) {
    console.error('[cron obrigacoes] notificacoes_pendentes_whatsapp', ePendWhats.message);
  } else {
    const cfgUazapi = configDeEnv();
    for (const n of pendWhats ?? []) {
      const r = await enviarMensagem(cfgUazapi, {
        telefone: n.whatsapp_numero,
        texto: montarTextoWhatsapp({
          titulo: n.titulo,
          corpo: n.corpo,
          action_href: n.action_href,
          linha_digitavel: n.linha_digitavel,
          siteUrl,
        }),
      });
      if (r.ok) {
        await admin.from('notifications').update({ enviada_whatsapp_em: new Date().toISOString() }).eq('id', n.id);
        whatsappEnviados++;
      } else {
        console.error('[cron obrigacoes] falha ao enviar whatsapp', r.erro ?? 'desconhecido');
        whatsappPulados++;
      }
    }
  }

  // Bloco 7: conciliação bancária. Entra DEPOIS do que tem prazo legal e
  // ANTES do billing, seguindo a mesma disciplina de ordem já estabelecida
  // aqui: o que é obrigação fiscal primeiro, o que depende de HTTP de
  // terceiro por último. Isolada em try/catch para um provedor fora do ar
  // não custar o resto do cron.
  let conciliacao: unknown = null;
  try {
    conciliacao = await rodarConciliacao(admin);
  } catch (err) {
    console.error('[cron obrigacoes] conciliacao falhou', err);
    conciliacao = { erro: String(err) };
  }

  // Billing (Bloco 4A) roda AQUI e não em cron próprio: o plano Hobby da
  // Vercel permite exatamente 2 crons e o vercel.json já tem 2. O endpoint
  // /api/cron/billing continua existindo para disparo manual.
  //
  // Roda POR ÚLTIMO de propósito. Ele faz uma chamada HTTP ao Asaas por
  // assinatura (com retry e backoff), e um Asaas lento esgotaria o tempo da
  // invocação inteira. Se isso acontecesse antes, a materialização das
  // obrigações — que tem prazo legal — não rodaria naquele dia. E timeout
  // de wall-clock não é capturável por try/catch: a única defesa é ordem.
  let billing: unknown = null;
  try {
    billing = await rodarBilling();
  } catch (err) {
    console.error('[cron obrigacoes] billing falhou', err);
    billing = { erro: String(err) };
  }

  return NextResponse.json({
    ok: true, criadas, enviados, pulados,
    ...(ePend ? { email_erro: ePend.message } : {}),
    whatsapp_enviados: whatsappEnviados, whatsapp_pulados: whatsappPulados,
    whatsapp_suprimidas: eSuprimir ? null : (suprimidas ?? 0),
    sla_avisos: eSla ? null : (slaAvisos ?? 0),
    conciliacao,
    billing,
  });
}
