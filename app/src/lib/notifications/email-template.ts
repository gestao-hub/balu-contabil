// src/lib/notifications/email-template.ts
//
// Corpo/título vêm da regra de negócio (datas, textos de aviso) e podem
// eventualmente carregar dados de usuário (ex.: nome do escritório no
// rodapé) — interpolados crus no HTML do e-mail seriam um vetor de
// HTML/script injection sob o domínio de envio do app. Por isso escapamos
// tudo que não é marcação fixa deste template.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderNotificacaoEmail(opts: {
  titulo: string;
  corpo: string;
  norma?: string | null;
  actionUrl: string;
  escritorioNome?: string | null;
}): string {
  const { titulo, corpo, norma, actionUrl, escritorioNome } = opts;
  const rodapeMarca = escritorioNome
    ? `Enviado por ${escapeHtml(escritorioNome)} via Balu`
    : 'Balu — gestão fiscal para MEI e Simples';
  return `
  <div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a">
    <h2 style="font-size:18px;margin:0 0 12px">${escapeHtml(titulo)}</h2>
    <p style="font-size:15px;line-height:1.5;margin:0 0 16px">${escapeHtml(corpo)}</p>
    ${norma ? `<p style="font-size:12px;color:#666;margin:0 0 16px">Base legal: ${escapeHtml(norma)}</p>` : ''}
    <a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#1a1a1a;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-size:14px">Ver no Balu</a>
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0 12px">
    <p style="font-size:12px;color:#999;margin:0">${rodapeMarca}. Você pode ajustar seus avisos em Conta → Notificações.</p>
  </div>`;
}
