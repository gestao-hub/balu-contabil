'use client';
// @custom — bubble-behavior: Create_company (PRD §6.7)
// Popup único com 3 etapas visíveis (CNPJ → CEP → revisão).
// Não é wizard: tudo fica numa só tela, etapas são apenas seções colapsáveis lógicas.

import { useEffect, useId, useRef, useState } from 'react';
import { Building2, MapPin, X, Loader2 } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { CompanyCreateSchema, type CompanyInput } from '@/types/zod';
import {
  lookupCepAction,
  createCompanyAction,
} from '@/app/(auth)/onboarding/actions';
import { formatCnpj, formatCep } from '@/lib/format/masks';

type Props = {
  open: boolean;
  /** Quando true, esconde o botão Fechar (uso no onboarding obrigatório). */
  forceCreate?: boolean;
  onClose?: () => void;
  onCreated?: (id: string) => void;
};

type Form = CompanyInput;

const EMPTY: Form = {
  cnpj: '',
  razao_social: '',
  nome: '',
  inscricao_estadual: '',
  inscricao_municipal: '',
  codigo_municipio: '',
  logradouro: '',
  numero: '',
  sem_numero: false,
  bairro: '',
  municipio: '',
  uf: '',
  cep: '',
  telefone: '',
  email: '',
};

