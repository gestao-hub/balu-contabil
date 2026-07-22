// src/app/(auth)/contador/configuracoes/page.tsx
// Task 18: white-label — branding do escritório (nome, logo, WhatsApp, remetente
// de e-mail) + link de cadastro reutilizável. Mesma guarda das demais /contador.
import { redirect } from 'next/navigation';
import { Building2 } from 'lucide-react';
import { createServerClient } from '@/lib/supabase/server';
import { getContabilidadeCtx } from '@/lib/contador/guards';
import { signedUrlBranding } from '@/lib/clients/supabase-storage';
import EscritorioConfigForm from './EscritorioConfigForm';

export default async function ContadorConfiguracoesPage() {
  const ctx = await getContabilidadeCtx();
  if ('error' in ctx) redirect('/login');
  if (!ctx.contabilidade) redirect('/contador/cadastro');
  if (ctx.contabilidade.status === 'pendente') redirect('/contador/aguardando');
  if (ctx.contabilidade.status === 'suspensa') redirect('/contador/aguardando');

  const c = ctx.contabilidade;
  const logoUrlInicial = c.logo_url ? await signedUrlBranding(c.logo_url) : null;

  // Link reutilizável atual (se existir) — RLS de `convites` já escopa por membro
  // do escritório, então o client autenticado basta (sem admin).
  const supabase = await createServerClient();
  const { data: linkRow } = await supabase
    .from('convites')
    .select('token')
    .eq('contabilidade_id', c.id)
    .eq('tipo', 'cliente')
    .is('email', null)
    .is('revogado_em', null)
    .maybeSingle();
  const linkInicial = linkRow ? `${process.env.NEXT_PUBLIC_SITE_URL}/r/${linkRow.token}` : null;

  return (
    <main className="p-6 max-w-3xl">
      <header className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Building2 className="size-5 text-primary" />
          <h1 className="text-2xl font-semibold text-foreground">Configurações do escritório</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Personalize a marca exibida para seus clientes e gerencie o link de cadastro do escritório.
        </p>
      </header>

      <EscritorioConfigForm
        initial={{
          nome: c.nome,
          whatsapp_suporte: c.whatsapp_suporte ?? '',
          email_remetente_nome: c.email_remetente_nome ?? '',
        }}
        logoUrlInicial={logoUrlInicial}
        linkInicial={linkInicial}
      />
    </main>
  );
}
