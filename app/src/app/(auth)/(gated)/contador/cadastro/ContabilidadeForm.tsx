// src/app/(auth)/contador/cadastro/ContabilidadeForm.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ContabilidadeSchema, type ContabilidadeInput } from '@/types/zod';
import { useToast } from '@/components/Toaster';
import { criarContabilidadeAction } from '../actions';
import { formatCnpj } from '@/lib/format/masks';

const UF_OPTIONS = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS',
  'MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO',
] as const;

const EMPTY: ContabilidadeInput = {
  nome: '',
  cnpj: '',
  crc: '',
  crc_uf: '',
};

export default function ContabilidadeForm() {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState<ContabilidadeInput>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function update<K extends keyof ContabilidadeInput>(key: K, value: ContabilidadeInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    const parsed = ContabilidadeSchema.safeParse(form);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        errs[issue.path.join('.')] = issue.message;
      }
      setErrors(errs);
      toast('error', 'Verifique os campos do formulário.');
      return;
    }
    setBusy(true);
    try {
      const result = await criarContabilidadeAction(parsed.data);
      if (!result.ok) {
        toast('error', result.error);
        return;
      }
      toast('success', 'Cadastro enviado para análise.');
      router.push('/contador/aguardando');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5 rounded-lg border border-border bg-card p-6">
      <Field label="Nome do escritório" error={errors.nome} required>
        <input
          value={form.nome}
          onChange={(e) => update('nome', e.target.value)}
          className={inputCls}
        />
      </Field>

      <Field label="CNPJ" error={errors.cnpj} required>
        <input
          value={formatCnpj(form.cnpj)}
          onChange={(e) => update('cnpj', e.target.value.replace(/\D/g, ''))}
          maxLength={18}
          className={inputCls}
        />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Registro CRC" error={errors.crc} required>
          <input
            value={form.crc}
            onChange={(e) => update('crc', e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="UF do CRC" error={errors.crc_uf} required>
          <select
            value={form.crc_uf}
            onChange={(e) => update('crc_uf', e.target.value)}
            className={inputCls}
          >
            <option value=""></option>
            {UF_OPTIONS.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
          </select>
        </Field>
      </div>

      <div className="flex justify-end pt-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Enviando…' : 'Enviar cadastro'}
        </button>
      </div>
    </form>
  );
}

const inputCls =
  'mt-1 block w-full rounded-md border border-border bg-surface-2 text-foreground px-3 py-2 text-sm focus:border-primary focus:outline-none';

function Field({
  label,
  error,
  required,
  children,
}: {
  label: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-xs text-muted-foreground-2">
      <span>
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </span>
      {children}
      {error && <span className="mt-1 block text-[11px] text-destructive">{error}</span>}
    </label>
  );
}
