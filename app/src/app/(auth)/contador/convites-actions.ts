// src/app/(auth)/contador/convites-actions.ts
'use server';
import { randomBytes } from 'crypto';
import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getContabilidadeCtx, type ContabilidadeCtx } from '@/lib/contador/guards';
import { sendEmail } from '@/lib/clients/email';

// Padrão local ao arquivo (não cross-import de rota) — ver nota em ./actions.ts.
export type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

const novoToken = () => randomBytes(24).toString('base64url');
const siteUrl = () => process.env.NEXT_PUBLIC_SITE_URL!;

// `contabilidade.nome` e `company.nome` são dados de usuário (o escritório escolhe
// o próprio nome; o nome da empresa vem do cadastro) — interpolados crus no HTML
// do e-mail eles seriam um vetor de phishing/HTML injection sob o domínio de envio
// do app. A URL do convite é gerada por nós (token nosso + siteUrl() de env), não
// precisa escapar.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Anotação de retorno explícita: sem ela, o TS infere os dois ramos do union
// preenchendo as chaves ausentes de um com `?: undefined` do outro (quirk de
// inferência de retorno multi-`return`), o que faz `'error' in g` não eliminar
// o ramo `{ ctx }` e `g.error` tipar como `string | undefined` nas actions abaixo.
async function requireEscritorioAprovado(): Promise<{ error: string } | { ctx: ContabilidadeCtx }> {
  const ctx = await getContabilidadeCtx();
  if ('error' in ctx) return { error: ctx.error };
  if (!ctx.contabilidade) return { error: 'Você não faz parte de um escritório.' };
  if (ctx.contabilidade.status !== 'aprovada') return { error: 'Escritório ainda não aprovado.' };
  return { ctx };
}

export async function convidarClienteAction(
  email: string, companyId: string,
): Promise<ActionResult<{ url: string }>> {
  const g = await requireEscritorioAprovado();
  if ('error' in g) return { ok: false, error: g.error };
  const admin = createAdminClient();
  // empresa precisa ser do escritório e não ter dono ainda
  const { data: comp } = await admin.from('companies')
    .select('id, nome, user_id, contabilidade_id').eq('id', companyId).maybeSingle();
  if (!comp || comp.contabilidade_id !== g.ctx.contabilidade!.id)
    return { ok: false, error: 'Empresa não encontrada na sua carteira.' };
  if (comp.user_id) return { ok: false, error: 'Esta empresa já tem um responsável no Balu.' };
  const token = novoToken();
  const expira = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const { error } = await admin.from('convites').insert({
    contabilidade_id: g.ctx.contabilidade!.id, tipo: 'cliente',
    email, token, company_id: companyId, expira_em: expira,
  });
  if (error) return { ok: false, error: error.message };
  const url = `${siteUrl()}/convite/${token}`;
  const nomeEscritorioHtml = escapeHtml(g.ctx.contabilidade!.nome);
  const nomeEmpresaHtml = escapeHtml(comp.nome ?? '');
  await sendEmail({
    to: email,
    fromName: g.ctx.contabilidade!.email_remetente_nome ?? g.ctx.contabilidade!.nome,
    subject: `${g.ctx.contabilidade!.nome} convidou você para o Balu`,
    html: `<p>O escritório <b>${nomeEscritorioHtml}</b> cadastrou a empresa <b>${nomeEmpresaHtml}</b> no Balu.</p>
           <p>Pelo link abaixo você cria seu acesso e assume a empresa. O escritório poderá <b>visualizar</b> suas notas,
           impostos e guias — ele <b>não pode</b> emitir nem alterar nada.</p>
           <p><a href="${url}">${url}</a> (válido por 7 dias)</p>`,
  });
  return { ok: true, data: { url } };
}

