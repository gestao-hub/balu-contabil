import { DOC_KEYS, type DocKey } from '@/types/abertura';

export type DocEstado = 'pendente_envio' | 'aguardando_analise' | 'aprovado' | 'recusado';
export type DocRevisao = { status: 'aprovado' | 'recusado'; observacao?: string | null; revisado_por?: string | null; revisado_em?: string | null };

/** Estado derivado de um documento: path presente? há revisão? */
export function estadoDoc(path: string | null | undefined, rev: DocRevisao | undefined): DocEstado {
  if (!path) return 'pendente_envio';
  if (rev?.status === 'aprovado') return 'aprovado';
  if (rev?.status === 'recusado') return 'recusado';
  return 'aguardando_analise';
}

/** Conjunto obrigatório de documentos por tipo de empresa. Identidade = RG OU CNH
 *  (o front trata a alternativa; aqui exigimos o conjunto mínimo). */
export function docsExigidos(empresaTipo: string): DocKey[] {
  const identidade: DocKey[] = ['doc_rg_frente']; // ou CNH — validado no front
  if (empresaTipo === 'MEI') return [...identidade, 'doc_cpf', 'doc_comprovante_titular'];
  if (empresaTipo === 'EI') return [...identidade, 'doc_cpf', 'doc_comprovante_titular', 'doc_comprovante_sede'];
  // LTDA / SLU (mais exigente): + comprovante de sede + declaração de uso
  return [...identidade, 'doc_cpf', 'doc_comprovante_titular', 'doc_comprovante_sede', 'doc_declaracao_uso'];
}

export const TODOS_DOCS = DOC_KEYS;
