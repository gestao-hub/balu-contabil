// @custom — Callback de autenticação (PKCE). O link do e-mail (recuperação de
// senha, confirmação) aponta para cá: aqui o `code` é trocado por uma sessão
// (gravada em cookies) ANTES de seguir para a página final. Sem este passo o
// updateUser/getUser server-side falha com "Auth session missing".
import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  // `next` é sempre um caminho relativo (pode conter querystring própria, ex:
  // /reset_pw?step=update). Rejeita URLs absolutas para evitar open redirect.
  const nextParam = searchParams.get('next') ?? '/';
  const next = nextParam.startsWith('/') ? nextParam : '/';

  const fail = (msg: string) =>
    NextResponse.redirect(`${origin}/reset_pw?error=${encodeURIComponent(msg)}`);

  if (!code) return fail('Link inválido ou expirado. Solicite um novo.');

  const supabase = await createServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return fail('Não foi possível validar o link. Solicite um novo.');

  return NextResponse.redirect(`${origin}${next}`);
}
