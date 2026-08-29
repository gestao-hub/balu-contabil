import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { createServerClient } from '@/lib/supabase/server';
import { competenciaAddMonths, competenciaReferenciaBrt } from '@/lib/fiscal/guia';
import { FolhaGrid, type FolhaRow } from './FolhaGrid';

export const dynamic = 'force-dynamic';

export default async function FolhaPage() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: profile } = user
    ? await supabase.from('profiles').select('current_company').eq('user_id', user.id).single()
    : { data: null };
  const companyId = (profile?.current_company ?? null) as string | null;

  // 13 competências: a atual + 12 anteriores (mais recente primeiro).
  const atual = competenciaReferenciaBrt(new Date());
  const competencias = Array.from({ length: 13 }, (_, i) => competenciaAddMonths(atual, -i));

  const folhaPorComp = new Map<string, { pro_labore: number; salarios: number; encargos: number }>();
  if (companyId) {
    const inicio = competencias[competencias.length - 1];
    const { data } = await supabase
      .from('folha_mensal')
      .select('competencia, pro_labore, salarios, encargos')
      .eq('company_id', companyId)
      .gte('competencia', inicio)
      .lte('competencia', atual);
    for (const r of data ?? []) {
      folhaPorComp.set(r.competencia as string, {
        pro_labore: Number(r.pro_labore ?? 0),
        salarios: Number(r.salarios ?? 0),
        encargos: Number(r.encargos ?? 0),
      });
    }
  }

  const rows: FolhaRow[] = competencias.map((competencia) => {
    const f = folhaPorComp.get(competencia);
    return {
      competencia,
      proLabore: f?.pro_labore ?? 0,
      salarios: f?.salarios ?? 0,
      encargos: f?.encargos ?? 0,
    };
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link
        href="/impostos"
        className="inline-flex min-h-6 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition"
      >
        <ArrowLeft className="size-4" />
        Voltar
      </Link>

      {/* BUG-005 (auditoria 29/08/2026): o texto dizia "os últimos 12 meses" e a
          grade mostrava 13 linhas, o que foi lido como risco de cálculo fora da
          janela. O cálculo está certo — `somarFolha12` soma exatamente de -12 a
          -1, excluindo a competência corrente, mesma janela do RBT12. A 13ª
          linha é a competência CORRENTE, que está ali para ser preenchida
          agora e entrar na janela no mês que vem. Era a frase que estava
          errada, não a conta; e explicar as duas coisas custa uma linha. */}
      <h1 className="mt-3 text-xl font-semibold">Folha (Fator R)</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        A folha dos <strong>12 meses fechados</strong> alimenta o <strong>Fator R</strong>, que
        decide entre o Anexo III e o Anexo V para CNAEs sujeitos a ele. Meses em branco contam
        como zero. A competência corrente aparece no topo para você já lançar — ela entra no
        cálculo a partir do mês seguinte.
      </p>

      {!companyId ? (
        <p className="mt-6 text-sm text-muted-foreground">Selecione uma empresa para lançar a folha.</p>
      ) : (
        <FolhaGrid initialRows={rows} />
      )}
    </div>
  );
}
