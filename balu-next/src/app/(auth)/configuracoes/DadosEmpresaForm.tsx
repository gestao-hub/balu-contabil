'use client';
// @custom — bubble-behavior: form de edição da empresa atual (PRD §8 — aba "Dados da empresa").
// Abre em modo leitura (campos bloqueados + botão "Editar"); ao editar, o footer vira
// "Salvar" + "Cancelar". Cancelar reverte aos valores salvos; salvar re-bloqueia.
// CNPJ permanece sempre bloqueado.
import { useState } from 'react';
import { Loader2, Save, Pencil, MapPin } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { CompanySchema, type CompanyInput } from '@/types/zod';
import { formatCnpj, formatCep, formatTel } from '@/lib/format/masks';

const UF_OPTIONS = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS',
  'MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO',
] as const;
import { lookupCepAction } from '@/app/(auth)/onboarding/actions';
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
  const [busyCep, setBusyCep] = useState(false);

  const locked = !editing;

  function set<K extends keyof CompanyInput>(k: K, v: CompanyInput[K]) {
    setForm((prev) => ({ ...prev, [k]: v }));
  }

  function handleCancel() {
    setForm(initial);
    setEditing(false);
    setBusyCep(false); // reseta caso um lookup de CEP esteja em voo ao cancelar
  }

  async function handleLookupCep() {
    const digits = (form.cep ?? '').replace(/\D+/g, '');
    if (digits.length !== 8) {
      toast('warning', 'Informe um CEP com 8 dígitos.');
      return;
    }
    setBusyCep(true);
    try {
      const r = await lookupCepAction(digits);
      if (!r.ok) { toast('error', r.error); return; }
      setForm((prev) => ({
        ...prev,
        logradouro: r.data.logradouro ?? prev.logradouro,
        bairro: r.data.bairro ?? prev.bairro,
        municipio: r.data.municipio ?? prev.municipio,
        uf: r.data.uf ?? prev.uf,
      }));
      toast('success', 'Endereço preenchido.');
    } finally {
      setBusyCep(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Validação completa (endereço rua/cidade/estado é obrigatório).
    const parsed = CompanySchema.safeParse({
      ...form,
      cep: form.cep ? form.cep.replace(/\D+/g, '') : undefined,
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
      {/* CNPJ é sempre read-only: onChange no-op para o estado nunca receber o valor mascarado (mantém 14 dígitos). */}
      <Field label="CNPJ" value={formatCnpj(form.cnpj ?? '')} onChange={() => {}} disabled />
      <Field label="Inscrição estadual" value={form.inscricao_estadual ?? ''} onChange={(v) => set('inscricao_estadual', v)} disabled={locked} />
      <Field label="Inscrição municipal" value={form.inscricao_municipal ?? ''} onChange={(v) => set('inscricao_municipal', v)} disabled={locked} />
      <Field label="Código município (IBGE)" value={form.codigo_municipio ?? ''} onChange={(v) => set('codigo_municipio', v.replace(/\D/g, '').slice(0, 7))} disabled={locked} />
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs font-medium text-muted-foreground-2">CEP</span>
        <div className="flex gap-2">
          <input
            type="text"
            inputMode="numeric"
            placeholder="00000-000"
            value={formatCep(form.cep ?? '')}
            onChange={(e) => set('cep', formatCep(e.target.value))}
            disabled={locked}
            maxLength={9}
            className="flex-1 rounded-md border border-border bg-surface-2 text-foreground px-3 py-2 text-sm disabled:bg-surface-2 disabled:text-muted-foreground"
          />
          <button
            type="button"
            onClick={handleLookupCep}
            disabled={locked || busyCep}
            className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-2 text-sm font-medium text-muted-foreground-2 hover:bg-surface-2 disabled:opacity-50"
          >
            {busyCep ? <Loader2 className="size-4 animate-spin" /> : <MapPin className="size-4" />}
            Buscar
          </button>
        </div>
      </label>
      <Field label="Logradouro" value={form.logradouro ?? ''} onChange={(v) => set('logradouro', v)} disabled={locked} required className="col-span-2" />
      <div className="flex flex-col gap-1 text-sm">
        <span className="text-xs font-medium text-muted-foreground-2">
          Número{!form.sem_numero && <span className="text-destructive"> *</span>}
        </span>
        <input
          type="text"
          value={form.numero ?? ''}
          onChange={(e) => set('numero', e.target.value)}
          disabled={locked || !!form.sem_numero}
          required={!form.sem_numero}
          className="rounded-md border border-border bg-surface-2 text-foreground px-3 py-2 text-sm disabled:bg-surface-2 disabled:text-muted-foreground"
        />
        <label className="mt-1 flex items-center gap-2 text-xs text-muted-foreground-2">
          <input
            type="checkbox"
            checked={!!form.sem_numero}
            disabled={locked}
            onChange={(e) => setForm((prev) => ({ ...prev, sem_numero: e.target.checked, numero: e.target.checked ? '' : prev.numero }))}
            className="size-4 rounded border-border disabled:opacity-50"
          />
          Sem número
        </label>
      </div>
      <Field label="Bairro" value={form.bairro ?? ''} onChange={(v) => set('bairro', v)} disabled={locked} />
      <Field label="Município" value={form.municipio ?? ''} onChange={(v) => set('municipio', v)} disabled={locked} required />
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs font-medium text-muted-foreground-2">UF<span className="text-destructive"> *</span></span>
        <select
          value={form.uf ?? ''}
          onChange={(e) => set('uf', e.target.value)}
          disabled={locked}
          required
          className="rounded-md border border-border bg-surface-2 text-foreground px-3 py-2 text-sm disabled:bg-surface-2 disabled:text-muted-foreground"
        >
          <option value=""></option>
          {UF_OPTIONS.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs font-medium text-muted-foreground-2">Telefone</span>
        <input
          type="tel"
          value={formatTel(form.telefone ?? '')}
          onChange={(e) => set('telefone', formatTel(e.target.value))}
          disabled={locked}
          placeholder="(00)0 0000-0000"
          maxLength={16}
          className="rounded-md border border-border bg-surface-2 text-foreground px-3 py-2 text-sm disabled:bg-surface-2 disabled:text-muted-foreground"
        />
      </label>
      <Field label="E-mail" type="email" value={form.email ?? ''} onChange={(v) => set('email', v)} disabled={locked} />

      <div className="col-span-2 mt-3 flex justify-end gap-2">
        {editing ? (
          <>
            <button
              type="button"
              onClick={handleCancel}
              disabled={busy}
              className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground-2 hover:bg-surface-2 disabled:opacity-50"
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
      <span className="text-xs font-medium text-muted-foreground-2">
        {label}{required && <span className="text-destructive"> *</span>}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        required={required}
        className="rounded-md border border-border bg-surface-2 text-foreground px-3 py-2 text-sm disabled:bg-surface-2 disabled:text-muted-foreground"
      />
    </label>
  );
}