export default function CreateCompanyDialog({ open, forceCreate = false, onClose, onCreated }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const toast = useToast();
  const titleId = useId(); // id único por instância — evita aria-labelledby duplicado
  const [form, setForm] = useState<Form>(EMPTY);
  const [busyCep, setBusyCep] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  // Reabrir o popup (ex.: botão "Nova empresa" do menu) deve começar limpo.
  useEffect(() => {
    if (!open) {
      setForm(EMPTY);
      setBusyCep(false);
      setSubmitting(false);
    }
  }, [open]);

  function set<K extends keyof Form>(k: K, v: Form[K]) {
    setForm((prev) => ({ ...prev, [k]: v }));
  }

  async function handleLookupCep() {
    if (!form.cep || form.cep.replace(/\D+/g, '').length !== 8) {
      toast('warning', 'Informe um CEP com 8 dígitos.');
      return;
    }
    setBusyCep(true);
    try {
      const r = await lookupCepAction(form.cep);
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
    const parsed = CompanyCreateSchema.safeParse({
      ...form,
      cnpj: form.cnpj.replace(/\D+/g, '').padStart(14, '0').slice(-14),
      cep: form.cep ? form.cep.replace(/\D+/g, '') : undefined,
      email: form.email || undefined,
      uf: form.uf ? form.uf.toUpperCase() : undefined,
    });
    if (!parsed.success) {
      toast('error', parsed.error.issues[0]?.message ?? 'Verifique os campos.');
      return;
    }
    setSubmitting(true);
    try {
      const r = await createCompanyAction(parsed.data);
      if (!r.ok) { toast('error', r.error); return; }
      toast('success', 'Empresa criada!');
      onCreated?.(r.id);
      if (!forceCreate) onClose?.();
      // Após criar, o layout faz revalidatePath('/') e o popup fecha sozinho via prop `open`.
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(e) => { e.preventDefault(); if (!forceCreate) onClose?.(); }}
      className="rounded-xl border border-zinc-200 p-0 shadow-xl backdrop:bg-black/40 backdrop:backdrop-blur-sm"
    >
      <form onSubmit={handleSubmit} className="w-[min(720px,95vw)] max-h-[90vh] overflow-y-auto p-6">
        <header className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-full bg-primary/10 text-primary">
              <Building2 className="size-5" />
            </span>
            <div>
              <h2 id={titleId} className="text-lg font-semibold text-brand-navy">
                {forceCreate ? 'Cadastre sua primeira empresa' : 'Nova empresa'}
              </h2>
              <p className="text-sm text-zinc-500">
                Preencha os dados da sua empresa.
              </p>
            </div>
          </div>
          {!forceCreate && (
            <button type="button" onClick={onClose} aria-label="Fechar" className="text-zinc-400 hover:text-zinc-700">
              <X className="size-5" />
            </button>
          )}
        </header>

        {/* Etapa 1 — CNPJ (preenchimento manual; a busca na Focus fica só no cadastro de cliente) */}
        <section className="mb-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2">1. CNPJ</h3>
          <input
            type="text"
            inputMode="numeric"
            placeholder="00.000.000/0000-00"
            value={form.cnpj}
            onChange={(e) => set('cnpj', formatCnpj(e.target.value))}
            maxLength={18}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
            required
          />
        </section>

        {/* Etapa 2 — CEP */}
        <section className="mb-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2">2. CEP</h3>
          <div className="flex gap-2">
            <input
              type="text"
              inputMode="numeric"
              placeholder="00000-000"
              value={form.cep ?? ''}
              onChange={(e) => set('cep', formatCep(e.target.value))}
              maxLength={9}
              className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={handleLookupCep}
              disabled={busyCep}
              className="inline-flex items-center gap-2 rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
            >
              {busyCep ? <Loader2 className="size-4 animate-spin" /> : <MapPin className="size-4" />}
              Buscar
            </button>
          </div>
        </section>

        {/* Etapa 3 — Revisão */}
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2">3. Confirme os dados</h3>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Razão social" value={form.razao_social} onChange={(v) => set('razao_social', v)} required className="col-span-2" />
            <Field label="Nome fantasia" value={form.nome ?? ''} onChange={(v) => set('nome', v)} className="col-span-2" />
            <Field label="Inscrição estadual" value={form.inscricao_estadual ?? ''} onChange={(v) => set('inscricao_estadual', v)} />
            <Field label="Inscrição municipal" value={form.inscricao_municipal ?? ''} onChange={(v) => set('inscricao_municipal', v)} />
            <Field label="Logradouro" value={form.logradouro ?? ''} onChange={(v) => set('logradouro', v)} required className="col-span-2" />
            <div className="flex flex-col gap-1 text-sm">
              <span className="text-xs font-medium text-zinc-600">
                Número{!form.sem_numero && <span className="text-destructive"> *</span>}
              </span>
              <input
                type="text"
                value={form.numero ?? ''}
                onChange={(e) => set('numero', e.target.value)}
                disabled={!!form.sem_numero}
                required={!form.sem_numero}
                className="rounded-md border border-zinc-300 px-3 py-2 text-sm disabled:bg-zinc-50 disabled:text-zinc-500"
              />
              <label className="mt-1 flex items-center gap-2 text-xs text-zinc-600">
                <input
                  type="checkbox"
                  checked={!!form.sem_numero}
                  onChange={(e) => setForm((prev) => ({ ...prev, sem_numero: e.target.checked, numero: e.target.checked ? '' : prev.numero }))}
                  className="size-4 rounded border-zinc-300"
                />
                Sem número
              </label>
            </div>
            <Field label="Bairro" value={form.bairro ?? ''} onChange={(v) => set('bairro', v)} />
            <Field label="Município" value={form.municipio ?? ''} onChange={(v) => set('municipio', v)} required />
            <Field label="UF" value={form.uf ?? ''} onChange={(v) => set('uf', v.toUpperCase().slice(0, 2))} required />
            <Field label="Telefone" value={form.telefone ?? ''} onChange={(v) => set('telefone', v)} />
            <Field label="E-mail" type="email" value={form.email ?? ''} onChange={(v) => set('email', v)} />
          </div>
        </section>

        <footer className="mt-6 flex justify-end gap-2">
          {!forceCreate && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
            >
              Cancelar
            </button>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {submitting && <Loader2 className="size-4 animate-spin" />}
            Criar empresa
          </button>
        </footer>
      </form>
    </dialog>
  );
}

function Field({
  label, value, onChange, type = 'text', required = false, className = '',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1 text-sm ${className}`}>
      <span className="text-xs font-medium text-zinc-600">{label}{required && <span className="text-destructive"> *</span>}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
      />
    </label>
  );
}
