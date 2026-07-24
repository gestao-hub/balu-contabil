// src/lib/notifications/email-template.test.ts
import { describe, it, expect } from 'vitest';
import { renderNotificacaoEmail } from './email-template';

describe('renderNotificacaoEmail', () => {
  const base = { titulo: 'DAS vence em 3 dias', corpo: 'Seu DAS de 07/2026 vence dia 20.', actionUrl: 'https://x/impostos' };

  it('escapa HTML do corpo (anti-injection)', () => {
    const html = renderNotificacaoEmail({ ...base, corpo: '<script>alert(1)</script>' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
  it('mostra a norma quando presente', () => {
    const html = renderNotificacaoEmail({ ...base, norma: 'Res. CGSN 140/2018, art. 38' });
    expect(html).toContain('Res. CGSN 140/2018, art. 38');
  });
  it('inclui o link de ação', () => {
    expect(renderNotificacaoEmail(base)).toContain('https://x/impostos');
  });
});
