'use client';

// @custom — bubble-behavior
// Toolbar + tabela interativa de clientes (PRD §9).

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Trash2, Plus, Search } from 'lucide-react';
import type { Tables } from '@/types/database';
import FilterPeriodo, { type PeriodoRange } from '@/components/FilterPeriodo';
import PopupConfirm from '@/components/PopupConfirm';
import ClienteFormDialog from '@/components/ClienteFormDialog';
import { useToast } from '@/components/Toaster';
import { softDeleteClienteAction } from '@/app/(auth)/clientes/actions';
import type { ClienteInput } from '@/types/zod';

export type Cliente = Tables['clientes'];

function formatDoc(doc: string | null | undefined): string {
  if (!doc) return '—';
  const d = doc.replace(/\D/g, '');
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return doc;
}

export default function ClientesListClient({ initial }: { initial: Cliente[] }) {
  const router = useRouter();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [, setPeriodo] = useState<PeriodoRange>({ start: null, end: null });
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Cliente | null>(null);
  const [deleting, setDeleting] = useState<Cliente | null>(null);
  const [busyDelete, setBusyDelete] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return initial;
    return initial.filter((c) => {
      return (
        (c.razao_social ?? '').toLowerCase().includes(q) ||
        (c.document ?? '').toLowerCase().includes(q) ||
        (c.email ?? '').toLowerCase().includes(q)
      );
    });
  }, [initial, query]);

  async function confirmDelete() {
    if (!deleting) return;
    setBusyDelete(true);
    try {
      const result = await softDeleteClienteAction(deleting.id);
      if (!result.ok) {
        toast('error', result.error);
        return;
      }
      toast('success', 'Cliente excluído.');
      setDeleting(null);
      router.refresh();
    } finally {
      setBusyDelete(false);
    }
  }

  function toInitial(c: Cliente): Partial<ClienteInput> & { id?: string } {
    return {
      id: c.id,
      person_type: (c.person_type as 'PF' | 'PJ') ?? 'PJ',
      razao_social: c.razao_social ?? '',
      document: c.document ?? '',
      inscricao_estadual: c.inscricao_estadual ?? '',
      indicador_inscricao_estadual: c.indicador_inscricao_estadual ?? 9,
      inscricao_municipal: c.inscricao_municipal ?? '',
      email: c.email ?? '',
      telefone: c.telefone ?? '',
      logradouro: c.logradouro ?? '',
      numero: c.numero ?? '',
      complemento: c.complemento ?? '',
      bairro: c.bairro ?? '',
      municipio: c.municipio ?? '',
      uf: c.uf ?? '',
      cep: c.cep ?? '',
      pais: c.pais ?? 'Brasil',
    };
  }

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nome, documento ou e-mail"
            className="w-full rounded-lg border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm focus:border-primary focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-2">
          <FilterPeriodo onChange={setPeriodo} />
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            <Plus className="size-4" />
            Novo cliente
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-3 font-medium">Nome</th>
              <th className="px-4 py-3 font-medium">Documento</th>
              <th className="px-4 py-3 font-medium">E-mail</th>
              <th className="px-4 py-3 font-medium">Telefone</th>
              <th className="px-4 py-3 font-medium">Cidade/UF</th>
              <th className="px-4 py-3 font-medium text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-zinc-500">
                  {initial.length === 0 ? 'Nenhum cliente cadastrado' : 'Nenhum cliente encontrado para a busca.'}
                </td>
              </tr>
            ) : (
              filtered.map((c) => (
                <tr key={c.id} className="hover:bg-zinc-50/60">
                  <td className="px-4 py-3 font-medium text-brand-navy">{c.razao_social ?? '—'}</td>
                  <td className="px-4 py-3 text-zinc-700">{formatDoc(c.document)}</td>
                  <td className="px-4 py-3 text-zinc-700">{c.email ?? '—'}</td>
                  <td className="px-4 py-3 text-zinc-700">{c.telefone ?? '—'}</td>
                  <td className="px-4 py-3 text-zinc-700">
                    {c.municipio || c.uf ? `${c.municipio ?? ''}${c.municipio && c.uf ? '/' : ''}${c.uf ?? ''}` : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        aria-label={`Editar ${c.razao_social ?? ''}`}
                        onClick={() => setEditing(c)}
                        className="grid size-8 place-items-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-primary"
                      >
                        <Pencil className="size-4" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Excluir ${c.razao_social ?? ''}`}
                        onClick={() => setDeleting(c)}
                        className="grid size-8 place-items-center rounded-md text-zinc-500 hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ClienteFormDialog
        open={creating}
        mode="create"
        onClose={() => setCreating(false)}
        onSaved={() => router.refresh()}
      />

      <ClienteFormDialog
        open={editing !== null}
        mode="edit"
        initial={editing ? toInitial(editing) : undefined}
        onClose={() => setEditing(null)}
        onSaved={() => router.refresh()}
      />

      <PopupConfirm
        open={deleting !== null}
        title="Excluir cliente"
        description={
          deleting
            ? `Excluir cliente ${deleting.razao_social ?? ''}? Esta ação pode ser revertida via suporte.`
            : undefined
        }
        confirmLabel="Excluir"
        variant="destructive"
        busy={busyDelete}
        onConfirm={confirmDelete}
        onCancel={() => !busyDelete && setDeleting(null)}
      />
    </>
  );
}
