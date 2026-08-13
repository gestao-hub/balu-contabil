import { describe, it, expect } from 'vitest';
import { formatCnpj, formatCep, formatCnae, somenteDigitos } from './masks';

describe('formatCnpj', () => {
  it('formata CNPJ completo', () => {
    expect(formatCnpj('11222333000181')).toBe('11.222.333/0001-81');
  });
  it('formata parcial progressivamente', () => {
    expect(formatCnpj('11')).toBe('11');
    expect(formatCnpj('112')).toBe('11.2');
    expect(formatCnpj('11222333')).toBe('11.222.333');
    expect(formatCnpj('112223330001')).toBe('11.222.333/0001');
  });
  it('trunca acima de 14 dígitos', () => {
    expect(formatCnpj('112223330001819999')).toBe('11.222.333/0001-81');
  });
  it('limpa símbolos e é idempotente', () => {
    expect(formatCnpj('11.222.333/0001-81')).toBe('11.222.333/0001-81');
    expect(formatCnpj('abc11def222')).toBe('11.222');
  });
  it('retorna vazio para entrada vazia (estado de mount do input)', () => {
    expect(formatCnpj('')).toBe('');
  });
});

describe('formatCep', () => {
  it('formata CEP completo', () => {
    expect(formatCep('80010000')).toBe('80010-000');
  });
  it('formata parcial', () => {
    expect(formatCep('800')).toBe('800');
    expect(formatCep('80010')).toBe('80010');
    expect(formatCep('800100')).toBe('80010-0');
  });
  it('trunca acima de 8 dígitos e é idempotente', () => {
    expect(formatCep('800100009999')).toBe('80010-000');
    expect(formatCep('80010-000')).toBe('80010-000');
  });
  it('retorna vazio para entrada vazia (estado de mount do input)', () => {
    expect(formatCep('')).toBe('');
  });
});

describe('formatCnae', () => {
  it('formata CNAE completo (7 dígitos)', () => {
    expect(formatCnae('4299501')).toBe('4299-5/01');
  });
  it('formata parcial progressivamente', () => {
    expect(formatCnae('4299')).toBe('4299');
    expect(formatCnae('42995')).toBe('4299-5');
    expect(formatCnae('429950')).toBe('4299-5/0');
  });
  it('trunca acima de 7 dígitos e é idempotente', () => {
    expect(formatCnae('42995019999')).toBe('4299-5/01');
    expect(formatCnae('4299-5/01')).toBe('4299-5/01');
  });
  it('retorna vazio para entrada vazia (estado de mount do input)', () => {
    expect(formatCnae('')).toBe('');
  });
});


describe('somenteDigitos', () => {
  it('tira máscara e respeita o teto', () => {
    expect(somenteDigitos('11.222.333/0001-81', 14)).toBe('11222333000181');
    expect(somenteDigitos('112223330001812345', 14)).toBe('11222333000181');
  });

  it('o teto é o ponto: sem ele, tela e estado discordam', () => {
    // `formatCnpj` corta em 14 para exibir. Se o estado guardasse mais, a tela
    // mostraria um CNPJ perfeito e o submit recusaria o campo — sem nada
    // visível para o usuário corrigir.
    const colado = '112223330001819999';
    expect(formatCnpj(colado)).toBe('11.222.333/0001-81');
    expect(somenteDigitos(colado, 14)).toBe('11222333000181');
  });

  it('entrada vazia ou só com símbolos vira string vazia', () => {
    expect(somenteDigitos('', 14)).toBe('');
    expect(somenteDigitos('../--', 14)).toBe('');
  });
});
