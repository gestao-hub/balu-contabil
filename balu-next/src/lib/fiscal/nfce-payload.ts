// @custom — Emissão multi-tipo: builder puro do payload NFC-e (modelo 65) p/ Focus.
// Doc: https://doc.focusnfe.com.br/reference/emitir_nfce
// NFC-e = consumidor final: destinatário opcional, mas formas_pagamento obrigatório.
import {
  toBrasiliaISO,
  type NfeEmitente,
  type NfeItem,
  type NfeItemPayload,
} from './nfe-payload';

export type NfceFormaPagamento = {
  forma: string;   // '01' dinheiro, '03' cartão crédito, etc.
  valor: number;
};

export type NfceConsumidor = {
  cpf: string | null;
  nome: string | null;
};

export type NfcePayload = {
  data_emissao: string;
  presenca_comprador: number;   // 1 = presencial
  modalidade_frete: number;     // 9 = sem frete
  local_destino: number;        // 1 = operação interna
  cnpj_emitente: string;
  cpf_destinatario?: string;
  nome_destinatario?: string;
  items: NfeItemPayload[];
  formas_pagamento: { forma_pagamento: string; valor_pagamento: number }[];
};

function digits(s: string | null | undefined): string {
  return (s ?? '').replace(/\D+/g, '');
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// NFC-e usa o mesmo mapeamento de itens da NF-e. Reusamos a validação inline
// (mesmas regras) para não acoplar à assinatura de buildNfePayload.
function mapItens(itens: NfeItem[], regime: NfeEmitente['regime']): NfeItemPayload[] {
  if (!itens.length) throw new Error('A nota precisa de pelo menos 1 item.');
  return itens.map((it, i) => {
    const ncm = digits(it.ncm);
    const cfop = digits(it.cfop);
    if (ncm.length !== 8) throw new Error(`Item ${i + 1}: NCM deve ter 8 dígitos.`);
    if (cfop.length !== 4) throw new Error(`Item ${i + 1}: CFOP deve ter 4 dígitos.`);
    if (!it.descricao.trim()) throw new Error(`Item ${i + 1}: descrição obrigatória.`);
    if (!Number.isFinite(it.quantidade) || it.quantidade <= 0) throw new Error(`Item ${i + 1}: quantidade inválida.`);
    if (!Number.isFinite(it.valorUnitario) || it.valorUnitario <= 0) throw new Error(`Item ${i + 1}: valor unitário inválido.`);
    const valorUnit = round2(it.valorUnitario);
    const imposto = regime === '3' ? { icms_origem: 0, icms_situacao_tributaria: '00' } : { icms_origem: 0, icms_csosn: '102' };
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
      ...imposto,
    };
  });
}

export function buildNfcePayload(
  emitente: NfeEmitente,
  itens: NfeItem[],
  pagamentos: NfceFormaPagamento[],
  consumidor: NfceConsumidor | null,
  now: Date = new Date(),
): NfcePayload {
  const cnpjEmit = digits(emitente.cnpj);
  if (cnpjEmit.length !== 14) throw new Error('CNPJ do emitente deve ter 14 dígitos.');
  if (!pagamentos.length) throw new Error('Informe ao menos uma forma de pagamento.');

  const items = mapItens(itens, emitente.regime);

  const payload: NfcePayload = {
    data_emissao: toBrasiliaISO(new Date(now.getTime() - 2_000)),
    presenca_comprador: 1,
    modalidade_frete: 9,
    local_destino: 1,
    cnpj_emitente: cnpjEmit,
    items,
    formas_pagamento: pagamentos.map((p) => ({ forma_pagamento: p.forma, valor_pagamento: round2(p.valor) })),
  };
  const cpf = digits(consumidor?.cpf);
  if (cpf) payload.cpf_destinatario = cpf;
  if (consumidor?.nome?.trim()) payload.nome_destinatario = consumidor.nome.trim().slice(0, 60);
  return payload;
}
