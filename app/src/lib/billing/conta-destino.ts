// Conta bancária de destino do saque do escritório.
//
// Guardada CIFRADA (mesmo envelope AES-256-GCM da apiKey da subconta, Bloco E)
// e acompanhada de um resumo sem dado sensível, para a tela dizer para onde o
// dinheiro vai sem precisar decifrar a cada render.
//
// Validação aqui é defesa contra erro de digitação, não firula: o destino
// errado não volta sozinho — dinheiro transferido para a conta de outra pessoa
// é problema de polícia, não de suporte.
import { cifrarCampo, decifrarCampo } from '@/lib/crypto/envelope';

export type ContaDestino = {
  bancoCodigo: string;        // 3 dígitos (ex.: '341')
  bancoNome: string;
  agencia: string;
  conta: string;
  contaDigito: string;
  tipo: 'CONTA_CORRENTE' | 'CONTA_POUPANCA';
  titular: string;
  cpfCnpj: string;            // só dígitos
};

export type Validacao = { ok: true; conta: ContaDestino } | { ok: false; erro: string };

const soDigitos = (s: string): string => (s ?? '').replace(/\D+/g, '');

/** Validação de CPF/CNPJ pelo dígito verificador — não só pelo tamanho. */
function documentoValido(doc: string): boolean {
  if (doc.length === 11) {
    if (/^(\d)\1{10}$/.test(doc)) return false;
    const calc = (ate: number): number => {
      let soma = 0;
      for (let i = 0; i < ate; i++) soma += Number(doc[i]) * (ate + 1 - i);
      const r = (soma * 10) % 11;
      return r === 10 ? 0 : r;
    };
    return calc(9) === Number(doc[9]) && calc(10) === Number(doc[10]);
  }
  if (doc.length === 14) {
    if (/^(\d)\1{13}$/.test(doc)) return false;
    const calc = (ate: number): number => {
      const pesos = ate === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
      let soma = 0;
      for (let i = 0; i < ate; i++) soma += Number(doc[i]) * pesos[i];
      const r = soma % 11;
      return r < 2 ? 0 : 11 - r;
    };
    return calc(12) === Number(doc[12]) && calc(13) === Number(doc[13]);
  }
  return false;
}

export function validarContaDestino(bruto: Partial<ContaDestino>): Validacao {
  const bancoCodigo = soDigitos(bruto.bancoCodigo ?? '');
  const agencia = soDigitos(bruto.agencia ?? '');
  const conta = soDigitos(bruto.conta ?? '');
  const contaDigito = (bruto.contaDigito ?? '').trim().toUpperCase();
  const cpfCnpj = soDigitos(bruto.cpfCnpj ?? '');
  const titular = (bruto.titular ?? '').trim();
  const bancoNome = (bruto.bancoNome ?? '').trim();
  const tipo = bruto.tipo === 'CONTA_POUPANCA' ? 'CONTA_POUPANCA' : 'CONTA_CORRENTE';

  // 2 ou 3 dígitos: o código é sempre de 3 (001–999), mas escrever "41" para o
  // Banrisul (041) é digitação corrente — completamos com zero à esquerda em
  // vez de recusar. Um dígito só recusa, porque aí é erro, não abreviação.
  if (bancoCodigo.length < 2 || bancoCodigo.length > 3) {
    return { ok: false, erro: 'Informe o código do banco (3 dígitos, ex.: 341).' };
  }
  if (!bancoNome) return { ok: false, erro: 'Informe o nome do banco.' };
  if (agencia.length < 3) return { ok: false, erro: 'Agência inválida.' };
  if (conta.length < 3) return { ok: false, erro: 'Conta inválida.' };
  // Dígito de 1 caractere, aceitando X (usado por alguns bancos).
  if (!/^[0-9X]$/.test(contaDigito)) return { ok: false, erro: 'Dígito da conta inválido (1 caractere).' };
  if (titular.length < 3) return { ok: false, erro: 'Informe o nome do titular da conta.' };
  if (!documentoValido(cpfCnpj)) return { ok: false, erro: 'CPF/CNPJ do titular inválido.' };

  return {
    ok: true,
    conta: { bancoCodigo: bancoCodigo.padStart(3, '0'), bancoNome, agencia, conta, contaDigito, tipo, titular, cpfCnpj },
  };
}

/** Texto curto para a tela — sem CPF, sem conta inteira. */
export function resumoDaConta(c: ContaDestino): string {
  const fim = c.conta.slice(-4);
  const tipo = c.tipo === 'CONTA_POUPANCA' ? 'poupança' : 'corrente';
  return `${c.bancoNome} (${c.bancoCodigo}) · ag ${c.agencia} · conta ****${fim}-${c.contaDigito} · ${tipo} · ${c.titular}`;
}

export function guardarContaDestino(c: ContaDestino): string {
  return cifrarCampo(JSON.stringify(c));
}

export function lerContaDestino(cifrada: string | null): ContaDestino | null {
  if (!cifrada) return null;
  try {
    const json = decifrarCampo(cifrada);
    return json ? (JSON.parse(json) as ContaDestino) : null;
  } catch {
    // Chave trocada ou dado corrompido: melhor "sem conta cadastrada" (que
    // bloqueia o saque) do que estourar a tela inteira da subconta.
    console.error('[conta-destino] falha ao decifrar a conta de destino');
    return null;
  }
}
