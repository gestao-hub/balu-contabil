'use server';
// Caixa Postal do e-CAC — ações da tela (empresa e escritório).
//
// QUEM PODE: o dono da empresa (empresa atual dele) e o escritório que a
// atende (id da empresa na URL, conferido contra a carteira). A leitura das
// mensagens é pela SESSÃO (RLS da 0110); a escrita, pelo service role.
//
// ⚠️ ABRIR DÁ CIÊNCIA (Decreto 70.235/72, art. 23, § 2º, III). A action exige
// `cienteDoPrazo: true` — a tela só manda isso depois do aviso confirmado —, e
// registra quem abriu e quando.
import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getContabilidadeCtx } from '@/lib/contador/guards';
import { registrarAuditoria } from '@/lib/security/audit';
import { sincronizarCaixaPostalEmpresa } from '@/lib/fiscal/caixa-postal-sync';
import { detalharMensagem } from '@/lib/fiscal/serpro-caixa-postal';

type Resultado<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

/**
 * A empresa sobre a qual a pessoa pode agir. `companyId` informado = caminho do
 * escritório; ausente = a empresa atual do dono.
 */
async function empresaPermitida(companyId: string | null): Promise<
  { ok: true; companyId: string; userId: string; contabilidadeId: string | null } | { ok: false; error: string }
> {
  const g = await getContabilidadeCtx();
  if ('error' in g) return { ok: false, error: 'Entre na sua conta.' };

  if (companyId) {
    if (!g.contabilidade || g.contabilidade.status !== 'aprovada') return { ok: false, error: 'Empresa não encontrada.' };
    const { data } = await createAdminClient().from('companies')
      .select('id, contabilidade_id, deleted_at').eq('id', companyId).maybeSingle();
    if (!data || data.contabilidade_id !== g.contabilidade.id || data.deleted_at) {
      return { ok: false, error: 'Empresa não encontrada na sua carteira.' };
    }
    return { ok: true, companyId, userId: g.userId, contabilidadeId: g.contabilidade.id };
  }

  const sb = await createServerClient();
  const { data: p } = await sb.from('profiles').select('current_company').eq('user_id', g.userId).maybeSingle();
  const atual = (p?.current_company as string | null) ?? null;
  if (!atual) return { ok: false, error: 'Selecione a sua empresa.' };
  // Pela SESSÃO: a RLS de `companies` só devolve empresa do próprio usuário.
  const { data: c } = await sb.from('companies').select('id').eq('id', atual).eq('user_id', g.userId).maybeSingle();
  if (!c) return { ok: false, error: 'Empresa não encontrada.' };
  return { ok: true, companyId: atual, userId: g.userId, contabilidadeId: null };
}

function revalidar(companyId: string) {
  revalidatePath('/receita/mensagens');
  revalidatePath(`/contador/clientes/${companyId}/receita`);
}

/** Busca na Receita agora (lista tudo; não abre nada). */
export async function atualizarCaixaPostalAction(
  companyId: string | null,
): Promise<Resultado<{ novas: number; total: number }>> {
  const e = await empresaPermitida(companyId);
  if (!e.ok) return e;
  const r = await sincronizarCaixaPostalEmpresa(createAdminClient(), e.companyId, { completa: true });
  if (!r.ok) return { ok: false, error: r.error };
  revalidar(e.companyId);
  return { ok: true, data: { novas: r.novas, total: r.total } };
}

/** ⚠️ Abre a mensagem na Receita — DÁ CIÊNCIA. */
export async function abrirMensagemReceitaAction(
  mensagemId: string, cienteDoPrazo: boolean,
): Promise<Resultado<{ conteudo: string }>> {
  if (!mensagemId) return { ok: false, error: 'Mensagem não informada.' };
  if (cienteDoPrazo !== true) return { ok: false, error: 'Confirme que está ciente de que abrir a mensagem conta como ciência.' };

  const g = await getContabilidadeCtx();
  if ('error' in g) return { ok: false, error: 'Entre na sua conta.' };

  // Pela SESSÃO: a RLS da 0110 só devolve mensagem da empresa do dono ou de
  // cliente do escritório. Id de outra empresa volta vazio.
  const sb = await createServerClient();
  const { data: m } = await sb.from('mensagens_receita')
    .select('id, company_id, isn, conteudo').eq('id', mensagemId).maybeSingle();
  if (!m) return { ok: false, error: 'Mensagem não encontrada.' };
  // Já aberta antes: o conteúdo guardado basta, sem nova chamada à Receita.
  if (m.conteudo) return { ok: true, data: { conteudo: m.conteudo as string } };

  const admin = createAdminClient();
  const r = await detalharMensagem(admin, m.company_id as string, m.isn as string);
  if (!r.ok) return { ok: false, error: r.error };

  const agora = new Date().toISOString();
  const { error } = await admin.from('mensagens_receita').update({
    conteudo: r.mensagem.corpo,
    assunto: r.mensagem.assunto,
    lida_na_receita: true,
    data_ciencia: r.mensagem.dataCiencia ?? agora.slice(0, 10),
    aberta_em: agora,
    aberta_por: g.userId,
    updated_at: agora,
  }).eq('id', m.id as string);
  if (error) console.error('[caixa postal] mensagem aberta mas não gravada:', error.message);

  await registrarAuditoria({
    actorUserId: g.userId, acao: 'receita.mensagem_aberta',
    alvoTipo: 'mensagem_receita', alvoId: m.id as string,
    contabilidadeId: g.contabilidade?.id ?? undefined,
    // A ciência é o fato jurídico: quem, qual mensagem, quando.
    meta: { company_id: m.company_id, isn: m.isn },
  });

  revalidar(m.company_id as string);
  return { ok: true, data: { conteudo: r.mensagem.corpo } };
}
