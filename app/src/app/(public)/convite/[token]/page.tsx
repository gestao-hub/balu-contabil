// src/app/(public)/convite/[token]/page.tsx
// Página pública de aceite de convite dirigido (cliente com empresa pré-cadastrada, ou membro
// da equipe do escritório). Convite reutilizável do escritório (`/r/[token]`) não passa por aqui.
import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerClient } from '@/lib/supabase/server';
import Logo from '@/components/Logo';
import AceiteConvite from './AceiteConvite';

type ConviteRow = {
  tipo: 'cliente' | 'membro';
  company_id: string | null;
  expira_em: string | null;
  revogado_em: string | null;
  usado_em: string | null;
  contabilidades: { nome: string; status: string } | null;
  companies: { nome: string | null } | null;
};

export default async function ConvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();
  const { data } = await admin
    .from('convites')
    .select('tipo, company_id, expira_em, revogado_em, usado_em, contabilidades ( nome, status ), companies ( nome )')
    .eq('token', token)
    .maybeSingle();
  const conv = data as unknown as ConviteRow | null;

  const erro = motivoInvalido(conv);
  if (erro) {
    return (
      <main className="w-full max-w-sm px-6">
        <div className="bg-surface rounded-2xl shadow-sm border border-border p-8 text-center">
          <div className="flex flex-col items-center mb-6">
            <Logo size={44} className="mb-3" />
          </div>
          <p className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2 mb-4">
            {erro}
          </p>
          <p className="text-sm text-muted-foreground">Peça um novo link ao seu contador.</p>
          <Link href="/login" className="inline-block mt-6 text-primary hover:underline text-sm">
            Ir para o login
          </Link>
        </div>
      </main>
    );
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const escritorioNome = conv!.contabilidades?.nome ?? 'seu contador';
  const empresaNome = conv!.companies?.nome ?? null;

  if (!user) {
    const next = `/convite/${token}`;
    return (
      <main className="w-full max-w-sm px-6">
        <div className="bg-surface rounded-2xl shadow-sm border border-border p-8">
          <div className="flex flex-col items-center mb-6">
            <Logo size={44} className="mb-3" />
          </div>
          <p className="text-sm text-foreground mb-1">
            <b>{escritorioNome}</b> convidou você para o Balu
            {conv!.tipo === 'cliente' && empresaNome ? (
              <>
                {' '}
                para assumir <b>{empresaNome}</b>
              </>
            ) : null}
            .
          </p>
          <p className="text-sm text-muted-foreground mb-6">Entre ou crie sua conta para continuar.</p>
          <div className="flex gap-3">
            <Link
              href={`/login?next=${encodeURIComponent(next)}`}
              className="flex-1 text-center bg-primary text-white rounded-lg py-2.5 text-sm font-medium hover:opacity-90 transition"
            >
              Entrar
            </Link>
            <Link
              href={`/cadastro?next=${encodeURIComponent(next)}`}
              className="flex-1 text-center border border-border rounded-lg py-2.5 text-sm font-medium hover:bg-surface-2 transition"
            >
              Criar conta
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="w-full max-w-sm px-6">
      <AceiteConvite token={token} tipo={conv!.tipo} escritorioNome={escritorioNome} empresaNome={empresaNome} />
    </main>
  );
}

function motivoInvalido(conv: ConviteRow | null): string | null {
  if (!conv) return 'Convite não encontrado.';
  if (conv.revogado_em) return 'Este convite foi cancelado.';
  if (conv.expira_em && new Date(conv.expira_em) < new Date()) return 'Convite expirado.';
  if (conv.usado_em) return 'Este convite já foi utilizado.';
  if (conv.contabilidades?.status !== 'aprovada') return 'O escritório não está ativo.';
  if (conv.tipo === 'cliente' && !conv.company_id) return 'Convite sem empresa associada.';
  return null;
}
