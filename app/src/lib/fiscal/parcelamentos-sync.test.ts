import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const estado = { regime: '4' as string | null };
  const upserts: { tabela: string; linhas: Record<string, unknown>[] }[] = [];
  const from = (tabela: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'is']) b[m] = () => b;
    b.maybeSingle = async () => ({ data: estado.regime ? { Code_regime_tributario: estado.regime } : null, error: null });
    b.upsert = async (linhas: Record<string, unknown>[]) => { upserts.push({ tabela, linhas }); return { error: null }; };
    b.update = () => ({ eq: async () => ({ error: null }) });
    return b;
  };
  const chamar = vi.fn();
  return { estado, upserts, from, chamar };
});

vi.mock('@/lib/fiscal/serpro-chamada', () => ({ chamarIntegraDaEmpresa: h.chamar }));

import { consultarParcelamentosEmpresa, gerarDasDaParcela } from './parcelamentos-sync';

const admin = { from: h.from } as never;
const env = (dados: unknown) => ({ dados: JSON.stringify(dados) });

beforeEach(() => {
  h.estado.regime = '4';
  h.upserts.length = 0;
  h.chamar.mockReset();
});

describe('consultarParcelamentosEmpresa', () => {
  it('MEI consulta as 4 modalidades do MEI e grava o que achar', async () => {
    h.chamar.mockImplementation(async (_a: unknown, _c: unknown, p: { idSistema: string }) => (
      p.idSistema === 'PARCMEI'
        ? { ok: true, resp: env({ parcelamentos: [{ numero: 1, situacao: 'Em parcelamento', dataDoPedido: 20250101 }] }) }
        : { ok: true, resp: env({ parcelamentos: [] }) }
    ));
    const r = await consultarParcelamentosEmpresa(admin, 'emp_1');
    expect(r).toEqual({ ok: true, encontrados: 1, falhas: [] });
    expect(h.chamar.mock.calls.map((c) => (c[2] as { idServico: string }).idServico))
      .toEqual(['PEDIDOSPARC203', 'PEDIDOSPARC213', 'PEDIDOSPARC223', 'PEDIDOSPARC233']);
    expect(h.upserts[0].linhas[0]).toMatchObject({ company_id: 'emp_1', modalidade: 'PARCMEI', numero: '1' });
  });

  it('sem autorização: para na primeira, sem gastar as outras três chamadas', async () => {
    h.chamar.mockResolvedValue({ ok: false, error: 'A empresa ainda não autorizou a Balu (Termo/procuração) na SERPRO.' });
    const r = await consultarParcelamentosEmpresa(admin, 'emp_1');
    expect(r.ok).toBe(false);
    expect(h.chamar).toHaveBeenCalledTimes(1);
  });

  it('Regime Normal não consulta nada', async () => {
    h.estado.regime = '3';
    expect((await consultarParcelamentosEmpresa(admin, 'emp_1')).ok).toBe(false);
    expect(h.chamar).not.toHaveBeenCalled();
  });

  it('todas as modalidades falharam: erro, não "nenhum parcelamento"', async () => {
    h.chamar.mockResolvedValue({ ok: false, error: 'SERPRO fora' });
    expect((await consultarParcelamentosEmpresa(admin, 'emp_1')).ok).toBe(false);
  });
});

describe('gerarDasDaParcela', () => {
  it('manda a parcela AAAAMM como número, pela rota Emitir', async () => {
    h.chamar.mockResolvedValue({ ok: true, resp: env({ docArrecadacaoPdfB64: 'JVBER' }) });
    expect(await gerarDasDaParcela(admin, 'emp_1', 'PARCSN', '202610')).toEqual({ ok: true, pdfBase64: 'JVBER' });
    expect(h.chamar.mock.calls[0][2]).toMatchObject({ rota: 'Emitir', idServico: 'GERARDAS161', dados: { parcelaParaEmitir: 202610 } });
  });
  it('recusa modalidade e parcela inválidas sem chamar a Receita', async () => {
    expect((await gerarDasDaParcela(admin, 'emp_1', 'XPTO', '202610')).ok).toBe(false);
    expect((await gerarDasDaParcela(admin, 'emp_1', 'PARCSN', '2026-10')).ok).toBe(false);
    expect(h.chamar).not.toHaveBeenCalled();
  });
});
