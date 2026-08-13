// Invariantes de `uploadCertificadoClienteAction` (card P11).
//
// POR QUE ESTE ARQUIVO EXISTE
// Esta é a primeira ESCRITA do contador sobre material criptográfico do cliente,
// e ela roda com service_role — ou seja, sem RLS por baixo para segurar erro. O
// que separa "o escritório instalou o certificado do cliente dele" de "qualquer
// escritório instalou certificado em qualquer empresa" são duas linhas de
// código, e nenhuma delas é verificável por `tsc`: apagar o
// `companyDaCarteira` compila limpo.
//
// Cada teste aqui existe para MORDER uma mudança que hoje passa pelo typecheck:
//   1. sumir com o anti-IDOR da carteira;
//   2. passar o companyId DO FORMULÁRIO adiante em vez do que a carteira provou;
//   3. aceitar upload sem a declaração de autorização do titular;
//   4. registrar auditoria de um upload que falhou (trilha mentindo);
//   5. deixar escritório não aprovado escrever.
//
// O núcleo (`processarUploadCertificado`) é mockado: ele abre PFX de verdade e
// tem rede própria. O que se prova aqui é QUEM pode chamá-lo e COM QUAL empresa.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const CONTABILIDADE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = 'user_contador_1';
const COMPANY_ID = '22222222-2222-4222-8222-222222222222';
const OWNER_ID = 'user_dono_1';

const h = vi.hoisted(() => {
  const estado = {
    guard: null as unknown,
    /** null = a empresa NÃO está na carteira deste escritório. */
    alvo: null as unknown,
    processar: null as unknown,
  };
  return {
    estado,
    processar: vi.fn(async () => estado.processar),
    companyDaCarteira: vi.fn(async () => estado.alvo),
    registrarAuditoria: vi.fn(async () => {}),
    revalidatePath: vi.fn(),
  };
});

vi.mock('next/cache', () => ({ revalidatePath: h.revalidatePath }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ __admin: true }) }));
vi.mock('@/lib/contador/guards', () => ({ requireEscritorioAprovado: async () => h.estado.guard }));
vi.mock('@/lib/contador/carteira', () => ({ companyDaCarteira: h.companyDaCarteira }));
vi.mock('@/lib/fiscal/cert-upload', () => ({ processarUploadCertificado: h.processar }));
vi.mock('@/lib/security/audit', () => ({ registrarAuditoria: h.registrarAuditoria }));

import { uploadCertificadoClienteAction } from './cert-actions';

/** FormData como a tela envia. `.pfx` e senha passam no validador de verdade. */
function fd(over: { companyId?: string; nome?: string; senha?: string; autorizacao?: string } = {}) {
  const f = new FormData();
  f.set('companyId', over.companyId ?? COMPANY_ID);
  f.set('file', new File([new Uint8Array([1, 2, 3, 4])], over.nome ?? 'cliente.pfx'));
  f.set('senha', over.senha ?? 'senha-do-pfx');
  if (over.autorizacao !== '') f.set('autorizacao', over.autorizacao ?? 'on');
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.estado.guard = {
    ok: true, userId: USER_ID, id: CONTABILIDADE_ID,
    contabilidade: { id: CONTABILIDADE_ID, nome: 'Escritorio Teste', status: 'aprovada' },
  };
  h.estado.alvo = { companyId: COMPANY_ID, ownerUserId: OWNER_ID };
  h.estado.processar = { ok: true, warnings: [], notAfter: '2027-08-13T00:00:00.000Z' };
});

describe('uploadCertificadoClienteAction', () => {
  it('recusa empresa fora da carteira SEM tocar no certificado', async () => {
    h.estado.alvo = null;
    const r = await uploadCertificadoClienteAction(fd({ companyId: 'empresa-de-outro-escritorio' }));
    expect(r.ok).toBe(false);
    // O que importa não é a mensagem: é que nada foi escrito.
    expect(h.processar).not.toHaveBeenCalled();
    expect(h.registrarAuditoria).not.toHaveBeenCalled();
  });

  it('usa o companyId PROVADO pela carteira, não o que veio no formulário', async () => {
    // A carteira devolve outra empresa (cenário artificial de propósito): se a
    // action repassar o campo do formulário, o certificado do cliente entra na
    // empresa errada.
    h.estado.alvo = { companyId: COMPANY_ID, ownerUserId: OWNER_ID };
    await uploadCertificadoClienteAction(fd({ companyId: 'id-vindo-do-navegador' }));
    expect(h.processar).toHaveBeenCalledTimes(1);
    expect(h.processar.mock.calls[0][1]).toBe(COMPANY_ID);
  });

  it('recusa sem a declaração de autorização do titular', async () => {
    const r = await uploadCertificadoClienteAction(fd({ autorizacao: '' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/autoriz/i);
    expect(h.processar).not.toHaveBeenCalled();
  });

  it('NÃO registra auditoria quando o upload falha', async () => {
    // Trilha de auditoria de um upload que não aconteceu é pior que trilha
    // nenhuma: ela seria usada para provar consentimento.
    h.estado.processar = { ok: false, error: 'Não foi possível abrir o certificado.' };
    const r = await uploadCertificadoClienteAction(fd());
    expect(r.ok).toBe(false);
    expect(h.registrarAuditoria).not.toHaveBeenCalled();
  });

  it('no sucesso, registra auditoria com ator, empresa e escritório', async () => {
    const r = await uploadCertificadoClienteAction(fd());
    expect(r.ok).toBe(true);
    expect(h.registrarAuditoria).toHaveBeenCalledTimes(1);
    const ev = h.registrarAuditoria.mock.calls[0][0] as Record<string, unknown>;
    expect(ev.acao).toBe('cert.upload_contador');
    expect(ev.actorUserId).toBe(USER_ID);
    expect(ev.alvoId).toBe(COMPANY_ID);
    expect(ev.contabilidadeId).toBe(CONTABILIDADE_ID);
  });

  it('recusa escritório não aprovado antes de qualquer escrita', async () => {
    h.estado.guard = { ok: false, error: 'Escritório não aprovado.' };
    const r = await uploadCertificadoClienteAction(fd());
    expect(r.ok).toBe(false);
    expect(h.companyDaCarteira).not.toHaveBeenCalled();
    expect(h.processar).not.toHaveBeenCalled();
  });

  it('recusa arquivo que não é .pfx/.p12', async () => {
    const r = await uploadCertificadoClienteAction(fd({ nome: 'certificado.txt' }));
    expect(r.ok).toBe(false);
    expect(h.processar).not.toHaveBeenCalled();
  });

  it('devolve o aviso do núcleo sem transformá-lo em erro', async () => {
    // O certificado JÁ está salvo quando a SERPRO/Focus falham; virar erro faria
    // o contador subir tudo de novo achando que não gravou.
    h.estado.processar = { ok: true, warnings: ['Token do procurador falhou.'], notAfter: '2027-01-01T00:00:00.000Z' };
    const r = await uploadCertificadoClienteAction(fd());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warning).toContain('Token do procurador');
  });
});
