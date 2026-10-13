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
import { apoiarComProcurador, emitirComProcurador } from '@/lib/clients/serpro';
import { prepararChamadaDaEmpresa, mensagemDeFalhaSerpro } from '@/lib/fiscal/serpro-chamada';
import { parseProtocolo, parseEmissao, pareceUmPdf } from '@/lib/fiscal/sitfis-parse';

export type ResultadoSitfisSerpro =
  | { ok: true; pdf: Buffer }
  | { ok: false; error: string; aindaGerando?: boolean };

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function emitirRelatorioSitfis(
  sb: SupabaseClient, companyId: string, opts: { esperaMaximaMs: number },
): Promise<ResultadoSitfisSerpro> {
  const inicio = Date.now();
  const prep = await prepararChamadaDaEmpresa(sb, companyId);
  if (!prep.ok) return prep;
  const { base } = prep.chamada;
  const envelope = (idServico: string, dados: string) =>
    prep.chamada.envelope({ idSistema: 'SITFIS', idServico, versaoSistema: '2.0', dados });

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
    return { ok: false, error: mensagemDeFalhaSerpro(e, 'Não foi possível emitir a situação fiscal') };
  }
}
