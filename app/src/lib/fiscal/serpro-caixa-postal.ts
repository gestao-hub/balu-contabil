// Caixa Postal do e-CAC pelo Integra Contador (CAIXAPOSTAL). Mesma forma das
// demais consultas com procurador (`serpro-dasn-simei.ts`): contratante +
// token do procurador da empresa + POST /Consultar.
//
// ⚠️ `detalharMensagem` DÁ CIÊNCIA da intimação (Decreto 70.235/72, art. 23,
// § 2º, III). Só pode ser chamada por clique de uma pessoa avisada — nunca por
// cron. Ver o cabeçalho da 0110.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { garantirAuthContratante } from '@/lib/fiscal/serpro-contratante';
import { garantirTokenProcurador } from '@/lib/fiscal/serpro-procurador';
import { consultarComProcurador, Tipo } from '@/lib/clients/serpro';
import { traduzirErroSerpro } from '@/lib/fiscal/serpro-erro';
import {
  parseIndicador, parseListaMensagens, parseDetalhe,
  type ListaMensagens, type MensagemDetalhe,
} from '@/lib/fiscal/serpro-caixa-postal-parse';

type Falha = { ok: false; error: string };

/** Uma chamada ao serviço CAIXAPOSTAL para a empresa. */
async function chamar(
  sb: SupabaseClient, companyId: string, idServico: string, dados: Record<string, string> | null,
): Promise<{ ok: true; resp: unknown } | Falha> {
  const { data: company } = await sb.from('companies').select('cnpj').eq('id', companyId).single();
  const cnpj = String(company?.cnpj ?? '').replace(/\D+/g, '');
  if (!cnpj) return { ok: false, error: 'CNPJ da empresa ausente.' };

  const auth = await garantirAuthContratante();
  if (!auth) return { ok: false, error: 'Configure o certificado do contratante (SERPRO) para consultar.' };
  const tk = await garantirTokenProcurador(sb, companyId);
  if (!tk.ok) return { ok: false, error: tk.warning };

  try {
    const resp = await consultarComProcurador({
      pfx: auth.pfx, passphrase: auth.passphrase, accessToken: auth.accessToken, jwt: auth.jwt,
      procuradorToken: tk.token,
      envelope: {
        contratante: { numero: auth.cnpj, tipo: Tipo.CNPJ },
        autorPedidoDados: { numero: cnpj, tipo: Tipo.CNPJ },
        contribuinte: { numero: cnpj, tipo: Tipo.CNPJ },
        pedidoDados: {
          idSistema: 'CAIXAPOSTAL', idServico, versaoSistema: '1.0',
          dados: dados ? JSON.stringify(dados) : '',
        },
      },
    });
    return { ok: true, resp };
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (/ICGERENCIADOR-022|procura(c|ç)[aã]o/i.test(msg)) {
      return { ok: false, error: 'A empresa ainda não autorizou a Balu (Termo/procuração) na SERPRO.' };
    }
    return { ok: false, error: `Não foi possível consultar a Caixa Postal: ${traduzirErroSerpro(msg)}` };
  }
}

/** INNOVAMSG63 — há mensagem nova (ainda não aberta por ninguém)? */
export async function indicadorMensagensNovas(
  sb: SupabaseClient, companyId: string,
): Promise<{ ok: true; indicador: 0 | 1 | 2 | null } | Falha> {
  const r = await chamar(sb, companyId, 'INNOVAMSG63', null);
  if (!r.ok) return r;
  try { return { ok: true, indicador: parseIndicador(r.resp) }; }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'Resposta inválida.' }; }
}

/** Teto de páginas por consulta: uma caixa enorme não pode prender o cron. */
const MAX_PAGINAS = 5;

/**
 * MSGCONTRIBUINTE61 — lista (assunto, origem, data). NÃO abre mensagem nenhuma.
 * `somenteNaoLidas` pede `statusLeitura: 2`; senão, todas (`0`).
 */
export async function listarMensagens(
  sb: SupabaseClient, companyId: string, opts: { somenteNaoLidas: boolean },
): Promise<{ ok: true; lista: ListaMensagens } | Falha> {
  const todas: ListaMensagens = { mensagens: [], ultimaPagina: true, proximoPonteiro: null };
  let ponteiro: string | null = null;
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const dados: Record<string, string> = {
      statusLeitura: opts.somenteNaoLidas ? '2' : '0',
      indicadorPagina: ponteiro ? '1' : '0',
      ...(ponteiro ? { ponteiroPagina: ponteiro } : {}),
    };
    const r = await chamar(sb, companyId, 'MSGCONTRIBUINTE61', dados);
    if (!r.ok) return pagina === 0 ? r : { ok: true, lista: { ...todas, ultimaPagina: false } };
    let lista: ListaMensagens;
    try { lista = parseListaMensagens(r.resp); }
    catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'Resposta inválida.' }; }
    todas.mensagens.push(...lista.mensagens);
    if (lista.ultimaPagina || !lista.proximoPonteiro) return { ok: true, lista: todas };
    ponteiro = lista.proximoPonteiro;
  }
  // Bateu o teto de páginas: o que veio vale, e o resto entra na próxima rodada.
  return { ok: true, lista: { ...todas, ultimaPagina: false } };
}

/**
 * MSGDETALHAMENTO62 — ⚠️ DÁ CIÊNCIA. Só por clique de pessoa avisada.
 */
export async function detalharMensagem(
  sb: SupabaseClient, companyId: string, isn: string,
): Promise<{ ok: true; mensagem: MensagemDetalhe } | Falha> {
  const r = await chamar(sb, companyId, 'MSGDETALHAMENTO62', { isn });
  if (!r.ok) return r;
  try {
    const m = parseDetalhe(r.resp);
    return m ? { ok: true, mensagem: m } : { ok: false, error: 'A Receita não devolveu o conteúdo desta mensagem.' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Resposta inválida.' };
  }
}
