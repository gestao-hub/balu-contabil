// DCTFWeb pelo Integra Contador — prioridade 5 da análise de 06/10/2026.
//
// SÓ LEITURA E GUIA, nunca transmissão:
//   CONSRECIBO32 (Consultar) — recibo da declaração do mês (prova de entrega)
//   GERARGUIA31  (Emitir)    — DARF da declaração (exige declaração ATIVA)
// TRANSDECLARACAO310 fica de fora: transmitir é irreversível e tem efeito
// legal, e segue a mesma regra do PGDAS-D (só simulação até haver decisão).
//
// Categoria fixa GERAL_MENSAL (40): é a da folha mensal da empresa, o caso dos
// clientes da Balu. 13º, aferição e reclamatória ficam para quando houver
// demanda.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { chamarIntegraDaEmpresa } from '@/lib/fiscal/serpro-chamada';

type Resultado = { ok: true; pdfBase64: string } | { ok: false; error: string };

/** `PDFByteArrayBase64` do `dados` (string JSON ou objeto). Puro — exportado para teste. */
export function pdfDaResposta(envelope: unknown): string | null {
  const env = (envelope ?? {}) as { dados?: unknown };
  let d: unknown = env.dados;
  if (typeof d === 'string') {
    if (!d.trim()) return null;
    try { d = JSON.parse(d); } catch { return null; }
  }
  const o = (d && typeof d === 'object' ? d : {}) as Record<string, unknown>;
  const v = o.PDFByteArrayBase64 ?? o.pdfByteArrayBase64;
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** AAAAMM → { anoPA, mesPA }, ou null. Puro — exportado para teste. */
export function periodoDe(competencia: string): { anoPA: string; mesPA: string } | null {
  const m = /^(\d{4})(\d{2})$/.exec(competencia);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null;
  return { anoPA: m[1], mesPA: m[2] };
}

async function chamar(
  sb: SupabaseClient, companyId: string, competencia: string,
  p: { rota: 'Consultar' | 'Emitir'; idServico: string; contexto: string },
): Promise<Resultado> {
  const periodo = periodoDe(competencia);
  if (!periodo) return { ok: false, error: 'Competência inválida.' };
  const r = await chamarIntegraDaEmpresa(sb, companyId, {
    rota: p.rota, idSistema: 'DCTFWEB', idServico: p.idServico,
    dados: { categoria: 'GERAL_MENSAL', ...periodo },
    contexto: p.contexto,
  });
  if (!r.ok) return r;
  const pdf = pdfDaResposta(r.resp);
  return pdf ? { ok: true, pdfBase64: pdf } : { ok: false, error: `${p.contexto}: a Receita não devolveu o documento.` };
}

export function consultarReciboDctfweb(sb: SupabaseClient, companyId: string, competencia: string) {
  return chamar(sb, companyId, competencia, {
    rota: 'Consultar', idServico: 'CONSRECIBO32',
    contexto: 'Não foi possível obter o recibo da DCTFWeb (a declaração do mês foi transmitida?)',
  });
}

export function gerarGuiaDctfweb(sb: SupabaseClient, companyId: string, competencia: string) {
  return chamar(sb, companyId, competencia, {
    rota: 'Emitir', idServico: 'GERARGUIA31',
    contexto: 'Não foi possível gerar o DARF da DCTFWeb (a declaração precisa estar transmitida e ativa)',
  });
}
