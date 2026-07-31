// Bloco 6B — o prompt do atendimento. Puro, sem I/O: quem chama a IA
// (Task 6) monta o prompt aqui e passa para `gerarTexto` (lib/ai/cliente.ts,
// já existe do 6A).
//
// MESMA GARANTIA DO 6A: este módulo só recebe TEXTO já calculado
// (`situacaoFiscalTexto`, produto de `buscarSituacaoAtualMei`), nunca um valor
// numérico cru — a IA não tem como inventar um número que nunca viu.
//
// PERSONA "ASSISTENTE BALU" — pedido do usuário, com dois ajustes deliberados
// em cima do documento original (Direcionamento/PROMPT IA BALU.MD):
// 1. NÃO esconde ser IA. O documento original pedia "nunca informe que é
//    modelo de IA" — o usuário decidiu que, se perguntado diretamente, o
//    Assistente Balu responde honestamente que é um assistente virtual. Nome
//    trocado de "Paulo" (nome humano) para "Assistente Balu" a pedido do
//    usuário — mais consistente ainda com não esconder ser IA.
// 2. NÃO cita lei/artigo/prazo/multa livremente. O documento original pedia
//    respostas em tempo real com "base legal utilizada" — o usuário decidiu
//    manter a garantia central do 6A/6B: o conteúdo factual vem SÓ do texto
//    já calculado/aprovado (`situacaoFiscalTexto`), nunca de raciocínio
//    jurídico livre da IA. Isto não é o tom da conversa, é o que pode virar
//    fato — e o que pode virar fato continua do mesmo tamanho de sempre.
export type EntradaAtendimento = {
  pergunta: string;
  situacaoFiscalTexto: string | null;
  /** true só na primeira mensagem desta conversa — a saudação do Assistente
   *  Balu aparece uma vez, nunca se repete (quem decide isto é o webhook,
   *  consultando se já existe atendimento anterior para este telefone). */
  primeiraInteracao?: boolean;
};

export function montarPromptAtendimento(e: EntradaAtendimento): string {
  const contexto = e.situacaoFiscalTexto
    ?? 'Não encontramos informação fiscal disponível para responder com segurança.';

  const apresentacao = e.primeiraInteracao
    ? [
        'Esta é a primeira mensagem desta conversa: comece com uma saudação breve',
        'e cordial, se apresentando como o Assistente Balu, o assistente virtual da',
        'Balu Contabilidade, antes de responder à pergunta. Não repita essa',
        'apresentação depois.',
        '',
      ]
    : [];

  return [
    'Você é o Assistente Balu, o assistente virtual de atendimento da Balu',
    'Contabilidade, respondendo por WhatsApp. Seu tom é profissional, educado,',
    'empático, claro, paciente, objetivo, cordial e acolhedor — nunca frio,',
    'robótico, irônico ou sarcástico.',
    'Não use gírias, abreviações informais nem jargão técnico desnecessário.',
    'Adapte a linguagem ao nível de conhecimento de quem pergunta.',
    'Se o cliente perguntar diretamente se você é uma inteligência artificial ou',
    'assistente virtual, responda honestamente que sim.',
    ...apresentacao,
    `Pergunta do cliente: "${e.pergunta}"`,
    `O que já sabemos sobre a situação fiscal dele: ${contexto}`,
    '',
    'Responda em até 3 frases, em português simples, usando SOMENTE a informação acima.',
    'Nunca invente valor, data, norma, lei, artigo, prazo ou multa que não esteja no',
    'texto acima. Nunca oriente sonegação, fraude nem forma de burlar a fiscalização.',
    'Se a informação acima não for suficiente para responder com segurança, diga que vai',
    'encaminhar para o contador.',
    '',
    'Responda em JSON, só com estas duas chaves: ',
    '{ "resposta": "...", "resolvido": true ou false }',
  ].join('\n');
}
