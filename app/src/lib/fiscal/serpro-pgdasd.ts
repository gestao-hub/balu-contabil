import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AnexoSimples } from '@/lib/fiscal/regime';
import { garantirAuthContratante } from '@/lib/fiscal/serpro-contratante';
import { garantirTokenProcurador } from '@/lib/fiscal/serpro-procurador';
import { declararComProcurador, Tipo } from '@/lib/clients/serpro';
import { lerReceitasParaApuracao } from '@/lib/fiscal/receitas-source';
import { lerFolhaParaApuracao } from '@/lib/fiscal/folha-source';
import { competenciaAddMonths } from '@/lib/fiscal/guia';
import { idAtividadePadrao } from '@/lib/fiscal/pgdasd-atividade';
import { montarDeclaracaoPgdasd, type PgdasdAtividade } from '@/lib/fiscal/pgdasd-declaracao';
import { parseDeclaracaoPgdasd, type DeclaracaoPgdasdResult } from '@/lib/fiscal/serpro-pgdasd-parse';

type Result = { ok: true; result: DeclaracaoPgdasdResult } | { ok: false; error: string };

/**
 * Monta a PGDAS-D (TRANSDECLARACAO11) da competência e chama o /Declarar via procurador.
 * `indicadorTransmissao=false` → dry-run (SERPRO calcula sem transmitir). Espelha gerarDasSimples.
 */
