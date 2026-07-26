// src/lib/fiscal/declaracoes-anuais/erros.ts
// Traduz o erro do Zod para uma frase que diz QUAL campo está errado.
//
// MOTIVO: as actions devolviam `issues[0].message` cru. Para um campo faltando,
// a mensagem padrão do Zod é "Required" — o usuário via só isso, num formulário
// de 22 campos, sem nenhuma pista de onde mexer.
import type { ZodIssue } from 'zod';

/** Quantos campos citar antes de resumir o resto. */
const MAX_CITADOS = 3;

/**
 * `rotulo` recebe o caminho do campo (`['socios', 0, 'cpf']`) e devolve o nome
 * que o usuário vê na tela. Cada módulo conhece os seus próprios rótulos.
 */
export function mensagemDeIssues(
  issues: readonly ZodIssue[],
  rotulo: (caminho: readonly (string | number)[]) => string,
): string {
  if (issues.length === 0) return 'Dados inválidos.';

  // Zod repete o mesmo campo quando há mais de uma regra quebrada; o usuário só
  // precisa saber onde mexer, uma vez por campo.
  const porCampo = new Map<string, string>();
  for (const i of issues) {
    const chave = i.path.join('.');
    if (!porCampo.has(chave)) porCampo.set(chave, descrever(i, rotulo));
  }

  const todos = [...porCampo.values()];
  if (todos.length === 1) return todos[0];

  const citados = todos.slice(0, MAX_CITADOS).join(' · ');
  const resto = todos.length - MAX_CITADOS;
  return resto > 0 ? `${citados} — e mais ${resto} campo${resto > 1 ? 's' : ''}.` : citados;
}

function descrever(issue: ZodIssue, rotulo: (c: readonly (string | number)[]) => string): string {
  const nome = rotulo(issue.path);
  // "Required" e "Expected number, received nan" são texto de biblioteca, não de
  // produto: quem lê a tela precisa do nome do campo e do que fazer.
  const faltando = issue.code === 'invalid_type'
    && ('received' in issue ? issue.received === 'undefined' || issue.received === 'nan' : true);
  if (faltando) return nome ? `Preencha "${nome}".` : 'Preencha os campos obrigatórios.';
  return nome ? `${nome}: ${issue.message}` : issue.message;
}
