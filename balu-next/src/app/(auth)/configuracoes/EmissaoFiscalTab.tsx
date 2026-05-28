// @custom — Focus 4: aba unificada que substitui "NFS-e" + "Certificado A1".
// Server Component: recebe os mesmos dados que as duas abas antigas + um resumo
// curto do status na Focus (read-only por enquanto — ações ficam pra Focus 3).
import { ShieldCheck, Building2, RefreshCw } from 'lucide-react';
import CertificadoForm from './CertificadoForm';
import NfseForm, { type MunicipioInfo } from './NfseForm';

type FocusStatus = 'ok' | 'erro' | null;

type Props = {
  companyId: string;
  // Certificado
  certEnviadoEm: string | null;
  certValidoAte: string | null;
  // NFS-e (mesmos props do antigo NfseForm)
  nfseInitial: {
    nfse_usuario_login?: string | null;
    nfse_senha_login?: string | null;
    nfse_token_api?: string | null;
    nfse_habilitada?: boolean | null;
    empresa_fiscal_ativada?: boolean | null;
  } | null;
  municipio: MunicipioInfo | null;
  cidade: string;
  uf: string;
  // Focus
  focusStatus: FocusStatus;
  focusLastCheck: string | null;
  focusToken: string | null;
};

export default function EmissaoFiscalTab(props: Props) {
  return (
    <div className="space-y-10">
      <Section
        icon={<ShieldCheck className="size-5 text-primary" />}
        title="Certificado A1"
        subtitle="Necessário para assinar notas e autenticar a empresa em SEFAZ/SERPRO."
      >
        <CertificadoForm
          key={`cert-${props.companyId}`}
          enviadoEm={props.certEnviadoEm}
          validoAte={props.certValidoAte}
        />
      </Section>

      <Section
        icon={<Building2 className="size-5 text-primary" />}
        title="NFS-e do município"
        subtitle="Credenciais da prefeitura conforme o tipo de autenticação do provedor."
      >
        <NfseForm
          key={`nfse-${props.companyId}`}
          initial={props.nfseInitial}
          municipio={props.municipio}
          cidade={props.cidade}
          uf={props.uf}
        />
      </Section>

      <Section
        icon={<RefreshCw className="size-5 text-primary" />}
        title="Status na Focus"
        subtitle="Cadastro da empresa na Focus NFe (revenda). Ações de sincronização vêm em breve."
      >
        <FocusStatusBlock
          status={props.focusStatus}
          lastCheck={props.focusLastCheck}
          hasToken={!!props.focusToken}
        />
      </Section>
    </div>
  );
}

function Section({
  icon, title, subtitle, children,
}: { icon: React.ReactNode; title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section>
      <header className="mb-4 flex items-start gap-3">
        <span className="grid size-9 place-items-center rounded-md bg-primary/10">{icon}</span>
        <div>
          <h2 className="text-sm font-semibold text-brand-navy">{title}</h2>
          <p className="text-xs text-zinc-500">{subtitle}</p>
        </div>
      </header>
      {children}
    </section>
  );
}

function FocusStatusBlock({
  status, lastCheck, hasToken,
}: { status: FocusStatus; lastCheck: string | null; hasToken: boolean }) {
  const dotClass =
    status === 'ok' ? 'bg-success' : status === 'erro' ? 'bg-destructive' : 'bg-zinc-300';
  const label =
    status === 'ok' ? 'Cadastrada' : status === 'erro' ? 'Erro no último cadastro' : 'Não cadastrada';
  const when = lastCheck ? new Date(lastCheck).toLocaleString('pt-BR') : null;

  return (
    <div className="max-w-xl rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm">
      <div className="flex items-center gap-3">
        <span className={`inline-block size-2.5 rounded-full ${dotClass}`} />
        <span className="font-medium text-zinc-800">{label}</span>
        {hasToken && <span className="text-xs text-zinc-500">· token presente</span>}
      </div>
      {when && <p className="mt-2 text-xs text-zinc-500">Última verificação: {when}</p>}
      {status === 'erro' && (
        <p className="mt-2 text-xs text-destructive">
          A última tentativa de cadastro na Focus falhou. Botão de re-sincronização será adicionado em breve (Focus 3).
        </p>
      )}
      {status == null && (
        <p className="mt-2 text-xs text-zinc-500">
          Empresas criadas após a integração entram automaticamente. Para empresas antigas, o re-sincronizar virá em breve (Focus 3).
        </p>
      )}
    </div>
  );
}
