// 0094 — a rede das invariantes das credenciais do SERPRO.
//
// Além das mesmas de Focus/IA (UPDATE nunca UPSERT, cifra de verdade, auditoria
// sem segredo, zero-linhas não é sucesso), duas próprias desta tela:
//   1. MEIA CREDENCIAL não pode ser gravada — com só um dos dois no banco,
//      `obterCredenciaisSerpro` cai no fallback de ambiente e a chamada sai com
//      a credencial ANTIGA. O admin veria "salvo" e a Receita responderia com a
//      de antes;
//   2. trocar o certificado do contratante tem de ZERAR os tokens de sessão —
//      eles foram emitidos para o certificado velho, e reusá-los faria a
//      Receita recusar por um motivo que pareceria falha dela.
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { lerSegredoSerpro } from '@/lib/fiscal/config-serpro';

const USER_ID = 'user_admin_1';
const KEY_FALSA = 'TESTE-consumer-key-obviamente-falsa-0001';
const SECRET_FALSO = 'TESTE-consumer-secret-obviamente-falso-0002';
const SENHA_CERT = 'senha-de-teste';

type Chamada = { tabela: string; valores: Record<string, unknown>; eq: unknown[][]; select: string[] };

const h = vi.hoisted(() => {
  const updates: Chamada[] = [];
  const inserts: Chamada[] = [];
  const auditorias: Array<{ acao: string; meta?: Record<string, unknown> }> = [];

  const estado = {
    guard: { userId: 'user_admin_1' } as unknown,
    /** Linhas por tabela. `null` = tabela vazia. */
    linhas: {} as Record<string, Record<string, unknown> | null>,
    erroLeitura: null as { message: string } | null,
    erroEscrita: null as { message: string } | null,
    /** O que `parsePkcs12` devolve; `null` faz lançar (senha errada). */
    material: null as Record<string, unknown> | null,
    contratante: null as Record<string, unknown> | null,
    erroAuth: null as unknown,
  };

  function construir(tabela: string, kind: 'update' | 'insert', valores: Record<string, unknown>) {
    const chamada: Chamada = { tabela, valores, eq: [], select: [] };
    (kind === 'update' ? updates : inserts).push(chamada);
    const resultado = () => {
      if (estado.erroEscrita) return { data: null, error: estado.erroEscrita };
      if (kind === 'update') {
        const linha = estado.linhas[tabela] ?? null;
        const casou = linha !== null
          && chamada.eq.every(([col, val]) => linha[col as string] === val);
        if (!casou) return { data: chamada.select.length ? [] : null, error: null };
        Object.assign(linha, valores);
        if (chamada.select.length === 0) return { data: null, error: null };
        return { data: [{ id: linha.id }], error: null };
      }
      if (chamada.select.length === 0) return { data: null, error: null };
      return { data: [{ id: 1 }], error: null };
    };
    const b = {
      eq: (c: unknown, v: unknown) => { chamada.eq.push([c, v]); return b; },
      select: (cols: string) => { chamada.select.push(cols); return b; },
      then: (ok: (v: unknown) => unknown, falhou?: (e: unknown) => unknown) =>
        Promise.resolve(resultado()).then(ok, falhou),
    };
    return b;
  }

  const from = vi.fn((tabela: string) => ({
    select: (_cols: string) => {
      const b = {
        eq: (_c: unknown, _v: unknown) => b,
        limit: (_n: number) => b,
        maybeSingle: async () => ({
          data: estado.erroLeitura ? null : (estado.linhas[tabela] ?? null),
          error: estado.erroLeitura,
        }),
      };
      return b;
    },
    update: (valores: Record<string, unknown>) => construir(tabela, 'update', valores),
    insert: (valores: Record<string, unknown>) => construir(tabela, 'insert', valores),
  }));

  const registrarAuditoria = vi.fn(async (e: { acao: string; meta?: Record<string, unknown> }) => {
    auditorias.push(e);
  });
  const revalidatePath = vi.fn((_p: string) => {});
  const parsePkcs12 = vi.fn((_pfx: Buffer, _senha: string) => {
    if (!estado.material) throw new Error('PKCS#12 MAC could not be verified. Invalid password?');
    return estado.material;
  });
  const getContratante = vi.fn(async () => estado.contratante);
  const autenticarContratante = vi.fn(async (_pfx: Buffer, _senha: string) => {
    if (estado.erroAuth) throw estado.erroAuth;
    return { jwt: 'j', accessToken: 'a', expiration: '2026-01-01T00:00:00Z' };
  });

  return {
    updates, inserts, auditorias, estado, from,
    registrarAuditoria, revalidatePath, parsePkcs12, getContratante, autenticarContratante,
  };
});

