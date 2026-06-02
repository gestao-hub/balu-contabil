// @custom — Callback de autenticação. Trata dois fluxos:
// 1) PKCE (code): reset de senha, convite — troca `code` por sessão.
// 2) token_hash: troca de email, confirmação de cadastro — verifica OTP.
import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type');
  // `next` é sempre um caminho relativo. Rejeita URLs absolutas (open redirect).
  const nextParam = searchParams.get('next') ?? '/';
  const next = nextParam.startsWith('/') ? nextParam : '/';

  const fail = (msg: string) =>
    NextResponse.redirect(`${origin}/reset_pw?error=${encodeURIComponent(msg)}`);

  const supabase = await createServerClient();

  // Fluxo PKCE — troca `code` por sessão (reset de senha, convite, etc.).
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return fail('Não foi possível validar o link. Solicite um novo.');
    return NextResponse.redirect(`${origin}${next}`);
  }

  // Fluxo token_hash — verifica OTP (troca de email, confirmação de cadastro).
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as Parameters<typeof supabase.auth.verifyOtp>[0]['type'],
    });
    if (error) return fail('Não foi possível confirmar. O link pode ter expirado.');
    return NextResponse.redirect(`${origin}${next}`);
  }

  return fail('Link inválido ou expirado. Solicite um novo.');
}
