// @custom — Emissão multi-tipo: página NF-e. Server Component: guard + carga de dados.
import Link from 'next/link';
import { createServerClient } from '@/lib/supabase/server';
import { listarProdutosAction } from '../../actions';
import NfeForm from './NfeForm';
import type { ClienteOption } from '../ClienteCombobox';

export default async function NfeEmissaoPage() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from('profiles').select('current_company').eq('user_id', user.id).single();
  const companyId = (profile?.current_company ?? null) as string | null;
  if (!companyId) return <Bloqueio msg="Nenhuma empresa selecionada." />;

  const [{ data: fiscal }, { data: clientesRaw }, produtos] = await Promise.all([
    supabase.from('empresas_fiscais')
      .select('empresa_fiscal_ativada, focus_habilita_nfe')
      .eq('empresa_id', companyId).is('deleted_at', null).maybeSingle(),
    supabase.from('clientes')
      .select('id, razao_social, document, person_type')
      .eq('company_id', companyId).eq('status', 'active').is('deleted_at', null)
      .order('razao_social', { ascending: true }).limit(500),
    listarProdutosAction(),
  ]);

  if (!fiscal || fiscal.empresa_fiscal_ativada !== true) {
    return <Bloqueio msg="Ative a empresa fiscal antes de emitir." href="/configuracoes?tab=fiscal" />;
  }
  if (fiscal.focus_habilita_nfe !== true) {
    return <Bloqueio msg="Esta empresa não está habilitada para emitir NF-e." />;
  }

  const clientes: ClienteOption[] = (clientesRaw ?? []).map((c) => ({
    id: c.id as string,
    razao_social: (c.razao_social as string | null) ?? '—',
    document: (c.document as string | null) ?? '',
    person_type: (c.person_type as string | null) ?? 'PJ',
  }));

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-xl font-semibold mb-1">Emitir NF-e</h1>
      <p className="text-sm text-muted-foreground mb-6">Nota fiscal de produto (modelo 55) · homologação.</p>
      <NfeForm clientes={clientes} produtos={produtos} />
    </div>
  );
}

function Bloqueio({ msg, href }: { msg: string; href?: string }) {
  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="rounded-lg border border-border bg-surface-2 p-6">
        <p className="text-sm text-foreground">{msg}</p>
        {href && <Link href={href} className="mt-3 inline-block text-sm text-primary">Resolver →</Link>}
        <Link href="/notas_fiscais/emissao" className="mt-3 ml-4 inline-block text-sm text-muted-foreground">← Voltar</Link>
      </div>
    </div>
  );
}
