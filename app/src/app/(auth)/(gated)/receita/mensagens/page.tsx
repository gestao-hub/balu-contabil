// Caixa Postal do e-CAC — visão da EMPRESA (0110).
import { redirect } from 'next/navigation';
import { Mail } from 'lucide-react';
import { createServerClient } from '@/lib/supabase/server';
import { getContabilidadeCtx } from '@/lib/contador/guards';
import CaixaPostalReceita from './CaixaPostalReceita';
import { carregarCaixaPostal } from './carregar';

export const dynamic = 'force-dynamic';

export default async function MensagensReceitaPage() {
  const ctx = await getContabilidadeCtx();
  if ('error' in ctx) redirect('/login');
  // Membro de escritório vê a Caixa Postal de cada cliente pela ficha dele.
  if (ctx.contabilidade) redirect('/contador');

  const sb = await createServerClient();
  const { data: profile } = await sb.from('profiles').select('current_company').eq('user_id', ctx.userId).maybeSingle();
  const companyId = (profile?.current_company as string | null) ?? null;
  if (!companyId) redirect('/');

  const dados = await carregarCaixaPostal(sb, companyId);

  return (
    <main className="max-w-4xl p-6">
      <header className="mb-6">
        <div className="mb-1 flex items-center gap-2">
          <Mail className="size-5 text-primary" />
          <h1 className="text-2xl font-semibold text-foreground">Mensagens da Receita</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          A Caixa Postal do e-CAC da sua empresa: avisos, intimações e comunicados da Receita Federal.
        </p>
      </header>
      {dados.erro && (
        <p role="alert" className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Não foi possível carregar as mensagens agora. Recarregue a página.
        </p>
      )}
      <CaixaPostalReceita mensagens={dados.mensagens} consultadaEm={dados.consultadaEm} temCertificado={dados.temCertificado} />
    </main>
  );
}
