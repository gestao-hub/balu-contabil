// Página de um documento legal (Termos de Uso / Política de Privacidade) —
// AdminBalu. `tipo` vem da URL e precisa ser validado contra o CHECK da
// tabela antes de qualquer query: qualquer outro valor é 404, não um erro de
// banco.
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, FileText } from 'lucide-react';
import { requireAdminBaluPage } from '@/lib/admin/guard';
import { createAdminClient } from '@/lib/supabase/admin';
import DocumentoEditor, { type LinhaHistorico } from './DocumentoEditor';

export const dynamic = 'force-dynamic';

const TIPOS = ['termos', 'privacidade'] as const;
type Tipo = (typeof TIPOS)[number];

const RÓTULO: Record<Tipo, string> = {
  termos: 'Termos de Uso',
  privacidade: 'Política de Privacidade',
};

function ehTipoValido(v: string): v is Tipo {
  return (TIPOS as readonly string[]).includes(v);
}

export default async function DocumentoPage(
  { params }: { params: Promise<{ tipo: string }> },
) {
  await requireAdminBaluPage();
  const { tipo: tipoBruto } = await params;
  if (!ehTipoValido(tipoBruto)) notFound();
  const tipo = tipoBruto;

  const sb = createAdminClient();
  const { data: versoes } = await sb
    .from('documento_versoes')
    .select('id, versao, conteudo_md, publicado_em, created_at')
    .eq('tipo', tipo)
    .order('created_at', { ascending: false });

  const linhas = versoes ?? [];
  if (linhas.length === 0) {
    // Tipo válido, mas nunca teve versão nenhuma cadastrada (banco vazio).
    return (
      <div className="p-6 space-y-6">
        <Cabecalho tipo={tipo} />
        <div className="rounded-md border border-border bg-surface p-4 text-sm text-muted-foreground">
          Nenhuma versão cadastrada ainda para {RÓTULO[tipo]}.
        </div>
        <DocumentoEditor
          tipo={tipo}
          atual={null}
          aceitesAtual={0}
          historico={[]}
        />
      </div>
    );
  }

  const publicada = linhas.filter((v) => v.publicado_em)
    .sort((a, b) => (b.publicado_em! > a.publicado_em! ? 1 : -1))[0] ?? null;
  const rascunho = linhas.filter((v) => !v.publicado_em)
    .sort((a, b) => (b.created_at > a.created_at ? 1 : -1))[0] ?? null;
  const atual = rascunho ?? publicada!;

  // Contagem de aceites por versão, uma consulta só (não uma por linha do
  // histórico) — mesmo cuidado de N+1 do resto do admin.
  const { data: aceites } = await sb
    .from('aceites')
    .select('versao')
    .eq('tipo', tipo);
  const contagem = new Map<string, number>();
  for (const a of aceites ?? []) contagem.set(a.versao, (contagem.get(a.versao) ?? 0) + 1);

  const historico: LinhaHistorico[] = linhas.map((v) => ({
    id: v.id,
    versao: v.versao,
    publicadoEm: v.publicado_em,
    createdAt: v.created_at,
    aceites: contagem.get(v.versao) ?? 0,
  }));

  return (
    <div className="p-6 space-y-6">
      <Cabecalho tipo={tipo} />
      <DocumentoEditor
        tipo={tipo}
        atual={{
          id: atual.id,
          versao: atual.versao,
          conteudoMd: atual.conteudo_md,
          publicadoEm: atual.publicado_em,
        }}
        aceitesAtual={contagem.get(atual.versao) ?? 0}
        historico={historico}
      />
    </div>
  );
}

function Cabecalho({ tipo }: { tipo: Tipo }) {
  return (
    <div>
      <Link
        href="/admin/configuracoes/documentos"
        className="mb-3 inline-flex min-h-6 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Documentos legais
      </Link>
      <h1 className="mb-1 flex items-center gap-2 text-xl font-semibold">
        <FileText className="size-5 shrink-0 text-primary" />
        {RÓTULO[tipo]}
      </h1>
      {tipo === 'privacidade' && (
        <p className="text-sm text-muted-foreground">
          Inclui a seção de cookies — não existe um documento separado para cookies.
        </p>
      )}
    </div>
  );
}
