'use client';

// @custom — bubble-behavior
// Toolbar + tabela interativa de clientes (PRD §9).

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Trash2, Plus, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import type { Tables } from '@/types/database';
import PopupConfirm from '@/components/PopupConfirm';
import ClienteFormDialog from '@/components/ClienteFormDialog';
import { useToast } from '@/components/Toaster';
import { softDeleteClienteAction } from '@/app/(auth)/(gated)/clientes/actions';
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
  const POR_PAGINA = 100;
  const [pagina, setPagina] = useState(1);
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

  const totalPaginas = Math.max(1, Math.ceil(filtered.length / POR_PAGINA));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const paginados = filtered.slice((paginaAtual - 1) * POR_PAGINA, paginaAtual * POR_PAGINA);

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
      indicador_inscricao_estadual:
        c.indicador_inscricao_estadual != null ? Number(c.indicador_inscricao_estadual) : 9,
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

  const paginador = totalPaginas > 1 ? (
    <div className="flex items-center justify-between text-sm text-muted-foreground">
      <span>
        {((paginaAtual - 1) * POR_PAGINA) + 1}–{Math.min(paginaAtual * POR_PAGINA, filtered.length)} de {filtered.length}
      </span>
      <div className="flex items-center gap-1">
        <button onClick={() => setPagina((p) => Math.max(1, p - 1))} disabled={paginaAtual === 1}
          className="rounded-lg border border-border p-1.5 hover:bg-surface-2 disabled:opacity-40" aria-label="Página anterior">
          <ChevronLeft className="size-4" />
        </button>
        <span className="px-3 py-1 text-foreground font-medium">{paginaAtual} / {totalPaginas}</span>
        <button onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))} disabled={paginaAtual === totalPaginas}
          className="rounded-lg border border-border p-1.5 hover:bg-surface-2 disabled:opacity-40" aria-label="Próxima página">
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  ) : null;

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPagina(1); }}
            placeholder="Buscar por nome, documento ou e-mail"
            className="w-full rounded-lg border border-border bg-surface-2 py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-2">
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

      {paginador && <div className="mb-3">{paginador}</div>}

      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Nome</th>
              <th className="px-4 py-3 font-medium">Documento</th>
              <th className="px-4 py-3 font-medium">E-mail</th>
              <th className="px-4 py-3 font-medium">Telefone</th>
              <th className="px-4 py-3 font-medium">Cidade/UF</th>
              <th className="px-4 py-3 font-medium text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                  {initial.length === 0 ? 'Nenhum cliente cadastrado' : 'Nenhum cliente encontrado para a busca.'}
                </td>
              </tr>
            ) : (
              paginados.map((c) => (
                <tr key={c.id} className="hover:bg-surface-2">
                  <td className="px-4 py-3 font-medium text-foreground">{c.razao_social ?? '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground-2">{formatDoc(c.document)}</td>
                  <td className="px-4 py-3 text-muted-foreground-2">{c.email ?? '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground-2">{c.telefone ?? '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground-2">
                    {c.municipio || c.uf ? `${c.municipio ?? ''}${c.municipio && c.uf ? '/' : ''}${c.uf ?? ''}` : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        aria-label={`Editar ${c.razao_social ?? ''}`}
                        onClick={() => setEditing(c)}
                        className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-primary"
                      >
                        <Pencil className="size-4" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Excluir ${c.razao_social ?? ''}`}
                        onClick={() => setDeleting(c)}
                        className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
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

      {paginador && <div className="mt-3">{paginador}</div>}

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
