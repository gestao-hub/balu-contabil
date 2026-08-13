// P10 — a parte da IA na sugestão de código de tributação: escolher DENTRO da
// lista curta que `sugerir-codigo.ts` já montou e escrever o porquê em pt-BR.
//
// O modelo não conhece o catálogo, não inventa código e não decide se emite. Se
// ele devolver qualquer coisa fora da lista, `lerSugestaoModelo` descarta e a
// tela mostra o primeiro colocado determinístico com os motivos do próprio
// código. É por isso que o pior caso desta função é "a explicação fica mais
// seca", nunca "a nota sai com o código errado".
import type { SugestaoCodigo } from './sugerir-codigo';

export type SugestaoDoModelo = { codigo: string; porque: string };

const MAX_PORQUE = 240;

export function montarPromptSugestao(entrada: {
  /** Já REDIGIDA — sem CNPJ, CPF, e-mail ou telefone. Ver a action. */
  descricaoRedigida: string;
  candidatos: SugestaoCodigo[];
}): string {
  const lista = entrada.candidatos
    .map((c) => `- ${c.codigo} — ${c.label}`)
    .join('\n');

  return [
    'Você ajuda um contador brasileiro a escolher o código da Lista de Serviços Nacional para uma NFS-e.',
    '',
    'Descrição do serviço prestado:',
    `"""${entrada.descricaoRedigida}"""`,
    '',
    'Códigos possíveis (escolha EXATAMENTE UM desta lista, nunca outro):',
    lista,
    '',
    'Regras:',
    '- Responda só com JSON, sem texto antes ou depois.',
    '- "codigo" tem que ser um dos códigos listados acima, copiado igual.',
    '- "porque" é UMA frase curta, em português simples, dizendo o que na descrição levou a esse código. Não cite lei nem artigo.',
    '- Não afirme que o código está correto: quem confere é o contador.',
    '',
    'Formato:',
    '{"codigo":"010101","porque":"a descrição é de desenvolvimento de sistema sob encomenda"}',
  ].join('\n');
}

/**
 * Lê a resposta do modelo, aceitando só o que for verificável.
 *
 * `permitidos` é a lista curta que foi ao prompt. Um código fora dela é
 * descartado inteiro — inclusive quando o modelo acerta um código real que só
 * não estava na lista, porque aí ele estaria decidindo, e a regra é que quem
 * decide é o determinístico.
 */
export function lerSugestaoModelo(bruto: string, permitidos: string[]): SugestaoDoModelo | null {
  const texto = String(bruto ?? '').trim();
  if (!texto) return null;

  // Cerca markdown é o desvio mais comum dos modelos pequenos.
  const semCerca = texto.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const inicio = semCerca.indexOf('{');
  const fim = semCerca.lastIndexOf('}');
  if (inicio < 0 || fim <= inicio) return null;

  let obj: unknown;
  try {
    obj = JSON.parse(semCerca.slice(inicio, fim + 1));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const o = obj as Record<string, unknown>;

  const codigo = String(o.codigo ?? o.code ?? '').replace(/\D+/g, '');
  if (!permitidos.includes(codigo)) return null;

  const porque = String(o.porque ?? o.justificativa ?? o.motivo ?? o.why ?? '').trim();
  // Sem justificativa não há ganho sobre o determinístico — que já traz os
  // motivos dele. Devolver `null` faz a tela usar aqueles, que são melhores
  // que uma frase vazia.
  if (!porque) return null;

  return { codigo, porque: porque.slice(0, MAX_PORQUE) };
}
