// src/app/(onboarding)/onboarding/abertura/actions.ts
'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { createServerClient } from '@/lib/supabase/server';
import { AberturaCreateSchema } from '@/types/zod';
import { ABERTURA_TEXT_FIELDS, DOC_KEYS, EMPTY_ABERTURA, type AberturaData, type DocKey } from '@/types/abertura';
import { uploadAberturaDoc, uploadToBucket, ABERTURA_BUCKET, downloadFromBucket } from '@/lib/clients/supabase-storage';
import { canonical, dadosHash, sha256File } from '@/lib/abertura/hash';

type Result = { ok: true } | { ok: false; error: string };

function parseForm(fd: FormData): AberturaData {
  const d: AberturaData = { ...EMPTY_ABERTURA };
  for (const k of ABERTURA_TEXT_FIELDS) {
    const raw = fd.get(k);
    if (k === 'empresa_cnaes_secundarios') {
      (d as unknown as Record<string, unknown>)[k] = String(raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    } else if (k === 'sede_mesmo_que_titular') {
      (d as unknown as Record<string, unknown>)[k] = String(raw ?? '') === 'true';
    } else if (k === 'titular_cpf') {
      // Normaliza CPF para dígitos-only antes de armazenar e comparar (previne bypass da UNIQUE)
      (d as unknown as Record<string, unknown>)[k] = String(raw ?? '').replace(/\D/g, '');
    } else {
      (d as unknown as Record<string, unknown>)[k] = String(raw ?? '');
    }
  }
  return d;
}

async function fileEntry(fd: FormData, k: DocKey): Promise<{ bytes: Buffer; ext: string; type: string } | null> {
  const f = fd.get(k);
  if (!(f instanceof File) || f.size === 0) return null;
  const bytes = Buffer.from(await f.arrayBuffer());
  const ext = (f.name.split('.').pop() || 'bin').toLowerCase();
  return { bytes, ext, type: f.type || 'application/octet-stream' };
}

export async function submitAberturaAction(fd: FormData): Promise<Result> {
  const data = parseForm(fd);
  const parsed = AberturaCreateSchema.safeParse(data);
  if (!parsed.success) return { ok: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos.' };

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  // Guard: usuário já tem empresa ativa → não pode abrir outra via este fluxo
  const { data: profGuard } = await supabase.from('profiles').select('current_company').eq('user_id', user.id).maybeSingle();
  if (profGuard?.current_company) {
    const { data: compGuard } = await supabase.from('companies').select('status').eq('id', profGuard.current_company).maybeSingle();
    const st = (compGuard as { status?: string } | null)?.status;
    if (st && st !== 'em_abertura') return { ok: false, error: 'Você já possui uma empresa ativa.' };
  }

  // Pré-checa CPF (coluna UNIQUE)
  const { data: existing } = await supabase
    .from('abertura_empresas').select('id').eq('titular_cpf', data.titular_cpf).maybeSingle();
  if (existing) return { ok: false, error: 'Já existe uma solicitação de abertura para este CPF.' };

  // 1) stub em companies
  const { data: stub, error: stubErr } = await supabase.from('companies').insert({
    user_id: user.id, status: 'em_abertura', cnpj: null,
    razao_social: parsed.data.empresa_razao_social_1,
    nome: parsed.data.empresa_nome_fantasia || parsed.data.empresa_razao_social_1,
  }).select('id').single();
  if (stubErr || !stub) return { ok: false, error: 'Falha ao iniciar a empresa.' };

  // 2) profiles.current_company — salva o valor anterior para rollback
  const { data: prof } = await supabase.from('profiles').select('id, current_company').eq('user_id', user.id).maybeSingle();
  const prevCompany = (prof as { current_company?: string | null } | null)?.current_company ?? null;
  const profResult = prof
    ? await supabase.from('profiles').update({ current_company: stub.id }).eq('user_id', user.id)
    : await supabase.from('profiles').insert({ user_id: user.id, current_company: stub.id });
  if (profResult.error) {
    await supabase.from('companies').delete().eq('id', stub.id);
    return { ok: false, error: 'Falha ao associar a empresa ao perfil.' };
  }

  // 3) uploads + content-hash
  const docPaths: Partial<Record<DocKey, string>> = {};
  const docHashes: Partial<Record<DocKey, string>> = {};
  for (const k of DOC_KEYS) {
    const entry = await fileEntry(fd, k);
    if (!entry) continue;
    const { path } = await uploadAberturaDoc(stub.id, `${k}.${entry.ext}`, entry.bytes, entry.type);
    docPaths[k] = path; docHashes[k] = sha256File(entry.bytes);
  }

  // 4) insert abertura_empresas
  // Hash usa `data` (parseForm, sempre string/boolean/'') para consistência com
  // loadAberturaAtual que lê o banco e também retorna '' para campos vazios.
  // parsed.data tem `undefined` em campos opcionais não preenchidos — JSON.stringify
  // os omite, tornando os hashes incomparáveis com os futuros recomputed.
  const hash = dadosHash(canonical(data, docHashes));
  const row: Record<string, unknown> = {
    user_id: user.id,
    company_id: stub.id,
    processo_etapa: 'recebido',
    dados_hash: hash,
    // required fields from parsed.data
    titular_nome_completo: parsed.data.titular_nome_completo,
    titular_cpf: parsed.data.titular_cpf,
    empresa_razao_social_1: parsed.data.empresa_razao_social_1,
    empresa_tipo: parsed.data.empresa_tipo,
    empresa_regime_tributario: parsed.data.empresa_regime_tributario,
    sede_tipo_endereco: parsed.data.sede_tipo_endereco,
    // optional fields from parsed.data
    titular_rg_numero: parsed.data.titular_rg_numero,
    titular_rg_orgao_emissor: parsed.data.titular_rg_orgao_emissor,
    titular_rg_uf: parsed.data.titular_rg_uf,
    titular_data_nascimento: parsed.data.titular_data_nascimento,
    titular_estado_civil: parsed.data.titular_estado_civil,
    titular_nome_mae: parsed.data.titular_nome_mae,
    titular_nacionalidade: parsed.data.titular_nacionalidade,
    titular_telefone: parsed.data.titular_telefone,
    titular_email: parsed.data.titular_email,
    titular_naturalidade_cidade: parsed.data.titular_naturalidade_cidade,
    titular_naturalidade_uf: parsed.data.titular_naturalidade_uf,
    titular_cep: parsed.data.titular_cep,
    titular_logradouro: parsed.data.titular_logradouro,
    titular_numero: parsed.data.titular_numero,
    titular_complemento: parsed.data.titular_complemento,
    titular_bairro: parsed.data.titular_bairro,
    titular_cidade: parsed.data.titular_cidade,
    titular_uf: parsed.data.titular_uf,
    empresa_razao_social_2: parsed.data.empresa_razao_social_2,
    empresa_razao_social_3: parsed.data.empresa_razao_social_3,
    empresa_nome_fantasia: parsed.data.empresa_nome_fantasia,
    empresa_capital_social: parsed.data.empresa_capital_social,
    empresa_objeto_social: parsed.data.empresa_objeto_social,
    empresa_cnae_principal: parsed.data.empresa_cnae_principal,
    empresa_cnaes_secundarios: parsed.data.empresa_cnaes_secundarios,
    sede_mesmo_que_titular: parsed.data.sede_mesmo_que_titular,
    sede_cep: parsed.data.sede_cep,
    sede_logradouro: parsed.data.sede_logradouro,
    sede_numero: parsed.data.sede_numero,
    sede_complemento: parsed.data.sede_complemento,
    sede_bairro: parsed.data.sede_bairro,
    sede_cidade: parsed.data.sede_cidade,
    sede_uf: parsed.data.sede_uf,
  };
  for (const k of DOC_KEYS) if (docPaths[k]) row[k] = docPaths[k];

  const { error: insErr } = await supabase.from('abertura_empresas').insert(row);
  if (insErr) {
    // rollback best-effort — restaura current_company anterior em vez de forçar null
    await supabase.from('profiles').update({ current_company: prevCompany }).eq('user_id', user.id);
    await supabase.from('companies').delete().eq('id', stub.id);
    return { ok: false, error: 'Falha ao registrar a solicitação. Tente novamente.' };
  }

  revalidatePath('/');
  redirect('/configuracoes');
}

export async function loadAberturaAtual(): Promise<{ data: AberturaData; docs: Partial<Record<DocKey, string>>; aberturaId: string } | null> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: prof } = await supabase.from('profiles').select('current_company').eq('user_id', user.id).maybeSingle();
  if (!prof?.current_company) return null;
  const { data: ab } = await supabase.from('abertura_empresas').select('*').eq('company_id', prof.current_company).maybeSingle();
  if (!ab) return null;
  // Defesa explícita: RLS já filtra, mas garante invariante mesmo se RLS estiver desabilitada
  if ((ab as Record<string, unknown>).user_id !== user.id) return null;
  const data: AberturaData = { ...EMPTY_ABERTURA };
  for (const k of ABERTURA_TEXT_FIELDS) {
    if (k === 'empresa_cnaes_secundarios') (data as unknown as Record<string, unknown>)[k] = (ab as Record<string, unknown>)[k] ?? [];
    else if (k === 'sede_mesmo_que_titular') (data as unknown as Record<string, unknown>)[k] = !!(ab as Record<string, unknown>)[k];
    else (data as unknown as Record<string, unknown>)[k] = (ab as Record<string, unknown>)[k] ?? '';
  }
  const docs: Partial<Record<DocKey, string>> = {};
  for (const k of DOC_KEYS) if ((ab as Record<string, unknown>)[k]) docs[k] = (ab as Record<string, unknown>)[k] as string;
  return { data, docs, aberturaId: (ab as Record<string, unknown>).id as string };
}

