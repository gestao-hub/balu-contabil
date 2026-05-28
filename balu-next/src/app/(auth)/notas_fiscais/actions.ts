'use server';

// @custom — bubble-behavior (Day 1 / PR 1.2 — V1 §3.2)
// Export CSV do histórico de notas. Re-consulta no servidor aplicando os mesmos
// filtros da tela (período/tipo/status) + filtro de texto em memória.

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { focus, generateRef, type FocusEnv } from '@/lib/clients/focus-nfe';
import { assertTipoDoc, validarJustificativa, type TipoDoc } from '@/lib/fiscal/notas-tipo';
import { buildNfsePayload } from '@/lib/fiscal/nfse-payload';
import { traduzirErroFocus } from '@/lib/fiscal/focus-erro';
import type { RegimeCode } from '@/lib/fiscal/regime';

export type NotasFiltros = {
  start: string | null;
  end: string | null;
  tipo: string | null;
  status: string | null;
  text: string | null;
};

export type ExportResult =
  | { ok: true; csv: string; filename: string }
  | { ok: false; error: string };

type ExportRow = {
  tipo_documento: string;
  referencia: string | null;
  data_emissao: string | null;
  valor_total: number | null;
  status: string | null;
  payload_focusnfe: {
    destinatario?: { razao_social?: string | null; cnpj?: string | null; cpf?: string | null } | null;
  } | null;
};

/** Escapa um campo para CSV (separador ';', padrão pt-BR/Excel). */
function esc(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function exportNotasCsvAction(filtros: NotasFiltros): Promise<ExportResult> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão inválida.' };

  const { data: profile } = await supabase
    .from('profiles')
    .select('current_company')
    .eq('user_id', user.id)
    .single();
  const companyId = (profile?.current_company ?? null) as string | null;
  if (!companyId) return { ok: false, error: 'Nenhuma empresa selecionada.' };

  let q = supabase
    .from('notas_fiscais')
    .select('tipo_documento, referencia, data_emissao, valor_total, status, payload_focusnfe')
    .eq('company_id', companyId)
    .order('data_emissao', { ascending: false, nullsFirst: false })
    .limit(1000);

  if (filtros.tipo) q = q.eq('tipo_documento', filtros.tipo);
  if (filtros.status) q = q.eq('status', filtros.status);
  if (filtros.start) q = q.gte('data_emissao', `${filtros.start}T00:00:00`);
  if (filtros.end) q = q.lte('data_emissao', `${filtros.end}T23:59:59`);

  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };

  let rows = (data ?? []) as unknown as ExportRow[];

  // Nome/documento do cliente vêm do payload_focusnfe.destinatario (não há FK cliente_id).
  const clienteNome = (r: ExportRow) => r.payload_focusnfe?.destinatario?.razao_social ?? '';
  const clienteDoc = (r: ExportRow) =>
    r.payload_focusnfe?.destinatario?.cnpj ?? r.payload_focusnfe?.destinatario?.cpf ?? '';

  const text = filtros.text?.trim().toLowerCase();
  if (text) {
    rows = rows.filter(
      (r) =>
        (r.referencia ?? '').toLowerCase().includes(text) ||
        clienteNome(r).toLowerCase().includes(text) ||
        clienteDoc(r).toLowerCase().includes(text),
    );
  }

  const header = ['Data emissão', 'Tipo', 'Referência', 'Cliente', 'Documento', 'Valor', 'Status'];
  const lines = [header.join(';')];
  for (const r of rows) {
    lines.push(
      [
        r.data_emissao ? new Date(r.data_emissao).toLocaleString('pt-BR') : '',
        r.tipo_documento ?? '',
        r.referencia ?? '',
        clienteNome(r),
        clienteDoc(r),
        r.valor_total != null ? r.valor_total.toFixed(2) : '',
        r.status ?? '',
      ]
        .map(esc)
        .join(';'),
    );
  }

  // BOM (﻿) para o Excel reconhecer UTF-8; CRLF entre linhas.
  const csv = '﻿' + lines.join('\r\n');
  const filename = `notas_fiscais_${new Date().toISOString().slice(0, 10)}.csv`;
  return { ok: true, csv, filename };
}

