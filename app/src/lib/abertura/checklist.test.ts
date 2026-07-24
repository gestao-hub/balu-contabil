import { describe, it, expect } from 'vitest';
import { DOC_KEYS } from '@/types/abertura';
import { docsExigidos, estadoDoc } from './checklist';

describe('checklist de abertura', () => {
  it('MEI exige menos docs que LTDA', () => {
    expect(docsExigidos('MEI').length).toBeLessThan(docsExigidos('LTDA').length);
  });
  it('doc sem path = pendente_envio', () => {
    expect(estadoDoc(null, undefined)).toBe('pendente_envio');
  });
  it('doc com path e sem revisao = aguardando_analise', () => {
    expect(estadoDoc('s3://x', undefined)).toBe('aguardando_analise');
  });
  it('doc aprovado', () => {
    expect(estadoDoc('s3://x', { status: 'aprovado' })).toBe('aprovado');
  });
  it('doc recusado', () => {
    expect(estadoDoc('s3://x', { status: 'recusado' })).toBe('recusado');
  });
  it('docsExigidos retorna apenas chaves validas de DOC_KEYS', () => {
    for (const tipo of ['MEI', 'EI', 'LTDA']) {
      for (const k of docsExigidos(tipo)) expect(DOC_KEYS).toContain(k);
    }
  });
});
