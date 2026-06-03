// @custom — bubble-behavior: Configurações (PRD §8)
// Server Component: carrega a empresa atual + empresa_fiscal vinculada e renderiza tabs.
// Abas: Dados da empresa, Regime tributário, Emissão fiscal (Cert + NFS-e + Status Focus).
// Focus 4: as antigas abas "NFS-e" e "Certificado A1" viraram seções da nova aba.
import Link from 'next/link';
import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import DadosEmpresaForm from './DadosEmpresaForm';
import RegimeTributarioForm from './RegimeTributarioForm';
import EmissaoFiscalTab from './EmissaoFiscalTab';
import SaudeEmpresaTab from './SaudeEmpresaTab';
import { resolveMunicipioNfse } from '@/lib/fiscal/municipio-nfse.server';
import type { SaudeState } from '@/lib/fiscal/saude-empresa';
import { getAberturaByCompany } from '@/lib/abertura/queries';
import AberturaInfoView from './AberturaInfoView';

const TABS = [
  { key: 'dados', label: 'Dados da empresa' },
  { key: 'regime', label: 'Regime tributário' },
  { key: 'fiscal', label: 'Emissão fiscal' },
  { key: 'diagnostico', label: 'Diagnóstico' },
] as const;
type TabKey = (typeof TABS)[number]['key'];
// Compat: aliases das URLs antigas pra não quebrar bookmarks/links.
const TAB_ALIASES: Record<string, TabKey> = {
  nfse: 'fiscal',
  certificado: 'fiscal',
  saude: 'diagnostico', // renomeada — manter o link antigo funcional
};

type SP = Promise<{ tab?: string; alteracao?: string }>;

