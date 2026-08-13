// P10 — sugestão do código de tributação (Lista Nacional) na emissão de NFS-e.
//
// GUARD-RAIL DO PROJETO, aplicado aqui igual ao 6A: **determinístico decide,
// IA explica**. Este arquivo é o "decide". Ele monta a lista curta de códigos
// candidatos a partir da descrição do serviço e do CNAE da empresa, por
// casamento de termos — sem rede, sem modelo, sem chave.
//
// Por que o modelo não escolhe sozinho: código de tributação errado sai na nota
// e vira retificação (ou autuação) no município. O modelo pode, no máximo,
// escolher DENTRO desta lista e escrever o porquê em português — quem valida o
// universo de opções é o código.
//
// O universo é de propósito o mesmo `CODIGOS_TRIBUTACAO_FREQUENTES` que o select
// da tela já oferece. Sugerir um código fora dele daria uma sugestão que o
// formulário não sabe selecionar — e o usuário teria que digitar na mão um
// número vindo de um palpite.
import { CODIGOS_TRIBUTACAO_FREQUENTES } from './codigos-tributacao';

export type SugestaoCodigo = {
  codigo: string;
  label: string;
  /** Pontuação bruta — só serve para ordenar; não é "confiança" e não vai à tela. */
  pontos: number;
  /** Em pt-BR, o que no texto levou a este código. É isso que a tela mostra. */
  motivos: string[];
};

/**
 * Termos que apontam para cada código.
 *
 * Escritos com acento de propósito: os dois lados passam por `normalizarTexto`
 * antes de comparar, então o acento não atrapalha o casamento — e o termo vai
 * inteiro e escrito certo para a frase que a tela mostra ("a descrição fala em
 * …"). Guardá-los sem acento economizaria nada e mostraria "manutencao" ao
 * usuário.
 *
 * Frase longa vale mais que palavra solta (ver `pontuar`): é isso que faz
 * "consultoria em informática" ganhar de "consultoria", e "manutenção de
 * sistemas" ganhar de "manutenção". Termo genérico demais é mantido fora de
 * propósito — "fiscal" sozinho apareceria em quase toda descrição de escritório
 * contábil e em nenhuma delas seria evidência.
 */
const TERMOS: Readonly<Record<string, readonly string[]>> = {
  '010701': [
    'consultoria em informática', 'consultoria em TI', 'consultoria em tecnologia',
    'assessoria em TI', 'consultoria de sistemas', 'diagnóstico de TI',
  ],
  '010101': [
    'análise e desenvolvimento de sistemas', 'desenvolvimento de sistemas',
    'desenvolvimento de software', 'análise de sistemas', 'fábrica de software',
    'desenvolvimento de aplicativo', 'desenvolvimento de site', 'sistema web',
    'integração de sistemas', 'landing page', 'aplicativo', 'software', 'site', 'API',
  ],
  '010401': [
    'programação', 'codificação', 'automação de rotina', 'script', 'macro',
  ],
  '010601': [
    'suporte técnico em TI', 'suporte técnico', 'manutenção de sistemas',
    'manutenção de sistema', 'sustentação de sistemas', 'help desk', 'helpdesk',
    'infraestrutura de TI', 'administração de servidores', 'rede de computadores',
  ],
  '170101': [
    'consultoria empresarial', 'consultoria de gestão', 'planejamento estratégico',
    'assessoria empresarial', 'consultoria', 'assessoria',
  ],
  '170501': [
    'serviços de contabilidade', 'escrituração contábil', 'balanço patrimonial',
    'obrigações acessórias', 'folha de pagamento', 'departamento pessoal',
    'imposto de renda', 'contabilidade', 'escrituração', 'contábil',
  ],
  '170601': [
    'serviços advocatícios', 'honorários advocatícios', 'parecer jurídico',
    'consultoria jurídica', 'acompanhamento processual', 'advocacia',
    'advocatícios', 'jurídico',
  ],
  '170801': [
    'propaganda e publicidade', 'campanha publicitária', 'gestão de redes sociais',
    'criação de marca', 'identidade visual', 'marketing digital', 'tráfego pago',
    'social media', 'publicidade', 'propaganda', 'marketing', 'branding', 'design',
  ],
  '060201': [
    'manutenção e instalação', 'assistência técnica', 'instalação elétrica',
    'ar condicionado', 'instalação', 'manutenção', 'reparo', 'conserto', 'montagem',
  ],
  '140201': [
    'treinamento e capacitação', 'capacitação profissional', 'treinamento',
    'capacitação', 'instrutoria', 'workshop', 'palestra', 'mentoria', 'curso',
  ],
};

/**
 * CNAE (classe, 4 primeiros dígitos) → código provável.
 *
 * É pista, não veredito: uma empresa de CNAE 6201 pode emitir uma nota de
 * treinamento. Por isso o CNAE só soma bônus, nunca escolhe sozinho — e não
 * gera sugestão quando a descrição não aponta para lugar nenhum (ver
 * `sugerirCodigosServico`).
 */
