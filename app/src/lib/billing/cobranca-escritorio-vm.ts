// Bloco 4B — como uma cobrança do escritório se APRESENTA.
//
// DUAS TELAS LEEM A MESMA COBRANÇA: o cliente final (`/cobrancas`, decisão 7.3)
// e o escritório que a emitiu (`/contador/cobrancas`). Por isso este módulo saiu
// de dentro da pasta da tela do cliente e veio para `lib/` — se cada uma
// tivesse o seu rótulo e a sua cor, a MESMA cobrança apareceria "Em aberto" de
// um lado e "Pendente" do outro, e a conversa entre os dois começaria com os
// dois olhando telas que discordam. É o mesmo argumento dos três relógios que
// `cobranca-escritorio.ts` faz para o estado; aqui vale para o vocabulário.
//
// Puro de propósito: sem I/O, sem React, sem `server-only`. O que decide se
// aparece um botão "Pagar" merece teste próprio, e montar a página inteira só
// para perguntar isso é caro demais para o teste existir.
//
// NÃO deriva status aqui (nada de "o vencimento passou, logo está vencida").
// Quem decide o estado da cobrança é lib/billing/cobranca-escritorio.ts, a
// partir do evento do Asaas — e o cabeçalho de lá avisa que esse estado já tem
// três leitores concordando. Um quarto, na UI, faria esta tela discordar do
// painel do escritório sobre a MESMA cobrança, e o cliente ficaria no meio.
import type { StatusCobranca } from '@/lib/billing/cobranca-escritorio';

export type CobrancaVm = {
  id: string;
  descricao: string;
  status: string;
  valorCentavos: number;
  vencimento: string;
  pagoEm: string | null;
  linkFatura: string | null;
  pixCopiaCola: string | null;
  /** Nome do escritório emissor, e só quando NÃO é o que atende a empresa
   *  hoje. Cliente que trocou de contador tem histórico de dois emissores;
   *  rotular tudo com o escritório atual seria atribuir a ele cobrança que
   *  não é dele. `null` no caso normal, para não repetir o mesmo nome em
   *  toda linha. */
  emitidaPor: string | null;
};

const ROTULO_STATUS: Record<StatusCobranca, string> = {
  pendente: 'Em aberto',
  paga: 'Paga',
  vencida: 'Vencida',
  estornada: 'Estornada',
};

/** Cor por tokens da marca — nunca cor fixa, senão quebra no tema claro. */
const COR_STATUS: Record<StatusCobranca, string> = {
  pendente: 'bg-surface-3 text-muted-foreground-2',
  paga: 'bg-success/15 text-success',
  vencida: 'bg-alert/15 text-alert',
  estornada: 'bg-surface-3 text-muted-foreground',
};

/** Status desconhecido cai em `pendente` pelo mesmo motivo de statusDoAsaas():
 *  é o único dos quatro que não afirma nada sobre o dinheiro. */
export function rotuloStatus(status: string): string {
  return ROTULO_STATUS[status as StatusCobranca] ?? ROTULO_STATUS.pendente;
}

export function corStatus(status: string): string {
  return COR_STATUS[status as StatusCobranca] ?? COR_STATUS.pendente;
}

/** Ainda pede dinheiro do cliente. `vencida` entra: no Asaas o boleto vencido
 *  continua pagável, e é justamente quem mais precisa do botão. */
export function estaEmAberto(status: string): boolean {
  return status === 'pendente' || status === 'vencida';
}

/**
 * Botão de pagar: só onde há o que pagar E para onde mandar.
 *
 * `estornada` NUNCA paga — o dinheiro voltou, e oferecer "pagar" ali seria
 * pedir de novo o que o escritório devolveu. `paga`, idem, pelo motivo óbvio.
 * A cobrança estornada continua VISÍVEL (é histórico do cliente com o
 * escritório, e sumir com uma cobrança que ele talvez tenha pago é pior que
 * mostrá-la marcada); o que some é a ação.
 */
export function podePagar(c: { status: string; linkFatura: string | null }): boolean {
  return estaEmAberto(c.status) && !!c.linkFatura;
}

/**
 * O item "Cobranças" entra no menu do empresário?
 *
 * Ele aparece quando EXISTE boleto (decisão de 28/07): escritório vinculado não
 * basta, porque a maioria cobra fora da Balu e o item seria uma tela vazia
 * permanente ao lado de "Honorários", que fala da mesma dívida.
 *
 * **FALHA ABERTA, e isto é o ponto desta função.** Se a consulta falhar, o item
 * APARECE. Esconder por erro de leitura é a mesma falha que a tela do cliente
 * existe para evitar — lá, lista vazia não pode ser lida como "não devo nada";
 * aqui, item ausente não pode ser lido como "não tenho cobrança". Um nível acima
 * e mais silencioso: no menu não há onde escrever "não deu para conferir".
 *
 * O custo de errar para este lado é o usuário abrir uma tela que se explica
 * sozinha ("não foi possível carregar, recarregue"). O custo de errar para o
 * outro é um boleto vencer sem ele nunca ter visto.
 */
export function mostrarItemCobrancas(r: { erro: boolean; quantidade: number }): boolean {
  return r.erro || r.quantidade > 0;
}

/** Soma do que continua na mão do cliente, em centavos. */
export function totalEmAberto(cs: Array<{ status: string; valorCentavos: number }>): number {
  return cs.reduce((t, c) => (estaEmAberto(c.status) ? t + c.valorCentavos : t), 0);
}
