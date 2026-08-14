// src/lib/clients/email.ts
import 'server-only';

/**
 * Teto por chamada. Sem ele um socket pendurado na Resend segura o `await` até
 * a plataforma matar a função inteira — e o cron diário faz até 200 destas em
 * sequência, dentro de um `maxDuration` de 60s compartilhado com a conciliação,
 * a varredura da SERPRO, o billing e a apuração. Timeout de wall-clock não é
 * capturável por `try/catch`: quando ele chega, nada depois deste laço roda e
 * nem o resumo do cron é gravado.
 *
 * 10s é folgado para um POST de e-mail transacional e cabe 6x no orçamento.
 */
const TIMEOUT_MS = 10_000;

export type EnvioEmail =
  | { ok: true }
  | { ok: false; skipped?: true; erro?: string };

/**
 * Envia e-mail transacional via Resend. Sem RESEND_API_KEY → no-op logado (dev não trava).
 *
 * ⚠️ NUNCA LANÇA — e isso é contrato, não detalhe.
 *
 * Até 14/08/2026 um `fetch` rejeitado (DNS, conexão cortada, socket derrubado)
 * escapava desta função. O laço de e-mail do cron (`api/cron/obrigacoes`) não
 * tem `try/catch`, então UMA falha de rede num único destinatário derrubava o
 * GET inteiro com 500 — e a conciliação bancária, os pagamentos da SERPRO, o
 * billing e a apuração daquele dia simplesmente não aconteciam. O e-mail é a
 * etapa mais barata do cron e era a que podia calar todas as outras.
 *
 * Mesmo contrato de `lib/uazapi/cliente.enviarMensagem`, que já nascera assim:
 * as duas fazem o mesmo trabalho (falar com um terceiro dentro de um laço de
 * cron) e não podem discordar sobre o que acontece quando a rede falha.
 */
export async function sendEmail(
  opts: { to: string; subject: string; html: string; fromName?: string },
): Promise<EnvioEmail> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM; // ex.: "Balu <noreply@balu.app>"
  if (!key || !from) {
    console.warn('[email] RESEND_API_KEY/EMAIL_FROM ausentes — e-mail NÃO enviado:', opts.subject, '→', opts.to);
    return { ok: false, skipped: true };
  }
  const fromFinal = opts.fromName ? `${opts.fromName} <${from.replace(/^.*</, '').replace('>', '')}>` : from;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: fromFinal, to: [opts.to], subject: opts.subject, html: opts.html }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const corpo = await res.text().catch(() => '');
      console.error('[email] falha Resend', res.status, corpo);
      return { ok: false, erro: `resend respondeu ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    // Inclui o AbortError do timeout acima. A notificação fica pendente
    // (`enviada_email_em` só é carimbado no sucesso) e a próxima rodada retenta.
    const erro = e instanceof Error ? e.message : String(e);
    console.error('[email] envio falhou', erro);
    return { ok: false, erro };
  }
}
