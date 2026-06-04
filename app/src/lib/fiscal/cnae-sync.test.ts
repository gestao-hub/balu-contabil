import { describe, it, expect } from 'vitest';
import { montarStubsCnaeAnexo } from './cnae-sync';

describe('montarStubsCnaeAnexo', () => {
  it('cria stub só para CNAE ainda não catalogado', () => {
    const stubs = montarStubsCnaeAnexo(
      [{ codigo: '4299501', descricao: 'Já existe' }, { codigo: '9999999', descricao: 'Novo' }],
      new Set(['4299501']),
    );
    expect(stubs).toEqual([
      { codigo: '9999999', descricao: 'Novo', anexo_base: null, fator_r: false, anexo_iv: false, observacao: 'auto-stub — curar' },
    ]);
  });

  it('normaliza o código (tira máscara) e deduplica', () => {
    const stubs = montarStubsCnaeAnexo(
      [{ codigo: '62.01-5/01', descricao: 'A' }, { codigo: '6201501', descricao: 'A dup' }],
      new Set(),
    );
    expect(stubs.map((s) => s.codigo)).toEqual(['6201501']);
  });

  it('descrição ausente vira null; código vazio é ignorado', () => {
    const stubs = montarStubsCnaeAnexo(
      [{ codigo: '1234567' }, { codigo: '' }, { codigo: '---' }],
      new Set(),
    );
    expect(stubs).toEqual([
      { codigo: '1234567', descricao: null, anexo_base: null, fator_r: false, anexo_iv: false, observacao: 'auto-stub — curar' },
    ]);
  });

  it('tudo já catalogado → nenhum stub', () => {
    expect(montarStubsCnaeAnexo([{ codigo: '4299501' }], new Set(['4299501']))).toEqual([]);
  });
});
