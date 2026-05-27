// @custom — bubble-behavior: Configurações (PRD §8)
// Server Component: carrega a empresa atual + empresa_fiscal vinculada e renderiza tabs.
// Apenas a aba "Dados da empresa" está implementada; demais são TODOs claros.
import Link from 'next/link';
import { createServerClient } from '@/lib/supabase/server';
import DadosEmpresaForm from './DadosEmpresaForm';
import RegimeTributarioForm from './RegimeTributarioForm';

const TABS = [
  { key: 'dados', label: 'Dados da empresa' },
  { key: 'regime', label: 'Regime tributário' },
  { key: 'nfse', label: 'NFS-e' },
  { key: 'certificado', label: 'Certificado A1' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

type SP = Promise<{ tab?: string }>;

export default async function ConfiguracoesPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const active: TabKey = (TABS.find((t) => t.key === sp.tab)?.key ?? 'dados') as TabKey;

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  let company: Record<string, unknown> | null = null;
  let empresaFiscal: Record<string, unknown> | null = null;

  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('current_company')
      .eq('user_id', user.id)
      .single();

    if (profile?.current_company) {
      const { data: c } = await supabase
        .from('companies')
        .select('*')
        .eq('id', profile.current_company)
        .single();
      company = c ?? null;

      const { data: ef } = await supabase
        .from('empresas_fiscais')
        .select('*')
        .eq('empresa_id', profile.current_company)
        .is('deleted_at', null)
        .maybeSingle();
      empresaFiscal = ef ?? null;
    }
  }

  return (
    <main className="p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-brand-navy">Configurações</h1>
        <p className="text-sm text-zinc-500 mt-1">
          {company ? `Empresa atual: ${(company.nome as string) ?? (company.razao_social as string) ?? '—'}` : 'Nenhuma empresa selecionada.'}
        </p>
      </header>

      <nav className="border-b border-zinc-200 mb-6">
        <ul className="flex gap-1">
          {TABS.map((t) => {
            const is = t.key === active;
            return (
              <li key={t.key}>
                <Link
                  href={`/configuracoes?tab=${t.key}`}
                  className={`inline-block px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                    is ? 'border-primary text-primary' : 'border-transparent text-zinc-600 hover:text-zinc-900'
                  }`}
                >
                  {t.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {!company ? (
        <p className="text-sm text-zinc-500">Cadastre uma empresa para acessar as configurações.</p>
      ) : active === 'dados' ? (
        <DadosEmpresaForm
          key={company.id as string}
          id={company.id as string}
          initial={{
            cnpj: (company.cnpj as string) ?? '',
            razao_social: (company.razao_social as string) ?? '',
            nome: (company.nome as string) ?? '',
            inscricao_estadual: (company.inscricao_estadual as string) ?? '',
            inscricao_municipal: (company.inscricao_municipal as string) ?? '',
            codigo_municipio: (company.codigo_municipio as string) ?? '',
            logradouro: (company.logradouro as string) ?? '',
            numero: (company.numero as string) ?? '',
            bairro: (company.bairro as string) ?? '',
            municipio: (company.municipio as string) ?? '',
            uf: (company.uf as string) ?? '',
            cep: (company.cep as string) ?? '',
            telefone: (company.telefone as string) ?? '',
            email: (company.email as string) ?? '',
          }}
        />
      ) : active === 'regime' ? (
        <RegimeTributarioForm
          key={company.id as string}
          initial={
            empresaFiscal as {
              Code_regime_tributario?: string | null;
              anexo_simples?: string | null;
              usa_fator_r?: boolean | null;
              cnae_principal?: string | null;
            } | null
          }
        />
      ) : (
        <TodoPanel tab={active} hasFiscal={!!empresaFiscal} />
      )}
    </main>
  );
}

function TodoPanel({ tab, hasFiscal }: { tab: TabKey; hasFiscal: boolean }) {
  const labels: Record<TabKey, string> = {
    dados: 'Dados da empresa',
    regime: 'Regime tributário',
    nfse: 'NFS-e (Focus / certificado / credenciais)',
    certificado: 'Certificado digital A1 (upload + senha)',
  };
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6">
      <h2 className="text-sm font-semibold text-zinc-700">TODO — {labels[tab]}</h2>
      <p className="mt-1 text-sm text-zinc-500">
        Esta aba ainda não foi implementada. Vinculada à tabela <code>empresas_fiscais</code>{' '}
        {hasFiscal ? '(registro existente)' : '(nenhum registro ainda — será criado no primeiro save)'}.
      </p>
    </div>
  );
}
