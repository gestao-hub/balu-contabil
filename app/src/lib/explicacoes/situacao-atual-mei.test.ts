import { describe, it, expect } from 'vitest';
import { buscarSituacaoAtualMei } from './situacao-atual-mei';

// A cadeia real (ver page.tsx:58-71 e a implementação deste módulo):
//   empresas_fiscais: .select().eq('empresa_id', ...).is('deleted_at', null).maybeSingle()
//   apuracoes_fiscais / guias_fiscais: .select().eq('company_id', ...).is('deleted_at', null)
//                                       .order('competencia_referencia', {...}).limit(N)
// As duas cadeias compartilham o mesmo prefixo (.select().eq().is()) e só
// divergem no método final — por isso o objeto devolvido por `is()` abaixo
// oferece tanto `maybeSingle` quanto `order().limit`.
function clienteFalso(tabelas: Record<string, unknown>) {
  return {
    from: (t: string) => ({
      select: () => ({
        eq: () => ({
          is: () => ({
            maybeSingle: async () => ({ data: tabelas[t] ?? null, error: null }),
            order: () => ({
              limit: async () => ({ data: (tabelas[t] as unknown[]) ?? [], error: null }),
            }),
          }),
        }),
      }),
    }),
  } as never;
}

describe('buscarSituacaoAtualMei', () => {
  it('sem ficha fiscal devolve null', async () => {
    const r = await buscarSituacaoAtualMei(clienteFalso({}), 'empresa-1', '202607');
    expect(r).toBeNull();
  });
});
