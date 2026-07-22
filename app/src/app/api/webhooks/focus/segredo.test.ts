import { describe, it, expect, beforeAll } from 'vitest';
import { segredoOk } from './segredo';

beforeAll(() => { process.env.FOCUS_WEBHOOK_SECRET = 'segredo-de-teste-123'; });

function reqCom(s: string | null): Request {
  const url = s === null ? 'https://x/api/webhooks/focus' : `https://x/api/webhooks/focus?s=${encodeURIComponent(s)}`;
  return new Request(url, { method: 'POST' });
}
describe('segredoOk', () => {
  it('sem ?s → false', () => expect(segredoOk(reqCom(null))).toBe(false));
  it('?s errado → false', () => expect(segredoOk(reqCom('errado'))).toBe(false));
  it('?s certo → true', () => expect(segredoOk(reqCom('segredo-de-teste-123'))).toBe(true));
});
