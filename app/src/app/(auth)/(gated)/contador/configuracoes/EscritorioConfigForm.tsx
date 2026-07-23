'use client';
// src/app/(auth)/contador/configuracoes/EscritorioConfigForm.tsx
// Task 18: form de branding (nome/WhatsApp/remetente + logo) e link do escritório.
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader2, Save, Upload, Link2, Copy, Check, Ban, Image as ImageIcon,
} from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { ContabilidadeBrandingSchema } from '@/types/zod';
import { formatTel } from '@/lib/format/masks';
import { salvarBrandingAction } from '../actions';
import { gerarLinkEscritorioAction, revogarLinkEscritorioAction } from '../convites-actions';

type Initial = {
  nome: string;
  whatsapp_suporte: string;
  email_remetente_nome: string;
};

type Props = {
  initial: Initial;
  logoUrlInicial: string | null;
  linkInicial: string | null;
};

const MAX_LOGO_BYTES = 4 * 1024 * 1024; // 4MB — mesmo limite do endpoint (checagem antecipada, sem round-trip)

export default function EscritorioConfigForm({ initial, logoUrlInicial, linkInicial }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState<Initial>(initial);
  const [busy, setBusy] = useState(false);

  const [logoUrl, setLogoUrl] = useState(logoUrlInicial);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [link, setLink] = useState(linkInicial);
  const [copiado, setCopiado] = useState(false);
  const [pendingLink, startLink] = useTransition();

  function set<K extends keyof Initial>(k: K, v: Initial[K]) {
    setForm((prev) => ({ ...prev, [k]: v }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = ContabilidadeBrandingSchema.safeParse(form);
    if (!parsed.success) {
      toast('error', parsed.error.issues[0]?.message ?? 'Verifique os campos.');
      return;
    }
    setBusy(true);
    try {
      const r = await salvarBrandingAction(parsed.data);
      if (!r.ok) { toast('error', r.error); return; }
      toast('success', 'Dados do escritório atualizados.');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite re-selecionar o mesmo arquivo depois
    if (!file) return;
    if (file.size > MAX_LOGO_BYTES) {
      toast('error', 'Arquivo maior que 4MB. Escolha uma imagem menor.');
      return;
    }
    setUploadingLogo(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/contador/logo', { method: 'POST', body: fd });
      const data = await res.json().catch(() => null) as { ok?: boolean; url?: string | null; error?: string } | null;
      if (!res.ok || !data?.ok) {
        toast('error', data?.error ?? 'Não foi possível enviar o logo.');
        return;
      }
      setLogoUrl(data.url ?? null);
      toast('success', 'Logo atualizado.');
    } catch {
      toast('error', 'Falha de conexão ao enviar o logo.');
    } finally {
      setUploadingLogo(false);
    }
  }

  function handleGerarLink() {
    startLink(async () => {
      const r = await gerarLinkEscritorioAction();
      if (!r.ok) { toast('error', r.error); return; }
      setLink(r.data?.url ?? null);
      toast('success', 'Link gerado.');
    });
  }

  function handleRevogarLink() {
    startLink(async () => {
      const r = await revogarLinkEscritorioAction();
      if (!r.ok) { toast('error', r.error); return; }
      setLink(null);
      toast('success', 'Link revogado.');
    });
  }

  async function handleCopiarLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      toast('error', 'Não foi possível copiar o link.');
    }
  }

  return (
    <div className="space-y-6">
      {/* ── Marca ── */}
      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="mb-3 text-sm font-semibold text-foreground">Marca do escritório</h2>

        <div className="mb-4 flex items-center gap-4">
          <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-surface-2">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- URL assinada de bucket privado, não passa pelo otimizador de imagem
              <img src={logoUrl} alt="Logo do escritório" className="size-full object-contain" />
            ) : (
              <ImageIcon className="size-6 text-muted-foreground" />
            )}
          </div>
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              onChange={handleLogoChange}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingLogo}
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-muted-foreground-2 hover:bg-surface-2 disabled:opacity-50"
            >
              {uploadingLogo ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              Trocar logo
            </button>
            <p className="mt-1 text-xs text-muted-foreground">PNG ou JPG, até 4MB.</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="text-xs font-medium text-muted-foreground-2">
              Nome do escritório<span className="text-destructive"> *</span>
            </span>
            <input
              type="text"
              value={form.nome}
              onChange={(e) => set('nome', e.target.value)}
              required
              minLength={2}
              className="rounded-md border border-border bg-surface-2 text-foreground px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs font-medium text-muted-foreground-2">WhatsApp de suporte</span>
            <input
              type="tel"
              value={formatTel(form.whatsapp_suporte)}
              onChange={(e) => set('whatsapp_suporte', e.target.value.replace(/\D/g, ''))}
              placeholder="(00)0 0000-0000"
              maxLength={16}
              className="rounded-md border border-border bg-surface-2 text-foreground px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs font-medium text-muted-foreground-2">Nome do remetente (e-mails)</span>
            <input
              type="text"
              value={form.email_remetente_nome}
              onChange={(e) => set('email_remetente_nome', e.target.value)}
              maxLength={80}
              placeholder={form.nome || 'Nome do escritório'}
              className="rounded-md border border-border bg-surface-2 text-foreground px-3 py-2 text-sm"
            />
          </label>
          <div className="sm:col-span-2 mt-1 flex justify-end">
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
      </section>

      {/* ── Link do escritório ── */}
      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-foreground">
          <Link2 className="size-4 text-primary" />
          Link do escritório
        </h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Clientes que se cadastrarem por este link já entram vinculados ao seu escritório.
        </p>

        {link ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={link}
                onFocus={(e) => e.target.select()}
                className="flex-1 rounded-md border border-border bg-surface-2 text-foreground px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={handleCopiarLink}
                className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-muted-foreground-2 hover:bg-surface-2"
              >
                {copiado ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
                {copiado ? 'Copiado' : 'Copiar'}
              </button>
            </div>
            <button
              type="button"
              onClick={handleRevogarLink}
              disabled={pendingLink}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
              <Ban className="size-3.5" />
              Revogar link
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleGerarLink}
            disabled={pendingLink}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {pendingLink && <Loader2 className="size-4 animate-spin" />}
            Gerar link
          </button>
        )}
      </section>
    </div>
  );
}
