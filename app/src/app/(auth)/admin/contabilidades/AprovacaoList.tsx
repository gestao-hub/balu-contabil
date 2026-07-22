// src/app/(auth)/admin/contabilidades/AprovacaoList.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, X } from 'lucide-react';
import { formatCnpj } from '@/lib/format/masks';
import { useToast } from '@/components/Toaster';
import { decidirContabilidadeAction } from './actions';
import type { Contabilidade } from './page';

const STATUS_LABEL: Record<string, string> = {
  pendente: 'Pendente',
  aprovada: 'Aprovada',
  suspensa: 'Suspensa',
};

const STATUS_STYLE: Record<string, string> = {
  pendente: 'bg-alert/10 text-alert',
  aprovada: 'bg-success/10 text-success',
  suspensa: 'bg-destructive/10 text-destructive',
};

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('pt-BR') : '—';
}

export default function AprovacaoList({ initial }: { initial: Contabilidade[] }) {
  const router = useRouter();
  const toast = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function decidir(id: string, decisao: 'aprovada' | 'suspensa') {
    setBusyId(id);
    try {
      const result = await decidirContabilidadeAction(id, decisao);
      if (!result.ok) {
        toast('error', result.error);
        return;
      }
      toast('success', decisao === 'aprovada' ? 'Escritório aprovado.' : 'Escritório recusado.');
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full text-sm">
        <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">Nome</th>
            <th className="px-4 py-3 font-medium">CNPJ</th>
            <th className="px-4 py-3 font-medium">CRC</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Cadastro</th>
            <th className="px-4 py-3 font-medium text-right">Ações</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {initial.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                Nenhum escritório cadastrado.
              </td>
            </tr>
          ) : (
            initial.map((c) => (
              <tr key={c.id} className="hover:bg-surface-2">
                <td className="px-4 py-3 font-medium text-foreground">{c.nome}</td>
                <td className="px-4 py-3 text-muted-foreground-2">{c.cnpj ? formatCnpj(c.cnpj) : '—'}</td>
                <td className="px-4 py-3 text-muted-foreground-2">{c.crc}/{c.crc_uf}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[c.status] ?? ''}`}>
                    {STATUS_LABEL[c.status] ?? c.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted-foreground-2">{formatDate(c.created_at)}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    <button
                      type="button"
                      aria-label={`Aprovar ${c.nome}`}
                      disabled={busyId === c.id || c.status === 'aprovada'}
                      onClick={() => decidir(c.id, 'aprovada')}
                      className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-success/10 hover:text-success disabled:opacity-40"
                    >
                      <Check className="size-4" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Recusar ${c.nome}`}
                      disabled={busyId === c.id || c.status === 'suspensa'}
                      onClick={() => decidir(c.id, 'suspensa')}
                      className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
