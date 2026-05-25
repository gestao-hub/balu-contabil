'use client';

// Origem: reusable Bubble `re_authentication` (hook sem UI, 2 workflows: PageLoaded + custom event Re_authentication).
// No Bubble: on PageLoaded, se CurrentUser.expired_at < now, chama Supabase
// /auth/v1/token?grant_type=refresh_token e atualiza tokens no User.
//
// No Next.js + @supabase/ssr o refresh é automático em chamadas server.
// Este hook existe como rede de segurança no client: força um getUser() na
// montagem, e se falhar redireciona para /login.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@/lib/supabase/browser';

export function useReAuthentication() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createBrowserClient();
    let active = true;

    (async () => {
      const { data, error } = await supabase.auth.getUser();
      if (!active) return;
      if (error || !data.user) router.replace('/login');
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') router.replace('/login');
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [router]);
}