vi.mock('next/cache', () => ({ revalidatePath: h.revalidatePath }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: h.from }) }));
vi.mock('@/lib/admin/guard', () => ({ requireAdminBaluAction: async () => h.estado.guard }));
vi.mock('@/lib/security/audit', () => ({ registrarAuditoria: h.registrarAuditoria }));
vi.mock('@/lib/fiscal/pkcs12', () => ({ parsePkcs12: h.parsePkcs12 }));
vi.mock('@/lib/fiscal/serpro-contratante', () => ({ getContratante: h.getContratante }));
vi.mock('@/lib/clients/serpro-auth', () => ({ autenticarContratante: h.autenticarContratante }));

import {
  salvarConfigSerproAction,
  enviarCertContratanteAction,
  testarConexaoSerproAction,
} from './actions';

beforeAll(() => {
  process.env.CERT_ENC_KEY ??= Buffer.alloc(32, 7).toString('base64');
});

const DAQUI_A_UM_ANO = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();

beforeEach(() => {
  h.updates.length = 0;
  h.inserts.length = 0;
  h.auditorias.length = 0;
  h.estado.guard = { userId: USER_ID };
  h.estado.linhas = {
    config_serpro: { id: 1, consumer_key_cifrado: null, consumer_secret_cifrado: null },
    serpro_contratante: null,
  };
  h.estado.erroLeitura = null;
  h.estado.erroEscrita = null;
  h.estado.material = {
    notAfter: DAQUI_A_UM_ANO,
    subjectCN: 'PIPER AUTOMACOES LTDA:12345678000199',
    cnpj: '12345678000199',
  };
  h.estado.contratante = null;
  h.estado.erroAuth = null;
  h.registrarAuditoria.mockClear();
  h.revalidatePath.mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

function arquivoPfx(bytes = 128): FormData {
  const fd = new FormData();
  fd.set('arquivo', new File([new Uint8Array(bytes)], 'cert.pfx'));
  fd.set('senha', SENHA_CERT);
  return fd;
}

describe('salvarConfigSerproAction', () => {
  it('exige AdminBalu', async () => {
    h.estado.guard = { error: 'Acesso restrito.' };
    const r = await salvarConfigSerproAction({ consumer_key: KEY_FALSA });
    expect(r).toEqual({ ok: false, error: 'Acesso restrito.' });
    expect(h.updates).toHaveLength(0);
  });

  it('os dois campos vazios NÃO gravam nada', async () => {
    const r = await salvarConfigSerproAction({ consumer_key: '', consumer_secret: '  ' });
    expect(r.ok).toBe(false);
    expect(h.updates).toHaveLength(0);
    expect(h.inserts).toHaveLength(0);
  });

  // A INVARIANTE PRÓPRIA DESTA TELA.
  it('recusa gravar MEIA credencial quando o banco está vazio', async () => {
    const r = await salvarConfigSerproAction({ consumer_key: KEY_FALSA });
    expect(r.ok).toBe(false);
    expect('error' in r && r.error).toMatch(/juntos/);
    expect(h.updates).toHaveLength(0);
    expect(h.inserts).toHaveLength(0);
  });

  it('trocar só o secret, com a key já gravada, NÃO toca a key', async () => {
    h.estado.linhas.config_serpro = {
      id: 1, consumer_key_cifrado: 'enc:v1:qualquer', consumer_secret_cifrado: 'enc:v1:outro',
    };
    const r = await salvarConfigSerproAction({ consumer_secret: SECRET_FALSO });
    expect(r).toEqual({ ok: true });
    expect(h.updates).toHaveLength(1);
    expect(Object.keys(h.updates[0].valores)).toContain('consumer_secret_cifrado');
    expect(Object.keys(h.updates[0].valores)).not.toContain('consumer_key_cifrado');
  });

  it('a credencial vai CIFRADA e decifra de volta', async () => {
    const r = await salvarConfigSerproAction({
      consumer_key: KEY_FALSA, consumer_secret: SECRET_FALSO,
    });
    expect(r).toEqual({ ok: true });
    const v = h.updates[0].valores;
    expect(String(v.consumer_key_cifrado)).toMatch(/^enc:v1:/);
    expect(String(v.consumer_key_cifrado)).not.toContain(KEY_FALSA);
    expect(lerSegredoSerpro(v.consumer_key_cifrado as string)).toBe(KEY_FALSA);
    expect(lerSegredoSerpro(v.consumer_secret_cifrado as string)).toBe(SECRET_FALSO);
  });

  it('a auditoria não carrega a credencial', async () => {
    await salvarConfigSerproAction({ consumer_key: KEY_FALSA, consumer_secret: SECRET_FALSO });
    const serializada = JSON.stringify(h.auditorias[0]);
    expect(serializada).not.toContain(KEY_FALSA);
    expect(serializada).not.toContain(SECRET_FALSO);
    expect(h.auditorias[0].meta).toEqual({ trocou_key: true, trocou_secret: true });
  });
});

describe('enviarCertContratanteAction', () => {
  it('exige AdminBalu', async () => {
    h.estado.guard = { error: 'Acesso restrito.' };
    const r = await enviarCertContratanteAction(arquivoPfx());
    expect(r).toEqual({ ok: false, error: 'Acesso restrito.' });
  });

  it('sem arquivo, recusa', async () => {
    const fd = new FormData();
    fd.set('senha', SENHA_CERT);
    const r = await enviarCertContratanteAction(fd);
    expect(r.ok).toBe(false);
    expect(h.inserts).toHaveLength(0);
  });

  it('arquivo grande demais morre antes do parse', async () => {
    const fd = new FormData();
    fd.set('arquivo', new File([new Uint8Array(600 * 1024)], 'gordo.pfx'));
    fd.set('senha', SENHA_CERT);
    const r = await enviarCertContratanteAction(fd);
    expect(r.ok).toBe(false);
    expect(h.parsePkcs12).not.toHaveBeenCalled();
  });

  it('senha errada não grava nada', async () => {
    // `parsePkcs12` é o que valida a senha de verdade. Guardar sem abrir
    // deixaria o erro para o primeiro mTLS, dentro do cron, longe de quem
    // digitou.
    h.estado.material = null;
    const r = await enviarCertContratanteAction(arquivoPfx());
    expect(r.ok).toBe(false);
    expect(h.inserts).toHaveLength(0);
    expect(h.updates).toHaveLength(0);
  });

  it('certificado expirado é recusado', async () => {
    h.estado.material = {
      notAfter: '2020-01-01T00:00:00Z', subjectCN: 'X:12345678000199', cnpj: '12345678000199',
    };
    const r = await enviarCertContratanteAction(arquivoPfx());
    expect(r.ok).toBe(false);
    expect('error' in r && r.error).toMatch(/[Ee]xpirado/);
    expect(h.inserts).toHaveLength(0);
  });

  it('certificado sem CNPJ é recusado — a coluna é NOT NULL e identifica o contratante', async () => {
    h.estado.material = { notAfter: DAQUI_A_UM_ANO, subjectCN: 'FULANO DE TAL', cnpj: null };
    const r = await enviarCertContratanteAction(arquivoPfx());
    expect(r.ok).toBe(false);
    expect('error' in r && r.error).toMatch(/e-CNPJ/);
    expect(h.inserts).toHaveLength(0);
  });

  it('grava cifrado e ZERA os tokens de sessão do certificado antigo', async () => {
    h.estado.linhas.serpro_contratante = { id: 'c1', auth_access_token: 'velho', auth_jwt_token: 'velho' };
    const r = await enviarCertContratanteAction(arquivoPfx());
    expect(r).toEqual({ ok: true });

    const v = h.updates.find((u) => u.tabela === 'serpro_contratante')!.valores;
    expect(v.auth_access_token).toBeNull();
    expect(v.auth_jwt_token).toBeNull();
    expect(v.auth_token_expiration).toBeNull();
    expect(v.cnpj).toBe('12345678000199');
    // Nem o PFX nem a senha vão em claro: as duas colunas são base64 de blob
    // cifrado, e a senha digitada não aparece dentro delas.
    expect(String(v.cert_password_enc)).not.toContain(SENHA_CERT);
    expect(typeof v.cert_pfx_enc).toBe('string');
  });

  it('a auditoria registra o certificado, nunca o arquivo nem a senha', async () => {
    await enviarCertContratanteAction(arquivoPfx());
    const serializada = JSON.stringify(h.auditorias[0]);
    expect(serializada).not.toContain(SENHA_CERT);
    expect(h.auditorias[0].meta).toMatchObject({ cnpj: '12345678000199' });
  });
});

describe('testarConexaoSerproAction', () => {
  it('sem certificado guardado, diz isso em vez de tentar', async () => {
    h.estado.contratante = null;
    const r = await testarConexaoSerproAction();
    expect(r.ok).toBe(false);
    expect(h.autenticarContratante).not.toHaveBeenCalled();
  });

  it('autentica de verdade quando há contratante', async () => {
    h.estado.contratante = { pfx: Buffer.from('x'), senha: 's' };
    const r = await testarConexaoSerproAction();
    expect(r).toEqual({ ok: true });
    expect(h.autenticarContratante).toHaveBeenCalledTimes(1);
  });

  it('401 é lido como recusa da credencial ou do certificado', async () => {
    h.estado.contratante = { pfx: Buffer.from('x'), senha: 's' };
    h.estado.erroAuth = new Error('SERPRO /authenticate → 401: denied');
    const r = await testarConexaoSerproAction();
    expect(r.ok).toBe(false);
    expect('error' in r && r.error).toMatch(/recusou/);
  });

  it('erro que NÃO é 401/403 diz que a credencial não foi recusada', async () => {
    h.estado.contratante = { pfx: Buffer.from('x'), senha: 's' };
    h.estado.erroAuth = new Error('ETIMEDOUT');
    const r = await testarConexaoSerproAction();
    expect(r.ok).toBe(false);
    expect('error' in r && r.error).toMatch(/não recusou/);
  });
});
