// 0094 — credenciais do SERPRO Integra Contador (AdminBalu).
//
// NADA CIFRADO SAI DAQUI. A página lê as colunas de segredo só para decidir
// booleanos e as descarta; do certificado atravessam apenas CNPJ, titular e
// validade — metadados que já aparecem no painel de saúde da empresa. O PFX
// cifrado e a senha cifrada ficam no servidor.
import { requireAdminBaluPage } from '@/lib/admin/guard';
import { createAdminClient } from '@/lib/supabase/admin';
import ConfigSerproForm, { type CertContratanteVm } from './ConfigSerproForm';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requireAdminBaluPage();
  const sb = createAdminClient();

  const [cfg, cert] = await Promise.all([
    sb.from('config_serpro')
      .select('consumer_key_cifrado, consumer_secret_cifrado')
      .eq('id', 1)
      .maybeSingle(),
    sb.from('serpro_contratante')
      .select('cnpj, cert_subject_cn, cert_not_after')
      .limit(1)
      .maybeSingle(),
  ]);

  const cabecalho = (
    <div>
      <h1 className="mb-1 text-xl font-semibold">SERPRO Integra Contador</h1>
      <p className="text-sm text-muted-foreground">
        A credencial do contrato e o certificado que autenticam a Balu na Receita. Trocar
        aqui não exige deploy, e toda alteração vai para o registro de auditoria.
      </p>
    </div>
  );

  // LEITURA QUE FALHOU NÃO PODE VIRAR "NUNCA CONFIGURADO" — mesma decisão das
  // telas de IA e Focus. Formulário vazio diria ao admin que a credencial
  // sumiu, e o pior desfecho é ele colar outra por cima de um estado que não
  // está enxergando.
  if (cfg.error || cert.error) {
    console.error(
      '[0094] leitura da tela do SERPRO falhou:',
      cfg.error?.message ?? cert.error?.message,
    );
    return (
      <div className="space-y-6 p-6">
        {cabecalho}
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm">
          <p className="font-medium text-destructive">Não foi possível ler a configuração.</p>
          <p className="mt-1 text-muted-foreground">
            O formulário fica escondido de propósito: o que está gravado é desconhecido agora, e
            salvar por cima poderia trocar uma credencial que está funcionando. Recarregue a
            página; se persistir, o motivo está no log do servidor.
          </p>
        </div>
      </div>
    );
  }

  const certVm: CertContratanteVm = cert.data
    ? {
        cnpj: cert.data.cnpj as string,
        subjectCn: (cert.data.cert_subject_cn as string | null) ?? null,
        notAfter: (cert.data.cert_not_after as string | null) ?? null,
      }
    : null;

  return (
    <div className="space-y-6 p-6">
      {cabecalho}

      <ConfigSerproForm
        inicial={{
          temKey: Boolean(cfg.data?.consumer_key_cifrado),
          temSecret: Boolean(cfg.data?.consumer_secret_cifrado),
          cert: certVm,
        }}
      />
    </div>
  );
}
