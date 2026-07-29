import { describe, it, expect, vi, afterEach } from 'vitest';
import { gerarTexto } from './cliente';
import { URL_PADRAO } from './provedores';

const resposta = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }) as Response;

afterEach(() => vi.restoreAllMocks());

describe('cliente de IA', () => {
  it('adaptador OpenAI-compatível: manda para a URL do provedor e lê a escolha', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      resposta({ choices: [{ message: { content: 'texto gerado' } }] }));

    const r = await gerarTexto(
      { provedor: 'groq', modelo: 'llama-3.3-70b', base_url: null, chave: 'k' },
      'prompt');

    expect(r).toBe('texto gerado');
    expect(String(spy.mock.calls[0][0])).toContain(URL_PADRAO.groq);
  });

  it('adaptador Anthropic: formato próprio', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      resposta({ content: [{ type: 'text', text: 'texto claude' }] }));

    const r = await gerarTexto(
      { provedor: 'anthropic', modelo: 'claude-sonnet-4-6', base_url: null, chave: 'k' },
      'prompt');

    expect(r).toBe('texto claude');
    const headers = (spy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('k');
    expect(headers['anthropic-version']).toBeTruthy();
    // O Bearer e do outro dialeto: mandar os dois entregaria a chave em duas
    // formas para um provedor que so precisa de uma.
    expect(headers['Authorization']).toBeUndefined();
  });

  it('personalizado usa a base_url informada', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      resposta({ choices: [{ message: { content: 'ok' } }] }));

    await gerarTexto(
      { provedor: 'personalizado', modelo: 'm', base_url: 'https://meu.invalido/v1', chave: 'k' },
      'p');

    expect(String(spy.mock.calls[0][0])).toContain('https://meu.invalido/v1');
  });

  // A CHAVE NÃO VAZA NEM EM ERRO. Mesma regra que a varredura do 4B teve de
  // aprender: a mensagem é montada longe daqui.
  //
  // UMA chamada só, de propósito: com `mockResolvedValueOnce` uma segunda
  // chamada cairia no fetch REAL e a suíte bateria na OpenAI de verdade.
  it('erro do provedor não carrega a chave na mensagem', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      { ok: false, status: 401, text: async () => 'invalid key sk-SEGREDO-123' } as Response);

    const err: Error = await gerarTexto(
      { provedor: 'openai', modelo: 'm', base_url: null, chave: 'sk-SEGREDO-123' }, 'p')
      .then(() => { throw new Error('deveria ter lancado'); }, (e) => e);

    expect(err.message).toMatch(/401/);
    expect(err.message).not.toContain('sk-SEGREDO-123');
  });

  it('personalizado sem base_url é recusado antes de qualquer rede', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    await expect(gerarTexto(
      { provedor: 'personalizado', modelo: 'm', base_url: null, chave: 'k' }, 'p'))
      .rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });

  // Resposta 200 com corpo que nao tem texto e falha, nao string vazia: um
  // rascunho vazio entraria no catalogo parecendo conteudo.
  it('200 sem texto no corpo é erro', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(resposta({ choices: [] }));
    await expect(gerarTexto(
      { provedor: 'openai', modelo: 'm', base_url: null, chave: 'k' }, 'p'))
      .rejects.toThrow(/sem texto/i);
  });
});
