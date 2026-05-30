// @custom — Emissão multi-tipo: builder puro do payload NF-e (modelo 55) p/ Focus.
// Sem deps de React/Supabase — testável isoladamente.
// Doc: https://doc.focusnfe.com.br/reference/emitir_nfe
import type { RegimeCode } from './regime';

/** Item de nota de produto. Compartilhado por NF-e e NFC-e. */
export type NfeItem = {
  descricao: string;
  ncm: string;        // 8 dígitos
  cfop: string;       // 4 dígitos
  unidade: string;    // ex: 'UN'
  quantidade: number;
  valorUnitario: number;
};

export type NfeEmitente = {
  cnpj: string;
  regime: RegimeCode | string | null;
};

export type NfeDestinatario = {
  cnpj: string | null;
  cpf: string | null;
  nome: string;
};

export type NfeItemPayload = {
  numero_item: number;
  codigo_produto: string;
  descricao: string;
  codigo_ncm: string;
  cfop: string;
  unidade_comercial: string;
  quantidade_comercial: number;
  valor_unitario_comercial: number;
  valor_bruto: number;
  unidade_tributavel: string;
  quantidade_tributavel: number;
  valor_unitario_tributavel: number;
  icms_origem: number;             // 0 = nacional
  icms_situacao_tributaria?: string;
  icms_csosn?: string;
};

export type NfePayload = {
  natureza_operacao: string;
  data_emissao: string;
  tipo_documento: number;          // 1 = saída
  finalidade_emissao: string;      // '1' = normal
  consumidor_final: number;        // 0 = não
  cnpj_emitente: string;
  nome_destinatario: string;
  cnpj_destinatario?: string;
  cpf_destinatario?: string;
  indicador_inscricao_estadual_destinatario: number; // 9 = não contribuinte
  modalidade_frete: number;        // 9 = sem frete
  items: NfeItemPayload[];
};

function digits(s: string | null | undefined): string {
  return (s ?? '').replace(/\D+/g, '');
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;
/** ISO no fuso de Brasília (-03:00). Mesma razão do nfse-payload (Focus rejeita Z/UTC). */
export function toBrasiliaISO(d: Date): string {
  const brt = new Date(d.getTime() - BRT_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${brt.getUTCFullYear()}-${p(brt.getUTCMonth() + 1)}-${p(brt.getUTCDate())}T${p(brt.getUTCHours())}:${p(brt.getUTCMinutes())}:${p(brt.getUTCSeconds())}-03:00`;
}

/** Simples Nacional (regimes 1,2,4) usa CSOSN; regime 3 usa CST. */
function impostoDefaults(regime: RegimeCode | string | null): Pick<NfeItemPayload, 'icms_origem' | 'icms_situacao_tributaria' | 'icms_csosn'> {
  if (regime === '3') return { icms_origem: 0, icms_situacao_tributaria: '00' };
  return { icms_origem: 0, icms_csosn: '102' }; // 102 = sem permissão de crédito
}

function mapItens(itens: NfeItem[], regime: RegimeCode | string | null): NfeItemPayload[] {
  return itens.map((it, i) => {
    const ncm = digits(it.ncm);
    const cfop = digits(it.cfop);
    if (ncm.length !== 8) throw new Error(`Item ${i + 1}: NCM deve ter 8 dígitos.`);
    if (cfop.length !== 4) throw new Error(`Item ${i + 1}: CFOP deve ter 4 dígitos.`);
    if (!it.descricao.trim()) throw new Error(`Item ${i + 1}: descrição obrigatória.`);
    if (!Number.isFinite(it.quantidade) || it.quantidade <= 0) throw new Error(`Item ${i + 1}: quantidade inválida.`);
    if (!Number.isFinite(it.valorUnitario) || it.valorUnitario <= 0) throw new Error(`Item ${i + 1}: valor unitário inválido.`);
    const valorUnit = round2(it.valorUnitario);
    return {
      numero_item: i + 1,
      codigo_produto: String(i + 1),
      descricao: it.descricao.trim(),
      codigo_ncm: ncm,
      cfop,
      unidade_comercial: it.unidade || 'UN',
      quantidade_comercial: it.quantidade,
      valor_unitario_comercial: valorUnit,
      valor_bruto: round2(it.quantidade * valorUnit),
      unidade_tributavel: it.unidade || 'UN',
      quantidade_tributavel: it.quantidade,
      valor_unitario_tributavel: valorUnit,
      ...impostoDefaults(regime),
    };
  });
}

export function buildNfePayload(
  emitente: NfeEmitente,
  destinatario: NfeDestinatario,
  itens: NfeItem[],
  naturezaOperacao: string,
  now: Date = new Date(),
): NfePayload {
  const cnpjEmit = digits(emitente.cnpj);
  if (cnpjEmit.length !== 14) throw new Error('CNPJ do emitente deve ter 14 dígitos.');
  if (!itens.length) throw new Error('A nota precisa de pelo menos 1 item.');
  const natureza = naturezaOperacao.trim();
  if (!natureza) throw new Error('Natureza da operação é obrigatória.');

  const cnpjDest = digits(destinatario.cnpj);
  const cpfDest = digits(destinatario.cpf);
  if (!cnpjDest && !cpfDest) throw new Error('Destinatário precisa de CPF ou CNPJ.');
  const nome = destinatario.nome.trim();
  if (!nome) throw new Error('Nome do destinatário é obrigatório.');

  const payload: NfePayload = {
    natureza_operacao: natureza,
    data_emissao: toBrasiliaISO(new Date(now.getTime() - 2_000)),
    tipo_documento: 1,
    finalidade_emissao: '1',
    consumidor_final: 0,
    cnpj_emitente: cnpjEmit,
    nome_destinatario: nome.slice(0, 60),
    indicador_inscricao_estadual_destinatario: 9,
    modalidade_frete: 9,
    items: mapItens(itens, emitente.regime),
  };
  if (cnpjDest) payload.cnpj_destinatario = cnpjDest;
  else payload.cpf_destinatario = cpfDest;
  return payload;
}
