// @custom — Focus 4: aba unificada que substitui "NFS-e" + "Certificado A1".
// Server Component com 2 seções: Cert e NFS-e. O status na Focus mora na aba
// Diagnóstico (sub-itens "Empresa cadastrada" + "Autenticação funcionando"),
// não duplicamos aqui.
import { ShieldCheck, Building2 } from 'lucide-react';
import CertificadoForm from './CertificadoForm';
import NfseForm, { type MunicipioInfo } from './NfseForm';

type Props = {
  companyId: string;
  // Certificado
  certEnviadoEm: string | null;
  certValidoAte: string | null;
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
