import { describe, it, expect } from 'vitest';
import { documentosParaVm, grupoParaVm, validarArquivoDocumento, TAMANHO_MAXIMO_BYTES } from './documentos-subconta';

describe('grupoParaVm', () => {
  // O caso real medido no Escritório Demo em 06/10/2026.
  it('documento não enviado e sem link: pode enviar pela Balu', () => {
    const vm = grupoParaVm({
      id: 'g1', status: 'NOT_SENT', type: 'IDENTIFICATION', title: 'Documentos de identificação',
      responsible: { name: 'Fulano' }, onboardingUrl: null,
    });
    expect(vm).toMatchObject({ grupoId: 'g1', status: 'NOT_SENT', podeEnviar: true, responsavel: 'Fulano' });
    expect(vm.titulo).toContain('identificação');
  });

  it('com onboardingUrl o envio é pelo link, NUNCA pela API', () => {
    const vm = grupoParaVm({ id: 'g2', status: 'NOT_SENT', type: 'SOCIAL_CONTRACT', onboardingUrl: 'https://asaas/x' });
    expect(vm.podeEnviar).toBe(false);
    expect(vm.linkEnvio).toBe('https://asaas/x');
  });

  it('recusado pode reenviar; enviado/aprovado não', () => {
    expect(grupoParaVm({ id: 'a', status: 'REJECTED', type: 'IDENTIFICATION' }).podeEnviar).toBe(true);
    expect(grupoParaVm({ id: 'b', status: 'PENDING', type: 'IDENTIFICATION' }).podeEnviar).toBe(false);
    expect(grupoParaVm({ id: 'c', status: 'APPROVED', type: 'IDENTIFICATION' }).podeEnviar).toBe(false);
  });

  it('status desconhecido não vira ação nem aprovação', () => {
    const vm = grupoParaVm({ id: 'd', status: 'ALGO_NOVO', type: 'CUSTOM', title: 'X' });
    expect(vm.status).toBe('PENDING');
    expect(vm.podeEnviar).toBe(false);
  });
});

describe('documentosParaVm', () => {
  it('some com o ignorado e devolve o motivo geral de recusa', () => {
    const r = documentosParaVm({
      rejectReasons: ' foto ilegível ',
      data: [
        { id: 'a', status: 'NOT_SENT', type: 'IDENTIFICATION' },
        { id: 'b', status: 'IGNORED', type: 'INVOICE' },
      ],
    });
    expect(r.grupos.map((g) => g.grupoId)).toEqual(['a']);
    expect(r.motivoRecusa).toBe('foto ilegível');
  });
  it('resposta vazia não quebra', () => {
    expect(documentosParaVm(null)).toEqual({ grupos: [], motivoRecusa: null });
  });
});

describe('validarArquivoDocumento', () => {
  it('aceita foto e PDF dentro do limite', () => {
    expect(validarArquivoDocumento({ size: 1000, type: 'image/jpeg' })).toBeNull();
    expect(validarArquivoDocumento({ size: 1000, type: 'application/pdf' })).toBeNull();
  });
  it('recusa vazio, tipo errado e arquivo grande', () => {
    expect(validarArquivoDocumento({ size: 0, type: 'image/jpeg' })).toMatch(/Escolha/);
    expect(validarArquivoDocumento({ size: 10, type: 'image/heic' })).toMatch(/JPG ou PNG/);
    expect(validarArquivoDocumento({ size: TAMANHO_MAXIMO_BYTES + 1, type: 'image/png' })).toMatch(/4 MB/);
  });
});
