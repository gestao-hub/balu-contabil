import { describe, it, expect, beforeAll } from 'vitest';
import { guardarChaveIa, lerChaveIa, mascararChaveIa } from './config-ia';

beforeAll(() => {
  process.env.CERT_ENC_KEY ??= Buffer.alloc(32, 7).toString('base64');
});

const FALSA = 'sk-TESTE-chave-obviamente-falsa-0001';

describe('credencial do provedor de IA', () => {
  it('grava cifrada e lê de volta', () => {
    const c = guardarChaveIa(FALSA);
    expect(c.startsWith('enc:v1:')).toBe(true);
    expect(c).not.toContain(FALSA);
    expect(lerChaveIa(c)).toBe(FALSA);
  });

  it('nula entra, nula sai', () => {
    expect(lerChaveIa(null)).toBeNull();
  });

  // Não há legado de chave em claro nesta coluna: ela nasceu na 0056. Valor sem
  // prefixo só pode ser gravação corrompida, e devolvê-lo cru esconderia um
  // segredo em claro no banco fingindo que está tudo bem.
  it('LANÇA em valor sem cifra, em vez de devolver o valor cru', () => {
    expect(() => lerChaveIa('sk-em-claro')).toThrow();
  });

  it('vazia é recusada na gravação', () => {
    expect(() => guardarChaveIa('')).toThrow();
  });

  it('mascarar não devolve a chave utilizável', () => {
    const m = mascararChaveIa(FALSA);
    expect(m).not.toContain(FALSA.slice(6));
    expect(m).toContain('…');
  });

  // Duas gravacoes da MESMA chave dao cifras diferentes (IV por gravacao). Sem
  // isso, quem olhasse duas linhas do banco saberia que a chave e a mesma.
  it('cifra duas vezes não dá o mesmo texto', () => {
    expect(guardarChaveIa(FALSA)).not.toBe(guardarChaveIa(FALSA));
  });
});
