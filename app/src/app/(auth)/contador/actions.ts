// src/app/(auth)/contador/actions.ts
'use server';
import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getContabilidadeCtx } from '@/lib/contador/guards';
import { ContabilidadeSchema, CompanyCreateSchema, ContabilidadeBrandingSchema } from '@/types/zod';
import { posProcessarNovaEmpresa, resolverCodigoMunicipio } from '@/app/(auth)/onboarding/actions';

// Padrão local ao arquivo (não cross-import de rota) — segue a convenção
// dominante do repo: cada `actions.ts` declara seu próprio ActionResult
// (ver onboarding/actions.ts, impostos/actions.ts, conta/actions.ts,
// configuracoes/actions.ts). `clientes/actions.ts` é o único que exporta o
// tipo, e mesmo assim ninguém mais importa cross-rota — só reusa localmente.
export type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

export async function criarContabilidadeAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão inválida.' };
  const parsed = ContabilidadeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos.' };

  const admin = createAdminClient();
  // 1 usuário = 1 contabilidade no lançamento
  const { data: jaMembro } = await admin.from('contabilidade_membros')
    .select('contabilidade_id').eq('user_id', user.id).maybeSingle();
  if (jaMembro) return { ok: false, error: 'Você já faz parte de um escritório.' };

  const { data: cont, error } = await admin.from('contabilidades')
    .insert({ ...parsed.data, status: 'pendente' }).select('id').single();
  if (error) return { ok: false, error: error.message };
  const { error: e2 } = await admin.from('contabilidade_membros')
    .insert({ contabilidade_id: cont.id, user_id: user.id });
  if (e2) return { ok: false, error: e2.message };
  revalidatePath('/contador');
  return { ok: true, data: { id: cont.id } };
}

// Cadastro de empresa CLIENTE pelo escritório (contador cadastra em nome do cliente,
// antes de ele ter conta no Balu). Nasce sem dono (user_id null) e já vinculada à
// carteira (contabilidade_id) — o convite dirigido (convidarClienteAction) é quem,
// mais tarde, transfere a posse pro cliente via aceitar_convite RPC.
export async function criarEmpresaClienteAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const g = await getContabilidadeCtx();
  if ('error' in g) return { ok: false, error: g.error };
  if (!g.contabilidade || g.contabilidade.status !== 'aprovada')
    return { ok: false, error: 'Escritório não aprovado.' };

  // Mesmo pré-processamento de CNPJ do createCompanyAction (normCnpj é local porque
  // onboarding/actions.ts é 'use server' e não pode exportar função síncrona).
  const raw = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const cnpjNormalizado = String(raw.cnpj ?? '').replace(/\D+/g, '').padStart(14, '0').slice(-14);
  const parsed = CompanyCreateSchema.safeParse({ ...raw, cnpj: cnpjNormalizado });
  if (!parsed.success) return { ok: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos.' };

  // Mesma separação de campos que createCompanyAction (onboarding/actions.ts):
  // Code_regime_tributario/cnae_principal moram em empresas_fiscais, não em companies.
  const { Code_regime_tributario, cnae_principal, ...companyFields } = parsed.data;
  const codigoMunicipio = await resolverCodigoMunicipio(companyFields.codigo_municipio, companyFields.cep);

  const admin = createAdminClient();
  const { data: comp, error } = await admin.from('companies')
    .insert({
      ...companyFields,
      codigo_municipio: codigoMunicipio || null,
      user_id: null,
      contabilidade_id: g.contabilidade.id,
      nome: companyFields.nome?.trim() || companyFields.razao_social,
    })
    .select('id').single();
  if (error || !comp) return { ok: false, error: error?.message ?? 'Falha ao criar empresa.' };

  // empresas_fiscais + Focus + CNAEs — mesmo pós-processamento do fluxo do dono.
  // ownerUserId null: empresa ainda sem dono (ver posProcessarNovaEmpresa).
  await posProcessarNovaEmpresa(comp.id, parsed.data, null);

  revalidatePath('/contador');
  return { ok: true, data: { id: comp.id } };
}

export async function removerClienteDaCarteiraAction(companyId: string): Promise<ActionResult> {
  const g = await getContabilidadeCtx();
  if ('error' in g || !g.contabilidade) return { ok: false, error: 'Sem escritório.' };
  const admin = createAdminClient();
  const { error } = await admin.from('companies')
    .update({ contabilidade_id: null })
    .eq('id', companyId).eq('contabilidade_id', g.contabilidade.id); // escopado (anti-IDOR)
  revalidatePath('/contador');
  return error ? { ok: false, error: error.message } : { ok: true };
}

// Task 18: branding do escritório (nome exibido, WhatsApp de suporte, nome do
// remetente de e-mail). Client AUTENTICADO — o GRANT de coluna em 0030 cobre
// exatamente estes 3 campos; `status` nunca é alcançável por aqui.
export async function salvarBrandingAction(input: unknown): Promise<ActionResult> {
  const g = await getContabilidadeCtx();
  if ('error' in g) return { ok: false, error: g.error };
  if (!g.contabilidade) return { ok: false, error: 'Você não faz parte de um escritório.' };

  const parsed = ContabilidadeBrandingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos.' };

  // Campos opcionais: string vazia vira null (regex/limite só se aplicam a valor presente).
  const supabase = await createServerClient();
  const { error } = await supabase
    .from('contabilidades')
    .update({
      nome: parsed.data.nome,
      whatsapp_suporte: parsed.data.whatsapp_suporte || null,
      email_remetente_nome: parsed.data.email_remetente_nome || null,
    })
    .eq('id', g.contabilidade.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/contador/configuracoes');
  return { ok: true };
}

export async function removerMembroAction(userId: string): Promise<ActionResult> {
  const g = await getContabilidadeCtx();
  if ('error' in g || !g.contabilidade) return { ok: false, error: 'Sem escritório.' };
  const admin = createAdminClient();
  const { count } = await admin.from('contabilidade_membros')
    .select('*', { count: 'exact', head: true }).eq('contabilidade_id', g.contabilidade.id);
  if ((count ?? 0) <= 1) return { ok: false, error: 'O escritório precisa ter ao menos 1 membro.' };
  const { error } = await admin.from('contabilidade_membros').delete()
    .eq('contabilidade_id', g.contabilidade.id).eq('user_id', userId);
  revalidatePath('/contador/equipe');
  return error ? { ok: false, error: error.message } : { ok: true };
}
