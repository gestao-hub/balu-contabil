// src/lib/fiscal/declaracoes-anuais/divergencia.test.ts
import { describe, it, expect } from 'vitest';
import { calcularDivergencia } from './divergencia';

describe('calcularDivergencia', () => {
  it('acusa quando o declarado é maior que o apurado', () => {
    const d = calcularDivergencia(90000, 62000);
    expect(d.diferenca).toBe(28000);
    expect(d.ha).toBe(true);
    expect(d.sentido).toBe('acima');
  });

  it('acusa quando o declarado é menor que o apurado', () => {
    const d = calcularDivergencia(50000, 62000);
    expect(d.diferenca).toBe(-12000);
    expect(d.ha).toBe(true);
    expect(d.sentido).toBe('abaixo');
  });

  it('não acusa quando confere', () => {
    const d = calcularDivergencia(62000, 62000);
    expect(d.diferenca).toBe(0);
    expect(d.ha).toBe(false);
    expect(d.sentido).toBe('confere');
  });

  // Somatório de notas em float rende resíduo de centavo; um centavo não é divergência.
  it('tolera diferença de até um centavo', () => {
    expect(calcularDivergencia(62000.004, 62000).ha).toBe(false);
  });

  // Empresa sem nota nenhuma no ano: declarar qualquer coisa É divergência,
  // e é justamente o caso em que o alerta mais importa.
  it('acusa quando o apurado é zero e o declarado não', () => {
    const d = calcularDivergencia(15000, 0);
    expect(d.ha).toBe(true);
    expect(d.sentido).toBe('acima');
  });
});
