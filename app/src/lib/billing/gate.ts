// Bloco 4A — Gate de assinatura para ACOES DE ESCRITA COMERCIAL.
//
// Mesmo formato do assertAceitesEmDia (lib/lgpd/pendencia-aceite.ts): funcao
// chamada no topo da action, devolvendo {ok:false,error}. NAO e middleware
// nem layout — "o layout so cobre navegacao de pagina; server actions e
// route handlers nao passam pelo layout" (licao do Bloco E), e gate em
// middleware ja causou loop de redirect na sessao 3.
//
// ┌─ DUAS FRONTEIRAS INEGOCIAVEIS — nunca chame estas funcoes em: ──────────┐
// │ 1. Acao de OBRIGACAO LEGAL com prazo (gerar DAS, registrar declaracao,  │
// │    transmitir PGDAS-D). Bloquear vira multa da Receita para o usuario:  │
// │    dano de terceiro, desproporcional a divida, e exposicao pelo CDC 39. │
// │ 2. Acao de DIREITO DO TITULAR (LGPD art. 18: acesso, correcao,          │
// │    portabilidade, eliminacao). O §5º obriga atendimento SEM CUSTO, e    │
// │    inadimplencia nao e hipotese legal de suspensao desses direitos.     │
// └────────────────────────────────────────────────────────────────────────┘
// `cobertura-gate.test.ts` faz valer as duas listas nos dois sentidos.
import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { ymdBrt } from '@/lib/fiscal/tempo-brt';
import { statusEfetivo, type AssinaturaParaStatus } from './status';
import { MSG_ASSINATURA_PENDENTE } from './mensagens';

export type GateResult = { ok: true } | { ok: false; error: string };

// A frase vem de `mensagens.ts` — módulo neutro, porque a TELA precisa dizer
// exatamente o mesmo texto antes do envio, e este arquivo é server-only.
const MSG = MSG_ASSINATURA_PENDENTE;

/** Fail-open deliberado, igual ao `limitar` do rate-limit: erro de infra
 *  nao pode bloquear cliente que pagou. O risco inverso (um inadimplente
 *  passar durante uma falha de banco) e muito menor que barrar quem esta
 *  em dia. Toda ocorrencia vai pro log. */
function liberadoPorFalha(motivo: string, ref: string): GateResult {
  console.warn(`[billing gate] liberando por falha: ${motivo} (${ref})`);
  return { ok: true };
}

async function avaliar(
  coluna: 'contabilidade_id' | 'company_id',
  valor: string,
): Promise<GateResult> {
  try {
    const sb = createAdminClient();
    const { data, error } = await sb
      .from('assinaturas')
      .select('status, trial_termina_em, liberado_ate')
      .eq(coluna, valor)
      .maybeSingle();

    if (error) return liberadoPorFalha('erro de consulta', valor);
    // Ausencia e bug (a trigger da 0050 cria a linha no INSERT do titular),
    // mas nao e motivo pra barrar quem talvez esteja em dia.
    if (!data) return liberadoPorFalha('assinatura ausente', valor);

    const efetivo = statusEfetivo(data as AssinaturaParaStatus, ymdBrt());
    return efetivo === 'liberado' ? { ok: true } : { ok: false, error: MSG };
  } catch {
    return liberadoPorFalha('excecao inesperada', valor);
  }
}

/** Gate das actions do escritorio (contador). */
export async function assertAssinaturaEscritorio(contabilidadeId: string): Promise<GateResult> {
  if (!contabilidadeId) return { ok: true };
  return avaliar('contabilidade_id', contabilidadeId);
}

/**
 * Gate das actions do empresario.
 *
 * Empresa de carteira (`contabilidade_id` preenchido) responde SEMPRE
 * liberada: quem paga e o escritorio, e a inadimplencia dele nao alcanca a
 * carteira (decisao de produto nº 3.3 da spec). Consequencia aceita e
 * registrada: escritorio que nunca assinou ou cancelou NAO trava os
 * clientes dele.
 */
export async function assertAssinaturaEmpresa(companyId: string): Promise<GateResult> {
  if (!companyId) return { ok: true };
  try {
    const sb = createAdminClient();
    const { data: company, error } = await sb
      .from('companies').select('contabilidade_id').eq('id', companyId).maybeSingle();
    if (error || !company) return liberadoPorFalha('empresa nao encontrada', companyId);
    if (company.contabilidade_id) return { ok: true };
  } catch {
    return liberadoPorFalha('excecao ao ler empresa', companyId);
  }
  return avaliar('company_id', companyId);
}
