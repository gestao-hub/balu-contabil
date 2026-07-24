// src/app/(auth)/conta/actions.ts
'use server';
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSiteUrl } from '@/lib/site-url';
import { TIPOS_VALIDOS } from '@/lib/notifications/tipos';

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

/** Encerra a conta do titular sem apagar `auth.users`: as 12 FKs `public.* → auth.users`
 *  são ON DELETE CASCADE, então deletar o usuário destruiria notas/guias/empresas em
 *  cascata — inclusive documentos fiscais sob retenção legal. Em vez disso:
 *  1) anonimiza profiles/companies/clientes via RPC `anonimizar_usuario` (retém fiscal);
 *  2) neutraliza o email e bane o login no auth;
 *  3) encerra a sessão e redireciona para /login. */
export async function deleteAccountAction(): Promise<ContaActionResult> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  const admin = createAdminClient();

  // 0) Coleta os caminhos do blob do certificado ANTES de anonimizar (a RPC zera os
  //    ponteiros). O arquivo em si é removido do Storage no passo 4.
  const { data: companiesDoTitular } = await admin
    .from('companies').select('id').eq('user_id', user.id);
  const companyIds = (companiesDoTitular ?? []).map((c) => c.id as string);
  let certPaths: string[] = [];
  if (companyIds.length > 0) {
    const { data: certs } = await admin
      .from('arquivos_auxiliares')
      .select('storage_key, supabase_file_path')
      .in('company_id', companyIds);
    certPaths = [
      ...new Set(
        (certs ?? [])
          .flatMap((a) => [a.storage_key as string | null, a.supabase_file_path as string | null])
          .filter((p): p is string => !!p),
      ),
    ];
  }

  // 1) Anonimiza tabelas de negócio (fiscal retido); NUNCA deletar auth.users (FKs CASCADE).
  const { error: eAnon } = await admin.rpc('anonimizar_usuario', { p_user_id: user.id });
  if (eAnon) return { ok: false, error: eAnon.message };

  // 2) Neutraliza identidade e bloqueia login no auth (ban de longa duração).
  const { error: eUpdate } = await admin.auth.admin.updateUserById(user.id, {
    email: `deleted+${user.id}@invalid.local`,
    user_metadata: { full_name: 'Usuário removido' },
    ban_duration: '876000h',
  });
  if (eUpdate) return { ok: false, error: eUpdate.message };

  // 4) Remove o blob cifrado do certificado do Storage (best-effort — não bloqueia
  //    a exclusão se falhar; os ponteiros no banco já foram zerados).
  if (certPaths.length > 0) {
    try {
      await admin.storage.from('company-certificates').remove(certPaths);
    } catch (e) {
      console.warn('[exclusao] falha ao remover certificado do Storage:', e instanceof Error ? e.message : String(e));
    }
  }

  // 5) Invalida os cookies de sessão antes do redirect.
  await supabase.auth.signOut();
  redirect('/login');
}

/** Salva as preferências de notificação por e-mail (opt-out por tipo). As notificações
 *  no app sempre aparecem — este formulário controla apenas o envio de e-mail.
 *  Ausência de linha em `notification_preferences` equivale a "e-mail habilitado"
 *  (default). `abertura_etapa` é excluído (é transacional do Bloco 2, não recorrente). */
export async function salvarPreferenciasNotificacaoAction(fd: FormData): Promise<ContaActionResult> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  const desativados = fd.getAll('desativar_email').map(String);
  const rows = TIPOS_VALIDOS
    .filter((tipo) => tipo !== 'abertura_etapa')
    .map((tipo) => ({
      owner_user_id: user.id,
      tipo,
      email_enabled: !desativados.includes(tipo),
      updated_at: new Date().toISOString(),
    }));

  const { error } = await supabase
    .from('notification_preferences')
    .upsert(rows, { onConflict: 'owner_user_id,tipo' });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
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
