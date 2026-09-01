// @custom — Focus 4: aba unificada que substitui "NFS-e" + "Certificado A1".
// Server Component com 2 seções: Cert e NFS-e. O status na Focus mora na aba
// Diagnóstico (sub-itens "Empresa cadastrada" + "Autenticação funcionando"),
// não duplicamos aqui.
import { ShieldCheck, Building2, KeyRound } from 'lucide-react';
import CertificadoForm from './CertificadoForm';
import NfseForm, { type MunicipioInfo } from './NfseForm';
import { dataBrt } from '@/lib/format/data-brt';

type Props = {
  companyId: string;
  // Certificado
  certEnviadoEm: string | null;
  certValidoAte: string | null;
  /** 0085: o certificado veio do escritório contábil, não do próprio dono. */
  certPeloEscritorio: boolean;
  /**
   * Task 15 — rastro (não segredo) de quando o escritório contábil cadastrou
   * a credencial da Focus desta empresa (`companies.focus_token_em`). O token
   * em si nunca chega aqui: mora cifrado em `empresa_credenciais_focus`,
   * fechada para `authenticated` (0097). null = ninguém cadastrou credencial
   * pelo escritório (ex.: empresa cadastrada direto pelo Balu / origem 'balu').
   */
  credencialFocusCadastradaEm: string | null;
  // NFS-e (mesmos props do antigo NfseForm). Credenciais (Task 10 — cifradas em
  // repouso) NUNCA chegam aqui em texto: só indicadores `*_configurado`.
  nfseInitial: {
    nfse_usuario_login?: string | null;
    nfse_senha_login_configurado?: boolean;
    nfse_token_api_configurado?: boolean;
    nfse_habilitada?: boolean | null;
    empresa_fiscal_ativada?: boolean | null;
  } | null;
  municipio: MunicipioInfo | null;
  cidade: string;
  uf: string;
};

export default function EmissaoFiscalTab(props: Props) {
  return (
    <div className="space-y-10">
      {/* Task 15 — transparência da custódia (mesmo princípio de
          cert_enviado_por, 0085): quando o escritório contábil cadastrou a
          credencial da Focus desta empresa, o titular precisa ver isso. */}
      {props.credencialFocusCadastradaEm && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-2 p-4 text-sm">
          <KeyRound className="size-5 text-muted-foreground" />
          <p className="text-xs text-muted-foreground-2">
            A credencial fiscal desta empresa foi cadastrada pelo seu escritório de
            contabilidade em{' '}
            {dataBrt(props.credencialFocusCadastradaEm)}.
          </p>
        </div>
      )}

      <Section
        icon={<ShieldCheck className="size-5 text-primary" />}
        title="Certificado A1"
        subtitle="Necessário para assinar notas e autenticar a empresa em SEFAZ/SERPRO."
      >
        <CertificadoForm
          key={`cert-${props.companyId}`}
          enviadoEm={props.certEnviadoEm}
          validoAte={props.certValidoAte}
          peloEscritorio={props.certPeloEscritorio}
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
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </header>
      {children}
    </section>
  );
}
