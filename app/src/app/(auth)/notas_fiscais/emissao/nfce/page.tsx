// @custom — Emissão multi-tipo: página NFC-e. Server Component: guard + carga.
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { createServerClient } from '@/lib/supabase/server';
import { listarProdutosAction } from '../../actions';
import NfceForm from './NfceForm';

export default async function NfceEmissaoPage() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from('profiles').select('current_company').eq('user_id', user.id).single();
  const companyId = (profile?.current_company ?? null) as string | null;
  if (!companyId) return <Bloqueio msg="Nenhuma empresa selecionada." />;

  const [{ data: fiscal }, produtos] = await Promise.all([
    supabase.from('empresas_fiscais')
      .select('empresa_fiscal_ativada, focus_habilita_nfce')
      .eq('empresa_id', companyId).is('deleted_at', null).maybeSingle(),
    listarProdutosAction(),
  ]);

  if (!fiscal || fiscal.empresa_fiscal_ativada !== true) {
    return <Bloqueio msg="Ative a empresa fiscal antes de emitir." href="/configuracoes?tab=fiscal" />;
  }
  if (fiscal.focus_habilita_nfce !== true) {
    return <Bloqueio msg="Esta empresa não está habilitada para emitir NFC-e." />;
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-xl font-semibold mb-1">Emitir NFC-e</h1>
      <p className="text-sm text-muted-foreground mb-6">Nota de consumidor (modelo 65) · homologação.</p>
      <NfceForm produtos={produtos} />
    </div>
  );
}

function Bloqueio({ msg, href }: { msg: string; href?: string }) {
  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="rounded-lg border border-border bg-surface-2 p-6">
        <p className="text-sm text-foreground">{msg}</p>
        {href && <Link href={href} className="mt-3 inline-block text-sm text-primary">Resolver →</Link>}
        <Link href="/notas_fiscais/emissao" className="mt-3 ml-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition"><ArrowLeft className="size-4" />Voltar</Link>
      </div>
    </div>
  );
}
