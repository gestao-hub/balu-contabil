import { describe, it, expect } from 'vitest';
import { normalizarHost, ehHostValido, hostDaRequisicao } from './host';

describe('normalizarHost', () => {
  it('minusculiza e tira a porta', () => {
    expect(normalizarHost('APP.Escritorio.com.br:443')).toBe('app.escritorio.com.br');
  });

  it('aceita a URL inteira colada pelo usuario', () => {
    expect(normalizarHost('https://app.escritorio.com.br/contador?x=1')).toBe('app.escritorio.com.br');
  });

  it('tira espacos, barra final e ponto de raiz DNS', () => {
    expect(normalizarHost('  app.escritorio.com.br./  ')).toBe('app.escritorio.com.br');
  });

  it('descarta credenciais embutidas na URL', () => {
    expect(normalizarHost('http://user:senha@app.escritorio.com.br')).toBe('app.escritorio.com.br');
  });

  it('recusa vazio, nulo e indefinido', () => {
    expect(normalizarHost('')).toBeNull();
    expect(normalizarHost(null)).toBeNull();
    expect(normalizarHost(undefined)).toBeNull();
  });

  it('recusa host de rotulo unico', () => {
    // Sem isto, alguem reivindicaria o nome interno de um servico.
    expect(normalizarHost('intranet')).toBeNull();
  });

  it('recusa IP', () => {
    expect(normalizarHost('192.168.0.1')).toBeNull();
    expect(normalizarHost('[::1]:443')).toBeNull();
  });

  it('recusa localhost e subdominio de localhost', () => {
    expect(normalizarHost('localhost:3000')).toBeNull();
    expect(normalizarHost('app.localhost')).toBeNull();
  });

  it('www e host distinto — nao e unificado com o apex', () => {
    // Cada um precisa do seu proprio apontamento de DNS; fingir que sao o
    // mesmo faria o app dizer "verificado" para um host que nao foi.
    expect(normalizarHost('www.escritorio.com.br')).toBe('www.escritorio.com.br');
    expect(normalizarHost('escritorio.com.br')).toBe('escritorio.com.br');
  });

  it('recusa rotulo com caractere invalido ou hifen na ponta', () => {
    expect(normalizarHost('app_x.com.br')).toBeNull();
    expect(normalizarHost('-app.com.br')).toBeNull();
    expect(normalizarHost('app-.com.br')).toBeNull();
  });

  it('aceita hifen no meio e digitos', () => {
    expect(normalizarHost('app-2.escritorio-fulano.com.br')).toBe('app-2.escritorio-fulano.com.br');
  });
});

describe('ehHostValido', () => {
  it('recusa host acima de 253 caracteres', () => {
    const gigante = `${'a'.repeat(60)}.${'b'.repeat(60)}.${'c'.repeat(60)}.${'d'.repeat(60)}.${'e'.repeat(60)}.com.br`;
    expect(gigante.length).toBeGreaterThan(253);
    expect(ehHostValido(gigante)).toBe(false);
  });

  it('recusa o dominio da propria Balu', () => {
    expect(ehHostValido('balu.app.br')).toBe(false);
  });
});

describe('hostDaRequisicao', () => {
  it('prefere x-forwarded-host ao host', () => {
    // Na Vercel o `host` e o dominio interno do deployment: usar ele
    // significaria nunca reconhecer o dominio do escritorio.
    const h = { 'x-forwarded-host': 'app.escritorio.com.br', host: 'balu-abc123.vercel.app' };
    expect(hostDaRequisicao(h)).toBe('app.escritorio.com.br');
  });

  it('cai no host quando nao ha x-forwarded-host', () => {
    expect(hostDaRequisicao({ host: 'app.escritorio.com.br' })).toBe('app.escritorio.com.br');
  });

  it('usa o primeiro valor de uma cadeia de proxies', () => {
    const h = { 'x-forwarded-host': 'app.escritorio.com.br, proxy.interno.com' };
    expect(hostDaRequisicao(h)).toBe('app.escritorio.com.br');
  });

  it('x-forwarded-host invalido cai no host, em vez de devolver lixo', () => {
    const h = { 'x-forwarded-host': 'localhost:3000', host: 'app.escritorio.com.br' };
    expect(hostDaRequisicao(h)).toBe('app.escritorio.com.br');
  });

  it('funciona com Headers de verdade, nao so com objeto', () => {
    const h = new Headers({ 'x-forwarded-host': 'APP.Escritorio.com.br' });
    expect(hostDaRequisicao(h)).toBe('app.escritorio.com.br');
  });

  it('sem nenhum cabecalho de host devolve null', () => {
    expect(hostDaRequisicao({})).toBeNull();
  });
});