const CNAE_PARA_CODIGO: Readonly<Record<string, string>> = {
  '6201': '010101', '6202': '010101', '6209': '010601', '6203': '010601',
  '6204': '010701', '6311': '010601', '6319': '010601',
  '6920': '170501',
  '6911': '170601',
  '7020': '170101', '7010': '170101', '7490': '170101',
  '7311': '170801', '7312': '170801', '7319': '170801', '7410': '170801',
  '8599': '140201', '8593': '140201', '8592': '140201', '8532': '140201',
  '3312': '060201', '3313': '060201', '3314': '060201', '3321': '060201',
  '4321': '060201', '4322': '060201', '4329': '060201', '9521': '060201', '9529': '060201',
};

const BONUS_CNAE = 3;

const LABEL = new Map(CODIGOS_TRIBUTACAO_FREQUENTES.map((c) => [c.codigo, c.label]));

/** Minúscula, sem acento, pontuação virando espaço — para comparar termo com texto. */
export function normalizarTexto(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Frase longa vale mais: o peso é a quantidade de palavras do termo. */
function pesoDo(termo: string): number {
  return normalizarTexto(termo).split(' ').filter(Boolean).length;
}

/**
 * Quanto vale um termo casado, conforme ONDE ele aparece.
 *
 * Descrição de nota começa pelo serviço vendido e segue com o contexto:
 * "Treinamento de equipe em rotinas de departamento pessoal" é treinamento, não
 * departamento pessoal. Por isso o que abre a frase pesa o triplo — sem isso, um
 * complemento de três palavras derruba o substantivo que nomeia o serviço.
 */
// Medido em PALAVRAS, não em caracteres: "…em rotinas de departamento pessoal"
// começa no caractere 34, e um limite em caracteres daria a ele o mesmo peso de
// cabeça que "Treinamento", que abre a frase.
const CABECA_PALAVRAS = 2;
function pesoNoTexto(termo: string, alvo: string): number {
  const t = normalizarTexto(termo);
  const onde = alvo.indexOf(` ${t} `);
  if (onde < 0) return 0;
  const palavrasAntes = alvo.slice(0, onde).trim().split(' ').filter(Boolean).length;
  return pesoDo(termo) * (palavrasAntes <= CABECA_PALAVRAS ? 3 : 1);
}

/**
 * Lista curta de códigos candidatos, do mais provável para o menos.
 *
 * Devolve `[]` quando nada casa — e isso é resposta, não falha. Sem evidência no
 * texto, chutar um código de 6 dígitos é pior que não sugerir: o usuário
 * confiaria num número que ninguém derivou de nada.
 */
export function sugerirCodigosServico(
  descricao: string,
  cnae?: string | null,
  limite = 3,
): SugestaoCodigo[] {
  const texto = normalizarTexto(descricao);
  if (!texto) return [];
  // Espaço nas pontas = casamento por PALAVRA INTEIRA. Sem isso, "API" acha
  // "terapia" e "design" acha "designação" — e o usuário recebe um código de
  // TI para uma nota de clínica.
  const alvo = ` ${texto} `;

  const cnaeDigitos = String(cnae ?? '').replace(/\D+/g, '');
  const codigoDoCnae = cnaeDigitos.length >= 4 ? CNAE_PARA_CODIGO[cnaeDigitos.slice(0, 4)] : undefined;

  const achados: SugestaoCodigo[] = [];

  for (const { codigo, label } of CODIGOS_TRIBUTACAO_FREQUENTES) {
    const termos = TERMOS[codigo] ?? [];
    let pontos = 0;
    const motivos: string[] = [];

    // Só o termo mais específico de cada código entra no motivo — listar
    // "software" logo abaixo de "desenvolvimento de software" é ruído.
    const casados = termos
      .filter((t) => alvo.includes(` ${normalizarTexto(t)} `))
      .sort((a, b) => pesoNoTexto(b, alvo) - pesoNoTexto(a, alvo));

    if (casados.length > 0) {
      pontos += casados.reduce((s, t) => s + pesoNoTexto(t, alvo), 0);
      motivos.push(`a descrição fala em "${casados[0]}"`);
    }

    if (codigoDoCnae === codigo) {
      pontos += BONUS_CNAE;
      motivos.push(`o CNAE ${cnaeDigitos.slice(0, 4)} da empresa é dessa atividade`);
    }

    if (pontos > 0) achados.push({ codigo, label: label ?? LABEL.get(codigo) ?? '', pontos, motivos });
  }

  // Empate resolvido pelo código: a mesma descrição sugere sempre a mesma coisa.
  achados.sort((a, b) => (b.pontos - a.pontos) || a.codigo.localeCompare(b.codigo));

  // Um CNAE conhecido não produz sugestão sozinho: seria sugerir "contabilidade"
  // para um escritório contábil que digitou "serviço prestado em julho".
  const comTexto = achados.some((s) => s.motivos.some((m) => m.startsWith('a descrição')));
  if (!comTexto) return [];

  return achados.slice(0, Math.max(1, limite));
}
