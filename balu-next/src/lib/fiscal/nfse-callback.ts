// @custom — Extrai os campos persistíveis de um callback/consulta da Focus.
// Helper puro, testável. Compartilhado entre o webhook (`api/webhooks/focus`) e
// a action de atualização de status (`notas_fiscais/actions`), que antes
// duplicavam essa lógica assumindo nomes de campo de NF-e.
//
// NFS-e Nacional ≠ NF-e nos nomes de campo (callback real validado 2026-05-28):
//   - chave de acesso (50 dígitos) → `codigo_verificacao` (NÃO `chave_nfe`)
//   - número da nota               → `numero` / `numero_nfse`
//   - URL de consulta pública      → `url`
//   - PDF (S3 pré-assinada)        → `url_danfse`
//   - XML (path relativo Focus)    → `caminho_xml_nota_fiscal`
//   - NFS-e NÃO possui `protocolo` (conceito de NF-e)
// Campos de NF-e (`chave_nfe`, `protocolo`, `caminho_danfe`) ficam como fallback
// pra quando suportarmos NFe/NFCe.

export interface CamposNota {
  chaveAcesso: string | null;
  protocolo: string | null;
  numero: string | null;
  serie: string | null;
  pdf: string | null;
  xml: string | null;
  urlConsulta: string | null;
}

function str(v: unknown): string | null {
  return v != null ? String(v) : null;
}

export function extrairCamposNota(cb: Record<string, unknown>): CamposNota {
  return {
    // NFS-e: codigo_verificacao; NFe (futuro): chave_nfe.
    chaveAcesso: (cb.codigo_verificacao as string) ?? (cb.chave_nfe as string) ?? null,
    // Só NF-e. NFS-e não retorna protocolo.
    protocolo: (cb.protocolo as string) ?? null,
    numero: str(cb.numero ?? cb.numero_nfse),
    serie: str(cb.serie),
    // PDF: NFS-e manda url_danfse (S3); NFe legacy, caminho_danfe.
    pdf:
      (cb.pdf_url as string) ??
      (cb.url_danfse as string) ??
      (cb.caminho_danfe as string) ??
      (cb.caminho_danfse as string) ??
      null,
    // XML: NFS-e manda caminho_xml_nota_fiscal (relativo).
    xml:
      (cb.xml_url as string) ??
      (cb.caminho_xml_nota_fiscal as string) ??
      (cb.caminho_xml_nfse as string) ??
      null,
    // Consulta pública NFS-e Nacional.
    urlConsulta: (cb.url as string) ?? null,
  };
}
