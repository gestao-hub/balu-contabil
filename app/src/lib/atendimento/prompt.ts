// Bloco 6B — o prompt do atendimento. Puro, sem I/O: quem chama a IA
// (Task 6) monta o prompt aqui e passa para `gerarTexto` (lib/ai/cliente.ts,
// já existe do 6A).
//
// MESMA GARANTIA DO 6A: este módulo só recebe TEXTO já calculado
// (`situacaoFiscalTexto`, produto de `buscarSituacaoAtualMei`), nunca um valor
// numérico cru — a IA não tem como inventar um número que nunca viu.
export type EntradaAtendimento = {
  pergunta: string;
  situacaoFiscalTexto: string | null;
};

export function montarPromptAtendimento(e: EntradaAtendimento): string {
  const contexto = e.situacaoFiscalTexto
    ?? 'Não encontramos informação fiscal disponível para responder com segurança.';

  return [
    'Você é o atendimento de um escritório de contabilidade, respondendo por WhatsApp.',
    `Pergunta do cliente: "${e.pergunta}"`,
    `O que já sabemos sobre a situação fiscal dele: ${contexto}`,
    '',
    'Responda em até 3 frases, em português simples, usando SOMENTE a informação acima.',
    'Nunca invente valor, data ou norma que não esteja no texto acima.',
    'Se a informação acima não for suficiente para responder com segurança, diga que vai',
    'encaminhar para o contador.',
    '',
    'Responda em JSON, só com estas duas chaves: ',
    '{ "resposta": "...", "resolvido": true ou false }',
  ].join('\n');
}
