// Núcleo do upload de certificado A1, compartilhado pelos DOIS caminhos de
// entrada: o dono da empresa (`/configuracoes`) e o contador do escritório
// (`/contador/clientes/[companyId]`, migration 0085).
//
// Existe como módulo próprio porque duplicar isso seria duplicar a decisão de
// segurança: cifrar o material com `CERT_ENC_KEY`, descartar a senha do PFX e
// nunca gravar chave privada em claro. Uma cópia divergente é como um dos dois
// caminhos passa a guardar chave privada de um jeito que ninguém revisou.
//
// O client do Supabase vem de fora: o dono escreve com a sessão dele (a RLS
// `user_owns_company` autoriza) e o contador escreve com service_role depois de
// provar a permissão em `companyDaCarteira` — o painel do contador continua sem
// policy de escrita, que é a decisão registrada do Bloco A.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { parsePkcs12, type CertMaterial } from '@/lib/fiscal/pkcs12';
import { encryptBlob } from '@/lib/crypto/envelope';
import { uploadCertificado as storageUploadCertificado } from '@/lib/clients/supabase-storage';
import { garantirTokenProcurador } from '@/lib/fiscal/serpro-procurador';
import { atualizarEmpresaNaFocus } from '@/lib/fiscal/focus-empresa-sync';
import { formatCnpj } from '@/lib/format/masks';

/** Nome fixo no bucket: 1 certificado por empresa; re-upload sobrescreve. */
const CERT_FILENAME = 'certificado.enc';

export type CertUploadResult =
  | { ok: true; warnings: string[]; notAfter: string }
  | { ok: false; error: string };

const digitos = (v: unknown) => String(v ?? '').replace(/\D+/g, '');

/**
 * Recusa PFX de outro CNPJ. A checagem não existia enquanto só o dono subia o
 * próprio arquivo; com o contador manuseando dezenas de PFX de clientes
 * diferentes, trocar dois arquivos deixa de ser hipótese remota.
 *
 * Sem isto o erro aparece tarde e disfarçado: o Termo de Autorização é assinado
 * com o CNPJ do certificado (`serpro-procurador.ts` lê `cert_cnpj`) enquanto o
 * envelope do DAS declara o CNPJ da empresa (`serpro-das-mei.ts`), a SERPRO
 * recusa, e a tela diz "a empresa ainda não autorizou a Balu (Termo/procuração)"
 * — mandando o contador atrás de uma procuração quando o problema é o arquivo.
 *
 * Só dispara quando o certificado traz CNPJ no CN (padrão e-CNPJ "NOME:CNPJ").
 * Certificado sem CNPJ legível não é bloqueado: seria recusar arquivo válido
 * por causa de uma limitação de leitura nossa.
 */
export function conferirCnpjDoCertificado(
  certCnpj: string | null,
  empresaCnpj: string | null,
): { ok: true } | { ok: false; error: string } {
  const a = digitos(certCnpj);
  const b = digitos(empresaCnpj);
  if (!a || !b || a === b) return { ok: true };
  return {
    ok: false,
    error: `Este certificado é do CNPJ ${formatCnpj(a)} e a empresa selecionada é ${formatCnpj(b)}. Confira se o arquivo é o do cliente certo.`,
  };
}

/**
 * Faz o trabalho todo: abre o PFX, valida, cifra, sobe no Storage privado,
 * grava a linha em `arquivos_auxiliares` e tenta (best-effort) gerar o token do
 * procurador e espelhar o certificado na Focus.
 *
 * `enviadoPor` é o usuário que executou o upload — dono ou contador. Vai para a
 * coluna de exibição da 0085; a trilha que vale para auditoria é o `audit_log`,
 * escrito pelo caller que tem o contexto do escritório.
 */
