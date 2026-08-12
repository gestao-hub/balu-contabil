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
export type TurnoAnterior = { pergunta: string; resposta: string | null };

export type EntradaAtendimento = {
  pergunta: string;
  situacaoFiscalTexto: string | null;
  /** Trechos da base jurídica (documentos_juridicos) que casam com a pergunta.
   *  GROUNDING, NUNCA VOZ — mesma regra do 6A: servem para o assistente
   *  acertar a regra vigente, e o texto que chega ao cliente continua sem
   *  citar lei, artigo ou resolução (DL 9.295/46). */
  contextoJuridico?: { titulo: string; texto: string }[];
  /** Últimas trocas DESTA conversa, da mais antiga para a mais recente. Sem
   *  isto o assistente responde cada mensagem como se fosse a primeira, e o
   *  cliente precisa repetir tudo a cada pergunta. */
  historico?: TurnoAnterior[];
  /** 'geral' = dúvida conceitual (o que é IOF, como funciona o DAS), que a
   *  base jurídica responde mesmo sem nenhum dado da empresa. 'especifica' =
   *  depende dos números daquela empresa. Quem classifica é
   *  `lib/atendimento/classificar`, por código — não o modelo. */
  tipoPergunta?: 'geral' | 'especifica';
  /** true só na primeira mensagem desta conversa — a saudação do Assistente
   *  Balu aparece uma vez, nunca se repete (quem decide isto é o webhook,
   *  consultando se já existe atendimento anterior para este telefone). */
  primeiraInteracao?: boolean;
};

export function montarPromptAtendimento(e: EntradaAtendimento): string {
  // Sem dado fiscal, o texto muda conforme o tipo: numa dúvida geral, a
  // ausência é irrelevante e dizer "não encontramos" empurraria o modelo a
  // escalar sem necessidade.
  const contexto = e.situacaoFiscalTexto
    ?? (e.tipoPergunta === 'geral'
      ? '(não consultado — a pergunta não depende dos números da empresa)'
      : 'Não encontramos informação fiscal disponível para responder com segurança.');

  const apresentacao = e.primeiraInteracao
    ? [
        'Esta é a primeira mensagem desta conversa: comece com uma saudação breve',
        'e cordial, se apresentando como o Assistente Balu, o assistente virtual da',
        'Balu Contabilidade, antes de responder à pergunta. Não repita essa',
        'apresentação depois.',
        '',
      ]
    : [];

  // Memória: só as últimas trocas. O estado que vale é o do banco, e mandar a
  // conversa inteira encareceria o prompt e aumentaria a chance de o modelo se
  // apoiar em algo velho.
  const memoria = (e.historico ?? []).length > 0
    ? [
        'Conversa até aqui (mais antiga primeiro):',
        ...(e.historico ?? []).slice(-4).map((t) =>
          `- Cliente: ${t.pergunta}
  Assistente: ${t.resposta ?? '(sem resposta)'}`),
        '',
      ]
    : [];

  // Base jurídica: contexto interno, com instrução explícita de não virar voz.
  const juridico = (e.contextoJuridico ?? []).length > 0
    ? [
        'Material de apoio da legislação vigente (uso INTERNO, para você acertar a regra):',
        ...(e.contextoJuridico ?? []).slice(0, 4).map((t) => `- ${t.titulo}: ${t.texto.slice(0, 600)}`),
        'Use este material para responder com precisão, mas NÃO cite lei, artigo,',
        'resolução nem número de norma na sua resposta — explique em português simples.',
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
    ...memoria,
    ...juridico,
    `Pergunta do cliente: "${e.pergunta}"`,
    `O que já sabemos sobre a situação fiscal dele: ${contexto}`,
    '',
    'Responda em até 3 frases, em português simples, usando SOMENTE a informação acima',
    '(situação fiscal, material de apoio e o que já foi dito nesta conversa).',
    'Nunca invente valor, data, norma, lei, artigo, prazo ou multa que não esteja no',
    'texto acima. Nunca oriente sonegação, fraude nem forma de burlar a fiscalização.',
    ...(e.tipoPergunta === 'geral'
      ? [
          'ESTA É UMA DÚVIDA GERAL sobre como funcionam impostos e obrigações — não',
          'depende dos números da empresa de quem perguntou. Responda com o material de',
          'apoio acima, de forma didática, ainda que não haja dado fiscal do cliente.',
          'Não encaminhe para o contador só porque falta a situação fiscal dele.',
          'Não cite valor específico da empresa dele; se ele quiser o próprio número,',
          'convide a perguntar sobre isso em seguida.',
          'Se conseguiu explicar, use "resolvido": true.',
        ]
      : [
          'ESTA PERGUNTA É SOBRE A EMPRESA DE QUEM PERGUNTOU. Se a situação fiscal acima',
          'não trouxer o que responder, NÃO tente deduzir nem responder de forma genérica:',
          'diga que vai encaminhar para o contador e use "resolvido": false.',
        ]),
    '',
    'Responda em JSON, só com estas duas chaves: ',
    '{ "resposta": "...", "resolvido": true ou false }',
  ].join('\n');
}
