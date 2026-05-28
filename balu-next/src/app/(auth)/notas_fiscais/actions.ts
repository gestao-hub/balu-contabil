'use server';

// @custom — bubble-behavior (Day 1 / PR 1.2 — V1 §3.2)
// Export CSV do histórico de notas. Re-consulta no servidor aplicando os mesmos
// filtros da tela (período/tipo/status) + filtro de texto em memória.

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/supabase/server';
import { focus, type FocusEnv } from '@/lib/clients/focus-nfe';
import { assertTipoDoc, validarJustificativa } from '@/lib/fiscal/notas-tipo';

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

  const env: FocusEnv = 'hom'; // produção depende do token Focus (Blocked) + flags da empresa
  const justif = justificativa.trim();
  try {
    const tipo = assertTipoDoc(nota.tipo_documento as string);
    const ref = nota.referencia as string;
    if (tipo === 'NFe') await focus.cancelarNfe(ref, justif, env);
    else if (tipo === 'NFCe') await focus.cancelarNfce(ref, justif, env);
    else await focus.cancelarNfse(ref, justif, env);
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
  if (error) return { ok: false, error: error.message };

  revalidatePath('/notas_fiscais');
  revalidatePath(`/notas_fiscais/${id}`);
  return { ok: true };
}
