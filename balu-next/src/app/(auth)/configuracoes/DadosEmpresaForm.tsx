'use client';
// @custom — bubble-behavior: form de edição da empresa atual (PRD §8 — aba "Dados da empresa").
// Abre em modo leitura (campos bloqueados + botão "Editar"); ao editar, o footer vira
// "Salvar" + "Cancelar". Cancelar reverte aos valores salvos; salvar re-bloqueia.
// CNPJ permanece sempre bloqueado.
import { useState } from 'react';
import { Loader2, Save, Pencil } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { CompanySchema, type CompanyInput } from '@/types/zod';
import { updateCompanyAction } from './actions';

type Props = {
  id: string;
  initial: Partial<CompanyInput>;
};

export default function DadosEmpresaForm({ id, initial }: Props) {
  const toast = useToast();
  const [form, setForm] = useState<Partial<CompanyInput>>(initial);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  const locked = !editing;

  function set<K extends keyof CompanyInput>(k: K, v: CompanyInput[K]) {
    setForm((prev) => ({ ...prev, [k]: v }));
  }

  function handleCancel() {
    setForm(initial);
    setEditing(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Validação completa (endereço rua/cidade/estado é obrigatório).
    const parsed = CompanySchema.safeParse({
      ...form,
      email: form.email || undefined,
      uf: form.uf ? form.uf.toUpperCase() : undefined,
    });
    if (!parsed.success) {
      toast('error', parsed.error.issues[0]?.message ?? 'Verifique os campos.');
      return;
    }
    setBusy(true);
    try {
      const r = await updateCompanyAction(id, parsed.data);
      if (!r.ok) { toast('error', r.error); return; }
      toast('success', 'Empresa atualizada.');
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-3 max-w-3xl">
      <Field label="Razão social" value={form.razao_social ?? ''} onChange={(v) => set('razao_social', v)} disabled={locked} className="col-span-2" />
      <Field label="Nome fantasia" value={form.nome ?? ''} onChange={(v) => set('nome', v)} disabled={locked} className="col-span-2" />
      <Field label="CNPJ" value={form.cnpj ?? ''} onChange={(v) => set('cnpj', v)} disabled />
      <Field label="Inscrição estadual" value={form.inscricao_estadual ?? ''} onChange={(v) => set('inscricao_estadual', v)} disabled={locked} />
      <Field label="Inscrição municipal" value={form.inscricao_municipal ?? ''} onChange={(v) => set('inscricao_municipal', v)} disabled={locked} />
      <Field label="Código município (IBGE)" value={form.codigo_municipio ?? ''} onChange={(v) => set('codigo_municipio', v)} disabled={locked} />
      <Field label="CEP" value={form.cep ?? ''} onChange={(v) => set('cep', v)} disabled={locked} />
      <Field label="Logradouro" value={form.logradouro ?? ''} onChange={(v) => set('logradouro', v)} disabled={locked} required className="col-span-2" />
      <div className="flex flex-col gap-1 text-sm">
        <span className="text-xs font-medium text-zinc-600">
          Número{!form.sem_numero && <span className="text-destructive"> *</span>}
        </span>
        <input
          type="text"
          value={form.numero ?? ''}
          onChange={(e) => set('numero', e.target.value)}
          disabled={locked || !!form.sem_numero}
          required={!form.sem_numero}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm disabled:bg-zinc-50 disabled:text-zinc-500"
        />
        <label className="mt-1 flex items-center gap-2 text-xs text-zinc-600">
          <input
            type="checkbox"
            checked={!!form.sem_numero}
            disabled={locked}
            onChange={(e) => setForm((prev) => ({ ...prev, sem_numero: e.target.checked, numero: e.target.checked ? '' : prev.numero }))}
            className="size-4 rounded border-zinc-300 disabled:opacity-50"
          />
          Sem número
        </label>
      </div>
      <Field label="Bairro" value={form.bairro ?? ''} onChange={(v) => set('bairro', v)} disabled={locked} />
      <Field label="Município" value={form.municipio ?? ''} onChange={(v) => set('municipio', v)} disabled={locked} required />
      <Field label="UF" value={form.uf ?? ''} onChange={(v) => set('uf', v.toUpperCase().slice(0, 2))} disabled={locked} required />
      <Field label="Telefone" value={form.telefone ?? ''} onChange={(v) => set('telefone', v)} disabled={locked} />
      <Field label="E-mail" type="email" value={form.email ?? ''} onChange={(v) => set('email', v)} disabled={locked} />

      <div className="col-span-2 mt-3 flex justify-end gap-2">
        {editing ? (
          <>
            <button
              type="button"
              onClick={handleCancel}
              disabled={busy}
              className="rounded-md border border-zinc-200 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Salvar
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            <Pencil className="size-4" />
            Editar
          </button>
        )}
      </div>
    </form>
  );
}

function Field({
  label, value, onChange, type = 'text', disabled = false, required = false, className = '',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1 text-sm ${className}`}>
      <span className="text-xs font-medium text-zinc-600">
        {label}{required && <span className="text-destructive"> *</span>}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        required={required}
        className="rounded-md border border-zinc-300 px-3 py-2 text-sm disabled:bg-zinc-50 disabled:text-zinc-500"
      />
    </label>
  );
}
