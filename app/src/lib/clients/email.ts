// src/lib/clients/email.ts
import 'server-only';

/** Envia e-mail transacional via Resend. Sem RESEND_API_KEY → no-op logado (dev não trava). */
export async function sendEmail(opts: { to: string; subject: string; html: string; fromName?: string }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM; // ex.: "Balu <noreply@balu.app>"
  if (!key || !from) {
    console.warn('[email] RESEND_API_KEY/EMAIL_FROM ausentes — e-mail NÃO enviado:', opts.subject, '→', opts.to);
    return { ok: false as const, skipped: true as const };
  }
  const fromFinal = opts.fromName ? `${opts.fromName} <${from.replace(/^.*</, '').replace('>', '')}>` : from;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: fromFinal, to: [opts.to], subject: opts.subject, html: opts.html }),
  });
  if (!res.ok) console.error('[email] falha Resend', res.status, await res.text().catch(() => ''));
  return { ok: res.ok as boolean };
}
