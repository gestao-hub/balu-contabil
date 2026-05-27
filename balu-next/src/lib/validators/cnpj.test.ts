import { describe, it, expect } from 'vitest';
import { isValidCnpj } from './cnpj';

describe('isValidCnpj', () => {
  it('aceita CNPJ válido (com e sem máscara)', () => {
    expect(isValidCnpj('11222333000181')).toBe(true);
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
  });
  it('rejeita dígitos verificadores errados', () => {
    expect(isValidCnpj('11222333000180')).toBe(false);
    expect(isValidCnpj('45987654000132')).toBe(false); // CNPJ de teste fake
  });
  it('rejeita comprimento diferente de 14', () => {
    expect(isValidCnpj('123')).toBe(false);
    expect(isValidCnpj('')).toBe(false);
    expect(isValidCnpj(null)).toBe(false);
  });
  it('rejeita sequência repetida', () => {
    expect(isValidCnpj('00000000000000')).toBe(false);
    expect(isValidCnpj('11111111111111')).toBe(false);
  });
});
