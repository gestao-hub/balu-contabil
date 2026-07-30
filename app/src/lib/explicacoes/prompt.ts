// Bloco 6A — o prompt que pede a explicação à IA.
//
// ⚠️ A ASSINATURA É A GARANTIA. `montarPrompt` recebe `SituacaoFiscal` — um tipo
// que não tem como carregar valor, nome, documento ou competência. Não é
// disciplina de quem chama: é o compilador que impede o dado do contribuinte de
// chegar aqui. Se um dia alguém quiser passar "a guia", o caminho certo é
// derivar a situação dela, nunca alargar este parâmetro.
//
// Puro: sem I/O, sem `server-only`. Determinístico de propósito — mesma
// situação, mesmo prompt, para que dois rascunhos da mesma situação sejam
// comparáveis.
import {
  chaveDaSituacao, rotuloDoAnexo, type SituacaoFiscal,
} from '@/lib/fiscal/situacao-fiscal';
import { marcadoresDaChave } from './marcadores';
import type { TrechoJuridico } from '@/lib/base-juridica/buscar';

/** Como cada componente do DAS-MEI é dito em português, para a IA não ter de
 *  adivinhar a sigla. Só descreve o que o componente É — nada de alíquota, base
 *  de cálculo ou valor, que mudam por contribuinte e por ano. */
const NOME_COMPONENTE: Record<string, string> = {
  inss: 'INSS, a contribuição para a Previdência Social',
  icms: 'ICMS, o imposto estadual sobre circulação de mercadorias',
  iss: 'ISS, o imposto municipal sobre serviços',
};

function descreverSituacao(s: SituacaoFiscal): string {
  if (s.tributo === 'das-mei') {
    const partes = [...s.componentes].sort().map((c) => NOME_COMPONENTE[c] ?? c);
    return [
      'O contribuinte é um MEI (Microempreendedor Individual).',
      'Ele paga um valor mensal fixo pelo DAS (Documento de Arrecadação do Simples Nacional).',
      `Nesta situação, esse valor é composto por: ${partes.join('; ')}.`,
    ].join(' ');
  }

  const anexo = rotuloDoAnexo(s.anexo);
  const fator = s.fatorR
    ? ' Nesta situação vale o Fator R, a regra que compara a folha de pagamento com a receita para definir o anexo aplicável.'
    : '';
  return (
    `O contribuinte é uma empresa do Simples Nacional enquadrada no ${anexo}.` +
    ' Ele apura o valor devido todo mês pelo PGDAS-D, e o valor varia conforme a receita.' +
    fator
  );
}

/**
 * O prompt. As regras são ditas ao modelo, não esperadas dele: as três
 * proibições (não inventar valor, não aconselhar, não citar lei) são o que
 * mantém o texto dentro do que a Balu pode publicar sem um contador assinar
 * embaixo — e mesmo assim ele ainda passa por revisão humana antes de existir
 * para qualquer cliente.
 */
export function montarPrompt(s: SituacaoFiscal, contexto?: TrechoJuridico[]): string {
  const marcadores = marcadoresDaChave(chaveDaSituacao(s));
  const lista = marcadores.map((m) => `{${m}}`).join(', ');
  const exemplo = marcadores.length ? `{${marcadores[0]}}` : '{valor}';

  const secaoContexto = contexto && contexto.length
    ? [
        '',
        'CONTEXTO DE APOIO (uso interno seu, para redigir com precisão — NÃO cite',
        'nem repita este texto, nem mencione lei/norma/resolução no rascunho):',
        ...contexto.map((c) => `- ${c.titulo}: ${c.texto}`),
      ]
    : [];

  return [
    'Você escreve explicações curtas sobre tributos para donos de pequenas empresas no Brasil,',
    'em português simples, sem jargão. Quem vai ler não é contador.',
    '',
    'SITUAÇÃO:',
    descreverSituacao(s),
    ...secaoContexto,
    '',
    'REGRAS DO TEXTO:',
    '- Escreva de duas a quatro frases, em texto corrido, sem título e sem listas.',
    '- Fale com quem lê na segunda pessoa ("você paga"), não "o contribuinte paga".',
    `- Use exatamente estes marcadores, cada um pelo menos uma vez: ${lista}.`,
    // APRENDIDO CONTRA UM PROVEDOR DE VERDADE: sem este exemplo, o modelo trata
    // o marcador como se fosse o NOME do tributo e escreve "a contribuição
    // {inss}" — que, depois da troca, vira "a contribuição R$ 75,90". O marcador
    // é um VALOR, e a frase precisa continuar de pé depois da substituição.
    //
    // O exemplo usa o PRIMEIRO marcador desta situação, nunca um literal fixo:
    // um `{inss}` escrito à mão aqui apareceria também no prompt do PGDAS-D, que
    // não fornece esse marcador — o próprio teste de "nenhum marcador além dos
    // permitidos" pegou essa versão.
    '- Cada marcador será trocado por um valor em reais na hora de exibir. Escreva de',
    `  modo que a frase continue correta depois da troca: prefira "${exemplo} de <nome do`,
    `  tributo>", e nunca "a contribuição ${exemplo}" nem "o ${exemplo}".`,
    '- Não escreva nenhum valor em dinheiro, nenhuma alíquota e nenhum percentual:',
    '  os números entram só pelos marcadores.',
    '- Não invente marcador que não esteja na lista acima.',
    '- Não dê conselho: não diga o que fazer, o que contratar nem como economizar.',
    '- Não cite lei, artigo, resolução nem número de norma.',
    '- Não fale de prazo nem de data de vencimento.',
    '- Explique o que o contribuinte está pagando e por quê, e nada além disso.',
    '',
    'Responda apenas com o texto, sem aspas e sem comentários.',
  ].join('\n');
}
