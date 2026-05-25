'use server';

// @custom — bubble-behavior (Day 1 / PR 1.2 — V1 §3.2)
// Export CSV do histórico de notas. Re-consulta no servidor aplicando os mesmos
// filtros da tela (período/tipo/status) + filtro de texto em memória.

import { createServerClient } from '@/lib/supabase/server';

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
  tipo_nf: string;
  numero_nf: string | null;
  serie: string | null;
  chave_acesso: string | null;
  data_emissao: string | null;
  valor_total: number | null;
  status: string | null;
  clientes: { razao_social: string | null; document: string | null } | null;
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
    .eq('id', user.id)
    .single();
  const companyId = (profile?.current_company ?? null) as string | null;
  if (!companyId) return { ok: false, error: 'Nenhuma empresa selecionada.' };

  let q = supabase
    .from('notas_fiscais')
    .select('tipo_nf, numero_nf, serie, chave_acesso, data_emissao, valor_total, status, clientes(razao_social, document)')
    .eq('company_id', companyId)
    .order('data_emissao', { ascending: false, nullsFirst: false })
    .limit(1000);

  if (filtros.tipo) q = q.eq('tipo_nf', filtros.tipo);
  if (filtros.status) q = q.eq('status', filtros.status);
  if (filtros.start) q = q.gte('data_emissao', `${filtros.start}T00:00:00`);
  if (filtros.end) q = q.lte('data_emissao', `${filtros.end}T23:59:59`);

  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };

  // supabase-js tipa embed to-one como array; no runtime vem objeto. Cast via unknown.
  let rows = (data ?? []) as unknown as ExportRow[];

  const text = filtros.text?.trim().toLowerCase();
  if (text) {
    rows = rows.filter(
      (r) =>
        (r.numero_nf ?? '').toLowerCase().includes(text) ||
        (r.chave_acesso ?? '').toLowerCase().includes(text) ||
        (r.clientes?.razao_social ?? '').toLowerCase().includes(text) ||
        (r.clientes?.document ?? '').toLowerCase().includes(text),
    );
  }

  const header = [
    'Data emissão',
    'Tipo',
    'Número',
    'Série',
    'Cliente',
    'Documento',
    'Valor',
    'Status',
    'Chave de acesso',
  ];
  const lines = [header.join(';')];
  for (const r of rows) {
    lines.push(
      [
        r.data_emissao ? new Date(r.data_emissao).toLocaleString('pt-BR') : '',
        r.tipo_nf ?? '',
        r.numero_nf ?? '',
        r.serie ?? '',
        r.clientes?.razao_social ?? '',
        r.clientes?.document ?? '',
        r.valor_total != null ? r.valor_total.toFixed(2) : '',
        r.status ?? '',
        r.chave_acesso ?? '',
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
