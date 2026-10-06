// Cliente avulso (0108) — quem o escritório cobra sem ter na carteira.
//
// PURO de propósito: sem I/O, sem React, sem `server-only`. A tela do catálogo
// (cliente) valida com estas mesmas funções antes de enviar, a action valida de
// novo, e a tela de cobranças monta os links de compartilhar com elas — uma
// regra só, três leitores.
import { isValidCnpj } from '@/lib/validators/cnpj';

const soDigitos = (v: string | null | undefined): string => (v ?? '').replace(/\D+/g, '');

/** CPF pelos dígitos verificadores. */
export function isValidCpf(cpf: string | null | undefined): boolean {
  const d = soDigitos(cpf);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (len: number): number => {
    let soma = 0;
    for (let i = 0; i < len; i++) soma += Number(d[i]) * (len + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

/** Documento só com dígitos, ou `null` quando não é CPF nem CNPJ válido. */
export function documentoValido(doc: string | null | undefined): string | null {
  const d = soDigitos(doc);
  if (d.length === 11) return isValidCpf(d) ? d : null;
  if (d.length === 14) return isValidCnpj(d) ? d : null;
  return null;
}

/**
 * Telefone com DDD, só dígitos (10 ou 11), ou `null` se não der para usar.
 *
 * Aceita o que o escritório cola do WhatsApp: "+55 (11) 98888-7777" vira
 * "11988887777". O 55 é tirado aqui e posto de volta só no link.
 */
export function telefoneValido(tel: string | null | undefined): string | null {
  let d = soDigitos(tel);
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  return d.length === 10 || d.length === 11 ? d : null;
}

/** E-mail minimamente plausível, em minúsculas, ou `null`. */
export function emailValido(email: string | null | undefined): string | null {
  const e = (email ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

export type DadosCompartilhar = {
  nomeCliente: string;
  nomeEscritorio: string | null;
  descricao: string;
  valorFormatado: string;
  /** DD/MM/AAAA. */
  vencimento: string;
  linkFatura: string;
};

/** O texto que vai no WhatsApp e no corpo do e-mail. */
export function mensagemCobranca(d: DadosCompartilhar): string {
  const de = d.nomeEscritorio?.trim() ? ` do ${d.nomeEscritorio.trim()}` : '';
  return [
    `Olá, ${d.nomeCliente.trim()}!`,
    '',
    `Segue a cobrança${de}:`,
    `${d.descricao.trim()} — ${d.valorFormatado}, vencimento ${d.vencimento}.`,
    '',
    `Para pagar (Pix, boleto ou cartão): ${d.linkFatura}`,
  ].join('\n');
}

/** Link do WhatsApp. Sem telefone, abre o WhatsApp para escolher o contato. */
export function linkWhatsApp(telefone: string | null, texto: string): string {
  const t = telefoneValido(telefone);
  const base = t ? `https://wa.me/55${t}` : 'https://wa.me/';
  return `${base}?text=${encodeURIComponent(texto)}`;
}

/** `mailto:` com assunto e corpo. Sem e-mail, abre o rascunho sem destinatário. */
export function linkEmail(email: string | null, assunto: string, corpo: string): string {
  const para = emailValido(email) ?? '';
  return `mailto:${para}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo)}`;
}
