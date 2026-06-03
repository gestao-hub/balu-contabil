import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { garantirAuthContratante } from '@/lib/fiscal/serpro-contratante';
import { garantirTokenProcurador } from '@/lib/fiscal/serpro-procurador';
import { consultarComProcurador, Tipo } from '@/lib/clients/serpro';
import { parseConsultaDeclaracoes, type SituacaoPeriodo } from '@/lib/fiscal/serpro-consulta-parse';

type Result = { ok: true; situacoes: SituacaoPeriodo[] } | { ok: false; error: string };

/**
 * Consulta as declarações/DAS do ano (PGDAS-D / CONSDECLARACAO13) de uma empresa do Simples,
 * via o token do procurador. Read-only — não persiste (quem chama decide o upsert).
 */
export async function consultarDeclaracoesSimples(
  supabase: SupabaseClient,
  companyId: string,
  ano: number,
): Promise<Result> {
  // CNPJ da empresa (contribuinte).
  const { data: company } = await supabase.from('companies').select('cnpj').eq('id', companyId).single();
  const empresaCnpj = String(company?.cnpj ?? '').replace(/\D+/g, '');
  if (!empresaCnpj) return { ok: false, error: 'CNPJ da empresa ausente.' };

  // Auth do contratante (mTLS, cache) + token do procurador (lê o cert da empresa do Storage).
  const auth = await garantirAuthContratante();
  if (!auth) return { ok: false, error: 'Configure o certificado do contratante (SERPRO) para consultar.' };
  const tk = await garantirTokenProcurador(supabase, companyId);
  if (!tk.ok) return { ok: false, error: tk.warning };

  const envelope = {
    contratante: { numero: auth.cnpj, tipo: Tipo.CNPJ },
    autorPedidoDados: { numero: empresaCnpj, tipo: Tipo.CNPJ },
    contribuinte: { numero: empresaCnpj, tipo: Tipo.CNPJ },
    pedidoDados: {
      idSistema: 'PGDASD',
      idServico: 'CONSDECLARACAO13',
      versaoSistema: '1.0',
      dados: JSON.stringify({ anoCalendario: String(ano) }),
    },
  };

  try {
    const resp = await consultarComProcurador({
      pfx: auth.pfx,
      passphrase: auth.passphrase,
      accessToken: auth.accessToken,
      jwt: auth.jwt,
      procuradorToken: tk.token,
      envelope,
    });
    return { ok: true, situacoes: parseConsultaDeclaracoes(resp) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (/ICGERENCIADOR-022|procura(c|ç)[aã]o/i.test(msg)) {
      return { ok: false, error: 'A empresa ainda não autorizou a Balu (Termo/procuração) na SERPRO.' };
    }
    return { ok: false, error: `Falha ao consultar a SERPRO: ${msg.slice(0, 160)}` };
  }
}