export async function transmitirPgdasd(
  supabase: SupabaseClient,
  companyId: string,
  competencia: string, // YYYYMM
  opts: { indicadorTransmissao: boolean },
): Promise<Result> {
  const { data: company } = await supabase.from('companies').select('cnpj').eq('id', companyId).single();
  const empresaCnpj = String(company?.cnpj ?? '').replace(/\D+/g, '');
  if (!empresaCnpj) return { ok: false, error: 'CNPJ da empresa ausente.' };

  const auth = await garantirAuthContratante();
  if (!auth) return { ok: false, error: 'Configure o certificado do contratante (SERPRO).' };
  const tk = await garantirTokenProcurador(supabase, companyId);
  if (!tk.ok) return { ok: false, error: tk.warning };

  // CNAE principal (fallback de atividade) + mapa cnae→(anexo,fatorR) p/ idAtividade.
  const { data: cnaePrinc } = await supabase
    .from('company_cnaes').select('codigo')
    .eq('company_id', companyId).eq('tipo', 'principal').is('deleted_at', null).maybeSingle();
  const cnaePrincipal = (cnaePrinc?.codigo as string | null) ?? null;

  const receitas = await lerReceitasParaApuracao(supabase, companyId, competencia);
  const doMes = receitas.filter((r) => r.competencia === competencia);
  const cnaes = Array.from(new Set([cnaePrincipal, ...doMes.map((r) => r.cnae)].filter((c): c is string => !!c)));
  const refMap = new Map<string, { anexo_base: AnexoSimples | null; fator_r: boolean }>();
  if (cnaes.length) {
    const { data: refs } = await supabase
      .from('cnae_anexo').select('codigo, anexo_base, fator_r').in('codigo', cnaes);
    for (const r of refs ?? []) {
      refMap.set(r.codigo as string, { anexo_base: (r.anexo_base as AnexoSimples | null) ?? null, fator_r: r.fator_r === true });
    }
  }
  const idAtivDe = (cnae: string | null | undefined): number => {
    const ref = (cnae && refMap.get(cnae)) || (cnaePrincipal && refMap.get(cnaePrincipal)) || null;
    return idAtividadePadrao(ref?.anexo_base ?? null, ref?.fator_r ?? false);
  };

  // Atividades do mês: agrupa receita por idAtividade.
  const porId = new Map<number, number>();
  for (const r of doMes) {
    const id = idAtivDe(r.cnae);
    porId.set(id, (porId.get(id) ?? 0) + r.valor);
  }
  const atividadesMes: PgdasdAtividade[] = Array.from(porId, ([idAtividade, valor]) => ({ idAtividade, valor }));
  if (atividadesMes.length === 0) return { ok: false, error: 'Sem receita na competência para declarar.' };

  // receitasBrutasAnteriores: 12 meses anteriores (interno).
  const receitasBrutasAnteriores = Array.from({ length: 12 }, (_, i) => {
    const pa = competenciaAddMonths(competencia, -(i + 1));
    const valorInterno = receitas.filter((r) => r.competencia === pa).reduce((acc, r) => acc + r.valor, 0);
    return { pa: Number(pa), valorInterno: Number(valorInterno.toFixed(2)), valorExterno: 0 };
  }).reverse();

  // folhasSalario: só vale p/ atividade sujeita a Fator R (idAtividade 10/11/12/29). A SERPRO
  // recusa folha sem atividade que a exija ("Foi informada a lista de Folha de Salários mas não há
  // atividade com este requisito."). Sem Fator R → lista vazia.
  const ID_ATIV_FATOR_R = [10, 11, 12, 29];
  const temFatorR = atividadesMes.some((a) => ID_ATIV_FATOR_R.includes(a.idAtividade));
  const folhas = temFatorR ? await lerFolhaParaApuracao(supabase, companyId, competencia) : [];
  const folhasSalario = temFatorR
    ? Array.from({ length: 12 }, (_, i) => {
        const pa = competenciaAddMonths(competencia, -(i + 1));
        const valor = folhas
          .filter((f) => f.competencia === pa)
          .reduce((acc, f) => acc + f.proLabore + f.salarios + f.encargos, 0);
        return { pa: Number(pa), valor: Number(valor.toFixed(2)) };
      }).reverse()
    : [];

  const chamar = async (cnpjsAdicionais: string[]) => {
    const dados = montarDeclaracaoPgdasd({
      cnpj: empresaCnpj, competencia, atividadesMes,
      receitasBrutasAnteriores, folhasSalario, indicadorTransmissao: opts.indicadorTransmissao,
      cnpjsAdicionais,
    });
    const envelope = {
      contratante: { numero: auth.cnpj, tipo: Tipo.CNPJ },
      autorPedidoDados: { numero: empresaCnpj, tipo: Tipo.CNPJ },
      contribuinte: { numero: empresaCnpj, tipo: Tipo.CNPJ },
      pedidoDados: { idSistema: 'PGDASD', idServico: 'TRANSDECLARACAO11', versaoSistema: '1.0', dados: JSON.stringify(dados) },
    };
    return declararComProcurador({
      pfx: auth.pfx, passphrase: auth.passphrase, accessToken: auth.accessToken,
      jwt: auth.jwt, procuradorToken: tk.token, envelope,
    });
  };

  try {
    let resp: unknown;
    try {
      resp = await chamar([]);
    } catch (e1) {
      // A SERPRO exige TODOS os estabelecimentos do CNPJ. Ela nomeia os faltantes no erro
      // ("...não foram enviados no campo Estabelecimento: 10358425000201."). Extrai e reenvia
      // uma vez com eles como estabelecimentos vazios (a SERPRO é a autoridade sobre quais existem).
      const msg1 = e1 instanceof Error ? e1.message : '';
      const faltantes = /Estabelecimento/i.test(msg1) ? (msg1.match(/\d{14}/g) ?? []) : [];
      if (faltantes.length === 0) throw e1;
      resp = await chamar(faltantes);
    }
    return { ok: true, result: parseDeclaracaoPgdasd(resp) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (/ICGERENCIADOR-022|procura(c|ç)[aã]o/i.test(msg)) {
      return { ok: false, error: 'A empresa ainda não autorizou a Balu (Termo/procuração) na SERPRO.' };
    }
    return { ok: false, error: `Falha na declaração (SERPRO): ${msg.slice(0, 600)}` };
  }
}
