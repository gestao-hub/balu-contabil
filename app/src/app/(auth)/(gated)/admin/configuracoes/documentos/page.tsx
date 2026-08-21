// Índice dos documentos legais (Termos de Uso / Política de Privacidade) —
// AdminBalu. Cada linha mostra a versão publicada vigente, se há rascunho
// aberto e quantos usuários já aceitaram a versão vigente — o número que dá
// peso à decisão de reescrever ou publicar, na página de cada documento.
import Link from 'next/link';
import { ArrowLeft, ArrowRight, FileText, PenLine, Scale } from 'lucide-react';
import { requireAdminBaluPage } from '@/lib/admin/guard';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const TIPOS = ['termos', 'privacidade'] as const;

const RÓTULO: Record<(typeof TIPOS)[number], string> = {
  termos: 'Termos de Uso',
  privacidade: 'Política de Privacidade',
};

const DESCRICAO: Record<(typeof TIPOS)[number], string> = {
  termos: 'O que o usuário aceita para usar a plataforma.',
  privacidade: 'Inclui a seção de cookies — não há tipo separado para cookies.',
};

function formatarData(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

export default async function DocumentosPage() {
  await requireAdminBaluPage();
  const sb = createAdminClient();

  const { data: versoes } = await sb
    .from('documento_versoes')
    .select('tipo, versao, publicado_em, created_at')
    .order('created_at', { ascending: false });

  const linhas = await Promise.all(TIPOS.map(async (tipo) => {
    const doTipo = (versoes ?? []).filter((v) => v.tipo === tipo);
    const publicada = doTipo
      .filter((v) => v.publicado_em)
      .sort((a, b) => (b.publicado_em! > a.publicado_em! ? 1 : -1))[0] ?? null;
    const rascunho = doTipo.find((v) => !v.publicado_em) ?? null;

    let aceites = 0;
    if (publicada) {
      const { count } = await sb
        .from('aceites')
        .select('id', { count: 'exact', head: true })
        .eq('tipo', tipo)
        .eq('versao', publicada.versao);
      aceites = count ?? 0;
    }

    return { tipo, publicada, rascunho, aceites };
  }));

  return (
    <div className="p-6 space-y-8">
      <div>
        <Link
          href="/admin/configuracoes"
          className="mb-3 inline-flex min-h-6 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Configurações
        </Link>
        <h1 className="mb-1 flex items-center gap-2 text-xl font-semibold">
          <Scale className="size-5 shrink-0 text-primary" />
          Documentos legais
        </h1>
        <p className="text-sm text-muted-foreground">
          Termos de Uso e Política de Privacidade — os documentos que os usuários aceitam em
          <code className="mx-1 rounded bg-surface-2 px-1 py-0.5 text-xs">/aceite</code>
          . Publicar uma versão nova faz todo mundo ver a tela de aceite de novo no próximo acesso.
        </p>
      </div>

      <div className="space-y-4">
        {linhas.map(({ tipo, publicada, rascunho, aceites }) => (
          <section key={tipo} className="rounded-md border border-border bg-surface p-4">
            <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
              <FileText className="size-4 shrink-0 text-primary" />
              {RÓTULO[tipo]}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{DESCRICAO[tipo]}</p>

            <dl className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground-2">Versão publicada</dt>
                <dd className="text-foreground">
                  {publicada
                    ? `v${publicada.versao} — ${formatarData(publicada.publicado_em)}`
                    : 'Nenhuma versão publicada'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground-2">Rascunho</dt>
                <dd className="text-foreground">
                  {rascunho ? (
                    <span className="inline-flex items-center gap-1">
                      <PenLine className="size-3.5 text-muted-foreground" />
                      v{rascunho.versao} (não publicado)
                    </span>
                  ) : 'Nenhum'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground-2">Aceitaram a versão vigente</dt>
                <dd className="text-foreground">
                  {publicada ? `${aceites} usuário${aceites === 1 ? '' : 's'}` : '—'}
                </dd>
              </div>
            </dl>

            <Link
              href={`/admin/configuracoes/documentos/${tipo}`}
              className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground-2 transition-colors hover:border-primary hover:bg-primary/10 hover:text-primary"
            >
              Abrir documento
              <ArrowRight className="size-3.5" />
            </Link>
          </section>
        ))}
      </div>
    </div>
  );
}
