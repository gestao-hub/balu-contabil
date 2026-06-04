// @custom — PR 2.1 — Emissão de NFS-e (NFSe Nacional).
// Server Component: carrega empresa atual + empresa_fiscal + clientes ativos.
// Bloqueia o form se empresa não estiver pronta (não ativada, sem cert, etc).
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { createServerClient } from '@/lib/supabase/server';
import EmissaoForm from '../EmissaoForm';
import { obterPreviewImposto } from '@/lib/fiscal/preview-imposto';
import type { PreviewImposto } from '@/lib/fiscal/apuracao-types';

type SP = Promise<{ error?: string }>;

export default async function NotasFiscaisEmissaoPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('current_company')
    .eq('user_id', user.id)
    .single();
  const companyId = (profile?.current_company ?? null) as string | null;

  if (!companyId) {
    return <Bloqueio titulo="Nenhuma empresa selecionada" mensagem="Cadastre ou escolha uma empresa antes de emitir notas." />;
  }

  const [{ data: company }, { data: fiscal }, { data: clientes }] = await Promise.all([
    supabase.from('companies').select('id, razao_social, nome, codigo_municipio').eq('id', companyId).single(),
    supabase.from('empresas_fiscais')
      .select('emitir_nota_homol_antes_producao, Code_regime_tributario')
      .eq('empresa_id', companyId).is('deleted_at', null).maybeSingle(),
    supabase.from('clientes')
      .select('id, razao_social, document, person_type, email')
      .eq('company_id', companyId).eq('status', 'active').is('deleted_at', null)
      .order('razao_social', { ascending: true })
      .limit(500),
  ]);

  const previewImposto: PreviewImposto = await obterPreviewImposto(supabase, companyId);

  if (!company) {
    return <Bloqueio titulo="Empresa não encontrada" mensagem="A empresa selecionada não existe." />;
  }
  if (!fiscal) {
    return (
      <Bloqueio
        titulo="Cadastro fiscal incompleto"
        mensagem="Configure o regime tributário e ative a empresa fiscal antes de emitir."
        href="/configuracoes?tab=regime"
        labelLink="Ir para Regime tributário"
      />
    );
  }
  // Verifica disponibilidade real do município na Focus (status_nfse da tabela municipios_nfse).
  if (company.codigo_municipio) {
    const { data: muni } = await supabase
      .from('municipios_nfse')
      .select('status_nfse')
      .eq('codigo_ibge', company.codigo_municipio)
      .maybeSingle();
    if (muni && muni.status_nfse !== 'ativo') {
      const statusLabel: Record<string, string> = {
        fora_do_ar: 'O servidor da Focus para este município está temporariamente fora do ar.',
        pausado: 'A emissão NFS-e para este município está pausada na Focus.',
        em_implementacao: 'Este município está sendo implementado na Focus. Aguarde.',
        em_reimplementacao: 'Este município está em reimplementação na Focus. Aguarde.',
        inativo: 'A NFS-e para este município foi desativada na Focus.',
        nao_implementado: 'Este município não é suportado pela Focus para NFS-e.',
      };
      const mensagem = statusLabel[muni.status_nfse ?? ''] ?? `Status Focus: ${muni.status_nfse}`;
      return <Bloqueio titulo="NFS-e indisponível para este município" mensagem={mensagem} />;
    }
  }
  if (!company.codigo_municipio) {
    return (
      <Bloqueio
        titulo="Município sem código IBGE"
        mensagem="A NFS-e Nacional exige o código IBGE do município do prestador. Edite os dados da empresa."
        href="/configuracoes?tab=dados"
        labelLink="Ir para Dados da empresa"
      />
    );
  }

  // MVP: emitirNotaAction sempre usa hom (ver comentário lá). Exibimos
  // "homologação" pra refletir a realidade até suportarmos produção.
  const env = 'homologação';

  return (
    <main className="p-6 max-w-3xl">
      <header className="mb-6">
        <div className="flex items-center gap-2">
          <Link href="/notas_fiscais/emissao" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition"><ArrowLeft className="size-4" />Voltar</Link>
        </div>
        <h1 className="text-2xl font-semibold text-foreground mt-2">Emitir NFS-e</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Prestador: <strong className="text-muted-foreground-2">{(company.razao_social as string) ?? '—'}</strong> · Ambiente: <span className="font-mono text-xs">{env}</span>
        </p>
      </header>

      {sp.error && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {sp.error}
        </div>
      )}

      <EmissaoForm
        clientes={(clientes ?? []).map((c) => ({
          id: c.id as string,
          razao_social: (c.razao_social as string | null) ?? '—',
          document: (c.document as string | null) ?? '',
          person_type: (c.person_type as string | null) ?? 'PJ',
        }))}
        previewImposto={previewImposto}
      />
    </main>
  );
}

function Bloqueio({
  titulo, mensagem, href, labelLink,
}: { titulo: string; mensagem: string; href?: string; labelLink?: string }) {
  return (
    <main className="p-6 max-w-2xl">
      <div className="rounded-lg border border-alert/30 bg-alert/5 p-6">
        <h1 className="text-lg font-semibold text-alert">{titulo}</h1>
        <p className="text-sm text-muted-foreground-2 mt-2">{mensagem}</p>
        {href && labelLink && (
          <Link href={href} className="inline-block mt-4 text-sm font-medium text-primary hover:underline">
            {labelLink} →
          </Link>
        )}
        <Link href="/notas_fiscais/emissao" className="mt-3 ml-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition"><ArrowLeft className="size-4" />Voltar</Link>
      </div>
    </main>
  );
}
