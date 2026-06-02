'use client';

// @custom — bubble-behavior
// Popup de criar/editar cliente (PRD §9 + §6.5/6.6).
// Reusable equivalente a `PU_create_client` / `PU_edit_client` do Bubble.

import { useEffect, useRef, useState } from 'react';
import { X, Search, Loader2 } from 'lucide-react';
import { ClienteSchema, type ClienteInput } from '@/types/zod';
import { useToast } from '@/components/Toaster';
import { createClienteAction, updateClienteAction, lookupCnpjAction } from '@/app/(auth)/clientes/actions';
import { lookupCepAction } from '@/app/(auth)/onboarding/actions';
import { formatCnpj, formatCpf, formatCep, formatTel } from '@/lib/format/masks';

const UF_OPTIONS = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS',
  'MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO',
] as const;

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
  const [busyCnpj, setBusyCnpj] = useState(false);
  const [busyCep, setBusyCep] = useState(false);
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

  // Busca de CNPJ na Focus para pré-preencher o cliente PJ (não existe no cadastro de empresa).
  async function handleLookupCnpj() {
    const digits = (form.document ?? '').replace(/\D/g, '');
    if (digits.length !== 14) {
      toast('warning', 'Informe um CNPJ com 14 dígitos.');
      return;
    }
    setBusyCnpj(true);
    try {
      const r = await lookupCnpjAction(digits);
      if (!r.ok) { toast('error', r.error); return; }
      const d = r.data ?? {};
      setForm((prev) => ({
        ...prev,
        razao_social: d.razao_social ?? prev.razao_social,
        inscricao_estadual: d.inscricao_estadual ?? prev.inscricao_estadual,
        inscricao_municipal: d.inscricao_municipal ?? prev.inscricao_municipal,
        logradouro: d.logradouro ?? prev.logradouro,
        numero: d.numero ?? prev.numero,
        complemento: d.complemento ?? prev.complemento,
        bairro: d.bairro ?? prev.bairro,
        municipio: d.municipio ?? prev.municipio,
        uf: d.uf ?? prev.uf,
        cep: d.cep ?? prev.cep,
        telefone: d.telefone ?? prev.telefone,
        email: d.email ?? prev.email,
      }));
      toast('success', 'Dados do CNPJ carregados.');
    } finally {
      setBusyCnpj(false);
    }
  }

  async function handleLookupCep() {
    const digits = (form.cep ?? '').replace(/\D/g, '');
    if (digits.length !== 8) { toast('warning', 'Informe um CEP com 8 dígitos.'); return; }
    setBusyCep(true);
    try {
      const r = await lookupCepAction(digits);
      if (!r.ok) { toast('error', r.error); return; }
      const d = r.data;
      setForm((prev) => ({
        ...prev,
        logradouro: d.logradouro ?? prev.logradouro,
        bairro:     d.bairro ?? prev.bairro,
        municipio:  d.municipio ?? prev.municipio,
        uf:         d.uf ?? prev.uf,
      }));
    } finally {
      setBusyCep(false);
    }
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
      className="rounded-xl border border-border bg-surface text-foreground p-0 shadow-xl backdrop:bg-black/40 backdrop:backdrop-blur-sm"
    >
      <form onSubmit={onSubmit} className="w-[min(720px,95vw)] max-h-[90vh] overflow-y-auto">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface px-6 py-4">
          <h2 id="cliente-form-title" className="text-base font-semibold text-foreground">
            {mode === 'create' ? 'Novo cliente' : 'Editar cliente'}
          </h2>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Fechar">
            <X className="size-5 text-muted-foreground hover:text-muted-foreground-2" />
          </button>
        </header>

        <div className="space-y-5 px-6 py-5">
          {/* Toggle PF/PJ — só na criação; na edição o tipo é fixo */}
          {mode === 'create' ? (
            <div className="inline-flex rounded-lg border border-border bg-surface-2 p-1">
              {(['PF', 'PJ'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => update('person_type', t)}
                  className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                    form.person_type === t ? 'bg-surface text-primary shadow-sm' : 'text-muted-foreground-2'
                  }`}
                >
                  {t === 'PF' ? 'Pessoa Física' : 'Pessoa Jurídica'}
                </button>
              ))}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground-2">
              {form.person_type === 'PF' ? 'Pessoa Física' : 'Pessoa Jurídica'}
            </span>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label={form.person_type === 'PF' ? 'Nome completo' : 'Razão social'} error={errors.razao_social} required>
              <input
                value={form.razao_social}
                onChange={(e) => update('razao_social', e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label={docLabel} error={errors.document} required>
              <div className="flex items-start gap-2">
                <input
                  value={form.person_type === 'PJ' ? formatCnpj(form.document) : formatCpf(form.document)}
                  onChange={(e) => update('document', e.target.value.replace(/\D/g, ''))}
                  maxLength={form.person_type === 'PF' ? 14 : 18}
                  className={`${inputCls} flex-1`}
                />
                {form.person_type === 'PJ' && (
                  <button
                    type="button"
                    onClick={handleLookupCnpj}
                    disabled={busyCnpj}
                    title="Buscar dados do CNPJ na Receita"
                    className="mt-1 inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {busyCnpj ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                    Buscar
                  </button>
                )}
              </div>
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
                type="tel"
                value={formatTel(form.telefone ?? '')}
                onChange={(e) => update('telefone', formatTel(e.target.value))}
                placeholder="(00)0 0000-0000"
                maxLength={16}
                className={inputCls}
              />
            </Field>
          </div>

          <fieldset className="space-y-4">
            <legend className="text-sm font-semibold text-foreground">Endereço</legend>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-6">
              <div className="md:col-span-2">
                <Field label="CEP" error={errors.cep}>
                  <div className="flex gap-2">
                    <input
                      value={formatCep(form.cep ?? '')}
                      onChange={(e) => update('cep', e.target.value.replace(/\D/g, ''))}
                      placeholder="00000-000"
                      maxLength={9}
                      className={`${inputCls} flex-1`}
                    />
                    <button
                      type="button"
                      onClick={handleLookupCep}
                      disabled={busyCep}
                      className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground-2 hover:bg-surface-2 disabled:opacity-50"
                    >
                      {busyCep ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                    </button>
                  </div>
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
                  <select
                    value={form.uf ?? ''}
                    onChange={(e) => update('uf', e.target.value)}
                    className={inputCls}
                  >
                    <option value=""></option>
                    {UF_OPTIONS.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
                  </select>
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

        <footer className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-surface px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground-2 hover:bg-surface-2 disabled:opacity-50"
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
