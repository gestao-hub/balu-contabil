import { describe, it, expect } from 'vitest';
import { segredoDaQuery, segredoDoHeader } from './segredo';

function req(url: string, headers?: Record<string, string>): Request {
  return new Request(url, { method: 'POST', headers });
}

describe('segredoDaQuery', () => {
  it('ausente → false', () => {
    expect(segredoDaQuery(req('https://x/w'), 's', 'esperado')).toBe(false);
  });
  it('errado, mesmo comprimento → false', () => {
    expect(segredoDaQuery(req('https://x/w?s=erradoo'), 's', 'esperad')).toBe(false);
  });
  it('certo → true', () => {
    expect(segredoDaQuery(req('https://x/w?s=abc123'), 's', 'abc123')).toBe(true);
  });
  it('esperado vazio → false (nunca liberar por falta de config)', () => {
    expect(segredoDaQuery(req('https://x/w?s='), 's', '')).toBe(false);
  });
  // timingSafeEqual LANCA em tamanhos diferentes — a checagem de
  // comprimento tem de vir antes, senao isto vira 500 no webhook.
  it('comprimento diferente → false, sem lancar', () => {
    expect(() => segredoDaQuery(req('https://x/w?s=curto'), 's', 'muito-mais-longo')).not.toThrow();
    expect(segredoDaQuery(req('https://x/w?s=curto'), 's', 'muito-mais-longo')).toBe(false);
  });
});

describe('segredoDoHeader', () => {
  it('ausente → false', () => {
    expect(segredoDoHeader(req('https://x/w'), 'asaas-access-token', 'esperado')).toBe(false);
  });
  it('certo → true', () => {
    expect(segredoDoHeader(req('https://x/w', { 'asaas-access-token': 'tok' }), 'asaas-access-token', 'tok')).toBe(true);
  });
  it('errado → false', () => {
    expect(segredoDoHeader(req('https://x/w', { 'asaas-access-token': 'xxx' }), 'asaas-access-token', 'tok')).toBe(false);
  });
  it('comprimento diferente → false, sem lancar', () => {
    expect(segredoDoHeader(req('https://x/w', { 'asaas-access-token': 'a' }), 'asaas-access-token', 'aaaa')).toBe(false);
  });
  it('esperado vazio → false (nunca liberar por falta de config)', () => {
    expect(segredoDoHeader(req('https://x/w', { 'asaas-access-token': '' }), 'asaas-access-token', '')).toBe(false);
  });
});
