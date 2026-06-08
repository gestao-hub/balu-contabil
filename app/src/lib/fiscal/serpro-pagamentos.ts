import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { garantirAuthContratante } from '@/lib/fiscal/serpro-contratante';
import { garantirTokenProcurador } from '@/lib/fiscal/serpro-procurador';
import { consultarComProcurador, Tipo } from '@/lib/clients/serpro';
import { parsePagamentosDas, type PagamentoDas } from '@/lib/fiscal/serpro-pagamentos-parse';

type Result = { ok: true; pagamentos: PagamentoDas[] } | { ok: false; error: string };

/**
 * Consulta DAS pagos do ano via PAGTOWEB / PAGAMENTOS71.
 * Só retorna documentos efetivamente pagos (dataArrecadacao preenchida).
 * Read-only na SERPRO — não persiste (quem chama decide o upsert).
 */
export async function consultarPagamentosDas(
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
      idSistema: 'PAGTOWEB',
      idServico: 'PAGAMENTOS71',
      versaoSistema: '1.0',
      dados: JSON.stringify({
        codigoTipoDocumentoLista: ['9'],
        intervaloDataArrecadacao: {
          dataInicial: `${ano}-01-01`,
          dataFinal: `${ano}-12-31`,
        },
        primeiroDaPagina: 0,
        tamanhoDaPagina: 100,
      }),
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
    return { ok: true, pagamentos: parsePagamentosDas(resp) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (/ICGERENCIADOR-022|procura(c|ç)[aã]o/i.test(msg)) {
      return { ok: false, error: 'A empresa ainda não autorizou a Balu (Termo/procuração) na SERPRO.' };
    }
    return { ok: false, error: `Falha ao consultar pagamentos SERPRO: ${msg.slice(0, 160)}` };
  }
}
