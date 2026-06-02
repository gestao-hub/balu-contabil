'use client';
// src/app/(onboarding)/onboarding/page.tsx
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Logo from '@/components/Logo';
import CreateCompanyDialog from '@/components/CreateCompanyDialog';

export default function OnboardingPage() {
  const router = useRouter();
  const [showExisting, setShowExisting] = useState(false);

  return (
    <div className="w-full max-w-xl">
      <div className="flex flex-col items-center mb-8">
        <Logo size={44} className="mb-3" />
        <h1 className="text-lg font-semibold text-foreground">Vamos começar</h1>
        <p className="text-sm text-muted-foreground mt-1">Como você quer adicionar sua empresa?</p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <button
          type="button"
          onClick={() => setShowExisting(true)}
          className="text-left rounded-2xl border border-border bg-surface p-6 hover:border-primary transition"
        >
          <h2 className="font-medium text-foreground mb-1">Já tenho uma empresa</h2>
          <p className="text-sm text-muted-foreground">Tenho CNPJ ativo e quero conectá-la à plataforma.</p>
        </button>

        <button
          type="button"
          onClick={() => router.push('/onboarding/abertura')}
          className="text-left rounded-2xl border border-border bg-surface p-6 hover:border-primary transition"
        >
          <h2 className="font-medium text-foreground mb-1">Quero abrir uma empresa</h2>
          <p className="text-sm text-muted-foreground">Ainda não tenho CNPJ. Solicitar a abertura.</p>
        </button>
      </div>

      {showExisting && (
        <CreateCompanyDialog open onClose={() => setShowExisting(false)} onCreated={() => router.push('/')} />
      )}
    </div>
  );
}
