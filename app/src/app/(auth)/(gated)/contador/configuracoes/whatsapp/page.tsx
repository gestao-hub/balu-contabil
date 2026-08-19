// Canal de WhatsApp do escritório (migration 0091).
//
// A tela lê só o que `authenticated` pode ler: número, status e desde quando.
// O token da instância e o do webhook não passam por aqui — nem para montar a
// interface, nem para depurar.
import { redirect } from 'next/navigation';
import { MessageCircle } from 'lucide-react';
import { getContabilidadeCtx } from '@/lib/contador/guards';
import { createServerClient } from '@/lib/supabase/server';
import WhatsappClient from './WhatsappClient';

export default async function WhatsappEscritorioPage() {
  const ctx = await getContabilidadeCtx();
  if ('error' in ctx) redirect('/login');
  if (!ctx.contabilidade) redirect('/contador/cadastro');
  if (ctx.contabilidade.status !== 'aprovada') redirect('/contador/aguardando');

  const supabase = await createServerClient();
  const { data } = await supabase
    .from('contabilidades')
    .select('uazapi_numero, uazapi_status, uazapi_conectado_em')
    .eq('id', ctx.contabilidade.id)
    .maybeSingle();

  return (
    <main className="p-6 max-w-2xl">
      <header className="mb-6">
        <div className="mb-1 flex items-center gap-2">
          <MessageCircle className="size-5 text-primary" />
          <h1 className="text-2xl font-semibold text-foreground">WhatsApp do escritório</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Conecte um número para atender seus clientes por WhatsApp. Os avisos de imposto
          e as respostas do assistente passam a sair por ele, com o seu nome.
        </p>
      </header>

      <WhatsappClient
        status={(data?.uazapi_status as string) ?? 'desconectado'}
        numero={(data?.uazapi_numero as string | null) ?? null}
        conectadoEm={(data?.uazapi_conectado_em as string | null) ?? null}
      />
    </main>
  );
}
