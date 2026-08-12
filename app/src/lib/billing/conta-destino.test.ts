import { describe, it, expect, beforeAll } from 'vitest';
import { validarContaDestino, resumoDaConta, guardarContaDestino, lerContaDestino, type ContaDestino } from './conta-destino';

beforeAll(() => {
  // O envelope exige chave; nos testes basta uma fixa de 32 bytes.
  process.env.CERT_ENC_KEY ??= Buffer.alloc(32, 7).toString('base64');
});

const valida: ContaDestino = {
  bancoCodigo: '341', bancoNome: 'Itaú', agencia: '1234', conta: '567890',
  contaDigito: '1', tipo: 'CONTA_CORRENTE', titular: 'Fulano de Tal', cpfCnpj: '52998224725',
};

describe('validarContaDestino', () => {
  it('aceita conta completa e normaliza o que é numérico', () => {
    const r = validarContaDestino({ ...valida, agencia: '1.234', cpfCnpj: '529.982.247-25', bancoCodigo: '41' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.conta.agencia).toBe('1234');
      expect(r.conta.cpfCnpj).toBe('52998224725');
      expect(r.conta.bancoCodigo).toBe('041');   // padStart, não vira '41'
    }
  });

  it('recusa CPF com dígito verificador errado', () => {
    // Só checar tamanho deixaria passar '11111111111' e digitação trocada — e
    // dinheiro enviado para a conta errada não volta sozinho.
    const r = validarContaDestino({ ...valida, cpfCnpj: '52998224726' });
    expect(r).toMatchObject({ ok: false, erro: expect.stringContaining('CPF/CNPJ') });
  });

  it('recusa CPF com todos os dígitos iguais', () => {
    expect(validarContaDestino({ ...valida, cpfCnpj: '11111111111' }).ok).toBe(false);
  });

  it('aceita CNPJ válido', () => {
    expect(validarContaDestino({ ...valida, cpfCnpj: '11222333000181' }).ok).toBe(true);
  });

  it('recusa CNPJ inválido', () => {
    expect(validarContaDestino({ ...valida, cpfCnpj: '11222333000182' }).ok).toBe(false);
  });

  it('aceita dígito X', () => {
    expect(validarContaDestino({ ...valida, contaDigito: 'x' }).ok).toBe(true);
  });

  it('recusa dígito com mais de um caractere', () => {
    expect(validarContaDestino({ ...valida, contaDigito: '12' }).ok).toBe(false);
  });

  it('recusa campos vazios com mensagem específica', () => {
    expect(validarContaDestino({ ...valida, titular: '' })).toMatchObject({ ok: false, erro: expect.stringContaining('titular') });
    expect(validarContaDestino({ ...valida, agencia: '' })).toMatchObject({ ok: false, erro: expect.stringContaining('Agência') });
    expect(validarContaDestino({ ...valida, bancoNome: '' })).toMatchObject({ ok: false, erro: expect.stringContaining('banco') });
  });

  it('tipo desconhecido cai em conta corrente, não estoura', () => {
    const r = validarContaDestino({ ...valida, tipo: 'CONTA_SALARIO' as unknown as ContaDestino['tipo'] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.conta.tipo).toBe('CONTA_CORRENTE');
  });
});

describe('resumoDaConta', () => {
  it('não expõe CPF nem a conta inteira', () => {
    const s = resumoDaConta(valida);
    expect(s).toContain('****7890-1');
    expect(s).not.toContain('52998224725');
    expect(s).not.toContain('567890');
  });
});

describe('cifra da conta de destino', () => {
  it('vai e volta pelo envelope, e o cifrado não contém o CPF em claro', () => {
    const cifrada = guardarContaDestino(valida);
    expect(cifrada).not.toContain('52998224725');
    expect(cifrada).not.toContain('1234');
    expect(lerContaDestino(cifrada)).toEqual(valida);
  });

  it('valor corrompido devolve null em vez de derrubar a tela', () => {
    expect(lerContaDestino('enc:v1:lixo')).toBeNull();
    expect(lerContaDestino(null)).toBeNull();
  });
});
