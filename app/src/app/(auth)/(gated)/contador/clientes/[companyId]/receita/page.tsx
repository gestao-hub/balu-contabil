// Caixa Postal do e-CAC de um cliente — visão do ESCRITÓRIO (0110).
// Mesma guarda da ficha do cliente: escritório aprovado e empresa da carteira
// dele (a policy de dono de `companies` não pode deixar passar empresa do
// próprio contador que não está na carteira).
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft, Mail } from 'lucide-react';
import { createServerClient } from '@/lib/supabase/server';
import { getContabilidadeCtx } from '@/lib/contador/guards';
import CaixaPostalReceita from '@/app/(auth)/(gated)/receita/mensagens/CaixaPostalReceita';
import { carregarCaixaPostal } from '@/app/(auth)/(gated)/receita/mensagens/carregar';

export const dynamic = 'force-dynamic';

export default async function ReceitaClientePage({ params }: { params: Promise<{ companyId: string }> }) {
  const ctx = await getContabilidadeCtx();
  if ('error' in ctx || !ctx.contabilidade || ctx.contabilidade.status !== 'aprovada') redirect('/contador');
  const { companyId } = await params;

  const sb = await createServerClient();
  const { data: empresa } = await sb.from('companies')
    .select('id, nome, razao_social, contabilidade_id').eq('id', companyId).maybeSingle();
  if (!empresa || empresa.contabilidade_id !== ctx.contabilidade.id) notFound();

  const dados = await carregarCaixaPostal(sb, companyId);
  const nome = (empresa.nome as string | null)?.trim() || (empresa.razao_social as string | null)?.trim() || 'Cliente';

  return (
    <main className="max-w-4xl p-6">
      <Link href={`/contador/clientes/${companyId}`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> {nome}
      </Link>
      <header className="mb-6">
        <div className="mb-1 flex items-center gap-2">
          <Mail className="size-5 text-primary" />
          <h1 className="text-2xl font-semibold text-foreground">Mensagens da Receita</h1>
        </div>
        <p className="text-sm text-muted-foreground">Caixa Postal do e-CAC de {nome}.</p>
      </header>
      {dados.erro && (
        <p role="alert" className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Não foi possível carregar as mensagens agora. Recarregue a página.
        </p>
      )}
      <CaixaPostalReceita
        mensagens={dados.mensagens} companyId={companyId}
        consultadaEm={dados.consultadaEm} temCertificado={dados.temCertificado}
      />
    </main>
  );
}
