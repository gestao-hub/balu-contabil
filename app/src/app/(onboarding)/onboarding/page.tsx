'use client';
// src/app/(onboarding)/onboarding/page.tsx
//
// Onboarding conversacional (item 6.1 do planejamento, "essencial para
// lançar"). O assistente identifica se a pessoa é contador, se já tem empresa
// ou se quer abrir uma, e a entrega no lugar certo.
//
// Os cards continuam existindo, atrás de "prefiro preencher um formulário":
// conversa é bom para quem não sabe por onde começar e é atrito para quem tem
// pressa. Também é a rede de segurança quando o assistente não entende.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut, MessagesSquare } from 'lucide-react';
import Logo from '@/components/Logo';
import CreateCompanyDialog from '@/components/CreateCompanyDialog';
import { createBrowserClient } from '@/lib/supabase/browser';
import Assistente from './Assistente';

export default function OnboardingPage() {
  const router = useRouter();
  const [modo, setModo] = useState<'conversa' | 'cards'>('conversa');
  const [showExisting, setShowExisting] = useState(false);

  async function signOut() {
    const supabase = createBrowserClient();
    await supabase.auth.signOut();
    router.replace('/login');
  }

  return (
    <div className="w-full max-w-xl">
      <div className="mb-8 flex flex-col items-center">
        <Logo size={44} className="mb-3" />
        <h1 className="text-lg font-semibold text-foreground">Vamos começar</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {modo === 'conversa' ? 'Me conte o que você precisa.' : 'Como você quer adicionar sua empresa?'}
        </p>
      </div>

      {modo === 'conversa' ? (
        <Assistente onPreferirFormulario={() => setModo('cards')} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setShowExisting(true)}
              className="rounded-2xl border border-border bg-surface p-6 text-left transition hover:border-primary"
            >
              <h2 className="mb-1 font-medium text-foreground">Já tenho uma empresa</h2>
              <p className="text-sm text-muted-foreground">Tenho CNPJ ativo e quero conectá-la à plataforma.</p>
            </button>

            <button
              type="button"
              onClick={() => router.push('/onboarding/abertura')}
              className="rounded-2xl border border-border bg-surface p-6 text-left transition hover:border-primary"
            >
              <h2 className="mb-1 font-medium text-foreground">Quero abrir uma empresa</h2>
              <p className="text-sm text-muted-foreground">Ainda não tenho CNPJ. Solicitar a abertura.</p>
            </button>
          </div>

          <div className="mt-5 flex justify-center">
            <button
              type="button" onClick={() => setModo('conversa')}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
            >
              <MessagesSquare className="size-4" />
              Prefiro conversar
            </button>
          </div>
        </>
      )}

      <div className="mt-8 flex justify-center">
        <button
          type="button"
          onClick={signOut}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <LogOut className="size-4" />
          Sair
        </button>
      </div>

      {showExisting && (
        <CreateCompanyDialog open onClose={() => setShowExisting(false)} onCreated={() => router.push('/')} />
      )}
    </div>
  );
}
