/**
 * INSTRUMENTAÇÃO — a apuração da TELA e a declaração do PGDAS-D, lado a lado,
 * sobre a MESMA entrada. SOMENTE LEITURA: não chama o SERPRO, não grava nada.
 *
 * ─── POR QUE ─────────────────────────────────────────────────────────────────
 * Em 02/09/2026 (sessão 38), para AL PISCINAS / 202606 no mesmo dia:
 *   `calcularApuracao`      → R$ 112,50   (o que a tela promete)
 *   SERPRO /Declarar (dry)  → R$ 344,33   (o que a Receita cobra)
 *
 * A hipótese registrada era que `montarDeclaracaoPgdasd` somava as duas notas
 * (R$ 5.000) onde a apuração somava uma (R$ 2.500). **A leitura do código já
 * derruba isso**: `transmitirPgdasd` chama a MESMA `lerReceitasParaApuracao`.
 * Então a base bruta é idêntica por construção, e a divergência tem de estar em
 * outro lugar.
 *
 * Este script existe para dizer ONDE, com número em vez de dedução. Ele imprime,
 * dos dois lados: receita do mês, RBT12, anexo/idAtividade, segregação por CNAE
 * e o payload que iria para a SERPRO.
 *
 * ⚠️ `--sem-filtro-ambiente` reproduz o estado ANTERIOR à correção de 02/09
 * (quando nota de homologação entrava na base). É a única forma de reproduzir o
 * caso original, já que hoje a base filtrada devolve R$ 0,00 dos dois lados.
 * Ele NÃO altera o app — só esta leitura.
 *
 * Uso:
 *   npx tsx --tsconfig scripts/tsconfig.smoke.json --env-file=.env.local \
 *     scripts/diag-apuracao-x-pgdasd.ts --empresa=<uuid> --competencia=YYYYMM [--sem-filtro-ambiente]
 */
import { loadEnvConfig } from '@next/env';
import { createClient } from '@supabase/supabase-js';
import { calcularApuracao } from '@/lib/fiscal/apuracao';
import type { ReceitaApuracao } from '@/lib/fiscal/apuracao-types';
import { calcularRbt12 } from '@/lib/fiscal/rbt12';
import { lerReceitasParaApuracao } from '@/lib/fiscal/receitas-source';
import { competenciaReferenciaBrt, competenciaAddMonths } from '@/lib/fiscal/guia';
import { resolverAnexoEmpresa } from '@/lib/fiscal/cnae-sync';
import { idAtividadePadrao } from '@/lib/fiscal/pgdasd-atividade';
import { montarDeclaracaoPgdasd, type PgdasdAtividade } from '@/lib/fiscal/pgdasd-declaracao';
import type { AnexoSimples } from '@/lib/fiscal/regime';

for (const n of ['SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SUPABASE_URL']) delete process.env[n];
loadEnvConfig(process.cwd(), true, { info: () => {}, error: () => {} });

const args = process.argv.slice(2);
const arg = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.split('=')[1];
const EMPRESA = arg('empresa');
const COMPETENCIA = arg('competencia') ?? '202606';
const SEM_FILTRO = args.includes('--sem-filtro-ambiente');

if (!EMPRESA) { console.error('\nfalta --empresa=<uuid>\n'); process.exit(1); }

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const tit = (t: string) => { console.log(`\n${'─'.repeat(72)}\n${t}\n${'─'.repeat(72)}`); };

/** Reprodução do estado PRÉ-correção: mesma consulta, SEM `.eq('ambiente','prod')`. */
async function receitasSemFiltroAmbiente(companyId: string, ate: string): Promise<ReceitaApuracao[]> {
  const inicio = competenciaAddMonths(ate, -12);
  const inicioIso = `${inicio.slice(0, 4)}-${inicio.slice(4, 6)}-01T00:00:00-03:00`;
  const { data, error } = await sb
    .from('notas_fiscais')
    .select('id, data_emissao, valor_total, status, tipo_documento, cnae, ambiente')
    .eq('company_id', companyId)
    .in('status', ['ativa', 'lancada'])
    .in('tipo_documento', ['NFSe', 'NFe', 'NFCe'])
    .gte('data_emissao', inicioIso)
    .order('id');
  if (error) throw new Error(error.message);
  return (data ?? [])
    .filter((n) => n.data_emissao != null && n.valor_total != null)
    .map((n) => ({
      competencia: competenciaReferenciaBrt(new Date(n.data_emissao as string)),
      valor: Number(n.valor_total),
      cnae: (n.cnae as string | null) ?? null,
    }));
}

