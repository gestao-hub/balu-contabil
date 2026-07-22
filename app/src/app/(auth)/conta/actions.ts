// src/app/(auth)/conta/actions.ts
'use server';
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSiteUrl } from '@/lib/site-url';

export type ContaActionResult = { ok: true; message?: string } | { ok: false; error: string };
export type ActionResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

/** Atualiza o nome de exibição em user_metadata.full_name. */
export async function updateNomeAction(nome: string): Promise<ContaActionResult> {
  const trimmed = nome.trim();
  if (!trimmed) return { ok: false, error: 'Informe um nome.' };

  const supabase = await createServerClient();
  const { error } = await supabase.auth.updateUser({ data: { full_name: trimmed } });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Envia link de confirmação para o novo email.
 *  O email só muda após o usuário clicar no link recebido. */
export async function updateEmailAction(newEmail: string): Promise<ContaActionResult> {
  const trimmed = newEmail.trim().toLowerCase();
  if (!trimmed || !trimmed.includes('@')) return { ok: false, error: 'Informe um email válido.' };

  const supabase = await createServerClient();
  const origin = getSiteUrl();
  const { error } = await supabase.auth.updateUser(
    { email: trimmed },
    { emailRedirectTo: `${origin}/auth/callback?next=/conta` },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true, message: `Link enviado para ${trimmed}. O email atual permanece ativo até a confirmação.` };
}

/** Atualiza a senha do usuário autenticado, verificando a senha atual primeiro. */
export async function updateSenhaAction(senhaAtual: string, senha: string, confirmar: string): Promise<ContaActionResult> {
  if (!senhaAtual) return { ok: false, error: 'Informe a senha atual.' };
  if (senha.length < 6) return { ok: false, error: 'A nova senha deve ter pelo menos 6 caracteres.' };
  if (senha !== confirmar) return { ok: false, error: 'As senhas não coincidem.' };

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return { ok: false, error: 'Sessão expirada.' };

  // Re-autentica com a senha atual antes de permitir a troca.
  const { error: authError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: senhaAtual,
  });
  if (authError) return { ok: false, error: 'Senha atual incorreta.' };

  const { error } = await supabase.auth.updateUser({ password: senha });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Exclui permanentemente a conta e todos os dados vinculados (cascade no banco).
 *  Após a exclusão, invalida a sessão e redireciona para /login. */
export async function deleteAccountAction(): Promise<ContaActionResult> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) return { ok: false, error: error.message };

  // Invalida os cookies de sessão antes do redirect.
  await supabase.auth.signOut();
  redirect('/login');
}

/** Colunas de credencial/segredo de `empresas_fiscais` que JAMAIS podem sair em texto
 *  puro na exportação — viram o marcador 'configurado' (não-nulo) ou `null`. */
const EMPRESA_FISCAL_SEGREDOS = [
  'nfse_senha_login',
  'nfse_token_api',
  'nfse_chave_api',
  'nfse_frase_secreta',
  'token_portal',
  'senha_responsavel',
] as const;

function sanitizarEmpresaFiscal(row: Record<string, unknown>): Record<string, unknown> {
  const limpo = { ...row };
  for (const chave of EMPRESA_FISCAL_SEGREDOS) {
    limpo[chave] = row[chave] ? 'configurado' : null;
  }
  return limpo;
}

/** Monta a exportação LGPD (art. 18, direito de acesso) com os dados do titular
 *  autenticado. Usa o client autenticado (RLS escopa automaticamente ao titular);
 *  além disso filtra explicitamente pelas empresas do usuário para não vazar dados
 *  de clientes de contabilidade a que o titular tenha acesso como contador. Nunca
 *  inclui credenciais/certificados em texto puro. */
export async function exportarMeusDadosAction(): Promise<ActionResult<{ json: string }>> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();
  if (profileError) return { ok: false, error: profileError.message };

  const { data: companies, error: companiesError } = await supabase
    .from('companies')
    .select('*')
    .eq('user_id', user.id);
  if (companiesError) return { ok: false, error: companiesError.message };

  const companyIds = (companies ?? []).map((c: { id: string }) => c.id);

  async function porEmpresa(tabela: string, coluna: string, select: string) {
    if (companyIds.length === 0) return [] as Record<string, unknown>[];
    const { data, error } = await supabase.from(tabela).select(select).in(coluna, companyIds);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Record<string, unknown>[];
  }

  try {
    const [
      clientes,
      empresasFiscaisRaw,
      notasFiscais,
      guiasFiscais,
      apuracoesFiscais,
      declaracoesFiscais,
      honorarios,
    ] = await Promise.all([
      porEmpresa('clientes', 'company_id', '*'),
      porEmpresa('empresas_fiscais', 'empresa_id', '*'),
      porEmpresa(
        'notas_fiscais',
        'company_id',
        'id, company_id, tipo_documento, referencia, data_emissao, status, valor_total, chave_acesso, cliente_id, cnae, protocolo_autorizacao, xml_url, pdf_url, numero_nf, serie, cancelled_at, cancellation_reason, created_at, updated_at',
      ),
      porEmpresa('guias_fiscais', 'company_id', '*'),
      porEmpresa('apuracoes_fiscais', 'company_id', '*'),
      porEmpresa('declaracoes_fiscais', 'company_id', '*'),
      porEmpresa('honorarios', 'empresa_cliente_id', '*'),
    ]);

    const { data: aceites, error: aceitesError } = await supabase
      .from('aceites')
      .select('id, tipo, versao, aceito_em')
      .eq('user_id', user.id);
    if (aceitesError) return { ok: false, error: aceitesError.message };

    const empresasFiscais = empresasFiscaisRaw.map(sanitizarEmpresaFiscal);

    const exportObj = {
      exportado_em: new Date().toISOString(),
      titular: { id: user.id, email: user.email ?? null },
      profiles: profile ?? null,
      companies: companies ?? [],
      empresas_fiscais: empresasFiscais,
      clientes,
      notas_fiscais: notasFiscais,
      guias_fiscais: guiasFiscais,
      apuracoes_fiscais: apuracoesFiscais,
      declaracoes_fiscais: declaracoesFiscais,
      honorarios,
      aceites: aceites ?? [],
    };

    return { ok: true, data: { json: JSON.stringify(exportObj, null, 2) } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Falha ao gerar exportação.' };
  }
}
