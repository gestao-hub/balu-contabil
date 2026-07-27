import { describe, it, expect } from 'vitest';
import { validarFaixas } from './validar-planos';

describe('validarFaixas', () => {
  it('faixas contiguas passam', () => {
    expect(validarFaixas([
      { id: 'a', clientes_min: 0,   clientes_max: 50 },
      { id: 'b', clientes_min: 51,  clientes_max: 200 },
      { id: 'c', clientes_min: 201, clientes_max: null },
    ])).toEqual({ ok: true });
  });

  it('aceita a ordem embaralhada — ordena antes de conferir', () => {
    expect(validarFaixas([
      { id: 'c', clientes_min: 201, clientes_max: null },
      { id: 'a', clientes_min: 0,   clientes_max: 50 },
      { id: 'b', clientes_min: 51,  clientes_max: 200 },
    ])).toEqual({ ok: true });
  });

  it('sobreposicao e recusada, nomeando os planos', () => {
    expect(validarFaixas([
      { id: 'a', clientes_min: 0,  clientes_max: 100 },
      { id: 'b', clientes_min: 50, clientes_max: 200 },
    ])).toEqual({ ok: false, erro: 'As faixas de "a" e "b" se sobrepoem.' });
  });

  it('buraco e recusado, dizendo qual intervalo ficou descoberto', () => {
    expect(validarFaixas([
      { id: 'a', clientes_min: 0,   clientes_max: 10 },
      { id: 'b', clientes_min: 100, clientes_max: null },
    ])).toEqual({ ok: false, erro: 'Ha um buraco entre "a" e "b": ninguem cobre 11 a 99.' });
  });

  it('min maior que max e recusado', () => {
    expect(validarFaixas([{ id: 'a', clientes_min: 100, clientes_max: 10 }]))
      .toEqual({ ok: false, erro: 'O plano "a" tem inicio maior que o fim.' });
  });

  it('lista vazia passa (nao ha o que validar)', () => {
    expect(validarFaixas([])).toEqual({ ok: true });
  });

  it('um plano so, faixa aberta, passa', () => {
    expect(validarFaixas([{ id: 'a', clientes_min: 0, clientes_max: null }]))
      .toEqual({ ok: true });
  });

  // Faixa aberta no topo so pode ser a ULTIMA — duas cobrem o mesmo
  // intervalo infinito e o `find` da faixa.ts devolveria a primeira,
  // silenciosamente.
  it('duas faixas abertas no topo sao recusadas', () => {
    expect(validarFaixas([
      { id: 'a', clientes_min: 0,  clientes_max: null },
      { id: 'b', clientes_min: 50, clientes_max: null },
    ])).toEqual({ ok: false, erro: 'As faixas de "a" e "b" se sobrepoem.' });
  });

  it('faixas contiguas coladas (max=N, min=N+1) passam', () => {
    expect(validarFaixas([
      { id: 'a', clientes_min: 0, clientes_max: 9 },
      { id: 'b', clientes_min: 10, clientes_max: null },
    ])).toEqual({ ok: true });
  });

  // ── Buracos nas PONTAS ────────────────────────────────────────────────
  // Achados na revisao: comparar so pares adjacentes deixava os dois
  // passarem, e o cron so reclamaria num console.warn um mes depois.

  it('ultima faixa fechada e recusada — ninguem cobre acima dela', () => {
    expect(validarFaixas([
      { id: 'a', clientes_min: 0,   clientes_max: 50 },
      { id: 'b', clientes_min: 51,  clientes_max: 200 },
      { id: 'c', clientes_min: 201, clientes_max: 1000 },
    ])).toEqual({
      ok: false,
      erro: 'A ultima faixa ("c") termina em 1000: ninguem cobre 1001 ou mais. Deixe o "ate" vazio.',
    });
  });

  it('primeira faixa comecando acima de zero e recusada', () => {
    expect(validarFaixas([
      { id: 'a', clientes_min: 10, clientes_max: 50 },
      { id: 'b', clientes_min: 51, clientes_max: null },
    ])).toEqual({
      ok: false,
      erro: 'A primeira faixa ("a") comeca em 10: ninguem cobre 0 a 9.',
    });
  });

  it('plano unico fechado e recusado', () => {
    expect(validarFaixas([{ id: 'a', clientes_min: 0, clientes_max: 100 }]))
      .toEqual({
        ok: false,
        erro: 'A ultima faixa ("a") termina em 100: ninguem cobre 101 ou mais. Deixe o "ate" vazio.',
      });
  });

  it('o seed da migration 0050 passa na validacao', () => {
    expect(validarFaixas([
      { id: 'escritorio_ate_50',   clientes_min: 0,   clientes_max: 50 },
      { id: 'escritorio_51_200',   clientes_min: 51,  clientes_max: 200 },
      { id: 'escritorio_201_mais', clientes_min: 201, clientes_max: null },
    ])).toEqual({ ok: true });
  });
});
