// Onboarding conversacional — extração determinística e redação de dado pessoal.
//
// ⚠️ ESTE ARQUIVO EXISTE POR CAUSA DE UMA REGRA DO PROJETO. O cliente de IA
// (`lib/ai/cliente.ts`) declara, no topo: "ESTA FUNÇÃO NUNCA RECEBE DADO DE
// CONTRIBUINTE". Um onboarding conversacional é, por natureza, o usuário
// digitando CNPJ, nome e e-mail — o que romperia a regra no ponto mais
// sensível possível, o cadastro.
//
// A saída: o modelo não precisa do número para conduzir a conversa. Ele
// precisa saber QUE veio um CNPJ, não QUAL. Aqui os valores são extraídos e
// validados por código, e o texto que segue para o provedor vai com marcadores
// (`⟨CNPJ⟩`) no lugar dos dados.
//
// Consequência prática: se o provedor de IA guardar prompts (todos guardam
// algum log), o que ele guarda não identifica ninguém.
import { isValidCnpj } from '@/lib/validators/cnpj';

export type CamposExtraidos = {
  cnpj?: string;        // 14 dígitos, validado
  email?: string;
  telefone?: string;    // só dígitos
  crc?: string;
  crcUf?: string;
};

export type Redacao = { texto: string; campos: CamposExtraidos };

const UFS = new Set([
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB',
  'PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO',
]);

const soDigitos = (s: string): string => s.replace(/\D+/g, '');

/**
 * Acha o primeiro CNPJ VÁLIDO no texto — com ou sem máscara.
 *
 * Valida o dígito verificador em vez de aceitar "14 dígitos": num campo livre,
 * um telefone com DDD e ramal também tem 14 dígitos, e tratar isso como CNPJ
 * faria a consulta à Receita falhar por um motivo que o usuário não entenderia.
 */
export function acharCnpj(texto: string): string | null {
  const candidatos = texto.match(/\d[\d./\s-]{12,20}\d/g) ?? [];
  for (const c of candidatos) {
    const d = soDigitos(c);
    if (d.length === 14 && isValidCnpj(d)) return d;
  }
  return null;
}

export function acharEmail(texto: string): string | null {
  const m = texto.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return m ? m[0].toLowerCase() : null;
}

/**
 * Telefone brasileiro com DDD (10 ou 11 dígitos).
 *
 * As âncoras `(?<!\d)`/`(?!\d)` não são detalhe: sem elas, o padrão casa com
 * os 10 primeiros dígitos de um número de 12 (uma inscrição estadual, por
 * exemplo) e a redação sai pela metade — `⟨TELEFONE⟩12`, com dígitos vazando
 * e o rótulo errado. Pego por teste.
 */
export function acharTelefone(texto: string): string | null {
  const m = texto.match(/(?<!\d)\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}(?!\d)/);
  if (!m) return null;
  const d = soDigitos(m[0]);
  return d.length === 10 || d.length === 11 ? d : null;
}

/**
 * Padrão de CRC: 1–2 letras de UF + números (ex.: "SP-123456" ou "CRC/SP 123456").
 *
 * Fábrica, e não constante: regex com `g` carrega `lastIndex`, e uma instância
 * compartilhada entre `acharCrc` e `redigir` faria uma chamada começar de onde
 * a outra parou.
 */
const crcRe = (): RegExp => /\b(?:crc\s*[-/]?\s*)?([A-Za-z]{2})\s*[-/]?\s*(\d{4,8})\b/gi;

/**
 * Acha o CRC no texto.
 *
 * Percorre TODOS os candidatos, e não só o primeiro: qualquer par de letras
 * seguido de 4–8 dígitos casa com o padrão ("os 12345 reais", "ap 4501"), e
 * parar no primeiro descartaria o CRC de verdade que vem depois — o assistente
 * pediria o CRC de novo com a pessoa já tendo respondido.
 */
export function acharCrc(texto: string): { crc: string; uf: string } | null {
  for (const m of texto.matchAll(crcRe())) {
    const uf = m[1].toUpperCase();
    if (UFS.has(uf)) return { crc: m[2], uf };
  }
  return null;
}

