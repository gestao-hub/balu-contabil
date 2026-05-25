'use client';
// @custom — bubble-behavior: form de edição da empresa atual (PRD §8 — aba "Dados da empresa").
import { useState } from 'react';
import { Loader2, Save } from 'lucide-react';
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
  const [busy, setBusy] = useState(false);

  function set<K extends keyof CompanyInput>(k: K, v: CompanyInput[K]) {
    setForm((prev) => ({ ...prev, [k]: v }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = CompanySchema.partial().safeParse({
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
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-3 max-w-3xl">
      <Field label="Razão social" value={form.razao_social ?? ''} onChange={(v) => set('razao_social', v)} className="col-span-2" />
      <Field label="Nome fantasia" value={form.nome ?? ''} onChange={(v) => set('nome', v)} className="col-span-2" />
      <Field label="CNPJ" value={form.cnpj ?? ''} onChange={(v) => set('cnpj', v)} disabled />
      <Field label="Inscrição estadual" value={form.inscricao_estadual ?? ''} onChange={(v) => set('inscricao_estadual', v)} />
      <Field label="Inscrição municipal" value={form.inscricao_municipal ?? ''} onChange={(v) => set('inscricao_municipal', v)} />
      <Field label="Código município (IBGE)" value={form.codigo_municipio ?? ''} onChange={(v) => set('codigo_municipio', v)} />
      <Field label="CEP" value={form.cep ?? ''} onChange={(v) => set('cep', v)} />
      <Field label="Logradouro" value={form.logradouro ?? ''} onChange={(v) => set('logradouro', v)} className="col-span-2" />
      <Field label="Número" value={form.numero ?? ''} onChange={(v) => set('numero', v)} />
      <Field label="Bairro" value={form.bairro ?? ''} onChange={(v) => set('bairro', v)} />
      <Field label="Município" value={form.municipio ?? ''} onChange={(v) => set('municipio', v)} />
      <Field label="UF" value={form.uf ?? ''} onChange={(v) => set('uf', v.toUpperCase().slice(0, 2))} />
      <Field label="Telefone" value={form.telefone ?? ''} onChange={(v) => set('telefone', v)} />
      <Field label="E-mail" type="email" value={form.email ?? ''} onChange={(v) => set('email', v)} />

      <div className="col-span-2 mt-3 flex justify-end">
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Salvar
        </button>
      </div>
    </form>
  );
}

function Field({
  label, value, onChange, type = 'text', disabled = false, className = '',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1 text-sm ${className}`}>
      <span className="text-xs font-medium text-zinc-600">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="rounded-md border border-zinc-300 px-3 py-2 text-sm disabled:bg-zinc-50 disabled:text-zinc-500"
      />
    </label>
  );
}
