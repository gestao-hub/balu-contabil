import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const estado = {
    anterior: null as { resultado: string } | null,
    empresa: { user_id: 'dono_1', contabilidade_id: 'contab_1', nome: 'Padaria', razao_social: null },
    membros: [{ user_id: 'contador_1' }],
    erroInsert: null as { message: string } | null,
    certs: [] as { company_id: string }[],
    fiscais: [] as { empresa_id: string; sitfis_consultado_em: string | null }[],
  };
  const inserts: { tabela: string; valores: Record<string, unknown> }[] = [];
  const upserts: { tabela: string; linhas: Record<string, unknown>[] }[] = [];
  const updates: { tabela: string; valores: Record<string, unknown> }[] = [];
  const from = (tabela: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'limit', 'is', 'not']) b[m] = () => b;
    b.maybeSingle = async () => ({
      data: tabela === 'companies' ? estado.empresa : tabela === 'relatorios_situacao_fiscal' ? estado.anterior : null,
      error: null,
    });
    b.then = (ok: (v: unknown) => unknown) => Promise.resolve({
      data: tabela === 'contabilidade_membros' ? estado.membros
        : tabela === 'arquivos_auxiliares' ? estado.certs
        : tabela === 'empresas_fiscais' ? estado.fiscais : [],
      error: null,
    }).then(ok);
    b.insert = (valores: Record<string, unknown>) => {
      inserts.push({ tabela, valores });
      return { select: () => ({ single: async () => (estado.erroInsert ? { data: null, error: estado.erroInsert } : { data: { id: 'rel_1' }, error: null }) }) };
    };
    b.upsert = async (linhas: Record<string, unknown>[]) => { upserts.push({ tabela, linhas }); return { error: null }; };
    b.update = (valores: Record<string, unknown>) => { updates.push({ tabela, valores }); return { eq: async () => ({ error: null }) }; };
    return b;
  };
  const emitirRelatorioSitfis = vi.fn();
  const analisarRelatorio = vi.fn();
  const uploadToBucket = vi.fn(async () => ({ path: 'x' }));
  return { estado, inserts, upserts, updates, from, emitirRelatorioSitfis, analisarRelatorio, uploadToBucket };
});

vi.mock('@/lib/fiscal/serpro-sitfis', () => ({ emitirRelatorioSitfis: h.emitirRelatorioSitfis }));
vi.mock('@/lib/fiscal/sitfis-parse', () => ({ analisarRelatorio: h.analisarRelatorio }));
vi.mock('@/lib/clients/supabase-storage', () => ({ uploadToBucket: h.uploadToBucket }));

import { gerarRelatorioSitfisEmpresa, rodarSitfis } from './sitfis-sync';

const admin = { from: h.from } as never;
const opts = { solicitadoPor: 'u1', esperaMaximaMs: 1000 };

beforeEach(() => {
  h.estado.anterior = null;
  h.estado.erroInsert = null;
  h.inserts.length = 0;
  h.upserts.length = 0;
  h.updates.length = 0;
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

  // Achado do code-review (06/10): "ainda gerando" é tentativa INTERROMPIDA,
  // não consulta feita. Carimbar escondia a empresa da varredura por 7 dias.
  it('"ainda gerando" NÃO carimba a consulta (volta na próxima rodada)', async () => {
    h.emitirRelatorioSitfis.mockResolvedValue({ ok: false, error: 'ainda gerando', aindaGerando: true });
    await gerarRelatorioSitfisEmpresa(admin, 'emp_1', opts);
    expect(h.updates.filter((u) => u.tabela === 'empresas_fiscais')).toHaveLength(0);
  });

  it('erro definitivo (sem autorização) carimba, para não ocupar a fila todo dia', async () => {
    h.emitirRelatorioSitfis.mockResolvedValue({ ok: false, error: 'A empresa ainda não autorizou a Balu' });
    await gerarRelatorioSitfisEmpresa(admin, 'emp_1', opts);
    expect(h.updates.filter((u) => u.tabela === 'empresas_fiscais')).toHaveLength(1);
  });

  it('upload falhou: não registra linha apontando para arquivo que não existe', async () => {
    h.analisarRelatorio.mockReturnValue('sem_pendencias');
    h.uploadToBucket.mockRejectedValueOnce(new Error('storage fora'));
    const r = await gerarRelatorioSitfisEmpresa(admin, 'emp_1', opts);
    expect(r.ok).toBe(false);
    expect(h.inserts).toHaveLength(0);
  });
});

// Achado do code-review (06/10): a varredura limitava a espera a 6s FIXOS
// mesmo com 28s de orçamento. Se a Receita leva mais que isso para gerar, TODA
// empresa caía em "ainda gerando" e a varredura nunca produzia relatório.
describe('rodarSitfis', () => {
  it('a espera pela Receita usa o orçamento que sobra, não um teto fixo pequeno', async () => {
    h.estado.certs = [{ company_id: 'emp_1' }];
    h.estado.fiscais = [{ empresa_id: 'emp_1', sitfis_consultado_em: null }];
    h.analisarRelatorio.mockReturnValue('sem_pendencias');
    await rodarSitfis(admin, { orcamentoMs: 28_000 });
    const espera = (h.emitirRelatorioSitfis.mock.calls[0][2] as { esperaMaximaMs: number }).esperaMaximaMs;
    expect(espera).toBeGreaterThanOrEqual(20_000);
    expect(espera).toBeLessThan(28_000);
  });
});

