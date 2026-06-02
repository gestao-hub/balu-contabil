// @custom — Confirmação de e-mail (PKCE/SSR). O template "Confirm signup" do
// Supabase aponta pra cá com `?token_hash=...&type=email&next=/`. Aqui usamos
// `verifyOtp` pra trocar o token por uma sessão e GRAVAR os cookies no domínio
// do app (não no .supabase.co — que era o problema do template default).
//
// Setup no Dashboard Supabase:
//   Auth → Email Templates → "Confirm signup":
//     <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/">
//       Confirmar e-mail
//     </a>
//   Auth → URL Configuration → Redirect URLs:
//     adicionar http://localhost:3000/auth/confirm
import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import type { EmailOtpType } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const VALID_TYPES: ReadonlyArray<EmailOtpType> = [
  'email',
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
];

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get('token_hash');
  const typeRaw = searchParams.get('type') ?? 'email';
  const nextParam = searchParams.get('next') ?? '/';
  // `next` aceita só caminho relativo (evita open redirect).
  const next = nextParam.startsWith('/') ? nextParam : '/';

  // Type-guard pra apenas tipos válidos da union do supabase-js.
  const type = (VALID_TYPES as ReadonlyArray<string>).includes(typeRaw)
    ? (typeRaw as EmailOtpType)
    : 'email';

  const fail = (msg: string) =>
    NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(msg)}`);

  if (!token_hash) return fail('Link inválido ou expirado. Solicite um novo.');

  const supabase = await createServerClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash });
  if (error) return fail('Não foi possível confirmar o e-mail. Solicite um novo link.');

  return NextResponse.redirect(`${origin}${next}`);
}
