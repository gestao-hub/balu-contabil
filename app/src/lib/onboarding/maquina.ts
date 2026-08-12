// Onboarding conversacional — a máquina de estados.
//
// Quem decide o que falta e quando o cadastro está completo é ESTE arquivo,
// não o modelo. A IA escreve a pergunta; a decisão de avançar, de repetir ou
// de concluir é determinística — mesmo princípio de todo o resto do projeto
// ("determinístico decide, IA explica").
//
// Sem isso, um modelo alucinando "pronto, cadastrei sua empresa!" criaria a
// pior classe de bug possível aqui: o usuário sai achando que tem cadastro.
import type { CamposExtraidos, Intencao } from './extrair';

export type EstadoOnboarding = {
  intencao: Intencao;
  campos: CamposExtraidos;
};

export type Passo =
  | { tipo: 'perguntar'; campo: CampoPendente; sugestao: string }
  | { tipo: 'concluir'; destino: 'empresa' | 'escritorio' | 'abertura' };

export type CampoPendente = 'intencao' | 'cnpj' | 'crc';

/** O texto de fallback: usado quando não há IA, ou quando ela falha. */
const PERGUNTA_PADRAO: Record<CampoPendente, string> = {
  intencao:
    'Para começar: você é contador e vai atender clientes por aqui, ou está cadastrando a sua própria empresa? '
    + 'Se ainda não tem CNPJ e quer abrir, também pode me dizer.',
  cnpj: 'Certo. Qual é o CNPJ da empresa? Pode colar do jeito que estiver.',
  crc: 'Perfeito. Me passa o número do seu CRC e a UF (por exemplo: SP-123456).',
};

/**
 * O que falta agora. Uma pergunta por vez, de propósito: pedir três coisas
 * numa frase é o que faz formulário conversacional virar formulário ruim.
 */
export function proximoPasso(estado: EstadoOnboarding): Passo {
  if (estado.intencao === 'indefinido') {
    return { tipo: 'perguntar', campo: 'intencao', sugestao: PERGUNTA_PADRAO.intencao };
  }

  if (estado.intencao === 'abertura') {
    // Abertura é coleta de ~49 campos e documentos — isso é o wizard, não um
    // chat. O assistente identifica e entrega o usuário lá, que é exatamente o
    // que o cliente pediu ("apenas coleta, execução manual pela equipe").
    return { tipo: 'concluir', destino: 'abertura' };
  }

  if (estado.intencao === 'contador') {
    if (!estado.campos.crc || !estado.campos.crcUf) {
      return { tipo: 'perguntar', campo: 'crc', sugestao: PERGUNTA_PADRAO.crc };
    }
    if (!estado.campos.cnpj) {
      return { tipo: 'perguntar', campo: 'cnpj', sugestao: 'E qual é o CNPJ do escritório?' };
    }
    return { tipo: 'concluir', destino: 'escritorio' };
  }

  // empresa_existente
  if (!estado.campos.cnpj) {
    return { tipo: 'perguntar', campo: 'cnpj', sugestao: PERGUNTA_PADRAO.cnpj };
  }
  return { tipo: 'concluir', destino: 'empresa' };
}

/**
 * Junta o que já se sabia com o que veio da mensagem nova.
 *
 * O campo já preenchido NÃO é sobrescrito por um valor novo da mesma
 * mensagem: se o usuário corrigir algo, ele diz explicitamente, e a correção
 * passa por `limpar`. Sobrescrever em silêncio faria um CNPJ citado de
 * passagem ("o do meu contador é ...") trocar o da empresa.
 */
export function acumular(estado: EstadoOnboarding, novos: CamposExtraidos, intencao: Intencao): EstadoOnboarding {
  return {
    intencao: estado.intencao === 'indefinido' ? intencao : estado.intencao,
    campos: {
      cnpj: estado.campos.cnpj ?? novos.cnpj,
      email: estado.campos.email ?? novos.email,
      telefone: estado.campos.telefone ?? novos.telefone,
      crc: estado.campos.crc ?? novos.crc,
      crcUf: estado.campos.crcUf ?? novos.crcUf,
    },
  };
}

/** Recomeço explícito ("errei", "não é isso", "quero mudar"). */
export function pediuRecomecar(texto: string): boolean {
  return /\b(recome[çc]ar|come[çc]ar de novo|errei|n[ãa]o [ée] (isso|isto)|voltar|corrigir|mudar)\b/i.test(texto);
}
