// src/app/(auth)/contador/page.tsx
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { getContabilidadeCtx, type ContabilidadeCtx } from '@/lib/contador/guards';
import { getLimitesFiscais } from '@/lib/fiscal/parametros';
import { classificarSemaforo, type FatosCliente } from '@/lib/fiscal/semaforo';
import PainelClientes, { type ClienteComSemaforo, type ResumoEscritorio } from './PainelClientes';

export default async function ContadorPage() {
  const ctx = await getContabilidadeCtx();
  if ('error' in ctx) redirect('/login');
  if (!ctx.contabilidade) redirect('/contador/cadastro');
  if (ctx.contabilidade.status === 'pendente') redirect('/contador/aguardando');
  if (ctx.contabilidade.status === 'suspensa') redirect('/contador/aguardando'); // aguardando mostra o status real

  const supabase = await createServerClient();
  const [{ data: linhas }, { data: resumoRows }, limites] = await Promise.all([
    supabase.rpc('painel_contador'),
    supabase.rpc('resumo_escritorio'),
    getLimitesFiscais(supabase),
  ]);
  const resumo: ResumoEscritorio = resumoRows?.[0] ?? { total_clientes: 0, honorarios_aberto: 0, honorarios_atrasado: 0 };
  const clientes: ClienteComSemaforo[] = (linhas ?? []).map((l: Record<string, unknown>) => {
    const fatos: FatosCliente = {
      regimeCode: (l.regime_code as FatosCliente['regimeCode']) ?? null,
      dasVencidos: Number(l.das_vencidos ?? 0),
      pgdasMesAnteriorTransmitida: Boolean(l.pgdas_mes_anterior_transmitida),
      dasnAnoAnteriorTransmitida: Boolean(l.dasn_ano_anterior_transmitida),
      faturamentoAno: Number(l.faturamento_ano ?? 0),
      certNotAfter: (l.cert_not_after as string) ?? null,
    };
    return {
      company_id: l.company_id as string,
      nome: (l.nome as string) ?? null,
      razao_social: (l.razao_social as string) ?? null,
      cnpj: (l.cnpj as string) ?? null,
      regime_code: (l.regime_code as string) ?? null,
      convite_pendente: Boolean(l.convite_pendente),
      faturamento_12m: l.faturamento_12m as string | number,
      honorarios_aberto: l.honorarios_aberto as string | number,
      honorarios_atrasado: l.honorarios_atrasado as string | number,
      semaforo: classificarSemaforo(fatos, limites),
    };
  });
  return <PainelClientes clientes={clientes} resumo={resumo} contabilidade={ctx.contabilidade as NonNullable<ContabilidadeCtx['contabilidade']>} />;
}
