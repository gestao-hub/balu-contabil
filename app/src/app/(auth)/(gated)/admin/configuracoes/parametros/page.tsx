// Parâmetros fiscais versionados (AdminBalu).
//
// A tela existe porque a 0079/0080 tiraram a tabela do Simples e o salário
// mínimo do código: mudar imposto deixou de ser deploy. Sem uma tela, "deixou
// de ser deploy" na prática virava "alguém roda um INSERT à mão no banco de
// produção" — que é pior do que o deploy, porque não tem revisão nem registro.
//
// A tabela do Simples aparece só para leitura, e de propósito: ela muda por lei
// complementar, não por ano, e digitar 30 faixas num formulário é convite a
// erro. Quando a LC 214/2025 entrar, a tabela nova vem por migration revisada.
import Link from 'next/link';
import { ArrowLeft, SlidersHorizontal } from 'lucide-react';
import { requireAdminBaluPage } from '@/lib/admin/guard';
import { createAdminClient } from '@/lib/supabase/admin';
import { competenciaReferenciaBrt } from '@/lib/fiscal/guia';
import { getParametrosDaCompetencia } from '@/lib/fiscal/parametros';
import { estaEmDia } from '@/lib/fiscal/salario-minimo-entrada';
import SalarioMinimoForm, { type LinhaParametro } from './SalarioMinimoForm';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requireAdminBaluPage();
  const sb = createAdminClient();

  const { data } = await sb
    .from('parametros_fiscais')
    .select('valor, vigencia_inicio, norma')
    .eq('chave', 'salario_minimo')
    .order('vigencia_inicio', { ascending: false });

  const linhas: LinhaParametro[] = (data ?? []).map((l) => ({
    vigenciaInicio: String(l.vigencia_inicio),
    valor: Number(l.valor),
    norma: (l.norma as string | null) ?? null,
  }));

  // O QUE O CÁLCULO USA HOJE, pela MESMA função da apuração — não pelo primeiro
  // item da lista acima. A lista traz agendamentos futuros; se a tela pegasse o
  // topo dela, mostraria o valor de 2027 como se já estivesse valendo.
  const { salarioMinimo: vigenteHoje } = await getParametrosDaCompetencia(
    sb, competenciaReferenciaBrt(new Date()),
  );

  const hoje = new Date();
  const maisRecenteJaVigente = linhas
    .map((l) => l.vigenciaInicio)
    .find((v) => v <= hoje.toISOString().slice(0, 10)) ?? null;

  return (
    <div className="p-6 space-y-8">
      <div>
        <Link
          href="/admin/configuracoes"
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Configurações
        </Link>
        <h1 className="mb-1 flex items-center gap-2 text-xl font-semibold">
          <SlidersHorizontal className="size-5 shrink-0 text-primary" />
          Parâmetros fiscais
        </h1>
        <p className="text-sm text-muted-foreground">
          Valores datados que entram no cálculo do imposto. Mudança aqui não exige publicar versão
          nova do aplicativo: vale a partir da data de vigência, sozinha. Toda alteração vai para o
          registro de auditoria.
        </p>
      </div>

      <section className="rounded-md border border-border bg-surface p-4">
        <h2 className="mb-1 text-sm font-medium text-foreground">Salário mínimo</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Define o INSS do MEI — 5% do mínimo (LC 123/2006, art. 18-A, §3º, V). É o número que aparece
          na estimativa do DAS-MEI e na explicação enviada pelo WhatsApp.
        </p>
        <SalarioMinimoForm
          linhas={linhas}
          emDia={estaEmDia(maisRecenteJaVigente, hoje)}
          anoCorrente={hoje.getFullYear()}
          vigenteHoje={vigenteHoje}
        />
      </section>

      <section className="rounded-md border border-border bg-surface p-4">
        <h2 className="mb-1 text-sm font-medium text-foreground">Tabela do Simples Nacional</h2>
        <p className="text-sm text-muted-foreground">
          Anexos I a V, seis faixas cada (LC 123/2006, art. 18, redação da LC 155/2016). Também é lida
          por vigência, mas não se edita por aqui: são 30 faixas com alíquota e parcela a deduzir, e
          digitar isso num formulário é convite a erro silencioso. Alteração da tabela vem por
          migration revisada.
        </p>
      </section>
    </div>
  );
}
