// Relatório de Situação Fiscal pelo Integra Contador (SITFIS).
//
// Dois passos (doc integra-sitfis):
//   1. SOLICITARPROTOCOLO91 em /Apoiar → protocolo + tempo de espera (ms).
//      Se o protocolo do DIA já foi pedido, vem 304 e o protocolo no ETag.
//   2. RELATORIOSITFIS92 em /Emitir com o protocolo → PDF (200) ou "ainda
//      gerando" (202, tempo em segundos).
//
// O protocolo vale só no dia em que foi pedido (fuso de São Paulo). Por isso a
// espera acontece NA MESMA chamada, com teto: quem chama decide quanto pode
// esperar (a tela espera mais, a varredura menos).
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { garantirAuthContratante } from '@/lib/fiscal/serpro-contratante';
import { garantirTokenProcurador } from '@/lib/fiscal/serpro-procurador';
import { apoiarComProcurador, emitirComProcurador, Tipo } from '@/lib/clients/serpro';
import { traduzirErroSerpro } from '@/lib/fiscal/serpro-erro';
import { parseProtocolo, parseEmissao, pareceUmPdf } from '@/lib/fiscal/sitfis-parse';

export type ResultadoSitfisSerpro =
  | { ok: true; pdf: Buffer }
  | { ok: false; error: string; aindaGerando?: boolean };

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function emitirRelatorioSitfis(
  sb: SupabaseClient, companyId: string, opts: { esperaMaximaMs: number },
): Promise<ResultadoSitfisSerpro> {
  const inicio = Date.now();
  const { data: company } = await sb.from('companies').select('cnpj').eq('id', companyId).single();
  const cnpj = String(company?.cnpj ?? '').replace(/\D+/g, '');
  if (!cnpj) return { ok: false, error: 'CNPJ da empresa ausente.' };

  const auth = await garantirAuthContratante();
  if (!auth) return { ok: false, error: 'Configure o certificado do contratante (SERPRO) para consultar.' };
  const tk = await garantirTokenProcurador(sb, companyId);
  if (!tk.ok) return { ok: false, error: tk.warning };

  const base = {
    pfx: auth.pfx, passphrase: auth.passphrase, accessToken: auth.accessToken, jwt: auth.jwt,
    procuradorToken: tk.token,
  };
  const envelope = (idServico: string, dados: string) => ({
    contratante: { numero: auth.cnpj, tipo: Tipo.CNPJ },
    autorPedidoDados: { numero: cnpj, tipo: Tipo.CNPJ },
    contribuinte: { numero: cnpj, tipo: Tipo.CNPJ },
    pedidoDados: { idSistema: 'SITFIS', idServico, versaoSistema: '2.0', dados },
  });

  try {
    // 1. protocolo
    const ap = await apoiarComProcurador({ ...base, envelope: envelope('SOLICITARPROTOCOLO91', '') });
    const { protocolo, esperaMs } = parseProtocolo(ap.corpo, ap.etag);
    if (!protocolo) return { ok: false, error: 'A Receita não devolveu o protocolo do relatório.' };

    // 2. emissão, respeitando o tempo de espera, dentro do teto de quem chama
    let espera = esperaMs;
    for (let tentativa = 0; tentativa < 4; tentativa++) {
      if (espera > 0) {
        if (Date.now() - inicio + espera > opts.esperaMaximaMs) {
          return { ok: false, aindaGerando: true, error: 'A Receita ainda está gerando o relatório. Tente de novo em instantes.' };
        }
        await dormir(espera);
      }
      const resp = await emitirComProcurador({
        ...base, envelope: envelope('RELATORIOSITFIS92', JSON.stringify({ protocoloRelatorio: protocolo })),
      });
      const em = parseEmissao(resp);
      if (em.pronto) {
        if (!pareceUmPdf(em.pdf)) return { ok: false, error: 'A Receita devolveu um arquivo que não é PDF.' };
        return { ok: true, pdf: em.pdf };
      }
      espera = em.esperaMs;
    }
    return { ok: false, aindaGerando: true, error: 'A Receita ainda está gerando o relatório. Tente de novo em instantes.' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (/ICGERENCIADOR-022|procura(c|ç)[aã]o/i.test(msg)) {
      return { ok: false, error: 'A empresa ainda não autorizou a Balu (Termo/procuração) na SERPRO.' };
    }
    return { ok: false, error: `Não foi possível emitir a situação fiscal: ${traduzirErroSerpro(msg)}` };
  }
}
