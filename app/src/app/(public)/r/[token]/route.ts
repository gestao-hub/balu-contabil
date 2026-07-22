// src/app/(public)/r/[token]/route.ts
// Link reutilizável do escritório: encaminha pro cadastro carregando o token
// num cookie httpOnly, consumido por `createCompanyAction` no onboarding.
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();
  const { data: conv } = await admin
    .from('convites')
    .select('contabilidade_id, revogado_em, contabilidades ( nome, status )')
    .eq('token', token)
    .eq('tipo', 'cliente')
    .is('email', null)
    .maybeSingle();
  const cont = conv?.contabilidades as unknown as { nome: string; status: string } | null;
  const url = new URL('/cadastro', process.env.NEXT_PUBLIC_SITE_URL!);
  if (!conv || conv.revogado_em || cont?.status !== 'aprovada') {
    url.searchParams.set('ref_invalido', '1');
    return NextResponse.redirect(url);
  }
  url.searchParams.set('escritorio', cont.nome);
  const res = NextResponse.redirect(url);
  res.cookies.set('balu_ref_convite', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 7 * 86_400,
    path: '/',
  });
  return res;
}
