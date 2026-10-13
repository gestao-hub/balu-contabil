// Uma chamada ao Integra Contador EM NOME DA EMPRESA: contratante + token do
// procurador (Termo assinado com o A1 da empresa) + POST na rota pedida.
//
// Antes deste arquivo, cada serviço novo (Caixa Postal, parcelamentos…)
// repetia o mesmo bloco de autenticação e a mesma tradução de erro. Cópias
// divergem — e a primeira a esquecer o `ICGERENCIADOR-022` mostraria erro cru
// ao cliente em vez de "a empresa ainda não autorizou a Balu".
//
// Duas camadas: `prepararChamadaDaEmpresa` (CNPJ + contratante + procurador,
// uma vez) e `chamarIntegraDaEmpresa` (uma ida ao SERPRO). Quem faz várias
// chamadas seguidas (parcelamentos, SITFIS) prepara uma vez e reaproveita — e
// uma falha de preparo (sem certificado, Termo vencido) aparece com o motivo
// real, não repetida em cada chamada.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { garantirAuthContratante } from '@/lib/fiscal/serpro-contratante';
import { garantirTokenProcurador } from '@/lib/fiscal/serpro-procurador';
import { consultarComProcurador, emitirComProcurador, Tipo, type Envelope } from '@/lib/clients/serpro';
import { traduzirErroSerpro } from '@/lib/fiscal/serpro-erro';

export type ResultadoChamada = { ok: true; resp: unknown } | { ok: false; error: string };

export type ChamadaPreparada = {
  /** Credenciais do POST (mTLS do contratante + tokens). */
  base: { pfx: Buffer; passphrase: string; accessToken: string; jwt: string; procuradorToken: string };
  /** Envelope em nome da empresa; `dados` já em string (vazia = sem dados). */
  envelope: (p: { idSistema: string; idServico: string; versaoSistema?: string; dados: string }) => Envelope;
};

export async function prepararChamadaDaEmpresa(
  sb: SupabaseClient, companyId: string,
): Promise<{ ok: true; chamada: ChamadaPreparada } | { ok: false; error: string }> {
  const { data: company } = await sb.from('companies').select('cnpj').eq('id', companyId).single();
  const cnpj = String(company?.cnpj ?? '').replace(/\D+/g, '');
  if (!cnpj) return { ok: false, error: 'CNPJ da empresa ausente.' };

  const auth = await garantirAuthContratante();
  if (!auth) return { ok: false, error: 'Configure o certificado do contratante (SERPRO) para consultar.' };
  const tk = await garantirTokenProcurador(sb, companyId);
  if (!tk.ok) return { ok: false, error: tk.warning };

  return {
    ok: true,
    chamada: {
      base: {
        pfx: auth.pfx, passphrase: auth.passphrase, accessToken: auth.accessToken, jwt: auth.jwt,
        procuradorToken: tk.token,
      },
      envelope: (p) => ({
        contratante: { numero: auth.cnpj, tipo: Tipo.CNPJ },
        autorPedidoDados: { numero: cnpj, tipo: Tipo.CNPJ },
        contribuinte: { numero: cnpj, tipo: Tipo.CNPJ },
        pedidoDados: {
          idSistema: p.idSistema, idServico: p.idServico, versaoSistema: p.versaoSistema ?? '1.0', dados: p.dados,
        },
      }),
    },
  };
}

/** Exceção do SERPRO → mensagem para a tela. Falta de procuração tem frase própria. */
export function mensagemDeFalhaSerpro(e: unknown, contexto: string): string {
  const msg = e instanceof Error ? e.message : '';
  if (/ICGERENCIADOR-022|procura(c|ç)[aã]o/i.test(msg)) {
    return 'A empresa ainda não autorizou a Balu (Termo/procuração) na SERPRO.';
  }
  return `${contexto}: ${traduzirErroSerpro(msg)}`;
}

export async function chamarIntegraDaEmpresa(
  sb: SupabaseClient,
  companyId: string,
  p: {
    rota: 'Consultar' | 'Emitir';
    idSistema: string;
    idServico: string;
    versaoSistema?: string;
    dados: Record<string, unknown> | null;
    /** Prefixo da mensagem de erro ("Não foi possível consultar a Caixa Postal"). */
    contexto: string;
  },
  /** Já preparada por quem faz várias chamadas seguidas; senão, prepara aqui. */
  preparada?: ChamadaPreparada,
): Promise<ResultadoChamada> {
  let chamada = preparada;
  if (!chamada) {
    const prep = await prepararChamadaDaEmpresa(sb, companyId);
    if (!prep.ok) return prep;
    chamada = prep.chamada;
  }

  const params = {
    ...chamada.base,
    envelope: chamada.envelope({
      idSistema: p.idSistema, idServico: p.idServico, versaoSistema: p.versaoSistema,
      dados: p.dados ? JSON.stringify(p.dados) : '',
    }),
  };

  try {
    const resp = p.rota === 'Emitir' ? await emitirComProcurador(params) : await consultarComProcurador(params);
    return { ok: true, resp };
  } catch (e) {
    return { ok: false, error: mensagemDeFalhaSerpro(e, p.contexto) };
  }
}
