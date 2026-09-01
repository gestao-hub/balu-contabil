// Leitura PÚBLICA dos documentos legais — sem login.
//
// POR QUE EXISTE: até 20/08/2026 não havia rota nenhuma para ler a política de
// privacidade. Ela só aparecia em `/aceite` (quando o usuário tinha pendência) e
// dentro do cadastro. Quem ainda não é cliente — que é justamente quem precisa
// ler antes de decidir — não tinha por onde.
//
// Não exige migration: a 0039 já concede `SELECT` a `anon` em
// `documento_versoes`, com a policy `doc_select_publicado` limitando ao que tem
// `publicado_em`. Rascunho não vaza por aqui.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import MarkdownLegal from '@/components/MarkdownLegal';
import { dataBrt } from '@/lib/format/data-brt';

export const dynamic = 'force-dynamic';

const TITULOS: Record<string, string> = {
  termos: 'Termos de Uso',
  privacidade: 'Política de Privacidade',
};

/** O CHECK da 0039 só aceita estes dois. Qualquer outro valor é 404 — sem esta
 *  guarda, `/documentos/qualquer-coisa` viraria uma página vazia com título
 *  inventado a partir da URL. */
function tipoValido(t: string): t is 'termos' | 'privacidade' {
  return t === 'termos' || t === 'privacidade';
}

export async function generateMetadata(
  { params }: { params: Promise<{ tipo: string }> },
): Promise<Metadata> {
  const { tipo } = await params;
  const titulo = tipoValido(tipo) ? TITULOS[tipo] : 'Documento';
  return { title: `${titulo} — Balu` };
}

export default async function DocumentoPublicoPage(
  { params }: { params: Promise<{ tipo: string }> },
) {
  const { tipo } = await params;
  if (!tipoValido(tipo)) notFound();

  const supabase = await createServerClient();
  const { data: doc } = await supabase
    .from('documento_versoes')
    .select('versao, conteudo_md, publicado_em')
    .eq('tipo', tipo)
    .not('publicado_em', 'is', null)
    .order('publicado_em', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Nada publicado ainda é 404 de propósito, e não uma página em branco: a
  // ausência do documento é informação, e uma casca vazia daria a impressão de
  // que o texto existe e falhou ao carregar.
  if (!doc) notFound();

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <Link
        href="/login"
        className="text-sm text-muted-foreground-2 transition-colors hover:text-primary"
      >
        ← Voltar
      </Link>

      <h1 className="mt-6 text-2xl font-semibold text-foreground">{TITULOS[tipo]}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Versão {doc.versao} · em vigor desde{' '}
        {dataBrt(doc.publicado_em as string)}
      </p>

      {/* Até 29/08/2026 isto era um `<pre>` com o markdown cru, sob a premissa
          de que "o texto é legível como está". A auditoria mostrou que não é:
          numa página jurídica PÚBLICA, o leitor via `## 7.` e `**Encarregado:**`
          com a sintaxe à mostra. O renderizador vive em `lib/markdown/legal.ts`
          e cobre o subconjunto que estes documentos usam. */}
      <div className="mt-6">
        <MarkdownLegal md={doc.conteudo_md as string} />
      </div>

      <p className="mt-10 border-t border-border pt-4 text-xs text-muted-foreground">
        Dúvidas sobre o tratamento dos seus dados? Fale com o encarregado pelo e-mail
        indicado no documento acima.
      </p>
    </main>
  );
}