/**
 * PR 2.1 — Emite uma NFS-e (NFSe Nacional) via Focus.
 *
 * Fluxo:
 *   1. Valida user/empresa/empresa_fiscal_ativada/cert.
 *   2. Resolve tomador (cliente do banco).
 *   3. Monta payload via `buildNfsePayload` (pure helper, testado).
 *   4. Insere `notas_fiscais` `status='pendente'` (com `referencia` única).
 *   5. POST Focus `/v2/nfsen?ref=...`.
 *   6. Sucesso (202 processando_autorizacao): mantém `pendente`; webhook depois
 *      atualiza pra `ativa` ou `erro`. Erro síncrono (pré-validação): vira `erro`
 *      imediato com mensagem traduzida.
 *   7. Redireciona pro detalhe.
 *
 * `env` decidido por `empresas_fiscais.emitir_nota_homol_antes_producao` (true → hom).
 */
export type EmitirNotaInput = {
  clienteId: string;
  codigoTributacao: string;
  descricao: string;
  valorReais: number;
  aliquotaIssPercentual: number;
};

export type EmitirNotaResult =
  | { ok: true; notaId: string }
  | { ok: false; error: string };

export async function emitirNotaAction(input: EmitirNotaInput): Promise<EmitirNotaResult> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };

  const { data: profile } = await supabase
    .from('profiles')
    .select('current_company')
    .eq('user_id', user.id)
    .single();
  const companyId = (profile?.current_company ?? null) as string | null;
  if (!companyId) return { ok: false, error: 'Nenhuma empresa selecionada.' };

  const { data: company } = await supabase
    .from('companies')
    .select('cnpj, codigo_municipio, razao_social, focus_token')
    .eq('id', companyId)
    .single();
  if (!company) return { ok: false, error: 'Empresa não encontrada.' };
  if (!company.focus_token) {
    return { ok: false, error: 'Empresa ainda não está cadastrada na Focus. Vá no Diagnóstico e clique "Sincronizar com Focus".' };
  }

  const { data: fiscal } = await supabase
    .from('empresas_fiscais')
    .select('Code_regime_tributario, empresa_fiscal_ativada, emitir_nota_homol_antes_producao')
    .eq('empresa_id', companyId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!fiscal) return { ok: false, error: 'Configure o regime tributário antes de emitir.' };
  if (fiscal.empresa_fiscal_ativada !== true) {
    return { ok: false, error: 'Ative a empresa fiscal (aba Emissão fiscal) antes de emitir.' };
  }

  const { data: cliente } = await supabase
    .from('clientes')
    .select('id, razao_social, document, person_type')
    .eq('id', input.clienteId)
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!cliente) return { ok: false, error: 'Cliente não encontrado.' };

  const personType = String(cliente.person_type ?? '').toUpperCase();
  const doc = String(cliente.document ?? '').replace(/\D+/g, '');
  const tomadorCnpj = personType === 'PJ' ? doc : null;
  const tomadorCpf = personType === 'PF' ? doc : null;
  if (!tomadorCnpj && !tomadorCpf) {
    return { ok: false, error: 'Cliente sem CPF/CNPJ — atualize o cadastro do cliente.' };
  }

  let payload;
  try {
    payload = buildNfsePayload(
      { cnpj: company.cnpj as string, codigo_municipio: (company.codigo_municipio as string | null) ?? null },
      { Code_regime_tributario: (fiscal.Code_regime_tributario as RegimeCode | null) ?? null },
      {
        cnpj: tomadorCnpj,
        cpf: tomadorCpf,
        razaoSocial: (cliente.razao_social as string | null) ?? '—',
      },
      {
        codigoTributacao: input.codigoTributacao,
        descricao: input.descricao,
        valor: input.valorReais,
        aliquotaIssPercentual: input.aliquotaIssPercentual,
      },
    );
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erro ao montar a nota.' };
  }

  // Inserir nota local `pendente` ANTES do POST: garante que mesmo se a Focus
  // demorar/timeout, o estado fica registrado e o ref é único.
  const ref = generateRef(companyId);
  const valorReaisRound = Math.round(input.valorReais * 100) / 100;
  const dataEmissao = new Date().toISOString();

  const { data: nota, error: insertErr } = await supabase
    .from('notas_fiscais')
    .insert({
      company_id: companyId,
      tipo_documento: 'NFSe',
      referencia: ref,
      data_emissao: dataEmissao,
      status: 'pendente',
      valor_total: valorReaisRound,
      payload_focusnfe: payload as unknown as Record<string, unknown>,
      cliente_id: cliente.id,
    })
    .select('id')
    .single();
  if (insertErr || !nota) {
    return { ok: false, error: insertErr?.message ?? 'Falha ao registrar a nota.' };
  }
  const notaId = nota.id as string;

  // Decide env: hom se empresa marcou "emitir em homologação antes de produção"
  // (default true em onboarding) ou se a flag não está setada.
  const env: FocusEnv = fiscal.emitir_nota_homol_antes_producao === false ? 'prod' : 'hom';

  try {
    const resp = await focus.emitirNfse(ref, payload, company.focus_token as string, env);
    // 202 (processando_autorizacao): mantém status='pendente'; webhook completa.
    // Quando Focus retorna sucesso síncrono (raro pra NFSe), já tem dados.
    await supabase
      .from('notas_fiscais')
      .update({
        // grava resposta sincrona pra debug
        payload_focusnfe: { request: payload, response: resp },
      })
      .eq('id', notaId)
      .eq('company_id', companyId);
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    const friendly = traduzirErroFocus(errMsg);
    await supabase
      .from('notas_fiscais')
      .update({
        status: 'erro',
        payload_focusnfe: { request: payload, error: errMsg },
      })
      .eq('id', notaId)
      .eq('company_id', companyId);
    return { ok: false, error: friendly };
  }

  revalidatePath('/notas_fiscais');
  revalidatePath(`/notas_fiscais/${notaId}`);
  return { ok: true, notaId };
}

