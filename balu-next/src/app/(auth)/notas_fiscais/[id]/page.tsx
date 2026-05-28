// @custom — PR 1.3: detalhe da nota fiscal (lê do banco + fallback no payload_focusnfe).
import { notFound } from 'next/navigation';
import { Download } from 'lucide-react';
import { createServerClient } from '@/lib/supabase/server';
import CancelarButton from './CancelarButton';

const STATUS_LABEL: Record<string, { txt: string; cls: string }> = {
  ativa: { txt: 'Ativa', cls: 'bg-success/10 text-success' },
  pendente: { txt: 'Pendente', cls: 'bg-amber-100 text-amber-700' },
  cancelada: { txt: 'Cancelada', cls: 'bg-destructive/10 text-destructive' },
};

function brl(v: number | null) {
  return (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default async function NotaDetalhePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();
  const { data: profile } = await supabase
    .from('profiles').select('current_company').eq('user_id', user.id).single();
  const companyId = (profile?.current_company ?? null) as string | null;
  if (!companyId) notFound();

  const { data: nota } = await supabase
    .from('notas_fiscais')
    .select('*')
    .eq('id', id)
    .eq('company_id', companyId)
    .maybeSingle();
  if (!nota) notFound();

  const payload = (nota.payload_focusnfe ?? {}) as unknown as Record<string, unknown>;
  const dest = (payload.destinatario ?? {}) as Record<string, unknown>;
  const clienteNome = (dest.razao_social as string) ?? '—';
  const clienteDoc = (dest.cnpj as string) ?? (dest.cpf as string) ?? '';
  const chave = (nota.chave_acesso as string) ?? (payload.chave_nfe as string) ?? '—';
  const protocolo = (nota.protocolo_autorizacao as string) ?? (payload.protocolo as string) ?? '—';
  const status = nota.status as string;
  const badge = STATUS_LABEL[status] ?? { txt: status, cls: 'bg-zinc-100 text-zinc-600' };

  return (
    <main className="p-6 max-w-3xl">
      <a href="/notas_fiscais" className="text-sm text-primary hover:underline">← Voltar</a>

      <header className="mt-3 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-brand-navy">
            {nota.tipo_documento} · {nota.referencia}
          </h1>
          <p className="text-sm text-zinc-500">
            Emitida em {nota.data_emissao ? new Date(nota.data_emissao as string).toLocaleString('pt-BR') : '—'}
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${badge.cls}`}>{badge.txt}</span>
      </header>

      <dl className="mt-6 grid grid-cols-2 gap-4 rounded-lg border border-zinc-200 p-4 text-sm">
        <div><dt className="text-xs text-zinc-500">Cliente</dt><dd className="text-zinc-800">{clienteNome} {clienteDoc && `(${clienteDoc})`}</dd></div>
        <div><dt className="text-xs text-zinc-500">Valor total</dt><dd className="text-zinc-800">{brl(nota.valor_total as number)}</dd></div>
        <div className="col-span-2"><dt className="text-xs text-zinc-500">Chave de acesso</dt><dd className="break-all font-mono text-xs text-zinc-800">{chave}</dd></div>
        <div className="col-span-2"><dt className="text-xs text-zinc-500">Protocolo de autorização</dt><dd className="text-zinc-800">{protocolo}</dd></div>
      </dl>

      {status === 'cancelada' && (
        <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <p className="font-medium text-destructive">Nota cancelada</p>
          {nota.cancelled_at && <p className="text-zinc-600">Em {new Date(nota.cancelled_at as string).toLocaleString('pt-BR')}</p>}
          {nota.cancellation_reason && <p className="mt-1 text-zinc-600">Motivo: {nota.cancellation_reason as string}</p>}
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <a
          href={`/notas_fiscais/${id}/download?formato=xml`}
          className="inline-flex items-center gap-2 rounded-md border border-zinc-200 px-4 py-2 text-sm hover:bg-zinc-50"
        >
          <Download className="size-4" /> Baixar XML
        </a>
        <a
          href={`/notas_fiscais/${id}/download?formato=pdf`}
          className="inline-flex items-center gap-2 rounded-md border border-zinc-200 px-4 py-2 text-sm hover:bg-zinc-50"
        >
          <Download className="size-4" /> Baixar PDF
        </a>
        <CancelarButton id={id} ativa={status === 'ativa'} />
      </div>
    </main>
  );
}
