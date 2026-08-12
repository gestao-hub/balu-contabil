// src/app/(auth)/contador/configuracoes/page.tsx
// Task 18: white-label — branding do escritório (nome, logo, WhatsApp, remetente
// de e-mail) + link de cadastro reutilizável. Mesma guarda das demais /contador.
import { redirect } from 'next/navigation';
import { Building2 } from 'lucide-react';
import { createServerClient } from '@/lib/supabase/server';
import { getContabilidadeCtx } from '@/lib/contador/guards';
import { signedUrlBranding } from '@/lib/clients/supabase-storage';
import EscritorioConfigForm from './EscritorioConfigForm';
import DominioSlaForm, { type DominioSlaInicial } from './DominioSlaForm';

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

  // Domínio/SLA vêm de uma leitura própria: o guard `getContabilidadeCtx`
  // seleciona uma lista fixa de colunas (branding do Bloco A) e não vale
  // alargá-la para todo consumidor por causa desta tela.
  const { data: dominioRow, error: erroDominio } = await supabase
    .from('contabilidades')
    .select('dominio_customizado,dominio_status,dominio_verificado_em,dominio_erro,sla_resposta_horas')
    .eq('id', c.id)
    .maybeSingle();
  // Mesmo cuidado da tela de subconta: GRANT por coluna em `contabilidades`
  // não alcança coluna nova, e sem este log a seção renderiza vazia como se
  // nada estivesse cadastrado.
  if (erroDominio) {
    console.error('[7] leitura de domínio/SLA falhou (coluna sem GRANT?):', erroDominio.message);
  }

  const dominioInicial: DominioSlaInicial = {
    dominio_customizado: (dominioRow?.dominio_customizado ?? null) as string | null,
    dominio_status: ((dominioRow?.dominio_status ?? 'pendente') as DominioSlaInicial['dominio_status']),
    dominio_verificado_em: (dominioRow?.dominio_verificado_em ?? null) as string | null,
    dominio_erro: (dominioRow?.dominio_erro ?? null) as string | null,
    sla_resposta_horas: (dominioRow?.sla_resposta_horas ?? null) as number | null,
  };

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

      <DominioSlaForm initial={dominioInicial} />
    </main>
  );
}
