import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MensagemResumo } from './serpro-caixa-postal-parse';

const h = vi.hoisted(() => {
  const estado = {
    existentes: [] as { isn: string; lida_na_receita: boolean; data_ciencia: string | null }[],
    empresa: { user_id: 'dono_1', contabilidade_id: 'contab_1', nome: 'Padaria', razao_social: null } as Record<string, unknown> | null,
    membros: [{ user_id: 'contador_1' }],
  };
  const upserts: { tabela: string; linhas: unknown; opts: unknown }[] = [];
  const updates: { tabela: string; valores: Record<string, unknown> }[] = [];
  const from = (tabela: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'is', 'not', 'limit']) b[m] = () => b;
    b.maybeSingle = async () => ({ data: tabela === 'companies' ? estado.empresa : null, error: null });
    b.then = (ok: (v: unknown) => unknown) => Promise.resolve({
      data: tabela === 'mensagens_receita' ? estado.existentes : tabela === 'contabilidade_membros' ? estado.membros : [],
      error: null,
    }).then(ok);
    b.upsert = async (linhas: unknown, opts: unknown) => { upserts.push({ tabela, linhas, opts }); return { error: null }; };
    b.update = (valores: Record<string, unknown>) => { updates.push({ tabela, valores }); return b; };
    return b;
  };
  const indicadorMensagensNovas = vi.fn();
  const listarMensagens = vi.fn();
  return { estado, upserts, updates, from, indicadorMensagensNovas, listarMensagens };
});

vi.mock('@/lib/fiscal/serpro-caixa-postal', () => ({
  indicadorMensagensNovas: h.indicadorMensagensNovas, listarMensagens: h.listarMensagens,
}));

import { sincronizarCaixaPostalEmpresa } from './caixa-postal-sync';

const admin = { from: h.from } as never;
const msg = (isn: string, extra: Partial<MensagemResumo> = {}): MensagemResumo => ({
  isn, numeroControle: null, assunto: `Assunto ${isn}`, origem: 'RFB', relevante: false,
  dataEnvio: '2026-10-05', lidaNaReceita: false, dataCiencia: null, ...extra,
});

