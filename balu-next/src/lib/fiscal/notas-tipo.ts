// @custom — PR 1.3: helpers puros de nota fiscal (dispatch por tipo + regra SEFAZ).
// Puro (sem server-only) para ser testável. O dispatch para as funções Focus em si
// fica nos chamadores server (action / route handler), que importam `focus`.

export type TipoDoc = 'NFe' | 'NFCe' | 'NFSe';

export function assertTipoDoc(t: string): TipoDoc {
  if (t === 'NFe' || t === 'NFCe' || t === 'NFSe') return t;
  throw new Error(`tipo_documento inválido: ${t}`);
}

export type Validacao = { ok: true } | { ok: false; error: string };

/** Regra SEFAZ: justificativa de cancelamento tem no mínimo 15 caracteres. */
export function validarJustificativa(j: string): Validacao {
  if ((j ?? '').trim().length < 15) {
    return { ok: false, error: 'A justificativa deve ter no mínimo 15 caracteres (regra SEFAZ).' };
  }
  return { ok: true };
}

/**
 * NFS-e é municipal: alguns provedores não expõem API de cancelamento — só dá pra
 * cancelar no portal da prefeitura (`municipios_nfse.cancelamento_so_portal = true`).
 * Nesses casos o cancelamento pela Focus não funciona. Não se aplica a NF-e/NFC-e
 * (cancelam via SEFAZ, independentes do portal municipal).
 */
export function cancelamentoSoPortal(
  tipo: string,
  municipioSoPortal: boolean | null | undefined,
): boolean {
  return tipo === 'NFSe' && municipioSoPortal === true;
}