/**
 * Devolve o texto com os dados pessoais trocados por marcadores, e os valores
 * extraídos à parte. É esta string — e só ela — que pode ir para o provedor.
 */
export function redigir(texto: string): Redacao {
  const campos: CamposExtraidos = {};
  let saida = texto;

  const cnpj = acharCnpj(texto);
  if (cnpj) {
    campos.cnpj = cnpj;
    // Troca todas as ocorrências daquele número, com ou sem máscara.
    saida = saida.replace(/\d[\d./\s-]{12,20}\d/g, (m) => (soDigitos(m) === cnpj ? '⟨CNPJ⟩' : m));
  }

  const email = acharEmail(saida);
  if (email) { campos.email = email; saida = saida.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '⟨EMAIL⟩'); }

  const tel = acharTelefone(saida);
  if (tel) {
    campos.telefone = tel;
    saida = saida.replace(/(?<!\d)\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}(?!\d)/g, '⟨TELEFONE⟩');
  }

  const crc = acharCrc(saida);
  if (crc) {
    campos.crc = crc.crc; campos.crcUf = crc.uf;
    // Só as ocorrências com UF de verdade: sem esse filtro, um "os 12345"
    // qualquer viraria ⟨CRC⟩ e o CRC real seguiria em claro no texto.
    saida = saida.replace(crcRe(), (m, uf: string) => (UFS.has(uf.toUpperCase()) ? '⟨CRC⟩' : m));
  }

  // Sobra numérica longa (CPF, inscrição, conta) também não passa.
  saida = saida.replace(/\b\d{7,}\b/g, '⟨NUMERO⟩');

  // ...e nem quando vem MASCARADA. Aqui contam os DÍGITOS da sequência, não o
  // comprimento da corrida: "529.982.247-25" tem 11 dígitos e nenhuma corrida
  // de 7 seguidos, então a regra acima sozinha mandaria um CPF inteiro para o
  // provedor — exatamente o que este arquivo existe para impedir. O piso de 9
  // dígitos deixa datas (12/08/2026, 8 dígitos) e valores passarem.
  saida = saida.replace(/\d[\d./-]*\d/g, (m) => (soDigitos(m).length >= 9 ? '⟨NUMERO⟩' : m));

  return { texto: saida, campos };
}

export type Intencao = 'contador' | 'empresa_existente' | 'abertura' | 'indefinido';

/**
 * Leitura determinística da intenção, por palavras-chave.
 *
 * Roda ANTES da IA e prevalece quando é conclusiva: é ela que faz o onboarding
 * continuar de pé com o provedor fora do ar, sem chave configurada, ou quando
 * o modelo devolve bobagem. A IA melhora a conversa; não é a fundação dela.
 */
export function intencaoPorPalavras(texto: string): Intencao {
  const t = texto.toLowerCase();

  // "não tenho CNPJ" contém "tenho cnpj". Sem apagar o trecho negado antes de
  // procurar por posse, a frase mais comum de quem quer ABRIR empresa é lida
  // como "já tem empresa" — e a pessoa cai no fluxo errado logo na primeira
  // resposta.
  const semNegado = t.replace(/n[ãa]o\s+(tenho|possuo|tem)\s+[\w-]+(\s+[\w-]+)?/g, ' ');

  const ehContador = /\b(sou (um |uma )?contador|contadora|escrit[óo]rio|contabilidade|meus clientes|minha carteira|crc)\b/.test(t);
  const querAbrir = /\b(abrir|abertura|n[ãa]o tenho (cnpj|empresa)|ainda n[ãa]o tenho|quero abrir|constituir)\b/.test(t);
  const temEmpresa = /\b(j[áa] tenho|minha empresa|meu cnpj|tenho cnpj|empresa aberta|sou mei|sou empres[áa]rio)\b/.test(semNegado);

  // Ordem importa: "sou contador e quero abrir uma empresa pro meu cliente"
  // é um contador. O papel manda mais que a tarefa.
  if (ehContador) return 'contador';
  if (querAbrir && !temEmpresa) return 'abertura';
  if (temEmpresa) return 'empresa_existente';
  if (acharCnpj(texto)) return 'empresa_existente';   // mandou o CNPJ = já tem empresa
  return 'indefinido';
}