beforeEach(() => {
  h.estado.existentes = [];
  h.upserts.length = 0;
  h.updates.length = 0;
  h.indicadorMensagensNovas.mockReset();
  h.listarMensagens.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('sincronizarCaixaPostalEmpresa', () => {
  it('indicador 0: não lista (a chamada mais cara) e só carimba', async () => {
    h.indicadorMensagensNovas.mockResolvedValue({ ok: true, indicador: 0 });
    const r = await sincronizarCaixaPostalEmpresa(admin, 'emp_1', { completa: false });
    expect(r).toMatchObject({ ok: true, novas: 0, pulada: 'sem_novidade' });
    expect(h.listarMensagens).not.toHaveBeenCalled();
    expect(h.updates.some((u) => u.tabela === 'empresas_fiscais' && u.valores.caixa_postal_consultada_em)).toBe(true);
  });

  it('indicador ausente (null) NÃO é "nada novo": lista para conferir', async () => {
    h.indicadorMensagensNovas.mockResolvedValue({ ok: true, indicador: null });
    h.listarMensagens.mockResolvedValue({ ok: true, lista: { mensagens: [], ultimaPagina: true, proximoPonteiro: null } });
    await sincronizarCaixaPostalEmpresa(admin, 'emp_1', { completa: false });
    expect(h.listarMensagens).toHaveBeenCalledWith(admin, 'emp_1', { somenteNaoLidas: true });
  });

  it('grava só as novas e avisa dono + escritório UMA vez por mensagem', async () => {
    h.estado.existentes = [{ isn: '1', lida_na_receita: false, data_ciencia: null }];
    h.listarMensagens.mockResolvedValue({
      ok: true, lista: { mensagens: [msg('1'), msg('2', { relevante: true })], ultimaPagina: true, proximoPonteiro: null },
    });
    const r = await sincronizarCaixaPostalEmpresa(admin, 'emp_1', { completa: true });
    expect(r).toMatchObject({ ok: true, novas: 1, total: 2 });

    const gravadas = h.upserts.find((u) => u.tabela === 'mensagens_receita')?.linhas as { isn: string }[];
    expect(gravadas.map((g) => g.isn)).toEqual(['2']);

    const avisos = h.upserts.find((u) => u.tabela === 'notifications')?.linhas as Record<string, unknown>[];
    expect(avisos).toHaveLength(2); // dono + 1 membro do escritório, só da mensagem nova
    expect(avisos.map((a) => a.owner_user_id).sort()).toEqual(['contador_1', 'dono_1']);
    expect(avisos[0]).toMatchObject({ tipo: 'receita_mensagem_nova', severidade: 'danger', chave: 'receita_mensagem:emp_1:2' });
    expect(avisos.find((a) => a.owner_user_id === 'contador_1')?.action_href).toBe('/contador/clientes/emp_1/receita');
  });

  // ── Achado do code-review (06/10): a primeira sincronização avisava o
  // histórico inteiro, mensagem por mensagem, inclusive as já lidas no e-CAC.
  it('carga inicial: UM aviso-resumo por destinatário, só contando as não lidas', async () => {
    h.estado.existentes = []; // empresa nunca sincronizada
    h.listarMensagens.mockResolvedValue({
      ok: true,
      lista: {
        mensagens: [msg('1', { lidaNaReceita: true }), msg('2', { lidaNaReceita: true }), msg('3'), msg('4')],
        ultimaPagina: true, proximoPonteiro: null,
      },
    });
    await sincronizarCaixaPostalEmpresa(admin, 'emp_1', { completa: true });
    const avisos = h.upserts.find((u) => u.tabela === 'notifications')?.linhas as Record<string, unknown>[];
    expect(avisos).toHaveLength(2); // dono + 1 membro, e não 4 mensagens x 2
    expect(avisos[0]).toMatchObject({ chave: 'receita_caixa_inicial:emp_1' });
    expect(String(avisos[0].corpo)).toMatch(/2 mensage/);
  });

  it('carga inicial com tudo já lido no e-CAC: ninguém é avisado', async () => {
    h.estado.existentes = [];
    h.listarMensagens.mockResolvedValue({
      ok: true, lista: { mensagens: [msg('1', { lidaNaReceita: true })], ultimaPagina: true, proximoPonteiro: null },
    });
    await sincronizarCaixaPostalEmpresa(admin, 'emp_1', { completa: true });
    expect(h.upserts.some((u) => u.tabela === 'notifications')).toBe(false);
  });

  it('mensagem nova que já chegou LIDA (abriram pelo e-CAC) não vira aviso', async () => {
    h.estado.existentes = [{ isn: '1', lida_na_receita: true, data_ciencia: null }];
    h.listarMensagens.mockResolvedValue({
      ok: true, lista: { mensagens: [msg('1', { lidaNaReceita: true }), msg('2', { lidaNaReceita: true })], ultimaPagina: true, proximoPonteiro: null },
    });
    await sincronizarCaixaPostalEmpresa(admin, 'emp_1', { completa: true });
    expect(h.upserts.some((u) => u.tabela === 'notifications')).toBe(false);
  });

  it('nada novo: não avisa ninguém', async () => {
    h.estado.existentes = [{ isn: '1', lida_na_receita: false, data_ciencia: null }];
    h.listarMensagens.mockResolvedValue({ ok: true, lista: { mensagens: [msg('1')], ultimaPagina: true, proximoPonteiro: null } });
    await sincronizarCaixaPostalEmpresa(admin, 'emp_1', { completa: true });
    expect(h.upserts.some((u) => u.tabela === 'notifications')).toBe(false);
  });

  it('estado na Receita mudou (lida pelo e-CAC): atualiza a linha existente', async () => {
    h.estado.existentes = [{ isn: '1', lida_na_receita: false, data_ciencia: null }];
    h.listarMensagens.mockResolvedValue({
      ok: true, lista: { mensagens: [msg('1', { lidaNaReceita: true, dataCiencia: '2026-10-06' })], ultimaPagina: true, proximoPonteiro: null },
    });
    await sincronizarCaixaPostalEmpresa(admin, 'emp_1', { completa: true });
    expect(h.updates.find((u) => u.tabela === 'mensagens_receita')?.valores)
      .toMatchObject({ lida_na_receita: true, data_ciencia: '2026-10-06' });
  });

  it('falha da SERPRO volta como erro, sem gravar', async () => {
    h.listarMensagens.mockResolvedValue({ ok: false, error: 'A empresa ainda não autorizou a Balu' });
    const r = await sincronizarCaixaPostalEmpresa(admin, 'emp_1', { completa: true });
    expect(r.ok).toBe(false);
    expect(h.upserts).toHaveLength(0);
  });
});
