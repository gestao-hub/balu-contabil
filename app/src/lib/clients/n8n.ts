// @custom — Onda 4 hardening — Cliente n8n (motor fiscal). Cada método é um webhook.
import 'server-only';
import { createHmac } from 'node:crypto';

const BASE = 'https://webhooks.envia.click';

function sign(body: string): string {
  const secret = process.env.N8N_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error('N8N_WEBHOOK_SECRET não configurado — webhooks n8n exigem HMAC SHA-256.');
  }
  const hex = createHmac('sha256', secret).update(body, 'utf8').digest('hex');
  return `sha256=${hex}`;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const payload = JSON.stringify(body ?? {});
  const signature = sign(payload);

  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Signature-256': signature,
    },
    body: payload,
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`n8n ${path} → ${res.status}: ${await res.text()}`);

  // n8n às vezes responde vazio — tratar.
  const text = await res.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

export const n8n = {
  consolidarReceitas:  (p: { empresa_id: string; competencia: string }) => post('/webhook/consolidar_receitas_fiscais', p),
  calcularRbt12:       (p: { empresa_id: string; competencia: string }) => post('/webhook/calcular_rbt12', p),
  consultaDasMei:      (p: { empresa_id: string; competencia: string }) => post('/webhook/consulta_das_mei', p),
};
