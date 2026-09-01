import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A ORDEM DA GUARDA EM `uploadCertificadoAction`.
 *
 * ─── POR QUE UM TESTE SÓ SOBRE ORDEM ────────────────────────────────────────
 * Até 01/09/2026 a action validava o arquivo — nome, tamanho, senha — ANTES de
 * saber de quem era a empresa. Duas consequências, e a segunda é a que importa:
 *
 *   1. entregava um oráculo de validação de certificado sobre CNPJ alheio a
 *      qualquer membro de escritório;
 *   2. o que estava logo atrás não era leitura. `processarUploadCertificado`
 *      grava em `${companyId}/certificado.enc` com client de SERVICE ROLE e
 *      `upsert: true` — a chave privada A1 cifrada do cliente, sobrescrita por
 *      cima da RLS.
 *
 * O caso E2E irmão (`tests/idor-actions-titular.spec.ts`) cobre as outras 11
 * actions, mas não esta: invocar uma Server Action que recebe `FormData` pelo
 * protocolo `Next-Action` exige uma codificação multipart que o Next monta a
 * partir de um `<form>`, e uma requisição montada à mão morre em "Connection
 * closed" — o teste mediria o decoder do framework, não a defesa.
 *
 * Aqui a pergunta fica direta: com `FormData` VAZIO — sem arquivo nenhum — a
 * resposta tem de ser a de posse, e não "Selecione o arquivo do certificado".
 * Só isso separa "guarda antes" de "guarda depois".
 */

const h = vi.hoisted(() => ({
  userId: 'usuario-contador',
  // Empresa ativa que o usuário NÃO possui — o estado que a 0100 permite para
  // membro de escritório com o cliente na carteira.
  ativa: { ok: false as const, motivo: 'nao_e_dono' as const },
  processarChamado: 0,
  validarChamado: 0,
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: h.userId } } }) },
  }),
}));

vi.mock('@/lib/lgpd/pendencia-aceite', () => ({
  assertAceitesEmDia: async () => ({ ok: true }),
}));

vi.mock('@/lib/auth/empresa-dono', async (original) => {
  const real = await original<typeof import('@/lib/auth/empresa-dono')>();
  return {
    ...real,
    // A guarda real é testada em `empresa-dono`; aqui o que se mede é se ela é
    // CHAMADA, e antes de quê.
    empresaAtivaDoDono: async () => h.ativa,
  };
});

vi.mock('@/lib/fiscal/cert-upload', () => ({
  processarUploadCertificado: async () => {
    h.processarChamado += 1;
    return { ok: true, warnings: [], producao: { liberada: false } };
  },
}));

vi.mock('@/lib/fiscal/certificado', async (original) => {
  const real = await original<Record<string, unknown>>();
  return {
    ...real,
    validateCertificadoUpload: (...args: unknown[]) => {
      h.validarChamado += 1;
      return (real.validateCertificadoUpload as (...a: unknown[]) => unknown)(...args);
    },
  };
});

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

import { uploadCertificadoAction } from './actions';
import { MENSAGEM_NAO_E_DONO } from '@/lib/auth/empresa-dono';

describe('uploadCertificadoAction — a guarda de posse vem antes do arquivo', () => {
  beforeEach(() => {
    h.processarChamado = 0;
    h.validarChamado = 0;
    h.ativa = { ok: false, motivo: 'nao_e_dono' };
  });

  it('FormData VAZIO em empresa alheia responde posse, não "selecione o arquivo"', async () => {
    const r = await uploadCertificadoAction(new FormData());
    expect(r).toEqual({ ok: false, error: MENSAGEM_NAO_E_DONO });
  });

  it('não chega a validar o certificado nem a processar o upload', async () => {
    const fd = new FormData();
    fd.set('senha', 'seja-la-qual-for');
    fd.set('file', new File([new Uint8Array([1, 2, 3])], 'cert.pfx'));
    const r = await uploadCertificadoAction(fd);

    expect(r).toEqual({ ok: false, error: MENSAGEM_NAO_E_DONO });
    // As duas asserções que fecham o achado: nenhum oráculo de validação, e
    // nenhuma escrita no storage da empresa alheia.
    expect(h.validarChamado, 'validou o certificado de empresa alheia').toBe(0);
    expect(h.processarChamado, 'processou upload em empresa alheia').toBe(0);
  });

  it('sem empresa ativa a mensagem é outra — os dois motivos não se confundem', async () => {
    h.ativa = { ok: false, motivo: 'sem_empresa' } as never;
    const r = await uploadCertificadoAction(new FormData());
    expect(r).toEqual({ ok: false, error: 'Nenhuma empresa selecionada.' });
  });
});
