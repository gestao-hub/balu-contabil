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
import { rodarApuracaoAutomatica } from '@/lib/fiscal/apuracao-cron';
import { rodarPagamentosSerpro } from '@/lib/fiscal/pagamentos-serpro-cron';
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
//
// DUAS MENSAGENS, E O MOTIVO É O DEDO DO CLIENTE (Frente 3, Task 4)
// Até 14/08/2026 isto devolvia UMA string com o rótulo "Código para pagar…"
// logo acima do número. No WhatsApp, o toque-e-segura copia a MENSAGEM
// INTEIRA — então quem tentava copiar a linha digitável levava junto o título,
// o corpo, o rótulo e o link, e colava isso no campo do banco. A linha vai
// sozinha, numa mensagem só dela, sem nada em volta.
// NÃO é `export` de propósito: `route.ts` só pode exportar handler HTTP, e o
// `next build` recusa o resto (o `tsc --noEmit` do app pega isso pelos tipos
// gerados em `.next/types`). Mesma cicatriz de `api/webhooks/asaas/route.ts`.
function montarTextoWhatsapp(n: {
  titulo: string;
  corpo: string;
  action_href: string | null;
  linha_digitavel: string | null;
  siteUrl: string;
}): { corpo: string; linhaDigitavel: string | null } {
  const linhaDigitavel = n.linha_digitavel?.trim() || null;
  const linhas = [n.titulo, '', n.corpo];
  if (linhaDigitavel) {
    linhas.push('', 'O código para pagar vai na próxima mensagem — é só tocar e segurar para copiar.');
  }
  if (n.action_href) linhas.push('', `${n.siteUrl}${n.action_href}`);
  return { corpo: linhas.join('\n'), linhaDigitavel };
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

  // Persiste status='vencida' (migration 0078). DEPOIS de materializar, nunca
  // antes: quem avisa o cliente é `materializar_obrigacoes`, e ela é o que tem
  // prazo. Este UPDATE só arruma o estado gravado — se falhar, o cliente foi
  // avisado do mesmo jeito e a tela continua pintando o badge por conta
  // própria. Por isso loga e segue, como o SLA acima.
  const { data: vencidas, error: eVenc } = await admin.rpc('marcar_guias_vencidas');
  if (eVenc) console.error('[cron obrigacoes] marcar_guias_vencidas', eVenc.message);

  // Alarme do parâmetro fiscal (0081). A 0079/0080 fizeram a TROCA do salário
  // mínimo valer sozinha na data de vigência; o que sobrou de humano é alguém
  // lembrar de cadastrar o valor novo — e foi esse elo que falhou em 2026, com
  // sete meses estimando DAS-MEI pelo mínimo de 2025 sem nada reclamar.
  //
  // Não inventa valor: detecta que a vigência mais recente é de um ano anterior
  // e avisa o AdminBalu, uma vez por ano (idempotente pela chave).
  const { data: paramAvisos, error: eParam } = await admin.rpc('alertar_parametros_desatualizados');
  if (eParam) console.error('[cron obrigacoes] alertar_parametros_desatualizados', eParam.message);

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
      const msg = montarTextoWhatsapp({
        titulo: n.titulo,
        corpo: n.corpo,
        action_href: n.action_href,
        linha_digitavel: n.linha_digitavel,
        siteUrl,
      });

      const r = await enviarMensagem(cfgUazapi, { telefone: n.whatsapp_numero, texto: msg.corpo });

      // ── O CARIMBO SÓ CAI QUANDO AS DUAS MENSAGENS PASSAM ─────────────────
      //
      // `enviada_whatsapp_em` é um carimbo só para um envio que agora tem duas
      // partes, e alguma assimetria é inevitável. Das duas formas de errar,
      // esta é a menos ruim:
      //
      //  - carimbar no sucesso da PRIMEIRA deixaria o cliente com um aviso
      //    dizendo "o código vai na próxima mensagem" e nenhuma próxima
      //    mensagem — a promessa quebrada, e sem retentativa;
      //  - carimbar só no fim faz a rodada seguinte reenviar as duas. Aviso
      //    repetido incomoda; aviso sem o código para pagar não serve.
      //
      // E se a primeira falha, a linha NÃO é enviada: um número solto, sem
      // nada em volta, chegando ao cliente é pior que silêncio.
      let ok = r.ok;
      if (r.ok && msg.linhaDigitavel) {
        const rLinha = await enviarMensagem(cfgUazapi, {
          telefone: n.whatsapp_numero, texto: msg.linhaDigitavel,
        });
        if (!rLinha.ok) {
          console.error('[cron obrigacoes] linha digitável não enviada', rLinha.erro ?? 'desconhecido');
          ok = false;
        }
      }

      if (ok) {
        await admin.from('notifications').update({ enviada_whatsapp_em: new Date().toISOString() }).eq('id', n.id);
        whatsappEnviados++;
      } else {
        if (!r.ok) console.error('[cron obrigacoes] falha ao enviar whatsapp', r.erro ?? 'desconhecido');
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

  // Frente 3: DAS pago descoberto na Receita. Entra DEPOIS da conciliação
  // bancária e ANTES do billing, pela mesma disciplina de ordem já estabelecida
  // aqui — o que é obrigação fiscal primeiro, o que depende de HTTP de terceiro
  // por último. Isolada em try/catch, e com orçamento de tempo próprio: é uma
  // chamada SERPRO por empresa, a mais cara do cron, e timeout de wall-clock
  // não é capturável por try/catch — a única defesa é o laço se cortar antes.
  let pagamentosSerpro: unknown = null;
  try {
    pagamentosSerpro = await rodarPagamentosSerpro(admin);
  } catch (err) {
    console.error('[cron obrigacoes] pagamentos serpro falhou', err);
    pagamentosSerpro = { erro: String(err) };
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

  // Apuração mensal automática (P2.1). ÚLTIMA DE TODAS, e é isso que a torna
  // segura: tudo que tem prazo legal já gravou, e ela é a única etapa que pode
  // ser cortada no meio sem prejuízo — é mensal, o cron é diário, e a fila
  // ordena por quem está sem apurar há mais tempo, então o que não coube hoje
  // entra amanhã na frente. Ela ainda se corta sozinha por orçamento próprio,
  // porque timeout de wall-clock não é capturável por try/catch.
  let apuracao: unknown = null;
  try {
    apuracao = await rodarApuracaoAutomatica(admin);
  } catch (err) {
    console.error('[cron obrigacoes] apuracao automatica falhou', err);
    apuracao = { erro: String(err) };
  }

  return NextResponse.json({
    ok: true, criadas, enviados, pulados,
    ...(ePend ? { email_erro: ePend.message } : {}),
    guias_vencidas: eVenc ? null : (vencidas ?? 0),
    parametros_desatualizados: eParam ? null : (paramAvisos ?? 0),
    whatsapp_enviados: whatsappEnviados, whatsapp_pulados: whatsappPulados,
    whatsapp_suprimidas: eSuprimir ? null : (suprimidas ?? 0),
    sla_avisos: eSla ? null : (slaAvisos ?? 0),
    conciliacao,
    pagamentos_serpro: pagamentosSerpro,
    billing,
    apuracao,
  });
}
