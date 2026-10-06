// Parcelamentos do Simples e do MEI (Integra-Parcelamento) — catálogo das
// modalidades e parser puro. Sem rede.
//
// As 8 modalidades têm os MESMOS três serviços que a Balu usa, com códigos que
// só mudam na dezena (catálogo oficial do Integra Contador):
//   GERARDAS{b}1          (Emitir)    DAS de uma parcela
//   PARCELASPARAGERAR{b}2 (Consultar) parcelas disponíveis para emitir
//   PEDIDOSPARC{b}3       (Consultar) todos os pedidos de parcelamento
//
// ⚠️ MODELADO PELA DOC (06/10/2026), sem envelope real ainda. Tolerante à forma.

export type Modalidade = {
  sistema: string;
  base: number;
  nome: string;
  regime: 'simples' | 'mei';
};

export const MODALIDADES: Modalidade[] = [
  { sistema: 'PARCSN', base: 16, nome: 'Parcelamento ordinário do Simples', regime: 'simples' },
  { sistema: 'PARCSN-ESP', base: 17, nome: 'Parcelamento especial do Simples', regime: 'simples' },
  { sistema: 'PERTSN', base: 18, nome: 'PERT do Simples', regime: 'simples' },
  { sistema: 'RELPSN', base: 19, nome: 'RELP do Simples', regime: 'simples' },
  { sistema: 'PARCMEI', base: 20, nome: 'Parcelamento ordinário do MEI', regime: 'mei' },
  { sistema: 'PARCMEI-ESP', base: 21, nome: 'Parcelamento especial do MEI', regime: 'mei' },
  { sistema: 'PERTMEI', base: 22, nome: 'PERT do MEI', regime: 'mei' },
  { sistema: 'RELPMEI', base: 23, nome: 'RELP do MEI', regime: 'mei' },
];

export const servico = {
  gerarDas: (m: Modalidade) => `GERARDAS${m.base}1`,
  parcelas: (m: Modalidade) => `PARCELASPARAGERAR${m.base}2`,
  pedidos: (m: Modalidade) => `PEDIDOSPARC${m.base}3`,
};

/** Modalidades que se aplicam ao regime (código de `empresas_fiscais`). */
export function modalidadesDoRegime(regimeCode: string): Modalidade[] {
  if (regimeCode === '4') return MODALIDADES.filter((m) => m.regime === 'mei');
  if (regimeCode === '1' || regimeCode === '2') return MODALIDADES.filter((m) => m.regime === 'simples');
  return [];
}

export function modalidadePorSistema(sistema: string): Modalidade | null {
  return MODALIDADES.find((m) => m.sistema === sistema) ?? null;
}

type Obj = Record<string, unknown>;

function lerDados(envelope: unknown): Obj | unknown[] {
  const env = (envelope ?? {}) as { dados?: unknown };
  let d: unknown = env.dados;
  if (typeof d === 'string') {
    if (!d.trim()) return {};
    try { d = JSON.parse(d); } catch { throw new Error('Resposta do parcelamento em formato inesperado.'); }
  }
  if (Array.isArray(d)) return d;
  return (d && typeof d === 'object' ? d : {}) as Obj;
}

/** A primeira lista que encontrar entre os nomes conhecidos (ou o próprio `dados`). */
function lista(d: Obj | unknown[], nomes: string[]): Obj[] {
  if (Array.isArray(d)) return d as Obj[];
  for (const n of nomes) if (Array.isArray(d[n])) return d[n] as Obj[];
  return [];
}

function dataIso(v: unknown): string | null {
  const s = String(v ?? '').replace(/\D/g, '');
  return /^\d{8}$/.test(s) && s !== '00000000' ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null;
}

export type PedidoParcelamento = {
  numero: string;
  dataPedido: string | null;
  situacao: string | null;
  dataSituacao: string | null;
};

/** PEDIDOSPARC{b}3 */
export function parsePedidos(envelope: unknown): PedidoParcelamento[] {
  return lista(lerDados(envelope), ['parcelamentos', 'listaParcelamentos'])
    .map((p) => ({
      numero: String(p.numero ?? '').trim(),
      dataPedido: dataIso(p.dataDoPedido),
      situacao: typeof p.situacao === 'string' ? p.situacao.trim() || null : null,
      dataSituacao: dataIso(p.dataDaSituacao),
    }))
    .filter((p) => p.numero);
}

export type ParcelaDisponivel = { parcela: string; valor: number | null };

/** PARCELASPARAGERAR{b}2 — `parcela` é AAAAMM. */
export function parseParcelas(envelope: unknown): ParcelaDisponivel[] {
  return lista(lerDados(envelope), ['listaParcela', 'listaParcelas'])
    .map((p) => {
      const valor = Number(p.valor);
      return { parcela: String(p.parcela ?? '').replace(/\D/g, ''), valor: Number.isFinite(valor) ? valor : null };
    })
    .filter((p) => /^\d{6}$/.test(p.parcela));
}

/** GERARDAS{b}1 — o PDF do DAS da parcela, em base64. */
export function parsePdfDas(envelope: unknown): string | null {
  const d = lerDados(envelope);
  if (Array.isArray(d)) return null;
  for (const [k, v] of Object.entries(d)) {
    if (/pdf/i.test(k) && typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

/** "Em parcelamento" e afins — o que ainda tem parcela a pagar. */
export function parcelamentoAtivo(situacao: string | null): boolean {
  const s = String(situacao ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return /em parcelamento|ativo|deferido/.test(s) && !/encerrad|rescindid|indeferid|cancelad|liquidad/.test(s);
}