export default async function ConfiguracoesPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const requested = sp.tab ?? '';
  const aliased = TAB_ALIASES[requested] ?? requested;
  const active: TabKey = (TABS.find((t) => t.key === aliased)?.key ?? 'dados') as TabKey;
  const alteracaoEnviada = sp?.alteracao === 'enviada';

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

  // Ramo: empresa em processo de abertura — mostra visão read-only em vez das 4 abas fiscais.
  if (company && (company as Record<string, unknown>).status === 'em_abertura') {
    const abertura = await getAberturaByCompany(supabase, company.id as string);
    return (
      <main className="max-w-3xl mx-auto px-6 py-8">
        <h1 className="text-lg font-semibold text-foreground mb-1">Informações da empresa</h1>
        <p className="text-sm text-muted-foreground mb-6">Empresa em processo de abertura.</p>
        {alteracaoEnviada && (
          <p className="mb-4 text-sm text-primary bg-primary/10 border border-primary/30 rounded-md px-3 py-2">
            Solicitação de alteração enviada. Você será avisado quando for analisada.
          </p>
        )}
        {abertura ? <AberturaInfoView abertura={abertura} /> : <p className="text-sm text-muted-foreground">Solicitação não encontrada.</p>}
      </main>
    );
  }

  const needsMunicipio = (active === 'fiscal' || active === 'diagnostico') && !!company;
  const municipioNfse = needsMunicipio
    ? await resolveMunicipioNfse(supabase, company!.municipio as string, company!.uf as string)
    : null;

  let certEnviadoEm: string | null = null;
  let certValidoAte: string | null = null;
  let certStorageKey: string | null = null;
  if ((active === 'fiscal' || active === 'diagnostico') && company) {
    const { data: cert } = await supabase
      .from('arquivos_auxiliares')
      .select('created_at, updated_at, cert_not_after, storage_key')
      .eq('company_id', company.id as string)
      .is('deleted_at', null)
      .maybeSingle();
    certEnviadoEm = (cert?.updated_at as string | null) ?? (cert?.created_at as string | null) ?? null;
    certValidoAte = (cert?.cert_not_after as string | null) ?? null;
    certStorageKey = (cert?.storage_key as string | null) ?? null;
  }

  let contratanteConfigurado = false;
  if (active === 'diagnostico') {
    const admin = createAdminClient();
    const { count } = await admin
      .from('serpro_contratante')
      .select('id', { count: 'exact', head: true });
    contratanteConfigurado = (count ?? 0) > 0;
  }

  let saudeState: SaudeState | null = null;
  if (active === 'diagnostico' && company) {
    const focusSyncEm = (empresaFiscal?.focus_sync_em as string | null) ?? null;
    saudeState = {
      municipio: (company.municipio as string | null) ?? null,
      uf: (company.uf as string | null) ?? null,
      // codigo IBGE: preferir o snapshot da Focus (foi confirmado pelo POST);
      // cair pra companies.codigo_municipio (preenchido por consulta CNPJ).
      codigoMunicipio:
        ((empresaFiscal?.focus_codigo_municipio as string | null) ?? null) ||
        ((company.codigo_municipio as string | null) ?? null),
      municipioInfo: municipioNfse
        ? {
            nfse_habilitada: municipioNfse.nfse_habilitada,
            status_nfse: municipioNfse.status_nfse,
            provedor_nfse: municipioNfse.provedor_nfse,
            possui_ambiente_homologacao_nfse: municipioNfse.possui_ambiente_homologacao_nfse,
          }
        : null,
      certPresente: !!certStorageKey,
      certNotAfter: certValidoAte,
      serproTokenExpiration: (empresaFiscal?.serpro_token_procurador_expiration as string | null) ?? null,
      contratanteConfigurado,
      focusStatus: (company.focus_status as 'ok' | 'erro' | null) ?? null,
      focusToken: (company.focus_token as string | null) ?? null,
      focusLastCheck: (company.focus_last_check as string | null) ?? null,
      focusLastError: (company.focus_last_error as string | null) ?? null,
      // Focus 2.0: snapshot só vira "presente" depois do GET após POST/PUT.
      // Sem focus_sync_em → snapshot null → fallback pra municipios_nfse.
      focusSnapshot: focusSyncEm
        ? {
            habilitaNfse: (empresaFiscal?.focus_habilita_nfse as boolean | null) ?? null,
            habilitaNfsenProducao: (empresaFiscal?.focus_habilita_nfsen_producao as boolean | null) ?? null,
            habilitaNfsenHomologacao: (empresaFiscal?.focus_habilita_nfsen_homologacao as boolean | null) ?? null,
            syncEm: focusSyncEm,
          }
        : null,
      // Drift detection (Focus 2.1): compara updated_at locais vs focus_sync_em.
      companiesUpdatedAt: (company.updated_at as string | null) ?? null,
      empresaFiscalUpdatedAt: (empresaFiscal?.updated_at as string | null) ?? null,
    };
  }

  return (
    <main className="p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground">Configurações</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {company ? `Empresa atual: ${(company.nome as string) ?? (company.razao_social as string) ?? '—'}` : 'Nenhuma empresa selecionada.'}
        </p>
      </header>

      <nav className="border-b border-border mb-6">
        <ul className="flex gap-1">
          {TABS.map((t) => {
            const is = t.key === active;
            return (
              <li key={t.key}>
                <Link
                  href={`/configuracoes?tab=${t.key}`}
                  className={`inline-block px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                    is ? 'border-primary text-primary' : 'border-transparent text-muted-foreground-2 hover:text-foreground'
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
        <p className="text-sm text-muted-foreground">Cadastre uma empresa para acessar as configurações.</p>
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
            sem_numero: (company.sem_numero as boolean) ?? false,
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
      ) : active === 'fiscal' ? (
        <EmissaoFiscalTab
          key={company.id as string}
          companyId={company.id as string}
          certEnviadoEm={certEnviadoEm}
          certValidoAte={certValidoAte}
          nfseInitial={
            empresaFiscal as {
              nfse_usuario_login?: string | null;
              nfse_senha_login?: string | null;
              nfse_token_api?: string | null;
              nfse_habilitada?: boolean | null;
              empresa_fiscal_ativada?: boolean | null;
            } | null
          }
          municipio={municipioNfse}
          cidade={(company.municipio as string) ?? ''}
          uf={(company.uf as string) ?? ''}
        />
      ) : saudeState ? (
        <SaudeEmpresaTab key={company.id as string} state={saudeState} />
      ) : null}
    </main>
  );
}
