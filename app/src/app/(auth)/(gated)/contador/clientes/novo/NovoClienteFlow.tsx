'use client';
// src/app/(auth)/contador/clientes/novo/NovoClienteFlow.tsx
// Fluxo de 2 passos: 1) cadastra a empresa do cliente (reusa CreateCompanyDialog,
// injetando criarEmpresaClienteAction) 2) e-mail do cliente → convite dirigido
// (convidarClienteAction). "Pular por enquanto" deixa a empresa com convite
// pendente — visível no painel (badge) e reenviável depois.
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Mail, Copy, Check, Loader2 } from 'lucide-react';
import CreateCompanyDialog from '@/components/CreateCompanyDialog';
import { useToast } from '@/components/Toaster';
import { criarEmpresaClienteAction } from '../../actions';
import { convidarClienteAction } from '../../convites-actions';

type Passo = 'empresa' | 'convite';

export default function NovoClienteFlow() {
  const router = useRouter();
  const toast = useToast();
  const [passo, setPasso] = useState<Passo>('empresa');
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [convite, setConvite] = useState<{ url: string } | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [pending, start] = useTransition();

  function handleCreated(id: string) {
    setCompanyId(id);
    setPasso('convite');
  }

  function handleEnviarConvite(e: React.FormEvent) {
    e.preventDefault();
    if (!companyId) return;
    if (!email.trim()) {
      toast('warning', 'Informe o e-mail do cliente.');
      return;
    }
    start(async () => {
      const r = await convidarClienteAction(email.trim(), companyId);
      if (!r.ok) { toast('error', r.error); return; }
      setConvite(r.data ?? null);
      toast('success', 'Convite enviado!');
    });
  }

  async function handleCopiar() {
    if (!convite) return;
    try {
      await navigator.clipboard.writeText(convite.url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      toast('error', 'Não foi possível copiar o link.');
    }
  }

  if (passo === 'empresa') {
    return (
      <main className="p-6">
        <CreateCompanyDialog
          open
          onClose={() => router.push('/contador')}
          onCreated={handleCreated}
          submitAction={criarEmpresaClienteAction}
        />
      </main>
    );
  }

  return (
    <main className="p-6">
      <div className="mx-auto max-w-lg rounded-xl border border-border bg-surface p-6">
        <header className="mb-5 flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-full bg-primary/10 text-primary">
            <Mail className="size-5" />
          </span>
          <div>
            <h1 className="text-lg font-semibold text-foreground">Convidar o cliente</h1>
            <p className="text-sm text-muted-foreground">
              Envie um convite para o cliente criar acesso e assumir a empresa cadastrada.
            </p>
          </div>
        </header>

        {!convite ? (
          <form onSubmit={handleEnviarConvite} className="space-y-4">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs font-medium text-muted-foreground-2">E-mail do cliente</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="cliente@empresa.com.br"
                required
                className="rounded-md border border-border bg-surface-2 text-foreground px-3 py-2 text-sm"
              />
            </label>
            <div className="flex items-center justify-between gap-2 pt-2">
              <button
                type="button"
                onClick={() => router.push('/contador')}
                className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-surface-2"
              >
                Pular por enquanto
              </button>
              <button
                type="submit"
                disabled={pending}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {pending && <Loader2 className="size-4 animate-spin" />}
                Enviar convite
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
              <Building2 className="size-4 shrink-0" />
              Convite enviado para {email}.
            </div>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={convite.url}
                className="flex-1 rounded-md border border-border bg-surface-2 text-foreground px-3 py-2 text-sm"
                onFocus={(e) => e.target.select()}
              />
              <button
                type="button"
                onClick={handleCopiar}
                aria-label="Copiar link do convite"
                className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-muted-foreground-2 hover:bg-surface-2"
              >
                {copiado ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
                {copiado ? 'Copiado' : 'Copiar'}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">Link válido por 7 dias.</p>
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => router.push('/contador')}
                className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
              >
                Ir para o painel
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
