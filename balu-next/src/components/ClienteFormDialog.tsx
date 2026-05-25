'use client';

// @custom — bubble-behavior
// Popup de criar/editar cliente (PRD §9 + §6.5/6.6).
// Reusable equivalente a `PU_create_client` / `PU_edit_client` do Bubble.

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { ClienteSchema, type ClienteInput } from '@/types/zod';
import { useToast } from '@/components/Toaster';
import { createClienteAction, updateClienteAction } from '@/app/(auth)/clientes/actions';

export type ClienteFormDialogProps = {
  open: boolean;
  mode: 'create' | 'edit';
  initial?: Partial<ClienteInput> & { id?: string };
  onClose: () => void;
  onSaved?: () => void;
};

const EMPTY: ClienteInput = {
  person_type: 'PJ',
  razao_social: '',
  document: '',
  inscricao_estadual: '',
  indicador_inscricao_estadual: 9,
  inscricao_municipal: '',
  email: '',
  telefone: '',
  logradouro: '',
  numero: '',
  complemento: '',
  bairro: '',
  municipio: '',
  uf: '',
  cep: '',
  pais: 'Brasil',
};

export default function ClienteFormDialog({ open, mode, initial, onClose, onSaved }: ClienteFormDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const toast = useToast();
  const [form, setForm] = useState<ClienteInput>({ ...EMPTY, ...(initial ?? {}) } as ClienteInput);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    if (open) {
      setForm({ ...EMPTY, ...(initial ?? {}) } as ClienteInput);
      setErrors({});
    }
  }, [open, initial]);

  if (!open) return null;

  function update<K extends keyof ClienteInput>(key: K, value: ClienteInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    const parsed = ClienteSchema.safeParse(form);
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
      const result =
        mode === 'create'
          ? await createClienteAction(parsed.data)
          : await updateClienteAction(initial?.id ?? '', parsed.data);
      if (!result.ok) {
        toast('error', result.error);
        return;
      }
      toast('success', mode === 'create' ? 'Cliente criado!' : 'Cliente atualizado!');
      onSaved?.();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const docLabel = form.person_type === 'PF' ? 'CPF' : 'CNPJ';

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="cliente-form-title"
      onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }}
      className="rounded-xl border border-zinc-200 p-0 shadow-xl backdrop:bg-black/40 backdrop:backdrop-blur-sm"
    >
      <form onSubmit={onSubmit} className="w-[min(720px,95vw)] max-h-[90vh] overflow-y-auto">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4">
          <h2 id="cliente-form-title" className="text-base font-semibold text-brand-navy">
            {mode === 'create' ? 'Novo cliente' : 'Editar cliente'}
          </h2>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Fechar">
            <X className="size-5 text-zinc-400 hover:text-zinc-700" />
          </button>
        </header>

        <div className="space-y-5 px-6 py-5">
          {/* Toggle PF/PJ */}
          <div className="inline-flex rounded-lg border border-zinc-200 bg-zinc-50 p-1">
            {(['PF', 'PJ'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => update('person_type', t)}
                className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                  form.person_type === t ? 'bg-white text-primary shadow-sm' : 'text-zinc-600'
                }`}
              >
                {t === 'PF' ? 'Pessoa Física' : 'Pessoa Jurídica'}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label={form.person_type === 'PF' ? 'Nome completo' : 'Razão social'} error={errors.razao_social} required>
              <input
                value={form.razao_social}
                onChange={(e) => update('razao_social', e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label={docLabel} error={errors.document} required>
              <input
                value={form.document}
                onChange={(e) => update('document', e.target.value.replace(/\D/g, ''))}
                maxLength={form.person_type === 'PF' ? 11 : 14}
                className={inputCls}
              />
            </Field>

            {form.person_type === 'PJ' && (
              <>
                <Field label="Inscrição estadual" error={errors.inscricao_estadual}>
                  <input
                    value={form.inscricao_estadual ?? ''}
                    onChange={(e) => update('inscricao_estadual', e.target.value)}
                    className={inputCls}
                  />
                </Field>
                <Field label="Indicador IE" error={errors.indicador_inscricao_estadual}>
                  <select
                    value={form.indicador_inscricao_estadual ?? 9}
                    onChange={(e) => update('indicador_inscricao_estadual', Number(e.target.value))}
                    className={inputCls}
                  >
                    <option value={1}>1 - Contribuinte ICMS</option>
                    <option value={2}>2 - Contribuinte isento</option>
                    <option value={9}>9 - Não contribuinte</option>
                  </select>
                </Field>
                <Field label="Inscrição municipal" error={errors.inscricao_municipal}>
                  <input
                    value={form.inscricao_municipal ?? ''}
                    onChange={(e) => update('inscricao_municipal', e.target.value)}
                    className={inputCls}
                  />
                </Field>
              </>
            )}

            <Field label="E-mail" error={errors.email}>
              <input
                type="email"
                value={form.email ?? ''}
                onChange={(e) => update('email', e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Telefone" error={errors.telefone}>
              <input
                value={form.telefone ?? ''}
                onChange={(e) => update('telefone', e.target.value)}
                className={inputCls}
              />
            </Field>
          </div>

          <fieldset className="space-y-4">
            <legend className="text-sm font-semibold text-brand-navy">Endereço</legend>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-6">
              <div className="md:col-span-2">
                <Field label="CEP" error={errors.cep}>
                  <input
                    value={form.cep ?? ''}
                    onChange={(e) => update('cep', e.target.value.replace(/\D/g, ''))}
                    maxLength={8}
                    className={inputCls}
                  />
                </Field>
              </div>
              <div className="md:col-span-4">
                <Field label="Logradouro" error={errors.logradouro}>
                  <input value={form.logradouro ?? ''} onChange={(e) => update('logradouro', e.target.value)} className={inputCls} />
                </Field>
              </div>
              <div className="md:col-span-1">
                <Field label="Número" error={errors.numero}>
                  <input value={form.numero ?? ''} onChange={(e) => update('numero', e.target.value)} className={inputCls} />
                </Field>
              </div>
              <div className="md:col-span-2">
                <Field label="Complemento" error={errors.complemento}>
                  <input value={form.complemento ?? ''} onChange={(e) => update('complemento', e.target.value)} className={inputCls} />
                </Field>
              </div>
              <div className="md:col-span-3">
                <Field label="Bairro" error={errors.bairro}>
                  <input value={form.bairro ?? ''} onChange={(e) => update('bairro', e.target.value)} className={inputCls} />
                </Field>
              </div>
              <div className="md:col-span-4">
                <Field label="Município" error={errors.municipio}>
                  <input value={form.municipio ?? ''} onChange={(e) => update('municipio', e.target.value)} className={inputCls} />
                </Field>
              </div>
              <div className="md:col-span-1">
                <Field label="UF" error={errors.uf}>
                  <input
                    value={form.uf ?? ''}
                    onChange={(e) => update('uf', e.target.value.toUpperCase())}
                    maxLength={2}
                    className={inputCls}
                  />
                </Field>
              </div>
              <div className="md:col-span-1">
                <Field label="País" error={errors.pais}>
                  <input value={form.pais ?? 'Brasil'} onChange={(e) => update('pais', e.target.value)} className={inputCls} />
                </Field>
              </div>
            </div>
          </fieldset>
        </div>

        <footer className="sticky bottom-0 flex justify-end gap-2 border-t border-zinc-200 bg-white px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-zinc-200 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Salvando…' : mode === 'create' ? 'Criar cliente' : 'Salvar alterações'}
          </button>
        </footer>
      </form>
    </dialog>
  );
}

const inputCls =
  'mt-1 block w-full rounded-md border border-zinc-200 px-3 py-2 text-sm focus:border-primary focus:outline-none';

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
    <label className="block text-xs text-zinc-600">
      <span>
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </span>
      {children}
      {error && <span className="mt-1 block text-[11px] text-destructive">{error}</span>}
    </label>
  );
}