/**
 * Versão server-action friendly (form action). Lê o FormData, chama
 * `emitirNotaAction` e redireciona em sucesso. Em erro, retorna pro form
 * com a mensagem via search param `?error=`.
 */
export async function emitirNotaFormAction(formData: FormData): Promise<void> {
  const input: EmitirNotaInput = {
    clienteId: String(formData.get('clienteId') ?? ''),
    codigoTributacao: String(formData.get('codigoTributacao') ?? ''),
    descricao: String(formData.get('descricao') ?? ''),
    valorReais: Number(formData.get('valorReais') ?? 0),
    aliquotaIssPercentual: Number(formData.get('aliquotaIssPercentual') ?? 0),
  };
  const r = await emitirNotaAction(input);
  if (!r.ok) {
    redirect(`/notas_fiscais/emissao?error=${encodeURIComponent(r.error)}`);
  }
  redirect(`/notas_fiscais/${r.notaId}`);
}

export async function cancelarNotaAction(
  id: string,
  justificativa: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const v = validarJustificativa(justificativa);
  if (!v.ok) return v;

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sessão expirada.' };
  const { data: profile } = await supabase
    .from('profiles')
    .select('current_company')
    .eq('user_id', user.id)
    .single();
  const companyId = (profile?.current_company ?? null) as string | null;
  if (!companyId) return { ok: false, error: 'Nenhuma empresa selecionada.' };

  const { data: nota } = await supabase
    .from('notas_fiscais')
    .select('id, tipo_documento, referencia, status')
    .eq('id', id)
    .eq('company_id', companyId)
    .maybeSingle();
  if (!nota) return { ok: false, error: 'Nota não encontrada.' };
  if (nota.status !== 'ativa') return { ok: false, error: 'Só notas ativas podem ser canceladas.' };

  // Cancelamento exige o token da EMPRESA (igual emissão).
  const { data: companyForCancel } = await supabase
    .from('companies')
    .select('focus_token')
    .eq('id', companyId)
    .single();
  if (!companyForCancel?.focus_token) {
    return { ok: false, error: 'Empresa sem token Focus — sincronize no Diagnóstico antes.' };
  }
  const focusToken = companyForCancel.focus_token as string;

  const env: FocusEnv = 'hom'; // produção depende do token Focus (Blocked) + flags da empresa
  const justif = justificativa.trim();

  let tipo: TipoDoc;
  try {
    tipo = assertTipoDoc(nota.tipo_documento as string);
  } catch {
    return { ok: false, error: 'Tipo de documento não suportado para cancelamento.' };
  }
  const ref = nota.referencia as string;

  try {
    if (tipo === 'NFe') await focus.cancelarNfe(ref, justif, focusToken, env);
    else if (tipo === 'NFCe') await focus.cancelarNfce(ref, justif, focusToken, env);
    else await focus.cancelarNfse(ref, justif, focusToken, env);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Falha ao cancelar na Focus.' };
  }

  const { error } = await supabase
    .from('notas_fiscais')
    .update({
      status: 'cancelada',
      cancelled_at: new Date().toISOString(),
      cancellation_reason: justif,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('company_id', companyId);
  if (error) {
    // Focus já cancelou na SEFAZ, mas o update no banco falhou → divergência banco↔SEFAZ.
    console.error('[cancelarNotaAction] Focus OK mas update no banco falhou', { id, error: error.message });
    return { ok: false, error: 'Nota cancelada na SEFAZ, mas houve falha ao atualizar o sistema. Contate o suporte.' };
  }

  revalidatePath('/notas_fiscais');
  revalidatePath(`/notas_fiscais/${id}`);
  return { ok: true };
}
