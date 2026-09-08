// @custom — Resgate de links de auth que voltam no FRAGMENTO da URL.
//
// O `/auth/v1/verify` do GoTrue (que é para onde `{{ .ConfirmationURL }}`
// aponta) não devolve nada na query string: ele redireciona para
// `…/auth/callback#access_token=…&refresh_token=…&type=recovery` no sucesso e
// `…#error=access_denied&error_code=otp_expired&…` na falha. Fragmento é
// resolvido só no navegador — nenhum route handler enxerga isso, e por isso o
// `/auth/callback` respondia "Link inválido" para link bom e link ruim
// igualmente.
//
// O fluxo novo (template com `token_hash` → `/auth/confirm`) não passa por
// aqui. Esta página existe para os e-mails ANTIGOS, já enviados, que ainda vão
// ser clicados — e para dar o motivo real quando o link de fato expirou.
'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createBrowserClient } from '@/lib/supabase/browser';

const ERRO_GENERICO = 'Link inválido ou expirado. Solicite um novo.';

/** Traduz o `error_code` do GoTrue para uma frase que diz o que fazer. */
function mensagemDeErro(p: URLSearchParams): string {
  const code = p.get('error_code');
  if (code === 'otp_expired') {
    // Vale lembrar: scanner de e-mail (Outlook/antivírus) pré-carrega o link e
    // queima o token de uso único antes do usuário clicar. O sintoma é este.
    return 'O link expirou ou já foi usado. Solicite um novo.';
  }
  if (code === 'access_denied') return ERRO_GENERICO;
  const desc = p.get('error_description');
  return desc ? desc.replace(/\+/g, ' ') : ERRO_GENERICO;
}

export default function AuthHashPage() {
  return (
    <Suspense fallback={<Aguarde />}>
      <AuthHashInner />
    </Suspense>
  );
}

function AuthHashInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [texto, setTexto] = useState('Validando seu link…');

  useEffect(() => {
    const nextParam = params.get('next') ?? '/';
    // Só caminho relativo (mesma regra do /auth/callback — evita open redirect).
    const next = nextParam.startsWith('/') ? nextParam : '/';

    const falhar = (msg: string) =>
      router.replace(`/reset_pw?error=${encodeURIComponent(msg)}`);

    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));

    if (hash.get('error') || hash.get('error_code')) {
      falhar(mensagemDeErro(hash));
      return;
    }

    const access_token = hash.get('access_token');
    const refresh_token = hash.get('refresh_token');

    if (!access_token || !refresh_token) {
      falhar(ERRO_GENERICO);
      return;
    }

    // Grava a sessão pelo cliente de navegador do @supabase/ssr: ele escreve os
    // cookies no domínio do app, então a server action `updatePasswordAction`
    // enxerga o usuário logado no submit da nova senha.
    createBrowserClient()
      .auth.setSession({ access_token, refresh_token })
      .then(({ error }) => {
        if (error) {
          falhar(ERRO_GENERICO);
          return;
        }
        // Tira os tokens da barra de endereço antes de seguir — eles não têm o
        // que fazer no histórico do navegador nem num print de tela.
        window.history.replaceState(null, '', window.location.pathname);
        setTexto('Tudo certo. Redirecionando…');
        router.replace(next);
      })
      .catch(() => falhar(ERRO_GENERICO));
  }, [params, router]);

  return <Aguarde texto={texto} />;
}

function Aguarde({ texto = 'Validando seu link…' }: { texto?: string }) {
  return (
    <main className="grid min-h-screen place-items-center px-6">
      <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
        {texto}
      </p>
    </main>
  );
}
