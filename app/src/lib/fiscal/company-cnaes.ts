import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

export type CnaeSecundario = {
  codigo: string;
  descricao: string | null;
  anexoLabel: string | null;
};

/**
 * CNAEs secundários da empresa (read-only), com o rótulo do anexo — pra exibir na aba
 * Regime tributário. A regra do rótulo espelha `listarCnaesEmpresaAction` (notas_fiscais):
 * `fator_r` → "Anexo III/V — Fator R"; senão `anexo_base`; sem mapeamento → null ("a curar").
 */
export async function listarCnaesSecundariosEmpresa(
  supabase: SupabaseClient,
  companyId: string,
): Promise<CnaeSecundario[]> {
  const { data: cnaes } = await supabase
    .from('company_cnaes')
    .select('codigo, descricao')
    .eq('company_id', companyId)
    .eq('tipo', 'secundario')
    .is('deleted_at', null)
    .order('codigo', { ascending: true });
  if (!cnaes || cnaes.length === 0) return [];

  const codigos = cnaes.map((c) => c.codigo as string);
  const { data: refs } = await supabase
    .from('cnae_anexo')
    .select('codigo, anexo_base, fator_r')
    .in('codigo', codigos);
  const refMap = new Map<string, { anexo_base: string | null; fator_r: boolean }>();
  for (const r of refs ?? []) {
    refMap.set(r.codigo as string, { anexo_base: (r.anexo_base as string | null) ?? null, fator_r: r.fator_r === true });
  }

  return cnaes.map((c) => {
    const ref = refMap.get(c.codigo as string);
    const anexoLabel = ref ? (ref.fator_r ? 'Anexo III/V — Fator R' : ref.anexo_base) : null;
    return { codigo: c.codigo as string, descricao: (c.descricao as string | null) ?? null, anexoLabel };
  });
}
