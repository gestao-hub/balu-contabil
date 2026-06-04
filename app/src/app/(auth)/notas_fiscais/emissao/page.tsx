// @custom — Emissão multi-tipo: tela de escolha do tipo de nota.
// Os 3 cards sempre visíveis; desabilitados conforme as flags focus_habilita_*.
import Link from 'next/link';
import { ArrowLeft, FileText, Package, ShoppingCart } from 'lucide-react';
import { createServerClient } from '@/lib/supabase/server';

type Tipo = { key: 'nfse' | 'nfe' | 'nfce'; titulo: string; sub: string; href: string; icon: React.ReactNode; habilitado: boolean };

export default async function EmissaoEscolhaPage() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from('profiles').select('current_company').eq('user_id', user.id).single();
  const companyId = (profile?.current_company ?? null) as string | null;

  let nfse = false, nfe = false, nfce = false;
  if (companyId) {
    const { data: fiscal } = await supabase
      .from('empresas_fiscais')
      .select('focus_habilita_nfse, focus_habilita_nfsen_homologacao, focus_habilita_nfe, focus_habilita_nfce, empresa_fiscal_ativada')
      .eq('empresa_id', companyId).is('deleted_at', null).maybeSingle();
    const ativa = fiscal?.empresa_fiscal_ativada === true;
    nfse = ativa && (fiscal?.focus_habilita_nfse === true || fiscal?.focus_habilita_nfsen_homologacao === true);
    nfe = ativa && fiscal?.focus_habilita_nfe === true;
    nfce = ativa && fiscal?.focus_habilita_nfce === true;
  }

  const tipos: Tipo[] = [
    { key: 'nfse', titulo: 'NFS-e', sub: 'Serviço', href: '/notas_fiscais/emissao/nfse', icon: <FileText className="size-6" />, habilitado: nfse },
    { key: 'nfe', titulo: 'NF-e', sub: 'Produto (modelo 55)', href: '/notas_fiscais/emissao/nfe', icon: <Package className="size-6" />, habilitado: nfe },
    { key: 'nfce', titulo: 'NFC-e', sub: 'Consumidor (modelo 65)', href: '/notas_fiscais/emissao/nfce', icon: <ShoppingCart className="size-6" />, habilitado: nfce },
  ];

  return (
    <div className="max-w-3xl mx-auto p-6">
      <Link href="/notas_fiscais"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition mb-4">
        <ArrowLeft className="size-4" />
        Voltar
      </Link>
      <h1 className="text-xl font-semibold mb-1">Emitir nota fiscal</h1>
      <p className="text-sm text-muted-foreground mb-6">Escolha o tipo de documento.</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {tipos.map((t) => t.habilitado ? (
          <Link key={t.key} href={t.href}
            className="rounded-xl border border-border bg-surface-2 p-5 hover:border-primary hover:shadow-sm transition flex flex-col gap-2">
            <span className="text-primary">{t.icon}</span>
            <span className="font-medium text-foreground">{t.titulo}</span>
            <span className="text-xs text-muted-foreground">{t.sub}</span>
          </Link>
        ) : (
          <div key={t.key} aria-disabled
            className="rounded-xl border border-border bg-surface p-5 opacity-50 cursor-not-allowed flex flex-col gap-2"
            title="Empresa não habilitada para este tipo">
            <span className="text-muted-foreground">{t.icon}</span>
            <span className="font-medium text-muted-foreground">{t.titulo}</span>
            <span className="text-xs text-muted-foreground">{t.sub} · não habilitado</span>
          </div>
        ))}
      </div>
    </div>
  );
}