export async function solicitarAlteracaoAction(fd: FormData): Promise<Result> {
  const data = parseForm(fd);
  const parsed = AberturaCreateSchema.safeParse(data);
  if (!parsed.success) return { ok: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos.' };

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };
  const { data: prof } = await supabase.from('profiles').select('current_company').eq('user_id', user.id).maybeSingle();
  if (!prof?.current_company) return { ok: false, error: 'Empresa não encontrada.' };
  const { data: ab } = await supabase.from('abertura_empresas').select('*').eq('company_id', prof.current_company).maybeSingle();
  if (!ab) return { ok: false, error: 'Solicitação de abertura não encontrada.' };
  // Defesa explícita: RLS já filtra, mas garante invariante mesmo se RLS estiver desabilitada
  if ((ab as Record<string, unknown>).user_id !== user.id) return { ok: false, error: 'Solicitação não encontrada.' };

  const aberturaId = (ab as Record<string, unknown>).id as string;

  // content-hash dos docs: novos enviados vs. atuais (lidos do Storage)
  const newDocHashes: Partial<Record<DocKey, string>> = {};
  const newDocBytes: Partial<Record<DocKey, { bytes: Buffer; ext: string; type: string }>> = {};
  const proposedPaths: Partial<Record<DocKey, string>> = {};
  for (const k of DOC_KEYS) {
    const entry = await fileEntry(fd, k);
    if (entry) {
      newDocHashes[k] = sha256File(entry.bytes);
      newDocBytes[k] = entry;
    } else if ((ab as Record<string, unknown>)[k]) {
      // doc mantido: baixa o atual e hasheia (para comparação justa)
      try {
        const bytes = await downloadFromBucket(ABERTURA_BUCKET, (ab as Record<string, unknown>)[k] as string);
        newDocHashes[k] = sha256File(bytes);
        proposedPaths[k] = (ab as Record<string, unknown>)[k] as string;
      } catch {
        return { ok: false, error: 'Falha ao ler documento existente. Faça o upload novamente.' };
      }
    }
  }

  // hash novo vs base
  const novoHash = dadosHash(canonical(data, newDocHashes));
  const baseHash = String((ab as Record<string, unknown>).dados_hash ?? '');
  if (baseHash && novoHash === baseHash) {
    return { ok: false, error: 'Nenhuma alteração detectada.' };
  }

  // sobe os docs alterados em <aberturaId>/alteracoes/<uuid>/
  // Usa uploadToBucket diretamente porque o scopeId contém '/' (path aninhado).
  const alteracaoId = randomUUID();
  for (const k of DOC_KEYS) {
    const entry = newDocBytes[k];
    if (!entry) continue;
    const storagePath = `${aberturaId}/alteracoes/${alteracaoId}/${k}.${entry.ext}`;
    const { path } = await uploadToBucket(ABERTURA_BUCKET, storagePath, entry.bytes, entry.type);
    proposedPaths[k] = path;
  }

  // raw_json com as mesmas chaves das colunas
  const dados: Record<string, unknown> = {};
  for (const k of ABERTURA_TEXT_FIELDS) dados[k] = (data as unknown as Record<string, unknown>)[k];
  for (const k of DOC_KEYS) if (proposedPaths[k]) dados[k] = proposedPaths[k];

  const { error: insErr } = await supabase.from('abertura_alteracoes').insert({
    abertura_id: aberturaId, user_id: user.id, dados, dados_hash: novoHash, status: 'pendente',
  });
  if (insErr) return { ok: false, error: 'Falha ao registrar a solicitação de alteração.' };

  revalidatePath('/configuracoes');
  redirect('/configuracoes?alteracao=enviada');
}
