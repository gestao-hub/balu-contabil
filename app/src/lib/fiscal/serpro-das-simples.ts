import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { garantirAuthContratante } from '@/lib/fiscal/serpro-contratante';
import { garantirTokenProcurador } from '@/lib/fiscal/serpro-procurador';
import { emitirComProcurador, Tipo } from '@/lib/clients/serpro';
import { parseDasSimples, type DasSimplesResult } from '@/lib/fiscal/serpro-das-simples-parse';

type Result = { ok: true; result: DasSimplesResult } | { ok: false; error: string };

/**
 * Gera o DAS (PGDAS-D / GERARDAS12) de um período de uma empresa do Simples, via o token do
 * procurador. Período pago → parseDasSimples devolve { semValor: true } (sem efeito de pagamento).
 */
export async function gerarDasSimples(
  supabase: SupabaseClient,
  companyId: string,
  competencia: string, // 'YYYYMM'
): Promise<Result> {
  const { data: company } = await supabase.from('companies').select('cnpj').eq('id', companyId).single();
  const empresaCnpj = String(company?.cnpj ?? '').replace(/\D+/g, '');
  if (!empresaCnpj) return { ok: false, error: 'CNPJ da empresa ausente.' };

  const auth = await garantirAuthContratante();
  if (!auth) return { ok: false, error: 'Configure o certificado do contratante (SERPRO) para gerar DAS.' };
  const tk = await garantirTokenProcurador(supabase, companyId);
  if (!tk.ok) return { ok: false, error: tk.warning };

  const envelope = {
    contratante: { numero: auth.cnpj, tipo: Tipo.CNPJ },
    autorPedidoDados: { numero: empresaCnpj, tipo: Tipo.CNPJ },
    contribuinte: { numero: empresaCnpj, tipo: Tipo.CNPJ },
    pedidoDados: {
      idSistema: 'PGDASD',
      idServico: 'GERARDAS12',
      versaoSistema: '1.0',
      dados: JSON.stringify({ periodoApuracao: competencia }),
    },
  };

  try {
    const resp = await emitirComProcurador({
      pfx: auth.pfx,
      passphrase: auth.passphrase,
      accessToken: auth.accessToken,
      jwt: auth.jwt,
      procuradorToken: tk.token,
      envelope,
    });
    return { ok: true, result: parseDasSimples(resp) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (/ICGERENCIADOR-022|procura(c|ç)[aã]o/i.test(msg)) {
      return { ok: false, error: 'A empresa ainda não autorizou a Balu (Termo/procuração) na SERPRO.' };
    }
    return { ok: false, error: `Falha ao gerar o DAS na SERPRO: ${msg.slice(0, 160)}` };
  }
}
