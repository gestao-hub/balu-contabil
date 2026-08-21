// A trava de CNPJ do upload de certificado.
//
// POR QUE ESTE ARQUIVO EXISTE: enquanto só o dono subia o próprio certificado,
// trocar o arquivo era improvável. Com o contador subindo o PFX de dezenas de
// clientes (card P11: até 30 por regime), o arquivo errado deixa de ser
// hipótese — e o erro NÃO aparece aqui: o Termo de Autorização é assinado com o
// CNPJ do certificado e o envelope do DAS declara o CNPJ da empresa, a SERPRO
// recusa lá na frente, e a tela diz "a empresa ainda não autorizou a Balu",
// mandando o contador caçar procuração por causa de um arquivo trocado.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const A = '12345678000195';
const B = '98765432000110';

// --- Task 11: branch da origem Focus no upload de certificado --------------
//
// `processarUploadCertificado` faz I/O real (PKCS12, cifra, Storage, SERPRO,
// Focus). Mockamos cada dependência pra provar só a decisão que importa aqui:
// com `focus_origem = 'propria'`, a Focus NUNCA é chamada — o token da empresa
// leva 401 lá (provado 20/08/2026), e a credencial de quem cadastrou não pode
// ser sobrescrita em silêncio.
const NOT_AFTER_FUTURO = '2099-01-01T00:00:00.000Z';

const h = vi.hoisted(() => ({
  parsePkcs12: vi.fn(() => ({
    keyPem: 'key', certPem: 'cert', chainPem: '',
    notBefore: '2020-01-01T00:00:00.000Z', notAfter: '2099-01-01T00:00:00.000Z',
    subjectCN: 'EMPRESA TESTE', cnpj: null, fingerprintSha256: 'ff',
  })),
  encryptBlob: vi.fn(() => Buffer.from('cifrado')),
  storageUploadCertificado: vi.fn(async () => ({ path: 'empresa/certificado.enc' })),
  garantirTokenProcurador: vi.fn(async () => ({ ok: true, token: 'tok', expiration: NOT_AFTER_FUTURO })),
  atualizarEmpresaNaFocus: vi.fn(async () => ({ ok: true, token: null })),
}));

vi.mock('@/lib/fiscal/pkcs12', () => ({ parsePkcs12: h.parsePkcs12 }));
vi.mock('@/lib/crypto/envelope', () => ({ encryptBlob: h.encryptBlob }));
vi.mock('@/lib/clients/supabase-storage', () => ({ uploadCertificado: h.storageUploadCertificado }));
vi.mock('@/lib/fiscal/serpro-procurador', () => ({ garantirTokenProcurador: h.garantirTokenProcurador }));
vi.mock('@/lib/fiscal/focus-empresa-sync', () => ({ atualizarEmpresaNaFocus: h.atualizarEmpresaNaFocus }));

import { conferirCnpjDoCertificado, processarUploadCertificado } from '@/lib/fiscal/cert-upload';

/** Chain do Supabase: toda etapa devolve `this` (thenable) resolvendo pra `result`. */
function makeChain(result: { data: unknown; error: { message: string } | null }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {
    select: () => obj,
    eq: () => obj,
    is: () => obj,
    order: () => obj,
    limit: () => obj,
    maybeSingle: () => obj,
    single: () => obj,
    insert: () => obj,
    update: () => obj,
    then: (resolve: (v: typeof result) => void) => resolve(result),
  };
  return obj;
}

function makeSupabase(fiscalRow: { focus_empresa_id: number | null; focus_origem: string | null } | null) {
  return {
    from: (table: string) => {
      if (table === 'companies') return makeChain({ data: { cnpj: null }, error: null });
      if (table === 'arquivos_auxiliares') return makeChain({ data: null, error: null });
      if (table === 'empresas_fiscais') return makeChain({ data: fiscalRow, error: null });
      return makeChain({ data: null, error: null });
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('processarUploadCertificado — Bloco 5: origem Focus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.parsePkcs12.mockReturnValue({
      keyPem: 'key', certPem: 'cert', chainPem: '',
      notBefore: '2020-01-01T00:00:00.000Z', notAfter: NOT_AFTER_FUTURO,
      subjectCN: 'EMPRESA TESTE', cnpj: null, fingerprintSha256: 'ff',
    });
    h.storageUploadCertificado.mockResolvedValue({ path: 'empresa/certificado.enc' });
    h.garantirTokenProcurador.mockResolvedValue({ ok: true, token: 'tok', expiration: NOT_AFTER_FUTURO });
    h.atualizarEmpresaNaFocus.mockResolvedValue({ ok: true, token: null });
  });

  it("com origem 'propria', NÃO chama a Focus e devolve o aviso", async () => {
    const supabase = makeSupabase({ focus_empresa_id: 999, focus_origem: 'propria' });
    const r = await processarUploadCertificado(
      supabase,
      'empresa-1',
      { bytes: Buffer.from([1, 2, 3]), senha: 'segredo' },
      'user-1',
    );
    expect(r.ok).toBe(true);
    expect(h.atualizarEmpresaNaFocus).not.toHaveBeenCalled();
    if (r.ok) {
      expect(r.warnings.some((w) => w.includes('própria conta na Focus'))).toBe(true);
    }
  });

  it("com origem 'balu' e focus_empresa_id presente, CHAMA a Focus (comportamento existente)", async () => {
    const supabase = makeSupabase({ focus_empresa_id: 999, focus_origem: 'balu' });
    const r = await processarUploadCertificado(
      supabase,
      'empresa-1',
      { bytes: Buffer.from([1, 2, 3]), senha: 'segredo' },
      'user-1',
    );
    expect(r.ok).toBe(true);
    expect(h.atualizarEmpresaNaFocus).toHaveBeenCalledTimes(1);
  });

  it("sem focus_origem gravado (null), trata como 'balu' — mesmo default de resolver-credencial.ts", async () => {
    const supabase = makeSupabase({ focus_empresa_id: 999, focus_origem: null });
    const r = await processarUploadCertificado(
      supabase,
      'empresa-1',
      { bytes: Buffer.from([1, 2, 3]), senha: 'segredo' },
      'user-1',
    );
    expect(r.ok).toBe(true);
    expect(h.atualizarEmpresaNaFocus).toHaveBeenCalledTimes(1);
  });
});

describe('conferirCnpjDoCertificado', () => {
  it('aceita quando os dois CNPJs são o mesmo', () => {
    expect(conferirCnpjDoCertificado(A, A).ok).toBe(true);
  });

  it('aceita ignorando máscara — a comparação é por dígito', () => {
    expect(conferirCnpjDoCertificado('12.345.678/0001-95', A).ok).toBe(true);
  });

  it('RECUSA certificado de outra empresa', () => {
    const r = conferirCnpjDoCertificado(A, B);
    expect(r.ok).toBe(false);
    // A mensagem precisa mostrar OS DOIS números: "certificado inválido" faria o
    // contador tentar de novo com o mesmo arquivo.
    if (!r.ok) {
      expect(r.error).toContain('12.345.678/0001-95');
      expect(r.error).toContain('98.765.432/0001-10');
    }
  });

  it('deixa passar quando o certificado não expõe CNPJ no CN', () => {
    // Recusar aqui seria barrar certificado válido por limitação da NOSSA
    // leitura do subject.
    expect(conferirCnpjDoCertificado(null, A).ok).toBe(true);
    expect(conferirCnpjDoCertificado('', A).ok).toBe(true);
  });

  it('deixa passar quando a empresa ainda não tem CNPJ cadastrado', () => {
    expect(conferirCnpjDoCertificado(A, null).ok).toBe(true);
  });
});
