import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

// Soma o valor das notas ATIVAS (NFe/NFCe/NFSe) emitidas no ano-calendário.
// Mesma família de filtro de receitas-source.ts.
const TIPOS = ['NFe', 'NFCe', 'NFSe'];

export async function somarEmitidoNoAno(
  supabase: SupabaseClient,
  companyId: string,
  ano: number,
): Promise<number> {
  const inicio = `${ano}-01-01`;
  const fim = `${ano + 1}-01-01`;
  const { data } = await supabase
    .from('notas_fiscais')
    .select('valor_total')
    .eq('company_id', companyId)
    // 'ativa' (emissão) + 'lancada' (lançamento manual) = receita real → conta no limite.
    .in('status', ['ativa', 'lancada'])
    // AMBIENTE: nota de homologação é teste. Sem isto, emitir em homologação
    // consumia o teto do Simples/MEI do cliente e disparava o alerta de
    // sublimite sobre faturamento que não existiu (achado de 02/09/2026 —
    // mesma causa de `receitas-source.ts`, que documenta a decisão).
    .eq('ambiente', 'prod')
    .in('tipo_documento', TIPOS)
    .gte('data_emissao', inicio)
    .lt('data_emissao', fim);
  return (data ?? []).reduce(
    (acc, n) => acc + (Number((n as { valor_total: number | null }).valor_total) || 0),
    0,
  );
}
