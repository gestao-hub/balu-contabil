import { describe, it, expect } from 'vitest';
import {
  isValidCpf, documentoValido, telefoneValido, emailValido,
  mensagemCobranca, linkWhatsApp, linkEmail,
} from './cliente-avulso';

describe('documentoValido', () => {
  it('aceita CPF válido com ou sem máscara', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(documentoValido('529.982.247-25')).toBe('52998224725');
  });
  it('recusa CPF com dígito errado e sequência repetida', () => {
    expect(documentoValido('529.982.247-24')).toBeNull();
    expect(documentoValido('111.111.111-11')).toBeNull();
  });
  it('aceita CNPJ válido e recusa tamanho errado', () => {
    expect(documentoValido('11.222.333/0001-81')).toBe('11222333000181');
    expect(documentoValido('123')).toBeNull();
    expect(documentoValido(null)).toBeNull();
  });
});

describe('telefoneValido', () => {
  it('tira máscara e o 55 do país', () => {
    expect(telefoneValido('+55 (11) 98888-7777')).toBe('11988887777');
    expect(telefoneValido('(11) 3333-4444')).toBe('1133334444');
  });
  it('recusa número sem DDD', () => {
    expect(telefoneValido('98888-7777')).toBeNull();
    expect(telefoneValido('')).toBeNull();
  });
});

describe('emailValido', () => {
  it('normaliza e valida', () => {
    expect(emailValido('  Fulano@Exemplo.com ')).toBe('fulano@exemplo.com');
    expect(emailValido('fulano@')).toBeNull();
  });
});

describe('links de compartilhar', () => {
  const texto = mensagemCobranca({
    nomeCliente: 'Maria', nomeEscritorio: 'Escritório X', descricao: 'Certidão negativa',
    valorFormatado: 'R$ 80,00', vencimento: '10/11/2026', linkFatura: 'https://www.asaas.com/i/abc',
  });

  it('a mensagem leva o link da fatura', () => {
    expect(texto).toContain('https://www.asaas.com/i/abc');
    expect(texto).toContain('do Escritório X');
  });
  it('WhatsApp com número põe o 55; sem número abre a escolha de contato', () => {
    expect(linkWhatsApp('11988887777', texto)).toMatch(/^https:\/\/wa\.me\/5511988887777\?text=/);
    expect(linkWhatsApp(null, texto)).toMatch(/^https:\/\/wa\.me\/\?text=/);
  });
  it('mailto codifica assunto e corpo', () => {
    const l = linkEmail('maria@x.com', 'Cobrança', texto);
    expect(l.startsWith('mailto:maria@x.com?subject=Cobran%C3%A7a&body=')).toBe(true);
    expect(linkEmail('inválido', 'a', 'b')).toBe('mailto:?subject=a&body=b');
  });
});
