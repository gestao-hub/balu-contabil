// Bloco 6B — a MESMA cadeia que produz a explicação na tela de impostos
// (CompetenciaAtualCardMei.tsx + page.tsx), montada fora de uma sessão HTTP —
// o webhook de atendimento (Task 6) não tem `user` de sessão, só um companyId
// já resolvido a partir do telefone de quem escreveu.
//
// NÃO reescreve a regra: chama exatamente as mesmas funções puras do 6A
// (situacaoDasMei, valoresDoDasMei, chaveDaSituacao, buscarExplicacao,
// renderizar). Se um dia divergir de page.tsx, é porque um dos dois lados
// mudou sem o outro — o teste deste módulo não substitui o da tela.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { situacaoDasMei, chaveDaSituacao } from '@/lib/fiscal/situacao-fiscal';
import { valoresDoDasMei } from '@/lib/explicacoes/valores-mei';
import { buscarExplicacao } from '@/lib/explicacoes/buscar';
import { renderizar } from '@/lib/explicacoes/renderizar';

export type SituacaoAtual = {
  texto: string;
  geradoPor: string | null;
};

/**
 * `sb` pode ser o admin client — `buscarExplicacao` aceita qualquer
 * `SupabaseClient` (ver `lib/explicacoes/buscar.ts`).
 */
export async function buscarSituacaoAtualMei(
  sb: SupabaseClient, companyId: string, competenciaAtual: string,
): Promise<SituacaoAtual | null> {
  const { data: fiscal } = await sb
    .from('empresas_fiscais')
    .select('atividade_mei')
    .eq('empresa_id', companyId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!fiscal) return null;

  const atividadeMei = (fiscal as { atividade_mei: string | null }).atividade_mei;

  const [{ data: apuracoes }, { data: guias }] = await Promise.all([
    sb.from('apuracoes_fiscais')
      .select('competencia_referencia, valor_imposto')
      .eq('company_id', companyId).is('deleted_at', null)
      .order('competencia_referencia', { ascending: false }).limit(13),
    sb.from('guias_fiscais')
      .select('competencia_referencia, valor_total')
      .eq('company_id', companyId).is('deleted_at', null)
      .order('competencia_referencia', { ascending: false }).limit(24),
  ]);

  type Apuracao = { competencia_referencia: string; valor_imposto: number | null };
  type Guia = { competencia_referencia: string; valor_total: number | null };
  const apuracaoAtual = ((apuracoes ?? []) as Apuracao[])
    .find((a) => a.competencia_referencia === competenciaAtual) ?? null;
  const guiaAtual = ((guias ?? []) as Guia[])
    .find((g) => g.competencia_referencia === competenciaAtual) ?? null;

  const totalExibido = guiaAtual?.valor_total ?? apuracaoAtual?.valor_imposto ?? null;
  const valores = valoresDoDasMei(atividadeMei, totalExibido);
  if (!valores) return null;

  const situacao = situacaoDasMei(atividadeMei);
  const explicacao = await buscarExplicacao(sb, chaveDaSituacao(situacao));
  if (!explicacao) return null;

  const r = renderizar(explicacao.texto, valores);
  if (!r.ok) return null;

  return { texto: r.texto, geradoPor: explicacao.geradoPor };
}