async function main() {
  const { data: empresa } = await sb
    .from('companies').select('id, razao_social, cnpj, created_at').eq('id', EMPRESA).single();
  const { data: fiscal } = await sb
    .from('empresas_fiscais')
    .select('Code_regime_tributario, anexo_simples, data_inicio_atividade')
    .eq('empresa_id', EMPRESA).is('deleted_at', null).maybeSingle();

  tit(`EMPRESA · ${empresa?.razao_social ?? '?'} · competência ${COMPETENCIA}`);
  console.log(`  regime           ${fiscal?.Code_regime_tributario ?? '(nulo)'}`);
  console.log(`  anexo_simples    ${fiscal?.anexo_simples ?? '(NULO — a apuração recusaria)'}`);
  console.log(`  inicio atividade ${fiscal?.data_inicio_atividade ?? '(nulo)'}`);

  const receitas = SEM_FILTRO
    ? await receitasSemFiltroAmbiente(EMPRESA!, COMPETENCIA)
    : await lerReceitasParaApuracao(sb as never, EMPRESA!, COMPETENCIA);

  tit(`RECEITAS LIDAS ${SEM_FILTRO ? '(SEM filtro de ambiente — estado pré-correção)' : '(com filtro ambiente=prod)'}`);
  console.log(`  ${receitas.length} linha(s)`);
  for (const r of receitas) console.log(`   · ${r.competencia}  ${brl(r.valor).padStart(14)}  cnae=${r.cnae ?? '(nulo)'}`);

  const doMes = receitas.filter((r) => r.competencia === COMPETENCIA);
  const somaMes = Number(doMes.reduce((a, r) => a + r.valor, 0).toFixed(2));

  // ── LADO A: o que a TELA mostra ──────────────────────────────────────────
  tit('LADO A — calcularApuracao (o que a tela promete)');
  const { rbt12, mesesConsiderados, anualizado } = calcularRbt12(
    receitas, COMPETENCIA, fiscal?.data_inicio_atividade as string | undefined,
  );
  console.log(`  receita do mês   ${brl(somaMes)}`);
  console.log(`  RBT12            ${brl(rbt12)}  (${mesesConsiderados} meses${anualizado ? ', ANUALIZADO' : ''})`);
  // ⚠️ PELO RESOLVER DE PRODUCAO, nao pelo `anexo_simples` cru.
  // A primeira versao deste script passava o campo manual e acusou "tela=Anexo
  // III x declaracao=Anexo IV" -- divergencia que NAO existe: `resolverAnexo`
  // da PRECEDENCIA ao CNAE sobre o campo manual (anexo-resolver.ts:29). Ler o
  // campo em vez de chamar o resolver e inventar defeito.
  const resolvido = await resolverAnexoEmpresa(
    sb as never, EMPRESA!, (fiscal?.anexo_simples ?? null) as AnexoSimples | null, COMPETENCIA,
  );
  console.log(`  anexo manual     ${fiscal?.anexo_simples ?? '(nulo)'}`);
  console.log(`  anexo RESOLVIDO  ${resolvido.anexo ?? '(nulo)'}  (origem: ${resolvido.origem})`);
  try {
    const ap = calcularApuracao({
      regimeCode: String(fiscal?.Code_regime_tributario ?? '1'),
      anexo: resolvido.anexo,
      receitas,
      competencia: COMPETENCIA,
      dataInicioAtividade: (fiscal?.data_inicio_atividade as string | undefined) ?? undefined,
    });
    console.log(`  anexo            ${'anexo' in (ap.breakdown as object) ? (ap.breakdown as { anexo?: string }).anexo : '—'}`);
    console.log(`  alíquota efetiva ${ap.aliquotaEfetiva != null ? `${(ap.aliquotaEfetiva * 100).toFixed(4)}%` : '—'}`);
    console.log(`  IMPOSTO          ${brl(ap.valorImposto)}`);
    console.log(`  breakdown        ${JSON.stringify(ap.breakdown)}`);
  } catch (e) {
    console.log(`  ❌ recusou: ${e instanceof Error ? e.message : e}`);
  }

  // ── LADO B: o que VAI para a SERPRO ──────────────────────────────────────
  tit('LADO B — montarDeclaracaoPgdasd (o que a Receita recebe)');
  const { data: cnaePrinc } = await sb
    .from('company_cnaes').select('codigo')
    .eq('company_id', EMPRESA).eq('tipo', 'principal').is('deleted_at', null).maybeSingle();
  const cnaePrincipal = (cnaePrinc?.codigo as string | null) ?? null;
  const cnaes = Array.from(new Set([cnaePrincipal, ...doMes.map((r) => r.cnae)].filter((c): c is string => !!c)));
  const { data: refs } = cnaes.length
    ? await sb.from('cnae_anexo').select('codigo, anexo_base, fator_r').in('codigo', cnaes)
    : { data: [] as Array<Record<string, unknown>> };
  const refMap = new Map((refs ?? []).map((r) => [r.codigo as string, r]));

  console.log(`  CNAE principal   ${cnaePrincipal ?? '(nulo)'}`);
  for (const c of cnaes) {
    const r = refMap.get(c);
    console.log(`   · ${c}  anexo_base=${(r?.anexo_base as string) ?? 'AUSENTE do catálogo'} fator_r=${r?.fator_r ?? '—'}`);
  }

  const porId = new Map<number, number>();
  for (const r of doMes) {
    const ref = (r.cnae && refMap.get(r.cnae)) || (cnaePrincipal && refMap.get(cnaePrincipal)) || null;
    const id = idAtividadePadrao((ref?.anexo_base as AnexoSimples | null) ?? null, ref?.fator_r === true);
    porId.set(id, (porId.get(id) ?? 0) + r.valor);
  }
  const atividadesMes: PgdasdAtividade[] = Array.from(porId, ([idAtividade, valor]) => ({ idAtividade, valor }));
  const receitasBrutasAnteriores = Array.from({ length: 12 }, (_, i) => {
    const pa = competenciaAddMonths(COMPETENCIA, -(i + 1));
    const valorInterno = receitas.filter((r) => r.competencia === pa).reduce((a, r) => a + r.valor, 0);
    return { pa: Number(pa), valorInterno: Number(valorInterno.toFixed(2)), valorExterno: 0 };
  }).reverse();

  console.log(`  atividades       ${JSON.stringify(atividadesMes)}`);
  console.log(`  soma enviada     ${brl(atividadesMes.reduce((a, x) => a + x.valor, 0))}`);
  const somaAnteriores = receitasBrutasAnteriores.reduce((a, x) => a + x.valorInterno, 0);
  console.log(`  RBT12 ENVIADO    ${brl(somaAnteriores)}  (12 meses CRUS, sem anualizar)`);

  const dados = montarDeclaracaoPgdasd({
    cnpj: String(empresa?.cnpj ?? ''),
    competencia: COMPETENCIA,
    atividadesMes,
    receitasBrutasAnteriores,
    folhasSalario: [],
    indicadorTransmissao: false,
  });

  // ── O CONFRONTO ──────────────────────────────────────────────────────────
  tit('CONFRONTO');
  const somaB = Number(atividadesMes.reduce((a, x) => a + x.valor, 0).toFixed(2));
  console.log(`  receita do mês   A=${brl(somaMes)}   B=${brl(somaB)}   ${somaMes === somaB ? '✅ iguais' : '❌ DIVERGEM'}`);
  console.log(`  RBT12            A=${brl(rbt12)}${anualizado ? ' (anualizado)' : ''}   B=${brl(somaAnteriores)} (cru)   ${rbt12 === somaAnteriores ? '✅ iguais' : '⚠️  DIFERENTES — a SERPRO reanualiza por conta dela'}`);
  console.log(`\n  receitasBrutasAnteriores ENVIADAS:`);
  for (const rba of receitasBrutasAnteriores) {
    console.log(`    pa=${rba.pa}  interno=${rba.valorInterno.toFixed(2).padStart(10)}  externo=${rba.valorExterno}`);
  }
  console.log(`\n  payload completo:`);
  console.log(JSON.stringify(dados, null, 2));
  console.log('\nNADA ALTERADO — leitura.\n');
}

main().catch((e) => { console.error(`\nfalhou: ${e instanceof Error ? e.message : e}\n`); process.exit(1); });
