import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { downloadCertificado } from '@/lib/clients/supabase-storage';
import { decryptBlob } from '@/lib/crypto/envelope';
import { garantirAuthContratante } from '@/lib/fiscal/serpro-contratante';
import { buildTermoXml, signTermoXml } from '@/lib/fiscal/serpro-termo';
import { proximaMeiaNoiteSaoPaulo } from '@/lib/fiscal/serpro-expiracao';
import { enviarTermoApoiar, Tipo } from '@/lib/clients/serpro';
import { isInFutureISO } from '@/lib/fiscal/saude-empresa';

type Material = { keyPem: string; certPem: string; cnpj: string | null; nome: string };
type Result = { ok: true; token: string; expiration: string } | { ok: false; warning: string };

/**
 * Garante um autenticar_procurador_token válido para a empresa. Idempotente: se o token
 * persistido ainda estiver no futuro, devolve sem chamar a SERPRO.
 * `material` opcional evita o round-trip de Storage no fluxo de upload.
 */
export async function garantirTokenProcurador(
  supabase: SupabaseClient,
  companyId: string,
  material?: Material,
): Promise<Result> {
  // 1. Token vigente? (idempotência)
  const { data: fiscal } = await supabase
    .from('empresas_fiscais')
    .select('serpro_token_procurador, serpro_token_procurador_expiration, cnpj')
    .eq('empresa_id', companyId)
    .is('deleted_at', null)
    .maybeSingle();

  if (
    fiscal?.serpro_token_procurador &&
    isInFutureISO(fiscal.serpro_token_procurador_expiration as string | null, new Date(), 60 * 1000)
  ) {
    return {
      ok: true,
      token: fiscal.serpro_token_procurador as string,
      expiration: fiscal.serpro_token_procurador_expiration as string,
    };
  }

  // 2. Material da empresa (memória no upload, senão Storage).
  let mat = material;
  if (!mat) {
    const admin = createAdminClient();
    const { data: aux } = await admin
      .from('arquivos_auxiliares')
      .select('storage_key, cert_cnpj, cert_subject_cn')
      .eq('company_id', companyId)
      .is('deleted_at', null)
      .maybeSingle();
    if (!aux?.storage_key) return { ok: false, warning: 'Certificado da empresa não encontrado.' };
    let pemJson: { keyPem: string; certPem: string };
    try {
      const blob = await downloadCertificado(aux.storage_key as string);
      pemJson = JSON.parse(decryptBlob(blob).toString('utf8'));
    } catch {
      return { ok: false, warning: 'Falha ao ler o certificado da empresa.' };
    }
    mat = {
      keyPem: pemJson.keyPem,
      certPem: pemJson.certPem,
      cnpj: (aux.cert_cnpj as string | null) ?? (fiscal?.cnpj as string | null) ?? null,
      nome: (aux.cert_subject_cn as string | null) ?? '',
    };
  }
  const empresaCnpj = (mat.cnpj ?? (fiscal?.cnpj as string | null) ?? '').replace(/\D+/g, '');
  if (!empresaCnpj) return { ok: false, warning: 'CNPJ da empresa ausente no certificado.' };

  // 3. Auth do contratante (mTLS, cache).
  const auth = await garantirAuthContratante();
  if (!auth) return { ok: false, warning: 'Configure o certificado do contratante (SERPRO) para ativar a geração de guias.' };

  // 4. Termo XML assinado pela empresa.
  let token: string;
  try {
    const xml = buildTermoXml({
      destinatario: { cnpj: auth.cnpj, nome: auth.nome },
      autor: { cnpj: empresaCnpj, nome: mat.nome },
    });
    const signed = signTermoXml(xml, { keyPem: mat.keyPem, certPem: mat.certPem });
    const xmlB64 = Buffer.from(signed, 'utf8').toString('base64');

    // 5. /Apoiar
    token = await enviarTermoApoiar({
      pfx: auth.pfx,
      passphrase: auth.passphrase,
      accessToken: auth.accessToken,
      jwt: auth.jwt,
      envelope: {
        contratante: { numero: auth.cnpj, tipo: Tipo.CNPJ },
        autorPedidoDados: { numero: empresaCnpj, tipo: Tipo.CNPJ },
        contribuinte: { numero: empresaCnpj, tipo: Tipo.CNPJ },
        pedidoDados: {
          idSistema: 'AUTENTICAPROCURADOR',
          idServico: 'ENVIOXMLASSINADO81',
          versaoSistema: '1.0',
          dados: JSON.stringify({ xml: xmlB64 }),
        },
      },
    });
  } catch (e) {
    return { ok: false, warning: `Autenticação SERPRO (procurador) falhou — será refeita depois: ${e instanceof Error ? e.message.slice(0, 160) : ''}` };
  }

  // 6. Persiste.
  const expiration = proximaMeiaNoiteSaoPaulo();
  await supabase
    .from('empresas_fiscais')
    .update({
      serpro_token_procurador: token,
      serpro_token_procurador_expiration: expiration,
      updated_at: new Date().toISOString(),
    })
    .eq('empresa_id', companyId);

  return { ok: true, token, expiration };
}
