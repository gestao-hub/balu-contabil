import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReceitaApuracao } from './apuracao-types';
import type { AnexoSimples } from './regime';
import { calcularRbt12 } from './rbt12';
import { somarFolha12 } from './folha';
import { calcularFatorR } from './fator-r';
import { lerFolhaParaApuracao } from './folha-source';

/**
 * Anota cada receita da competência com o anexo resolvido do seu CNAE, p/ a apuração segregar.
 * - sem cnae / cnae não mapeado → fallbackAnexo;
 * - cnae sujeito a Fator R → III/V da empresa (uma conta só) ou fallback se insuficiente;
 * - senão → anexo_base do catálogo (ou fallback).
 * Fast path: se nenhuma receita do mês tem cnae, devolve inalterado (cálculo usa o fallback).
 * Best-effort: nunca lança; em erro devolve as receitas como vieram.
 */
export async function anexarAnexosDasReceitas(
  supabase: SupabaseClient,
  companyId: string,
  competencia: string,
  receitas: ReceitaApuracao[],
  fallbackAnexo: AnexoSimples | null,
): Promise<ReceitaApuracao[]> {
  try {
    const doMes = receitas.filter((r) => r.competencia === competencia);
    const cnaes = Array.from(new Set(doMes.map((r) => r.cnae).filter((c): c is string => !!c)));
    if (cnaes.length === 0) return receitas;

    const { data: refs } = await supabase
      .from('cnae_anexo').select('codigo, anexo_base, fator_r').in('codigo', cnaes);
    const refMap = new Map<string, { anexo_base: AnexoSimples | null; fator_r: boolean }>();
    for (const r of refs ?? []) {
      refMap.set(r.codigo as string, {
        anexo_base: (r.anexo_base as AnexoSimples | null) ?? null,
        fator_r: r.fator_r === true,
      });
    }

    // Fator R da empresa (uma vez): folha 12m ÷ RBT12 total.
    const folhas = await lerFolhaParaApuracao(supabase, companyId, competencia);
    const { folha12m } = somarFolha12(folhas, competencia);
    const { rbt12 } = calcularRbt12(receitas, competencia);
    const fatorR = calcularFatorR({ folha12m, rbt12 });

    const resolver = (cnae: string | null | undefined): AnexoSimples | null => {
      if (!cnae) return fallbackAnexo;
      const ref = refMap.get(cnae);
      if (!ref) return fallbackAnexo;
      if (ref.fator_r) return fatorR.suficiente && fatorR.anexoDecidido ? fatorR.anexoDecidido : fallbackAnexo;
      return ref.anexo_base ?? fallbackAnexo;
    };

    return receitas.map((r) =>
      r.competencia === competencia ? { ...r, anexo: resolver(r.cnae) } : r,
    );
  } catch (e) {
    console.warn('[anexarAnexosDasReceitas]', e instanceof Error ? e.message : String(e));
    return receitas;
  }
}
