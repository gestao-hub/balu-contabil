import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const estado = {
    anterior: null as { resultado: string } | null,
    empresa: { user_id: 'dono_1', contabilidade_id: 'contab_1', nome: 'Padaria', razao_social: null },
    membros: [{ user_id: 'contador_1' }],
    erroInsert: null as { message: string } | null,
  };
  const inserts: { tabela: string; valores: Record<string, unknown> }[] = [];
  const upserts: { tabela: string; linhas: Record<string, unknown>[] }[] = [];
  const from = (tabela: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'limit', 'is', 'not']) b[m] = () => b;
    b.maybeSingle = async () => ({
      data: tabela === 'companies' ? estado.empresa : tabela === 'relatorios_situacao_fiscal' ? estado.anterior : null,
      error: null,
    });
    b.then = (ok: (v: unknown) => unknown) => Promise.resolve({
      data: tabela === 'contabilidade_membros' ? estado.membros : [], error: null,
    }).then(ok);
    b.insert = (valores: Record<string, unknown>) => {
      inserts.push({ tabela, valores });
      return { select: () => ({ single: async () => (estado.erroInsert ? { data: null, error: estado.erroInsert } : { data: { id: 'rel_1' }, error: null }) }) };
    };
    b.upsert = async (linhas: Record<string, unknown>[]) => { upserts.push({ tabela, linhas }); return { error: null }; };
    b.update = () => ({ eq: async () => ({ error: null }) });
    return b;
  };
  const emitirRelatorioSitfis = vi.fn();
  const analisarRelatorio = vi.fn();
  const uploadToBucket = vi.fn(async () => ({ path: 'x' }));
  return { estado, inserts, upserts, from, emitirRelatorioSitfis, analisarRelatorio, uploadToBucket };
});

vi.mock('@/lib/fiscal/serpro-sitfis', () => ({ emitirRelatorioSitfis: h.emitirRelatorioSitfis }));
vi.mock('@/lib/fiscal/sitfis-parse', () => ({ analisarRelatorio: h.analisarRelatorio }));
vi.mock('@/lib/clients/supabase-storage', () => ({ uploadToBucket: h.uploadToBucket }));

import { gerarRelatorioSitfisEmpresa } from './sitfis-sync';

const admin = { from: h.from } as never;
const opts = { solicitadoPor: 'u1', esperaMaximaMs: 1000 };

beforeEach(() => {
  h.estado.anterior = null;
  h.estado.erroInsert = null;
  h.inserts.length = 0;
  h.upserts.length = 0;
  h.emitirRelatorioSitfis.mockReset().mockResolvedValue({ ok: true, pdf: Buffer.from('%PDF-1.4') });
  h.analisarRelatorio.mockReset();
  h.uploadToBucket.mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('gerarRelatorioSitfisEmpresa', () => {
  it('guarda o PDF no bucket privado e registra o resultado', async () => {
    h.analisarRelatorio.mockReturnValue('sem_pendencias');
    const r = await gerarRelatorioSitfisEmpresa(admin, 'emp_1', opts);
    expect(r).toEqual({ ok: true, id: 'rel_1', resultado: 'sem_pendencias' });
    expect(h.uploadToBucket).toHaveBeenCalledWith('relatorios-fiscais', expect.stringMatching(/^emp_1\/sitfis-.*\.pdf$/), expect.any(Buffer), 'application/pdf');
    expect(h.inserts[0].valores).toMatchObject({ company_id: 'emp_1', resultado: 'sem_pendencias', solicitado_por: 'u1' });
    expect(h.upserts).toHaveLength(0);
  });

  it('pendência NOVA avisa dono e escritório', async () => {
    h.analisarRelatorio.mockReturnValue('com_pendencias');
    h.estado.anterior = { resultado: 'sem_pendencias' };
    await gerarRelatorioSitfisEmpresa(admin, 'emp_1', opts);
    const avisos = h.upserts.find((u) => u.tabela === 'notifications')?.linhas ?? [];
    expect(avisos.map((a) => a.owner_user_id).sort()).toEqual(['contador_1', 'dono_1']);
    expect(avisos[0]).toMatchObject({ tipo: 'situacao_fiscal_pendencia', severidade: 'danger', chave: 'sitfis_pendencia:rel_1' });
  });

  it('pendência que já estava no relatório anterior NÃO avisa de novo', async () => {
    h.analisarRelatorio.mockReturnValue('com_pendencias');
    h.estado.anterior = { resultado: 'com_pendencias' };
    await gerarRelatorioSitfisEmpresa(admin, 'emp_1', opts);
    expect(h.upserts).toHaveLength(0);
  });

  it('indeterminado não avisa (não se chuta pendência)', async () => {
    h.analisarRelatorio.mockReturnValue('indeterminado');
    await gerarRelatorioSitfisEmpresa(admin, 'emp_1', opts);
    expect(h.upserts).toHaveLength(0);
  });

  it('falha na Receita volta como erro, sem upload', async () => {
    h.emitirRelatorioSitfis.mockResolvedValue({ ok: false, error: 'ainda gerando', aindaGerando: true });
    const r = await gerarRelatorioSitfisEmpresa(admin, 'emp_1', opts);
    expect(r).toMatchObject({ ok: false, aindaGerando: true });
    expect(h.uploadToBucket).not.toHaveBeenCalled();
  });

  it('upload falhou: não registra linha apontando para arquivo que não existe', async () => {
    h.analisarRelatorio.mockReturnValue('sem_pendencias');
    h.uploadToBucket.mockRejectedValueOnce(new Error('storage fora'));
    const r = await gerarRelatorioSitfisEmpresa(admin, 'emp_1', opts);
    expect(r.ok).toBe(false);
    expect(h.inserts).toHaveLength(0);
  });
});
