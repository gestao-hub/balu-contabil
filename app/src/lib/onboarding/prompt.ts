// Onboarding conversacional — o prompt.
//
// A IA tem UMA função aqui: escrever a próxima pergunta com jeito de gente, e
// dizer que intenção ela leu. Ela não decide campo, não valida documento e não
// conclui cadastro — isso é da `maquina.ts`.
//
// O que entra no prompt já passou por `redigir()`: nenhum CNPJ, e-mail,
// telefone ou número longo chega ao provedor.
import type { Intencao } from './extrair';
import type { CampoPendente } from './maquina';

export type TurnoRedigido = { de: 'usuario' | 'balu'; texto: string };

const CAMPO_EXPLICADO: Record<CampoPendente, string> = {
  intencao: 'descobrir se a pessoa é CONTADOR (atende clientes), se ela JÁ TEM empresa com CNPJ, ou se QUER ABRIR uma empresa',
  cnpj: 'pedir o CNPJ',
  crc: 'pedir o número do CRC e a UF',
};

export function montarPromptOnboarding(entrada: {
  historico: TurnoRedigido[];
  campoPendente: CampoPendente;
  intencaoAtual: Intencao;
}): string {
  const conversa = entrada.historico
    .slice(-6)   // memória curta: o estado real está na máquina, não no texto
    .map((t) => `${t.de === 'usuario' ? 'Pessoa' : 'Balu'}: ${t.texto}`)
    .join('\n');

  return [
    'Você é o assistente de cadastro do Balu, um app de contabilidade para MEI e Simples Nacional no Brasil.',
    'Seu único trabalho é conduzir o cadastro com poucas perguntas, em português do Brasil, com frases curtas e cordiais.',
    '',
    'REGRAS INVIOLÁVEIS:',
    '- Nunca invente dados. Nunca confirme que algo foi cadastrado — quem cadastra é o sistema.',
    '- Nunca dê orientação fiscal, contábil ou jurídica, nem cite leis. Se perguntarem, diga que um contador responde isso depois do cadastro.',
    '- Os dados pessoais aparecem mascarados (⟨CNPJ⟩, ⟨EMAIL⟩). Isso é esperado: não peça para a pessoa repetir por estarem mascarados, e não os repita na resposta.',
    '- Faça UMA pergunta por vez.',
    '',
    `Objetivo do momento: ${CAMPO_EXPLICADO[entrada.campoPendente]}.`,
    entrada.intencaoAtual !== 'indefinido' ? `Já se sabe que a pessoa é: ${entrada.intencaoAtual}.` : '',
    '',
    conversa ? `Conversa até agora:\n${conversa}` : 'A conversa está começando.',
    '',
    'Responda SOMENTE com um JSON, sem cercas de código, neste formato:',
    '{"pergunta":"<a próxima mensagem para a pessoa, no máximo 2 frases>","intencao":"contador|empresa_existente|abertura|indefinido"}',
    'O campo "intencao" é a sua leitura do que a pessoa é; use "indefinido" quando ainda não der para saber.',
  ].filter(Boolean).join('\n');
}

/**
 * Lê o JSON do modelo com desconfiança.
 *
 * Modelos devolvem JSON válido mas fora da forma pedida, e alguns embrulham em
 * cerca markdown mesmo quando o prompt proíbe — as duas coisas já aconteceram
 * neste projeto (Bloco 6B). Sem checagem em runtime, `pergunta: undefined`
 * chegaria na tela como mensagem vazia do assistente.
 */
export function lerRespostaModelo(bruto: string): { pergunta: string; intencao: Intencao } | null {
  const semCerca = bruto.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1] ?? bruto;
  let j: unknown;
  try { j = JSON.parse(semCerca); } catch { return null; }
  if (!j || typeof j !== 'object') return null;

  const o = j as Record<string, unknown>;
  const pergunta = typeof o.pergunta === 'string' ? o.pergunta.trim() : '';
  if (!pergunta) return null;

  const bruta = typeof o.intencao === 'string' ? o.intencao : '';
  const intencao: Intencao =
    bruta === 'contador' || bruta === 'empresa_existente' || bruta === 'abertura' ? bruta : 'indefinido';

  // Teto de tamanho: o prompt pede 2 frases, mas prompt é pedido, não garantia
  // — e um parágrafo gigante quebraria a bolha do chat.
  return { pergunta: pergunta.slice(0, 400), intencao };
}