export async function processarUploadCertificado(
  supabase: SupabaseClient,
  companyId: string,
  entrada: { bytes: Buffer; senha: string },
  enviadoPor: string,
): Promise<CertUploadResult> {
  // Abre o PFX legado com node-forge (valida a senha de verdade) e extrai metadados.
  let material: CertMaterial;
  try {
    material = parsePkcs12(entrada.bytes, entrada.senha);
  } catch {
    return { ok: false, error: 'Não foi possível abrir o certificado. Verifique o arquivo e a senha.' };
  }
  if (new Date(material.notAfter).getTime() < Date.now()) {
    return { ok: false, error: `Certificado expirado em ${new Date(material.notAfter).toLocaleDateString('pt-BR')}.` };
  }

  const { data: company } = await supabase
    .from('companies').select('cnpj').eq('id', companyId).maybeSingle();
  const conf = conferirCnpjDoCertificado(material.cnpj, (company?.cnpj as string | null) ?? null);
  if (!conf.ok) return conf;

  // Re-cifra o material de chave (key+cert+cadeia) com a chave do app; a senha do cert é descartada.
  let blob: Buffer;
  try {
    blob = encryptBlob(
      Buffer.from(JSON.stringify({ keyPem: material.keyPem, certPem: material.certPem, chainPem: material.chainPem }), 'utf8'),
    );
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erro interno ao cifrar o certificado.' };
  }

  const { data: existing } = await supabase
    .from('arquivos_auxiliares')
    .select('id')
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .maybeSingle();

  let path: string;
  try {
    ({ path } = await storageUploadCertificado(blob, CERT_FILENAME, companyId));
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Falha ao enviar o arquivo.' };
  }

  const row = {
    supabase_file_path: path,
    storage_key: path,
    cert_password: null,
    cert_not_after: material.notAfter,
    cert_subject_cn: material.subjectCN,
    cert_cnpj: material.cnpj,
    cert_fingerprint: material.fingerprintSha256,
    cert_enviado_por: enviadoPor,
    cert_enviado_em: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (existing) {
    const { error } = await supabase.from('arquivos_auxiliares').update(row).eq('id', (existing as { id: string }).id);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await supabase.from('arquivos_auxiliares').insert({ company_id: companyId, ...row });
    if (error) return { ok: false, error: error.message };
  }

  // Best-effort daqui pra baixo: o certificado JÁ está salvo, e nenhuma falha
  // de integração externa pode fazer o usuário perder o que subiu.
  const warnings: string[] = [];

  const tk = await garantirTokenProcurador(supabase, companyId, {
    keyPem: material.keyPem,
    certPem: material.certPem,
    cnpj: material.cnpj,
    nome: material.subjectCN,
  });
  if (!tk.ok) warnings.push(tk.warning);

  // Focus 2.2: se a empresa já tem cadastro na Focus, envia o PFX + senha (em
  // base64) no mesmo PUT do payload base. Este é o ÚNICO momento em que temos a
  // senha original do PFX em memória; depois daqui ela é descartada (só o
  // material PEM cifrado fica em Storage). Sem `focus_empresa_id` ainda, pula em
  // silêncio — resolve-se depois em "Sincronizar com Focus" no Diagnóstico.
  const { data: fiscalForFocus } = await supabase
    .from('empresas_fiscais')
    .select('focus_empresa_id, focus_origem')
    .eq('empresa_id', companyId)
    .is('deleted_at', null)
    .maybeSingle();

  // Bloco 5: o espelho na Focus é do caminho `balu`. Com origem 'propria' o
  // PUT /v2/empresas/:id não está ao nosso alcance — é a credencial da
  // PLATAFORMA que o abre, e o token da empresa leva 401 (provado 20/08/2026).
  // Sem esta ramificação, toda empresa que traz a própria conta receberia um
  // aviso de falha em todo upload de certificado.
  if ((fiscalForFocus?.focus_origem ?? 'balu') === 'propria') {
    warnings.push(
      'Certificado guardado no Balu. Como esta empresa usa a própria conta na Focus, '
      + 'envie o mesmo certificado no painel da Focus dela — não conseguimos fazer isso por você.',
    );
  } else if (fiscalForFocus?.focus_empresa_id != null) {
    // Chamada EXISTENTE, inalterada — só movida para dentro do `else if`.
    const focusResult = await atualizarEmpresaNaFocus(supabase, companyId, undefined, {
      certificado: { base64: entrada.bytes.toString('base64'), senha: entrada.senha },
    });
    if (!focusResult.ok) {
      warnings.push(`Certificado salvo localmente, mas falhou ao enviar pra Focus: ${focusResult.error.slice(0, 200)}`);
    }
  }

  return { ok: true, warnings, notAfter: material.notAfter };
}
