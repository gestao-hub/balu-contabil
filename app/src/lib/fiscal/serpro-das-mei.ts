import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { garantirAuthContratante } from '@/lib/fiscal/serpro-contratante';
import { garantirTokenProcurador } from '@/lib/fiscal/serpro-procurador';
import { emitirComProcurador, Tipo } from '@/lib/clients/serpro';
import { parseDasMei, type DasMeiResult } from '@/lib/fiscal/das-mei-parse';
import { isNadaDevido } from '@/lib/fiscal/serpro-das-comum';

export type DasMeiOutcome = { semValor: true } | { semValor: false; das: DasMeiResult };
type Result = { ok: true; result: DasMeiOutcome } | { ok: false; error: string };

/**
 * Gera o DAS-MEI (PGMEI / GERARDASPDF21) de um período via o token do procurador.
 * Período sem valor devido → { semValor: true }. Espelha gerarDasSimples.
 */
export async function gerarDasMei(
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
      idSistema: 'PGMEI',
      idServico: 'GERARDASPDF21',
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
    if (isNadaDevido(resp)) return { ok: true, result: { semValor: true } };
    return { ok: true, result: { semValor: false, das: parseDasMei(resp) } };
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (/ICGERENCIADOR-022|procura(c|ç)[aã]o/i.test(msg)) {
      return { ok: false, error: 'A empresa ainda não autorizou a Balu (Termo/procuração) na SERPRO.' };
    }
    return { ok: false, error: `Falha ao gerar o DAS-MEI na SERPRO: ${msg.slice(0, 160)}` };
  }
}
