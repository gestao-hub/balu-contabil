import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { garantirAuthContratante } from '@/lib/fiscal/serpro-contratante';
import { garantirTokenProcurador } from '@/lib/fiscal/serpro-procurador';
import { consultarComProcurador, Tipo } from '@/lib/clients/serpro';
import { parsePagamentosDas, type PagamentoDas } from '@/lib/fiscal/serpro-pagamentos-parse';
import { traduzirErroSerpro } from '@/lib/fiscal/serpro-erro';

type Result = { ok: true; pagamentos: PagamentoDas[] } | { ok: false; error: string };

/**
 * Consulta DAS pagos via PAGTOWEB / PAGAMENTOS71.
 * Só retorna documentos efetivamente pagos (dataArrecadacao preenchida).
 * Read-only na SERPRO — não persiste (quem chama decide o upsert).
 *
 * ⚠️ A JANELA É DE DATA DE ARRECADAÇÃO (quando PAGOU), não de competência.
 * As duas não coincidem: o DAS da competência 12/AAAA vence no dia 20 de
 * JANEIRO de AAAA+1, então o pagamento dele cai no ano seguinte ao da
 * competência. Uma janela de um ano civil só, portanto, nunca contém o
 * pagamento da última competência daquele ano.
 *
 * `desdeAno` estica o começo da janela para trás. É UMA chamada só — o
 * `intervaloDataArrecadacao` é um intervalo livre, não um seletor de ano — então
 * ampliar não custa cota de contrato a mais.
 *
 * ⚠️ `tamanhoDaPagina` é 100 e NÃO há laço de paginação: janela larga demais
 * passa a arriscar corte silencioso. Com DAS mensal, dois anos são ~24
 * documentos — folgado. Esticar muito além disso exige paginar antes.
 */
export async function consultarPagamentosDas(
  supabase: SupabaseClient,
  companyId: string,
  ano: number,
  opts: { desdeAno?: number } = {},
): Promise<Result> {
  const anoInicial = Math.min(opts.desdeAno ?? ano, ano);
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
          dataInicial: `${anoInicial}-01-01`,
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
    return { ok: false, error: `Não foi possível consultar os pagamentos: ${traduzirErroSerpro(msg)}` };
  }
}
