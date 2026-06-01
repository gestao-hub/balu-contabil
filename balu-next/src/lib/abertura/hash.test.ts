// src/lib/abertura/hash.test.ts
import { describe, it, expect } from 'vitest';
import { canonical, dadosHash, sha256File } from './hash';
import { EMPTY_ABERTURA } from '@/types/abertura';

describe('canonical / dadosHash', () => {
  it('é estável independente da ordem de inserção das chaves dos docs', () => {
    const data = { ...EMPTY_ABERTURA, titular_nome_completo: 'Ana' };
    const a = canonical(data, { doc_rg_frente: 'h1', doc_cpf: 'h2' });
    const b = canonical(data, { doc_cpf: 'h2', doc_rg_frente: 'h1' });
    expect(dadosHash(a)).toBe(dadosHash(b));
  });

  it('muda o hash quando um campo textual muda', () => {
    const base = dadosHash(canonical({ ...EMPTY_ABERTURA, titular_nome_completo: 'Ana' }, {}));
    const alt = dadosHash(canonical({ ...EMPTY_ABERTURA, titular_nome_completo: 'Bia' }, {}));
    expect(base).not.toBe(alt);
  });

  it('muda o hash quando um content-hash de documento muda', () => {
    const base = dadosHash(canonical(EMPTY_ABERTURA, { doc_cpf: 'h1' }));
    const alt = dadosHash(canonical(EMPTY_ABERTURA, { doc_cpf: 'h2' }));
    expect(base).not.toBe(alt);
  });

  it('muda o hash ao alternar um campo booleano (sede_mesmo_que_titular)', () => {
    const off = dadosHash(canonical({ ...EMPTY_ABERTURA, sede_mesmo_que_titular: false }, {}));
    const on = dadosHash(canonical({ ...EMPTY_ABERTURA, sede_mesmo_que_titular: true }, {}));
    expect(off).not.toBe(on);
    // mesmo valor booleano produz o mesmo hash
    const onAgain = dadosHash(canonical({ ...EMPTY_ABERTURA, sede_mesmo_que_titular: true }, {}));
    expect(on).toBe(onAgain);
  });

  it('normaliza arrays (ordem estável) e trim de strings', () => {
    const a = dadosHash(canonical({ ...EMPTY_ABERTURA, empresa_cnaes_secundarios: ['b', 'a'] }, {}));
    const b = dadosHash(canonical({ ...EMPTY_ABERTURA, empresa_cnaes_secundarios: ['a', 'b'] }, {}));
    expect(a).toBe(b);
  });

  it('sha256File devolve hex determinístico', () => {
    expect(sha256File(Buffer.from('abc'))).toBe(sha256File(Buffer.from('abc')));
    expect(sha256File(Buffer.from('abc'))).not.toBe(sha256File(Buffer.from('abd')));
  });
});
