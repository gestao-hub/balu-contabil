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

  // ACHADO DO CODE-REVIEW. Os modelos de raciocinio da OpenAI (o1/o3/gpt-5)
  // RECUSAM `max_tokens` em /chat/completions com 400 "Unsupported parameter:
  // use 'max_completion_tokens'". O erro chega na tela do admin parecendo
  // credencial invalida. `max_completion_tokens` e aceito por toda a linha atual
  // da OpenAI, entao o corte e por PROVEDOR, nao por modelo — nao ha lista de
  // modelos para manter.
  it('OpenAI recebe max_completion_tokens, não max_tokens', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      resposta({ choices: [{ message: { content: 'ok' } }] }));

    await gerarTexto({ provedor: 'openai', modelo: 'gpt-5', base_url: null, chave: 'k' }, 'p');

    const corpo = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(corpo.max_completion_tokens).toBeGreaterThan(0);
    expect(corpo.max_tokens).toBeUndefined();
  });

  // Os demais OpenAI-compativeis NAO conhecem `max_completion_tokens`. Trocar
  // para todo mundo consertaria a OpenAI e quebraria Groq, DeepSeek e Mistral.
  it.each(['groq', 'deepseek', 'mistral', 'openrouter', 'gemini'] as const)(
    '%s continua recebendo max_tokens',
    async (provedor) => {
      const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        resposta({ choices: [{ message: { content: 'ok' } }] }));

      await gerarTexto({ provedor, modelo: 'm', base_url: null, chave: 'k' }, 'p');

      const corpo = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
      expect(corpo.max_tokens).toBeGreaterThan(0);
      expect(corpo.max_completion_tokens).toBeUndefined();
    },
  );

  it('Anthropic exige max_tokens e continua recebendo', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      resposta({ content: [{ type: 'text', text: 'ok' }] }));

    await gerarTexto({ provedor: 'anthropic', modelo: 'claude-sonnet-4-6', base_url: null, chave: 'k' }, 'p');

    const corpo = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(corpo.max_tokens).toBeGreaterThan(0);
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
