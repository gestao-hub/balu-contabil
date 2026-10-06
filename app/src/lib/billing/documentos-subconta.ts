// Documentos do KYC da subconta: o que o Asaas pede → o que a tela mostra.
//
// POR QUE EXISTE. Criar a subconta pela API não basta para aprová-la: o Asaas
// pede, por exemplo, documento de identificação e selfie do responsável, e
// enquanto eles não chegam a análise nem começa. A tela dizia só "em análise" —
// e o escritório esperava por algo que dependia dele. Medido em 06/10/2026 na
// subconta do Escritório Demo: `documentation: PENDING` com os dois grupos
// `NOT_SENT` e nenhum `onboardingUrl`.
//
// PURO: sem I/O, sem React, sem `server-only`. A page, a action e o componente
// de envio leem as mesmas regras.
import type { AsaasDocumentosConta, AsaasGrupoDocumento } from '@/lib/clients/asaas';

export type StatusDocumento = 'NOT_SENT' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'IGNORED';

export type GrupoDocumentoVm = {
  grupoId: string;
  tipo: string;
  titulo: string;
  descricao: string | null;
  status: StatusDocumento;
  responsavel: string | null;
  /** Envio pelo link do Asaas — quando existe, a API NÃO pode ser usada. */
  linkEnvio: string | null;
  /** Dá para mandar o arquivo por esta tela agora. */
  podeEnviar: boolean;
};

const ROTULO_TIPO: Record<string, string> = {
  IDENTIFICATION: 'Documento de identificação (RG ou CNH)',
  IDENTIFICATION_SELFIE: 'Selfie segurando o documento',
  SOCIAL_CONTRACT: 'Contrato social',
  MEI_CERTIFICATE: 'Certificado do MEI (CCMEI)',
  ENTREPRENEUR_REQUIREMENT: 'Requerimento de empresário',
  MINUTES_OF_CONSTITUTION: 'Ata de constituição',
  MINUTES_OF_ELECTION: 'Ata de eleição da diretoria',
  POWER_OF_ATTORNEY: 'Procuração',
  EMANCIPATION_OF_MINORS: 'Comprovante de emancipação',
  INVOICE: 'Nota fiscal',
  ALLOW_BANK_ACCOUNT_DEPOSIT_STATEMENT: 'Comprovante da conta bancária',
  CUSTOM: 'Documento adicional',
};

/** O que cada tipo pede, em uma frase — a do Asaas vem genérica ou vazia. */
const DICA_TIPO: Record<string, string> = {
  IDENTIFICATION: 'Frente e verso legíveis, num único arquivo (foto ou PDF).',
  IDENTIFICATION_SELFIE: 'Rosto e documento visíveis na mesma foto, sem óculos escuros nem boné.',
  SOCIAL_CONTRACT: 'A última alteração consolidada, em PDF.',
};

export const ROTULO_STATUS_DOCUMENTO: Record<StatusDocumento, string> = {
  NOT_SENT: 'Falta enviar',
  PENDING: 'Enviado — em análise',
  APPROVED: 'Aprovado',
  REJECTED: 'Recusado — envie de novo',
  IGNORED: 'Não é mais necessário',
};

const STATUS_CONHECIDOS = new Set<string>(['NOT_SENT', 'PENDING', 'APPROVED', 'REJECTED', 'IGNORED']);

/** Status desconhecido vira `PENDING`: é o único que não pede ação nem afirma
 *  aprovação — mesma assimetria de `mapearStatusSubconta`. */
function statusDe(s: string | null | undefined): StatusDocumento {
  return (s && STATUS_CONHECIDOS.has(s) ? s : 'PENDING') as StatusDocumento;
}

export function grupoParaVm(g: AsaasGrupoDocumento): GrupoDocumentoVm {
  const status = statusDe(g.status);
  const linkEnvio = g.onboardingUrl?.trim() || null;
  return {
    grupoId: g.id,
    tipo: g.type,
    titulo: ROTULO_TIPO[g.type] ?? (g.title?.trim() || 'Documento'),
    descricao: DICA_TIPO[g.type] ?? (g.description?.trim() || null),
    status,
    responsavel: g.responsible?.name?.trim() || null,
    linkEnvio,
    podeEnviar: !linkEnvio && (status === 'NOT_SENT' || status === 'REJECTED'),
  };
}

export function documentosParaVm(r: AsaasDocumentosConta | null | undefined): {
  grupos: GrupoDocumentoVm[];
  motivoRecusa: string | null;
} {
  const grupos = (r?.data ?? [])
    .filter((g) => g && typeof g.id === 'string' && statusDe(g.status) !== 'IGNORED')
    .map(grupoParaVm);
  return { grupos, motivoRecusa: r?.rejectReasons?.trim() || null };
}

// ─── ARQUIVO ────────────────────────────────────────────────────────────────

/** A Vercel recusa corpo acima de ~4,5 MB ANTES do Next (ver next.config.ts).
 *  4 MB deixa folga para o multipart. A tela reduz fotos antes de chegar aqui. */
export const TAMANHO_MAXIMO_BYTES = 4 * 1024 * 1024;

export const TIPOS_ACEITOS = ['image/jpeg', 'image/png', 'application/pdf'] as const;

export function validarArquivoDocumento(a: { size: number; type: string }): string | null {
  if (!a.size) return 'Escolha o arquivo.';
  if (!(TIPOS_ACEITOS as readonly string[]).includes(a.type)) {
    return 'Envie uma foto (JPG ou PNG) ou um PDF.';
  }
  if (a.size > TAMANHO_MAXIMO_BYTES) return 'O arquivo passa de 4 MB — tire outra foto ou comprima o PDF.';
  return null;
}
