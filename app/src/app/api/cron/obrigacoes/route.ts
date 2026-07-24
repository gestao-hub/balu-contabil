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

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET não configurado' }, { status: 500 });
  if ((req.headers.get('authorization') ?? '') !== `Bearer ${secret}`)
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  const admin = createAdminClient();

  const { data: criadas, error: eRpc } = await admin.rpc('materializar_obrigacoes');
  if (eRpc) {
    console.error('[cron obrigacoes] materializar_obrigacoes', eRpc.message);
    return NextResponse.json({ ok: false, error: eRpc.message }, { status: 500 });
  }

  const { data: pend, error: ePend } = await admin.rpc('notificacoes_pendentes_email', { p_limite: 200 });
  if (ePend) {
    console.error('[cron obrigacoes] notificacoes_pendentes_email', ePend.message);
    return NextResponse.json({ ok: true, criadas, email_erro: ePend.message }, { status: 207 });
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

  return NextResponse.json({ ok: true, criadas, enviados, pulados });
}
