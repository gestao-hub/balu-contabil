import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { garantirAuthContratante } from '@/lib/fiscal/serpro-contratante';
import { garantirTokenProcurador } from '@/lib/fiscal/serpro-procurador';
import { consultarComProcurador, Tipo } from '@/lib/clients/serpro';
import { parseDasnSimeiLista, type DasnSimeiDeclaracao } from '@/lib/fiscal/serpro-dasn-simei-parse';

type Result = { ok: true; declaracoes: DasnSimeiDeclaracao[] } | { ok: false; error: string };

/**
 * Consulta as DASN-SIMEI (declaração anual do MEI) já transmitidas de um ano-calendário, via o
 * token do procurador (CONSULTIMADECREC152). Read-only — não persiste (quem chama decide o upsert).
 * Espelha consultarDeclaracoesSimples. Obs.: a SERPRO não disponibiliza DASN-SIMEI no Trial.
 */
export async function consultarDasnSimei(
  supabase: SupabaseClient,
  companyId: string,
  ano: number,
): Promise<Result> {
  const { data: company } = await supabase.from('companies').select('cnpj').eq('id', companyId).single();
  const empresaCnpj = String(company?.cnpj ?? '').replace(/\D+/g, '');
  if (!empresaCnpj) return { ok: false, error: 'CNPJ da empresa ausente.' };

  const auth = await garantirAuthContratante();
  if (!auth) return { ok: false, error: 'Configure o certificado do contratante (SERPRO) para consultar.' };
  const tk = await garantirTokenProcurador(supabase, companyId);
  if (!tk.ok) return { ok: false, error: tk.warning };

  const envelope = {
    contratante: { numero: auth.cnpj, tipo: Tipo.CNPJ },
    autorPedidoDados: { numero: empresaCnpj, tipo: Tipo.CNPJ },
    contribuinte: { numero: empresaCnpj, tipo: Tipo.CNPJ },
    pedidoDados: {
      idSistema: 'DASNSIMEI',
      idServico: 'CONSULTIMADECREC152',
      versaoSistema: '1.0',
      dados: JSON.stringify({ cnpjCompleto: empresaCnpj, anoCalendario: String(ano) }),
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
    return { ok: true, declaracoes: parseDasnSimeiLista(resp) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (/ICGERENCIADOR-022|procura(c|ç)[aã]o/i.test(msg)) {
      return { ok: false, error: 'A empresa ainda não autorizou a Balu (Termo/procuração) na SERPRO.' };
    }
    return { ok: false, error: `Falha ao consultar a SERPRO: ${msg.slice(0, 160)}` };
  }
}
