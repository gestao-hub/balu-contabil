import { describe, it, expect } from 'vitest';
import { acharCnpj, acharEmail, acharTelefone, acharCrc, redigir, intencaoPorPalavras } from './extrair';

describe('acharCnpj', () => {
  it('acha com máscara e sem máscara', () => {
    expect(acharCnpj('meu cnpj é 11.222.333/0001-81')).toBe('11222333000181');
    expect(acharCnpj('cnpj 11222333000181 ok')).toBe('11222333000181');
  });

  it('recusa 14 dígitos que não são CNPJ válido', () => {
    // Um telefone com DDD e ramal também tem 14 dígitos. Aceitar por tamanho
    // faria a consulta à Receita falhar por um motivo que o usuário não
    // entenderia ("CNPJ não encontrado" quando ele mandou um telefone).
    expect(acharCnpj('11222333000182')).toBeNull();
    expect(acharCnpj('11111111111111')).toBeNull();
  });

  it('não confunde CPF com CNPJ', () => {
    expect(acharCnpj('meu cpf 529.982.247-25')).toBeNull();
  });
});

describe('acharEmail / acharTelefone / acharCrc', () => {
  it('e-mail volta em minúsculas', () => {
    expect(acharEmail('escreve pra Fulano@Empresa.com.BR')).toBe('fulano@empresa.com.br');
  });

  it('telefone com e sem 9º dígito', () => {
    expect(acharTelefone('(11) 98888-7777')).toBe('11988887777');
    expect(acharTelefone('11 3333-4444')).toBe('1133334444');
  });

  it('CRC em vários formatos', () => {
    expect(acharCrc('CRC SP-123456')).toEqual({ crc: '123456', uf: 'SP' });
    expect(acharCrc('meu crc é rj/98765')).toEqual({ crc: '98765', uf: 'RJ' });
  });

  it('recusa UF inexistente', () => {
    expect(acharCrc('XX-123456')).toBeNull();
  });
});

describe('redigir — o contrato de privacidade com o provedor de IA', () => {
  it('troca CNPJ, e-mail e telefone por marcadores', () => {
    const r = redigir('oi, sou a padaria, cnpj 11.222.333/0001-81, email joao@padaria.com, tel (11) 98888-7777');
    expect(r.texto).not.toContain('11222333');
    expect(r.texto).not.toContain('11.222.333');
    expect(r.texto).not.toContain('joao@padaria.com');
    expect(r.texto).not.toContain('98888');
    expect(r.texto).toContain('⟨CNPJ⟩');
    expect(r.texto).toContain('⟨EMAIL⟩');
    expect(r.texto).toContain('⟨TELEFONE⟩');
  });

  it('devolve os valores extraídos para o app usar', () => {
    const r = redigir('cnpj 11.222.333/0001-81 e email joao@padaria.com');
    expect(r.campos).toMatchObject({ cnpj: '11222333000181', email: 'joao@padaria.com' });
  });

  it('número longo desconhecido também não vaza', () => {
    // Inscrição estadual, CPF sem máscara, número de conta: nada disso precisa
    // chegar ao modelo para ele formular a próxima pergunta.
    const r = redigir('minha inscrição é 123456789012');
    expect(r.texto).not.toContain('123456789012');
    expect(r.texto).toContain('⟨NUMERO⟩');
  });

  it('preserva o texto útil em volta', () => {
    const r = redigir('sou contador e meu crc é SP-123456');
    expect(r.texto).toContain('sou contador');
  });

  it('texto sem dado pessoal passa intacto', () => {
    expect(redigir('quero abrir uma empresa').texto).toBe('quero abrir uma empresa');
  });
});

describe('intencaoPorPalavras — a fundação que funciona sem IA', () => {
  it('reconhece contador', () => {
    expect(intencaoPorPalavras('sou contador')).toBe('contador');
    expect(intencaoPorPalavras('tenho um escritório de contabilidade')).toBe('contador');
    expect(intencaoPorPalavras('quero atender meus clientes aqui')).toBe('contador');
  });

  it('reconhece quem quer abrir empresa', () => {
    expect(intencaoPorPalavras('ainda não tenho CNPJ, quero abrir')).toBe('abertura');
    expect(intencaoPorPalavras('preciso da abertura da empresa')).toBe('abertura');
  });

  it('reconhece quem já tem empresa', () => {
    expect(intencaoPorPalavras('já tenho empresa aberta')).toBe('empresa_existente');
    expect(intencaoPorPalavras('sou MEI')).toBe('empresa_existente');
  });

  it('CNPJ na mensagem já indica empresa existente', () => {
    expect(intencaoPorPalavras('11.222.333/0001-81')).toBe('empresa_existente');
  });

  it('contador que quer abrir empresa para o cliente continua contador', () => {
    // O papel manda mais que a tarefa: mandá-lo para o wizard de abertura o
    // cadastraria como empresário e ele perderia o painel do escritório.
    expect(intencaoPorPalavras('sou contador e quero abrir uma empresa para meu cliente')).toBe('contador');
  });

  it('mensagem vaga fica indefinida em vez de chutar', () => {
    expect(intencaoPorPalavras('oi, tudo bem?')).toBe('indefinido');
    expect(intencaoPorPalavras('quero começar')).toBe('indefinido');
  });
});
