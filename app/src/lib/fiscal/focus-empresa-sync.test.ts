// Task 12 — Bloco 5: guarda de origem em `syncEmpresaNaFocus` (cadastro,
// POST /v2/empresas) e `atualizarEmpresaNaFocus` (atualização, PUT).
//
// POR QUE ESTE ARQUIVO EXISTE
// Com `empresas_fiscais.focus_origem = 'propria'`, a empresa traz a própria
// conta na Focus — Balu não cadastra, não atualiza e não sobe certificado
// (este último já coberto em cert-upload.test.ts). `criarEmpresa` e
// `atualizarEmpresa` autenticam com o TOKEN DE REVENDA da Balu (não o da
// empresa) — então, sem a guarda, os dois endpoints seriam alcançáveis e
// criariam/atualizariam um cadastro fantasma no tenant da Balu que não
// corresponde à conta que a empresa de fato usa para emitir.
//
// O que se prova aqui: com origem 'propria', a Focus NUNCA é chamada. Com
// origem 'balu' (ou sem linha em empresas_fiscais — default seguro), a guarda
// deixa passar — o teste usa um stub de `companies` que falha de propósito
// pra provar que o fluxo passou da guarda sem precisar montar o payload Focus
// inteiro.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  criarEmpresa: vi.fn(async () => ({ id: 1, token_homologacao: 'tok-hom' })),
  atualizarEmpresa: vi.fn(async () => ({})),
  consultarEmpresa: vi.fn(async () => ({})),
}));

vi.mock('@/lib/clients/focus-nfe', () => ({
  focus: {
    criarEmpresa: h.criarEmpresa,
    atualizarEmpresa: h.atualizarEmpresa,
    consultarEmpresa: h.consultarEmpresa,
  },
}));

import { syncEmpresaNaFocus, atualizarEmpresaNaFocus } from '@/lib/fiscal/focus-empresa-sync';

type Result = { data: unknown; error: { message: string } | null };

/** Chain do Supabase: toda etapa devolve `this` (thenable) resolvendo pra `result`. */
function makeChain(result: Result) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {
    select: () => obj,
    eq: () => obj,
    is: () => obj,
    order: () => obj,
    limit: () => obj,
    maybeSingle: () => obj,
    single: () => obj,
    update: () => obj,
    then: (resolve: (v: Result) => void) => resolve(result),
  };
  return obj;
}

/**
 * `companies` sempre falha (de propósito): o que interessa nestes testes é só
 * o comportamento ANTES dessa consulta — se a guarda de origem bloqueou, ou
 * se deixou passar. Um round-trip completo até `focus.criarEmpresa` exigiria
 * montar o payload inteiro (endereço, regime, município), fora do escopo
 * desta guarda.
 */
function makeSupabase(focusOrigem: string | null) {
  return {
    from: (table: string) => {
      if (table === 'empresas_fiscais') {
        return makeChain({
          data: {
            focus_origem: focusOrigem,
            Code_regime_tributario: 'anexo3',
            empresa_fiscal_ativada: true,
            focus_empresa_id: 1,
            focus_codigo_municipio: null,
          },
          error: null,
        });
      }
      if (table === 'companies') {
        return makeChain({ data: null, error: { message: 'Empresa não encontrada (stub de teste).' } });
      }
      return makeChain({ data: null, error: null });
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('syncEmpresaNaFocus — Bloco 5: guarda de origem', () => {
  it("com focus_origem='propria', NÃO chama a Focus e devolve erro nomeado", async () => {
    const r = await syncEmpresaNaFocus(makeSupabase('propria'), 'empresa-1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/própria conta na Focus/);
    expect(h.criarEmpresa).not.toHaveBeenCalled();
  });

  it("com focus_origem='balu', a guarda deixa passar (segue pro fluxo existente)", async () => {
    const r = await syncEmpresaNaFocus(makeSupabase('balu'), 'empresa-1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).not.toMatch(/própria conta na Focus/);
    expect(h.criarEmpresa).not.toHaveBeenCalled(); // barrado pelo stub de `companies`, não pela guarda
  });

  it('sem linha em empresas_fiscais (focus_origem null), default seguro é tratar como balu', async () => {
    const r = await syncEmpresaNaFocus(makeSupabase(null), 'empresa-1');
    if (!r.ok) expect(r.error).not.toMatch(/própria conta na Focus/);
  });
});

describe('atualizarEmpresaNaFocus — Bloco 5: guarda de origem', () => {
  it("com focus_origem='propria', NÃO chama a Focus e devolve erro nomeado", async () => {
    const r = await atualizarEmpresaNaFocus(makeSupabase('propria'), 'empresa-1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/própria conta na Focus/);
    expect(h.atualizarEmpresa).not.toHaveBeenCalled();
  });

  it("com focus_origem='balu', a guarda deixa passar (segue pro fluxo existente)", async () => {
    const r = await atualizarEmpresaNaFocus(makeSupabase('balu'), 'empresa-1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).not.toMatch(/própria conta na Focus/);
    expect(h.atualizarEmpresa).not.toHaveBeenCalled(); // barrado pelo stub de `companies`, não pela guarda
  });
});
