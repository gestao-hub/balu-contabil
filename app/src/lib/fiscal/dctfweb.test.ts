import { describe, it, expect, vi, beforeEach } from 'vitest';

const chamar = vi.hoisted(() => vi.fn());
vi.mock('@/lib/fiscal/serpro-chamada', () => ({ chamarIntegraDaEmpresa: chamar }));

import { pdfDaResposta, periodoDe, consultarReciboDctfweb, gerarGuiaDctfweb } from './dctfweb';

const sb = {} as never;

beforeEach(() => chamar.mockReset());

describe('puros', () => {
  it('pdfDaResposta lê PDFByteArrayBase64 de string ou objeto', () => {
    expect(pdfDaResposta({ dados: JSON.stringify({ PDFByteArrayBase64: 'JVBER' }) })).toBe('JVBER');
    expect(pdfDaResposta({ dados: { PDFByteArrayBase64: 'X' } })).toBe('X');
    expect(pdfDaResposta({ dados: '' })).toBeNull();
    expect(pdfDaResposta({ dados: '{quebrado' })).toBeNull();
  });
  it('periodoDe', () => {
    expect(periodoDe('202609')).toEqual({ anoPA: '2026', mesPA: '09' });
    expect(periodoDe('202613')).toBeNull();
    expect(periodoDe('2026-09')).toBeNull();
  });
});

describe('chamadas', () => {
  it('recibo: Consultar CONSRECIBO32, categoria GERAL_MENSAL e período', async () => {
    chamar.mockResolvedValue({ ok: true, resp: { dados: JSON.stringify({ PDFByteArrayBase64: 'R' }) } });
    expect(await consultarReciboDctfweb(sb, 'emp_1', '202609')).toEqual({ ok: true, pdfBase64: 'R' });
    expect(chamar.mock.calls[0][2]).toMatchObject({
      rota: 'Consultar', idSistema: 'DCTFWEB', idServico: 'CONSRECIBO32',
      dados: { categoria: 'GERAL_MENSAL', anoPA: '2026', mesPA: '09' },
    });
  });
  it('guia: Emitir GERARGUIA31', async () => {
    chamar.mockResolvedValue({ ok: true, resp: { dados: JSON.stringify({ PDFByteArrayBase64: 'G' }) } });
    await gerarGuiaDctfweb(sb, 'emp_1', '202609');
    expect(chamar.mock.calls[0][2]).toMatchObject({ rota: 'Emitir', idServico: 'GERARGUIA31' });
  });
  it('competência inválida não chama a Receita; resposta sem PDF vira erro', async () => {
    expect((await gerarGuiaDctfweb(sb, 'emp_1', 'abc')).ok).toBe(false);
    expect(chamar).not.toHaveBeenCalled();
    chamar.mockResolvedValue({ ok: true, resp: { dados: '{}' } });
    expect((await consultarReciboDctfweb(sb, 'emp_1', '202609')).ok).toBe(false);
  });
});
