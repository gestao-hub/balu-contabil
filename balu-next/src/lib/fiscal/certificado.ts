// @custom — PR 1.6: validação pura do upload de certificado A1 (sem deps de server/React).
export type CertValidacao = { ok: true } | { ok: false; error: string };

// Certificados A1 são pequenos; 1MB também respeita o limite default de Server Action do Next.
const MAX_BYTES = 1_000_000;

export function validateCertificadoUpload(input: { name: string; size: number; senha: string }): CertValidacao {
  const nome = (input.name ?? '').toLowerCase();
  if (!nome.endsWith('.pfx') && !nome.endsWith('.p12')) {
    return { ok: false, error: 'O certificado deve ser um arquivo .pfx ou .p12.' };
  }
  if (!input.size || input.size <= 0) {
    return { ok: false, error: 'Selecione o arquivo do certificado.' };
  }
  if (input.size > MAX_BYTES) {
    return { ok: false, error: 'Arquivo muito grande (máx. 1 MB).' };
  }
  if (!input.senha || !input.senha.trim()) {
    return { ok: false, error: 'Informe a senha do certificado.' };
  }
  return { ok: true };
}