export async function gerarLinkEscritorioAction(): Promise<ActionResult<{ url: string }>> {
  const g = await requireEscritorioAprovado();
  if ('error' in g) return { ok: false, error: g.error };
  const admin = createAdminClient();
  const { data: existente } = await admin.from('convites')
    .select('token').eq('contabilidade_id', g.ctx.contabilidade!.id)
    .eq('tipo', 'cliente').is('email', null).is('revogado_em', null).maybeSingle();
  if (existente) return { ok: true, data: { url: `${siteUrl()}/r/${existente.token}` } };
  const token = novoToken();
  const { error } = await admin.from('convites').insert({
    contabilidade_id: g.ctx.contabilidade!.id, tipo: 'cliente', token, email: null, expira_em: null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { url: `${siteUrl()}/r/${token}` } };
}

export async function revogarLinkEscritorioAction(): Promise<ActionResult> {
  const g = await requireEscritorioAprovado();
  if ('error' in g) return { ok: false, error: g.error };
  const admin = createAdminClient();
  const { error } = await admin.from('convites')
    .update({ revogado_em: new Date().toISOString() })
    .eq('contabilidade_id', g.ctx.contabilidade!.id)
    .eq('tipo', 'cliente').is('email', null).is('revogado_em', null);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function convidarMembroAction(email: string): Promise<ActionResult<{ url: string }>> {
  const g = await requireEscritorioAprovado();
  if ('error' in g) return { ok: false, error: g.error };
  const admin = createAdminClient();
  const token = novoToken();
  const { error } = await admin.from('convites').insert({
    contabilidade_id: g.ctx.contabilidade!.id, tipo: 'membro', email, token,
    expira_em: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  });
  if (error) return { ok: false, error: error.message };
  const url = `${siteUrl()}/convite/${token}`;
  const nomeEscritorioHtml = escapeHtml(g.ctx.contabilidade!.nome);
  await sendEmail({ to: email, subject: `Convite para a equipe de ${g.ctx.contabilidade!.nome} no Balu`,
    html: `<p>Você foi convidado(a) para a equipe do escritório <b>${nomeEscritorioHtml}</b>.</p><p><a href="${url}">${url}</a> (7 dias)</p>` });
  return { ok: true, data: { url } };
}

export async function aceitarConviteAction(token: string): Promise<ActionResult<{ companyId: string | null }>> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Faça login para aceitar o convite.' };
  const { data, error } = await supabase.rpc('aceitar_convite', { p_token: token });
  if (error) {
    const msg: Record<string, string> = {
      CONVITE_INVALIDO: 'Convite não encontrado.', CONVITE_REVOGADO: 'Este convite foi cancelado.',
      CONVITE_EXPIRADO: 'Convite expirado — peça um novo ao seu contador.',
      CONVITE_USADO: 'Este convite já foi utilizado.', ESCRITORIO_INATIVO: 'O escritório não está ativo.',
      EMPRESA_JA_TEM_DONO: 'Esta empresa já tem um responsável no Balu.',
    };
    const key = Object.keys(msg).find((k) => error.message.includes(k));
    return { ok: false, error: key ? msg[key] : 'Não foi possível aceitar o convite.' };
  }
  // se veio company: vira empresa ativa do usuário
  const admin = createAdminClient();
  const { data: conv } = await admin.from('convites').select('tipo, company_id').eq('token', token).single();
  if (conv?.tipo === 'cliente' && conv.company_id) {
    // Quem aceita pode ser um usuário TOTALMENTE NOVO — nunca passou por
    // createCompanyAction, então ainda não tem linha em `profiles` (sem trigger de
    // auto-criação no signup, mesma observação de onboarding/actions.ts). Um UPDATE
    // puro seria no-op nesse caso (current_company nunca é setado → o gate de
    // /onboarding prende o cliente antes de ele ver a empresa). Upsert por
    // user_id, mesmo padrão de createCompanyAction.
    const { data: existingProfile } = await admin
      .from('profiles')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (existingProfile) {
      await admin.from('profiles').update({ current_company: conv.company_id }).eq('user_id', user.id);
    } else {
      await admin.from('profiles').insert({ user_id: user.id, current_company: conv.company_id });
    }
  }
  return { ok: true, data: { companyId: conv?.company_id ?? null } };
}
