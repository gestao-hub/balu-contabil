// Parcelamentos na Receita (Integra-Parcelamento) → `parcelamentos_receita`
// (0112), e as duas consultas ao vivo da tela: parcelas disponíveis e DAS de
// uma parcela.
//
// SOB DEMANDA, sem varredura: cada consulta são 4 chamadas (uma por
// modalidade do regime), e parcelamento muda pouco. O botão "Consultar
// parcelamentos" é a porta.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { chamarIntegraDaEmpresa } from '@/lib/fiscal/serpro-chamada';
import {
  modalidadesDoRegime, modalidadePorSistema, servico, parsePedidos, parseParcelas, parsePdfDas,
  type ParcelaDisponivel,
} from '@/lib/fiscal/parcelamento-parse';

export type ResultadoConsultaParcelamentos =
  | { ok: true; encontrados: number; falhas: string[] }
  | { ok: false; error: string };

export async function consultarParcelamentosEmpresa(
  admin: SupabaseClient, companyId: string,
): Promise<ResultadoConsultaParcelamentos> {
  const { data: fiscal } = await admin.from('empresas_fiscais')
    .select('Code_regime_tributario').eq('empresa_id', companyId).is('deleted_at', null).maybeSingle();
  const modalidades = modalidadesDoRegime(String(fiscal?.Code_regime_tributario ?? ''));
  if (modalidades.length === 0) {
    return { ok: false, error: 'Parcelamentos pela Receita cobrem só empresas do Simples e MEI.' };
  }

  let encontrados = 0;
  const falhas: string[] = [];
  const agora = new Date().toISOString();
  for (const m of modalidades) {
    const r = await chamarIntegraDaEmpresa(admin, companyId, {
      rota: 'Consultar', idSistema: m.sistema, idServico: servico.pedidos(m), dados: null,
      contexto: `Não foi possível consultar ${m.nome}`,
    });
    if (!r.ok) {
      // Falta de autorização vale para todas: não adianta tentar as outras três.
      if (/não autorizou/.test(r.error)) return { ok: false, error: r.error };
      falhas.push(m.nome);
      continue;
    }
    let pedidos;
    try { pedidos = parsePedidos(r.resp); } catch { falhas.push(m.nome); continue; }
    if (pedidos.length === 0) continue;
    const { error } = await admin.from('parcelamentos_receita').upsert(
      pedidos.map((p) => ({
        company_id: companyId, modalidade: m.sistema, numero: p.numero,
        data_pedido: p.dataPedido, situacao: p.situacao, data_situacao: p.dataSituacao,
        consultado_em: agora,
      })),
      { onConflict: 'company_id,modalidade,numero' },
    );
    if (error) { falhas.push(m.nome); continue; }
    encontrados += pedidos.length;
  }

  await admin.from('empresas_fiscais').update({ parcelamentos_consultados_em: agora }).eq('empresa_id', companyId);
  if (falhas.length === modalidades.length) {
    return { ok: false, error: 'Não foi possível consultar os parcelamentos na Receita agora. Tente de novo.' };
  }
  return { ok: true, encontrados, falhas };
}

/** Parcelas que a Receita deixa emitir agora, para uma modalidade. */
export async function parcelasDisponiveis(
  admin: SupabaseClient, companyId: string, sistema: string,
): Promise<{ ok: true; parcelas: ParcelaDisponivel[] } | { ok: false; error: string }> {
  const m = modalidadePorSistema(sistema);
  if (!m) return { ok: false, error: 'Modalidade de parcelamento desconhecida.' };
  const r = await chamarIntegraDaEmpresa(admin, companyId, {
    rota: 'Consultar', idSistema: m.sistema, idServico: servico.parcelas(m), dados: null,
    contexto: 'Não foi possível consultar as parcelas',
  });
  if (!r.ok) return r;
  try { return { ok: true, parcelas: parseParcelas(r.resp) }; }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'Resposta inválida.' }; }
}

/** DAS (PDF, base64) de uma parcela AAAAMM. */
export async function gerarDasDaParcela(
  admin: SupabaseClient, companyId: string, sistema: string, parcela: string,
): Promise<{ ok: true; pdfBase64: string } | { ok: false; error: string }> {
  const m = modalidadePorSistema(sistema);
  if (!m) return { ok: false, error: 'Modalidade de parcelamento desconhecida.' };
  if (!/^\d{6}$/.test(parcela)) return { ok: false, error: 'Parcela inválida.' };
  const r = await chamarIntegraDaEmpresa(admin, companyId, {
    rota: 'Emitir', idSistema: m.sistema, idServico: servico.gerarDas(m),
    dados: { parcelaParaEmitir: Number(parcela) },
    contexto: 'Não foi possível emitir o DAS da parcela',
  });
  if (!r.ok) return r;
  let pdf: string | null;
  try { pdf = parsePdfDas(r.resp); } catch { pdf = null; }
  return pdf ? { ok: true, pdfBase64: pdf } : { ok: false, error: 'A Receita não devolveu o DAS desta parcela.' };
}
